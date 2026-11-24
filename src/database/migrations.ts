/**
 * Migrations versionadas. NUNCA editar uma migration já publicada: crie uma nova.
 * Convenções: datas em TEXT ISO-8601 UTC; dinheiro em INTEGER centavos; JSON em TEXT.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE secrets (
  ref TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  scheme TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE marketplaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE marketplace_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_id TEXT NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured',
  account_ref TEXT,
  secret_ref TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (marketplace_id, label)
);

CREATE TABLE integration_capabilities (
  marketplace_id TEXT NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (marketplace_id, capability)
);

CREATE TABLE product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_id TEXT NOT NULL REFERENCES marketplaces(id),
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  shop_id TEXT,
  shop_name TEXT,
  category_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL,
  image_url TEXT,
  price_cents INTEGER,
  original_price_cents INTEGER,
  discount_pct REAL,
  commission_rate REAL,
  commission_cents INTEGER,
  rating REAL,
  rating_count INTEGER,
  sales_count INTEGER,
  available INTEGER,
  free_shipping INTEGER,
  offer_link TEXT,
  data_source TEXT NOT NULL,
  raw_json TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (marketplace_id, external_id)
);
CREATE INDEX idx_products_normalized_url ON products(normalized_url);
CREATE INDEX idx_products_marketplace ON products(marketplace_id);
CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, url)
);

CREATE TABLE product_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL,
  original_price_cents INTEGER,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_price_history_product_time ON product_price_history(product_id, observed_at);

CREATE TABLE product_commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rate REAL,
  amount_cents INTEGER,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_product_commissions_product ON product_commissions(product_id, observed_at);

CREATE TABLE coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_id TEXT NOT NULL REFERENCES marketplaces(id),
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  description TEXT,
  valid_until TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (marketplace_id, product_id, code)
);

CREATE TABLE affiliate_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  marketplace_id TEXT NOT NULL REFERENCES marketplaces(id),
  account_id INTEGER REFERENCES marketplace_accounts(id) ON DELETE SET NULL,
  original_url TEXT NOT NULL,
  affiliate_url TEXT NOT NULL,
  sub_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (account_id, original_url, sub_ids)
);
CREATE INDEX idx_affiliate_links_product ON affiliate_links(product_id);

CREATE TABLE favorites (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  monitor_price INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE blocked_products (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE blocked_sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_id TEXT NOT NULL REFERENCES marketplaces(id),
  shop_id TEXT NOT NULL,
  shop_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (marketplace_id, shop_id)
);

CREATE TABLE audience_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  max_price_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE channel_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured',
  secret_ref TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (channel_id, label)
);

CREATE TABLE destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_account_id INTEGER NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified',
  audience_profile_id INTEGER REFERENCES audience_profiles(id) ON DELETE SET NULL,
  categories TEXT NOT NULL DEFAULT '[]',
  allowed_start TEXT NOT NULL DEFAULT '08:00',
  allowed_end TEXT NOT NULL DEFAULT '22:00',
  min_interval_minutes INTEGER NOT NULL DEFAULT 30,
  daily_limit INTEGER NOT NULL DEFAULT 20,
  consent_confirmed INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (channel_account_id, external_id)
);

CREATE TABLE message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  style TEXT NOT NULL DEFAULT 'Personalizado',
  body TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  mode TEXT NOT NULL DEFAULT 'semi',
  marketplaces TEXT NOT NULL DEFAULT '[]',
  categories TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  excluded_keywords TEXT NOT NULL DEFAULT '[]',
  min_price_cents INTEGER,
  max_price_cents INTEGER,
  min_discount_pct REAL,
  min_commission_rate REAL,
  min_score REAL NOT NULL DEFAULT 70,
  min_rating REAL,
  days_of_week TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  start_time TEXT NOT NULL DEFAULT '08:00',
  end_time TEXT NOT NULL DEFAULT '22:00',
  interval_minutes INTEGER NOT NULL DEFAULT 30,
  daily_limit INTEGER NOT NULL DEFAULT 20,
  template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
  repeat_days INTEGER NOT NULL DEFAULT 7,
  repeat_on_price_drop_pct REAL,
  stale_policy TEXT NOT NULL DEFAULT 'suspend',
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE campaign_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE campaign_destinations (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, destination_id)
);

CREATE TABLE automation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  run_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  locked_at TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_jobs_status_run ON automation_jobs(status, run_at);

CREATE TABLE publication_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  affiliate_link_id INTEGER REFERENCES affiliate_links(id) ON DELETE SET NULL,
  message_text TEXT NOT NULL,
  image_url TEXT,
  status TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  price_cents_at_enqueue INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_queue_status_time ON publication_queue(status, scheduled_at);
CREATE INDEX idx_queue_destination ON publication_queue(destination_id, status);

CREATE TABLE publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER UNIQUE REFERENCES publication_queue(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  channel_message_id TEXT,
  price_cents INTEGER,
  mode TEXT NOT NULL DEFAULT 'api',
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_publications_product_dest ON publications(product_id, destination_id, sent_at);
CREATE INDEX idx_publications_sent ON publications(sent_at);

CREATE TABLE publication_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER NOT NULL REFERENCES publication_queue(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT,
  error TEXT,
  response TEXT
);

CREATE TABLE analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  metric TEXT NOT NULL,
  dimension_type TEXT NOT NULL DEFAULT 'global',
  dimension_id TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  source TEXT NOT NULL,
  UNIQUE (date, metric, dimension_type, dimension_id, source)
);

CREATE TABLE conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_id TEXT NOT NULL REFERENCES marketplaces(id),
  account_id INTEGER REFERENCES marketplace_accounts(id) ON DELETE SET NULL,
  external_order_id TEXT NOT NULL,
  product_external_id TEXT NOT NULL DEFAULT '',
  sub_ids TEXT NOT NULL DEFAULT '[]',
  click_time TEXT,
  purchase_time TEXT,
  status TEXT NOT NULL,
  amount_cents INTEGER,
  commission_cents INTEGER,
  source TEXT NOT NULL,
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (marketplace_id, external_order_id, product_external_id)
);

CREATE TABLE commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_id TEXT NOT NULL REFERENCES marketplaces(id),
  period TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (marketplace_id, period, status, source)
);

CREATE TABLE application_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_logs_time ON application_logs(created_at);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  size_bytes INTEGER,
  sha256 TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`
  }
]
