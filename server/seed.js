'use strict';
const path = require('path');
const fs = require('fs');

function seedFromExcel(db, getOrCreatePart, parseExcelBOM) {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM products').get();
  if (count.cnt > 0) return;

  const excelDir = path.join(__dirname, '..', 'A11-D1-0000');
  if (!fs.existsSync(excelDir)) return;

  const files = fs.readdirSync(excelDir).filter(f => f.endsWith('.xlsx'));
  const insertItem = db.prepare(
    'INSERT INTO bom_items (product_id, part_id, quantity, row_order, position, notes) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const file of files) {
    try {
      const { meta, bom_items } = parseExcelBOM(path.join(excelDir, file));
      if (!meta.part_number) continue;

      const r = db.prepare(
        `INSERT OR IGNORE INTO products (part_number, product_group, variant_code, name, customer, country_spec, spec, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(meta.part_number, meta.product_group, meta.variant_code, meta.name,
            meta.customer || '', meta.country_spec || '', meta.spec || '', '');

      if (r.changes === 0) continue;
      const productId = r.lastInsertRowid;

      bom_items.forEach((item, i) => {
        const part = getOrCreatePart(item.part_number, item.part_name, item.spec || '', item.unit || 'EA');
        insertItem.run(productId, part.id, item.quantity || 1, i, '', item.notes || '');
      });

      console.log(`[seed] ${meta.part_number}: ${bom_items.length}개 항목`);
    } catch (e) {
      console.error(`[seed] ${file} 실패:`, e.message);
    }
  }
}

module.exports = { seedFromExcel };
