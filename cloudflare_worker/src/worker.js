export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cache = caches.default;
    const cacheTtlSeconds = 1800;

    if (request.method === "OPTIONS") {
      return withCors(new Response("", { status: 204 }));
    }

    if (path === "/health") {
      return withCors(json({ ok: true }));
    }

    if (path === "/stats") {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS c, MAX(updated_at) AS last_updated FROM lowest_prices"
      ).first();
      return withCors(json({ ok: true, count: row?.c ?? 0, last_updated: row?.last_updated ?? null }));
    }

    if (path === "/snapshot") {
      // Dump all data for client-side caching.
      // D1 'all()' verifies the limit. For <100k rows, this is usually fine.
      // If DB grows larger, we might need a R2 dump + redirect approach.
      // Cache this response for 1 hour at Cloudflare edge.
      const result = await env.DB.prepare(
        "SELECT prod_id, min_price FROM lowest_prices"
      ).all();

      const prices = {};
      if (result.results) {
        for (const r of result.results) {
          prices[r.prod_id] = r.min_price;
        }
      }

      const response = withCors(json({ ok: true, last_updated: new Date().toISOString(), prices }));
      // Cache for 1 hour (3600s)
      response.headers.set("Cache-Control", "public, max-age=3600");
      return response;
    }

    if (path === "/lowest" && (request.method === "GET" || request.method === "POST")) {
      if (request.method === "GET") {
        const cached = await cache.match(request);
        if (cached) {
          const hitResponse = withCors(cached);
          hitResponse.headers.set("X-Cache", "HIT");
          return hitResponse;
        }
      }
      const prodId = await getProdId(request, url);
      if (!prodId) {
        return withCors(json({ ok: false, error: "Missing prodId" }, 400));
      }
      const row = await env.DB.prepare(
        "SELECT min_price, updated_at FROM lowest_prices WHERE prod_id = ?"
      ).bind(prodId).first();
      const payload = row
        ? { prodId, minPrice: row.min_price, updatedAt: row.updated_at }
        : { prodId, minPrice: null, updatedAt: null };
      const response = withCors(json(payload));
      response.headers.set("X-Cache", request.method === "GET" ? "MISS" : "BYPASS");
      if (payload.minPrice == null) {
        response.headers.set("Cache-Control", "no-store");
      } else {
        response.headers.set("Cache-Control", `public, max-age=${cacheTtlSeconds}`);
        if (request.method === "GET") {
          await cache.put(request, response.clone());
        }
      }
      return response;
    }

    if (path === "/ingest" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      if (!payload || !Array.isArray(payload.items)) {
        return withCors(json({ ok: false, error: "Invalid payload" }, 400));
      }
      if (payload.items.length > 200) {
        return withCors(json({ ok: false, error: "Too many items" }, 400));
      }

      // Get client IP for basic rate limiting logging (or implementation if KV available)
      const clientIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";

      const now = new Date().toISOString();
      let stored = 0;
      let failed = 0;

      const stmt = env.DB.prepare(
        "INSERT INTO lowest_prices (prod_id, min_price, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(prod_id) DO UPDATE SET " +
        "min_price = CASE WHEN excluded.min_price < lowest_prices.min_price " +
        "THEN excluded.min_price ELSE lowest_prices.min_price END, " +
        "updated_at = CASE WHEN excluded.min_price < lowest_prices.min_price " +
        "THEN excluded.updated_at ELSE lowest_prices.updated_at END"
      );

      for (const item of payload.items) {
        const prodId = typeof item.prodId === "string" ? item.prodId.trim() : "";
        const price = Number(item.price);

        // 1. Strict Format Check
        if (!prodId || !/^[A-Z0-9-]+$/.test(prodId)) {
          continue;
        }
        if (!Number.isFinite(price) || price <= 0) {
          continue;
        }

        // 2. Server-Side Verification (Source of Truth Check)
        // Only run check if the price is surprisingly low (e.g. < 500 TWD) or just always randomly sample?
        // To be safe and since strict consistency isn't required, we verify EVERY ingest for now to prevent poisoning.
        // Optimization: In a high scale system, we might queue this. For now, we await.
        const verified = await verifyPriceWithOfficial(prodId, price);
        if (!verified) {
          failed += 1;
          console.log(`[Security] Rejected ${prodId} price ${price} from ${clientIp}`);
          continue;
        }

        // Write to lowest_prices
        const res = await stmt.bind(prodId, price, now).run();

        // Write to price_history (Log every verified ingest)
        // Optimization: In production, maybe only log if price changed? 
        // For MVP/Data gathering, log all valid reports to build density.
        await env.DB.prepare(
          "INSERT INTO price_history (prod_id, price, recorded_at) VALUES (?, ?, ?)"
        ).bind(prodId, price, now).run();

        if (res.success) {
          stored += 1;
          const cacheKey = new Request(
            new URL(`/lowest?prodId=${encodeURIComponent(prodId)}`, url.origin),
            { method: "GET" }
          );
          await cache.delete(cacheKey);
        }
      }
      return withCors(json({ ok: true, count: payload.items.length, stored, failed }));
    }

    return withCors(json({ ok: false, error: "Not found" }, 404));
  },
};

async function getProdId(request, url) {
  if (request.method === "GET") {
    return (url.searchParams.get("prodId") || "").trim();
  }
  const payload = await request.json().catch(() => null);
  if (payload && typeof payload.prodId === "string") {
    return payload.prodId.trim();
  }
  return "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Verifies if the reported price is reasonable compared to the official PChome API.
 * Returns true if the price is accepted (valid or close enough).
 * Returns false if the price is suspicious (too low).
 */
async function verifyPriceWithOfficial(prodId, reportedPrice) {
  // Pass PChome's user agent or similar to avoid block if needed.
  // Using a generic user agent for the worker.
  try {
    const url = `https://ecapi-cdn.pchome.com.tw/ecshop/prodapi/v2/prod/button&id=${encodeURIComponent(prodId)}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "PChome-Community-Price-Check-Worker/1.0",
        "Referer": "https://24h.pchome.com.tw/"
      },
      cf: {
        // Optimize Cloudflare routing if possible
        cacheTtl: 60,
        cacheEverything: true
      }
    });

    if (!resp.ok) {
      // Fail Secure: If official source is down, we reject new data to be proper.
      // Or maybe we Log it?
      // For now, return false.
      return false;
    }

    const data = await resp.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry || !entry.Price) {
      return false; // Product not found
    }

    const officialPrice = Number(entry.Price.P);

    if (!Number.isFinite(officialPrice)) {
      return false;
    }

    // Sanity check: reported price should not be absurdly lower than official price.
    // Allow up to 50% drop (e.g. clearance).
    if (reportedPrice < officialPrice * 0.5) {
      return false;
    }

    return true;

  } catch (e) {
    // console.error(e);
    return false;
  }
}
