var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cache = caches.default;
    const cacheTtlSeconds = 3600;
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
      response.headers.set("Cache-Control", `public, max-age=${cacheTtlSeconds}`);
      if (request.method === "GET") {
        await cache.put(request, response.clone());
      }
      return response;
    }
    if (path === "/lowest/batch" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      if (!payload || !Array.isArray(payload.prodIds)) {
        return withCors(json({ ok: false, error: "Invalid payload" }, 400));
      }
      const prodIds = payload.prodIds.filter((value) => typeof value === "string").map((value) => value.trim()).filter((value) => value.length > 0);
      if (prodIds.length === 0) {
        return withCors(json({ ok: false, error: "No prodIds" }, 400));
      }
      if (prodIds.length > 200) {
        return withCors(json({ ok: false, error: "Too many prodIds" }, 400));
      }
      const unique = Array.from(new Set(prodIds));
      const results = /* @__PURE__ */ new Map();
      const missIds = [];
      for (const prodId of unique) {
        const cacheKey = new Request(
          new URL(`/lowest?prodId=${encodeURIComponent(prodId)}`, url.origin),
          { method: "GET" }
        );
        const cached = await cache.match(cacheKey);
        if (cached) {
          const data = await cached.clone().json().catch(() => null);
          if (data && typeof data.prodId === "string") {
            results.set(prodId, {
              prodId,
              minPrice: data.minPrice ?? null,
              updatedAt: data.updatedAt ?? null
            });
            continue;
          }
        }
        missIds.push(prodId);
      }
      const rowsById = /* @__PURE__ */ new Map();
      const chunkSize = 100;
      for (let i = 0; i < missIds.length; i += chunkSize) {
        const chunk = missIds.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => "?").join(", ");
        const stmt = env.DB.prepare(
          `SELECT prod_id, min_price, updated_at FROM lowest_prices WHERE prod_id IN (${placeholders})`
        ).bind(...chunk);
        const rows = await stmt.all();
        for (const row of rows.results || []) {
          rowsById.set(row.prod_id, row);
        }
      }
      for (const prodId of missIds) {
        const row = rowsById.get(prodId);
        const item = row ? { prodId, minPrice: row.min_price, updatedAt: row.updated_at } : { prodId, minPrice: null, updatedAt: null };
        results.set(prodId, item);
        const cacheKey = new Request(
          new URL(`/lowest?prodId=${encodeURIComponent(prodId)}`, url.origin),
          { method: "GET" }
        );
        const response = withCors(json(item));
        response.headers.set("Cache-Control", `public, max-age=${cacheTtlSeconds}`);
        await cache.put(cacheKey, response);
      }
      const items = prodIds.map((prodId) => results.get(prodId) || { prodId, minPrice: null, updatedAt: null });
      return withCors(json({ ok: true, items }));
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
