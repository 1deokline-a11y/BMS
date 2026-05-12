'use strict';
const path = require('path');
const fs = require('fs');

async function seedFromExcel(getOrCreatePart, parseExcelBOM, query) {
  try {
    const count = await query('SELECT COUNT(*) AS cnt FROM products');
    if (parseInt(count.rows[0].cnt) > 0) return;

    const excelDir = path.join(__dirname, '..', 'A11-D1-0000');
    if (!fs.existsSync(excelDir)) return;

    const files = fs.readdirSync(excelDir).filter(f => f.endsWith('.xlsx'));
    for (const file of files) {
      try {
        const { meta, bom_items } = parseExcelBOM(path.join(excelDir, file));
        if (!meta.part_number) continue;

        const r = await query(
          `INSERT INTO products (part_number, product_group, variant_code, name, customer, country_spec, spec, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (part_number) DO NOTHING RETURNING id`,
          [meta.part_number, meta.product_group, meta.variant_code, meta.name,
           meta.customer || '', meta.country_spec || '', meta.spec || '', '']
        );
        if (!r.rows.length) continue;
        const productId = r.rows[0].id;

        for (let i = 0; i < bom_items.length; i++) {
          const item = bom_items[i];
          const part = await getOrCreatePart(item.part_number, item.part_name, item.spec || '', item.unit || 'EA');
          await query(
            'INSERT INTO bom_items (product_id, part_id, quantity, row_order, position, notes) VALUES ($1,$2,$3,$4,$5,$6)',
            [productId, part.id, item.quantity || 1, i, '', item.notes || '']
          );
        }
        console.log(`[seed] ${meta.part_number}: ${bom_items.length}개 항목`);
      } catch (e) {
        console.error(`[seed] ${file} 실패:`, e.message);
      }
    }
  } catch (e) {
    console.error('[seed] 오류:', e.message);
  }
}

module.exports = { seedFromExcel };
