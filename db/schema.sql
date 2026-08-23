-- Apply this schema to PostgreSQL (Railway, Neon, Supabase, etc.).
-- The API remains stateless until a DATABASE_URL-backed data layer is connected.
CREATE TABLE searches (
  id BIGSERIAL PRIMARY KEY,
  query VARCHAR(250) NOT NULL,
  result_source VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  external_id VARCHAR(255) NOT NULL,
  name VARCHAR(500) NOT NULL,
  retailer VARCHAR(120) NOT NULL,
  retailer_url TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (external_id, retailer)
);

CREATE TABLE affiliate_clicks (
  id BIGSERIAL PRIMARY KEY,
  product_external_id VARCHAR(255) NOT NULL,
  retailer VARCHAR(120) NOT NULL,
  affiliate_network VARCHAR(80),
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX affiliate_clicks_clicked_at_idx ON affiliate_clicks (clicked_at DESC);
