CREATE TABLE IF NOT EXISTS lowest_prices (
  prod_id TEXT PRIMARY KEY,
  min_price INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
