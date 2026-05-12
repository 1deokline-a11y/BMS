-- BOM 관리 시스템 스키마
-- Supabase 대시보드 > SQL Editor > New Query 에서 실행

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  part_number TEXT UNIQUE NOT NULL,
  product_group TEXT NOT NULL DEFAULT '',
  variant_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  customer TEXT DEFAULT '',
  country_spec TEXT DEFAULT '',
  spec TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parts (
  id BIGSERIAL PRIMARY KEY,
  part_number TEXT UNIQUE NOT NULL,
  part_name TEXT NOT NULL DEFAULT '',
  spec TEXT DEFAULT '',
  unit TEXT DEFAULT 'EA'
);

CREATE TABLE IF NOT EXISTS bom_items (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  part_id BIGINT NOT NULL REFERENCES parts(id),
  quantity NUMERIC NOT NULL DEFAULT 1.0,
  row_order INTEGER DEFAULT 0,
  position TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS common_part_templates (
  id BIGSERIAL PRIMARY KEY,
  product_group TEXT NOT NULL,
  part_id BIGINT NOT NULL REFERENCES parts(id),
  default_quantity NUMERIC DEFAULT 1.0,
  UNIQUE(product_group, part_id)
);

CREATE TABLE IF NOT EXISTS change_logs (
  id BIGSERIAL PRIMARY KEY,
  action_type TEXT NOT NULL,
  operator TEXT DEFAULT '관리자',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT NOT NULL DEFAULT '',
  affected_products JSONB DEFAULT '[]',
  changes JSONB DEFAULT '{}',
  snapshot_data JSONB DEFAULT NULL,
  is_rolled_back INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recipient_groups (
  id BIGSERIAL PRIMARY KEY,
  group_name TEXT NOT NULL,
  emails JSONB DEFAULT '[]',
  default_for_actions JSONB DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_products_group ON products(product_group);
CREATE INDEX IF NOT EXISTS idx_bom_items_product ON bom_items(product_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_part ON bom_items(part_id);

-- 사내 전용 앱이므로 RLS 비활성화
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE parts DISABLE ROW LEVEL SECURITY;
ALTER TABLE bom_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE common_part_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE change_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE recipient_groups DISABLE ROW LEVEL SECURITY;
