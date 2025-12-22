# Cloudflare Workers + D1 (Community Lowest Price)

## Prereqs
- Node.js 18+
- Wrangler CLI (`npm i -g wrangler`)
- Cloudflare account

## Setup
```bash
cd cloudflare_worker
wrangler login
wrangler d1 create pchome-community-low
```

Update `wrangler.toml` with the `database_id` from the create step.

## Apply schema
```bash
wrangler d1 execute pchome-community-low --remote --file=./schema.sql
```

## Deploy
```bash
wrangler deploy
```

## Endpoints
- `GET  /health`
- `GET  /lowest?prodId=...`
- `POST /lowest` `{ "prodId": "..." }`
- `POST /ingest` `{ "items": [ { "prodId": "...", "price": 123 } ] }`
- `GET  /stats`

## Debug
`/lowest` responses include `X-Cache: HIT|MISS|BYPASS` for quick verification.

## Extension
In extension Options, enable **社群資料庫** and set the Base URL:
```
https://pchome-community-low.brad0315.workers.dev
```
