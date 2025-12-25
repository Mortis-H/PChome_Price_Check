CREATE TABLE IF NOT EXISTS lowest_prices (
  prod_id TEXT PRIMARY KEY,
  min_price INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prod_id TEXT NOT NULL,
  price INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_prod_id ON price_history(prod_id);
CREATE INDEX IF NOT EXISTS idx_history_recorded_at ON price_history(recorded_at);
