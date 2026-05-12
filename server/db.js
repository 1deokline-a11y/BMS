'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      part_number TEXT UNIQUE NOT NULL,
      product_group TEXT NOT NULL,
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
      id SERIAL PRIMARY KEY,
      part_number TEXT UNIQUE NOT NULL,
      part_name TEXT NOT NULL DEFAULT '',
      spec TEXT DEFAULT '',
      unit TEXT DEFAULT 'EA'
    );

    CREATE TABLE IF NOT EXISTS bom_items (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      part_id INTEGER NOT NULL REFERENCES parts(id),
      quantity NUMERIC NOT NULL DEFAULT 1.0,
      row_order INTEGER DEFAULT 0,
      position TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS common_part_templates (
      id SERIAL PRIMARY KEY,
      product_group TEXT NOT NULL,
      part_id INTEGER NOT NULL REFERENCES parts(id),
      default_quantity NUMERIC DEFAULT 1.0,
      UNIQUE(product_group, part_id)
    );

    CREATE TABLE IF NOT EXISTS change_logs (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      group_name TEXT NOT NULL,
      emails JSONB DEFAULT '[]',
      default_for_actions JSONB DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_products_group ON products(product_group);
    CREATE INDEX IF NOT EXISTS idx_bom_items_product ON bom_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_bom_items_part ON bom_items(part_id);
  `);
}

async function getOrCreatePart(partNumber, partName, spec = '', unit = 'EA') {
  const existing = await query('SELECT * FROM parts WHERE part_number = $1', [partNumber]);
  if (existing.rows.length > 0) return existing.rows[0];
  const r = await query(
    `INSERT INTO parts (part_number, part_name, spec, unit) VALUES ($1, $2, $3, $4)
     ON CONFLICT (part_number) DO UPDATE SET part_name = EXCLUDED.part_name RETURNING *`,
    [partNumber, partName, spec, unit]
  );
  return r.rows[0];
}

async function getBOMItems(productId) {
  const result = await query(`
    SELECT bi.*, p.part_number, p.part_name, p.spec, p.unit
    FROM bom_items bi JOIN parts p ON bi.part_id = p.id
    WHERE bi.product_id = $1
    ORDER BY bi.row_order
  `, [productId]);
  return result.rows.map(row => ({
    id: row.id,
    product_id: row.product_id,
    part_id: row.part_id,
    quantity: parseFloat(row.quantity),
    row_order: row.row_order,
    position: row.position,
    notes: row.notes,
    part: {
      id: row.part_id,
      part_number: row.part_number,
      part_name: row.part_name,
      spec: row.spec,
      unit: row.unit,
    },
  }));
}

module.exports = { pool, query, initDB, getOrCreatePart, getBOMItems };
