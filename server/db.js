'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(process.env.VERCEL ? '/tmp/backups' : path.join(__dirname, '..', 'backups'), { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'bom.db'));

db.exec(`PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT UNIQUE NOT NULL,
  product_group TEXT NOT NULL,
  variant_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  customer TEXT DEFAULT '',
  country_spec TEXT DEFAULT '',
  spec TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT UNIQUE NOT NULL,
  part_name TEXT NOT NULL DEFAULT '',
  spec TEXT DEFAULT '',
  unit TEXT DEFAULT 'EA'
);

CREATE TABLE IF NOT EXISTS bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  quantity REAL NOT NULL DEFAULT 1.0,
  row_order INTEGER DEFAULT 0,
  position TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS common_part_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_group TEXT NOT NULL,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  default_quantity REAL DEFAULT 1.0,
  UNIQUE(product_group, part_id)
);

CREATE TABLE IF NOT EXISTS change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  operator TEXT DEFAULT '관리자',
  timestamp TEXT DEFAULT (datetime('now','localtime')),
  reason TEXT NOT NULL DEFAULT '',
  affected_products TEXT DEFAULT '[]',
  changes TEXT DEFAULT '{}',
  snapshot_path TEXT DEFAULT '',
  is_rolled_back INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recipient_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name TEXT NOT NULL,
  emails TEXT DEFAULT '[]',
  default_for_actions TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_products_group ON products(product_group);
CREATE INDEX IF NOT EXISTS idx_bom_items_product ON bom_items(product_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_part ON bom_items(part_id);
`);

// Helper: get or create a part record
function getOrCreatePart(partNumber, partName, spec = '', unit = 'EA') {
  let part = db.prepare('SELECT * FROM parts WHERE part_number = ?').get(partNumber);
  if (!part) {
    const r = db.prepare(
      'INSERT INTO parts (part_number, part_name, spec, unit) VALUES (?, ?, ?, ?)'
    ).run(partNumber, partName, spec, unit);
    part = db.prepare('SELECT * FROM parts WHERE id = ?').get(r.lastInsertRowid);
  }
  return part;
}

// Helper: get full BOM items for a product
function getBOMItems(productId) {
  return db.prepare(`
    SELECT bi.*, p.part_number, p.part_name, p.spec, p.unit
    FROM bom_items bi JOIN parts p ON bi.part_id = p.id
    WHERE bi.product_id = ?
    ORDER BY bi.row_order
  `).all(productId).map(row => ({
    id: row.id,
    product_id: row.product_id,
    part_id: row.part_id,
    quantity: row.quantity,
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

module.exports = { db, getOrCreatePart, getBOMItems };
