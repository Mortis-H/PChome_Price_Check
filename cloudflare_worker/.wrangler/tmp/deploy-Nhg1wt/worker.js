var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var worker_default = {
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
    if (path === "/lowest" && (request.method === "GET" || request.method === "POST")) {
      if (request.method === "GET") {
        const cached = await cache.match(request);
        if (cached) {
          return withCors(cached);
        }
      }
      const prodId = await getProdId(request, url);
      if (!prodId) {
        return withCors(json({ ok: false, error: "Missing prodId" }, 400));
      }
      const row = await env.DB.prepare(
        "SELECT min_price, updated_at FROM lowest_prices WHERE prod_id = ?"
      ).bind(prodId).first();
      const payload = row ? { prodId, minPrice: row.min_price, updatedAt: row.updated_at } : { prodId, minPrice: null, updatedAt: null };
      const response = withCors(json(payload));
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
      const now = (/* @__PURE__ */ new Date()).toISOString();
      let stored = 0;
      const stmt = env.DB.prepare(
        "INSERT INTO lowest_prices (prod_id, min_price, updated_at) VALUES (?, ?, ?) ON CONFLICT(prod_id) DO UPDATE SET min_price = CASE WHEN excluded.min_price < lowest_prices.min_price THEN excluded.min_price ELSE lowest_prices.min_price END, updated_at = CASE WHEN excluded.min_price < lowest_prices.min_price THEN excluded.updated_at ELSE lowest_prices.updated_at END"
      );
      for (const item of payload.items) {
        const prodId = typeof item.prodId === "string" ? item.prodId.trim() : "";
        const price = Number(item.price);
        if (!prodId || !Number.isFinite(price) || price < 0) {
          continue;
        }
        const res = await stmt.bind(prodId, price, now).run();
        if (res.success) {
          stored += 1;
          const cacheKey = new Request(
            new URL(`/lowest?prodId=${encodeURIComponent(prodId)}`, url.origin),
            { method: "GET" }
          );
          await cache.delete(cacheKey);
        }
      }
      return withCors(json({ ok: true, count: payload.items.length, stored }));
    }
    return withCors(json({ ok: false, error: "Not found" }, 404));
  }
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
__name(getProdId, "getProdId");
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
__name(json, "json");
function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { status: response.status, headers });
}
__name(withCors, "withCors");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
