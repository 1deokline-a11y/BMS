'use strict';
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const { query, initDB, getOrCreatePart, getBOMItems } = require('./db');
const { parseExcelBOM, exportBOMToExcel, exportComparisonToExcel } = require('./services/excel');
const { generateNotificationEmail, suggestCommonParts } = require('./services/ai');
const { seedFromExcel } = require('./seed');

const app = express();
const PORT = 8000;
const BASE_DIR = path.join(__dirname, '..');
const TMP = process.env.VERCEL ? '/tmp' : BASE_DIR;
const UPLOAD_DIR = path.join(TMP, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
const upload = multer({ dest: UPLOAD_DIR });
app.use('/', express.static(path.join(BASE_DIR, 'frontend')));

// DB 초기화 및 시딩 (모듈 로드 시 1회 실행)
const dbReady = initDB()
  .then(() => seedFromExcel(getOrCreatePart, parseExcelBOM, query))
  .catch(e => console.error('[startup] DB 초기화 오류:', e.message));

app.use('/api', async (_req, _res, next) => { await dbReady; next(); });

// 동적 파라미터 빌더 ($1, $2... 자동 넘버링)
function params() {
  const values = [];
  let i = 0;
  return {
    add: (v) => { values.push(v); return `$${++i}`; },
    vals: () => values,
  };
}

// ======================================================
// HEALTH
// ======================================================
app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '1.0.0' }));

// ======================================================
// PRODUCTS
// ======================================================
app.get('/api/products', async (req, res) => {
  try {
    const { group, customer, country_spec, search } = req.query;
    const p = params();
    let sql = 'SELECT * FROM products WHERE 1=1';
    if (group)        sql += ` AND product_group = ${p.add(group)}`;
    if (customer)     sql += ` AND customer ILIKE ${p.add(`%${customer}%`)}`;
    if (country_spec) sql += ` AND country_spec ILIKE ${p.add(`%${country_spec}%`)}`;
    if (search) {
      const s = p.add(`%${search}%`);
      sql += ` AND (part_number ILIKE ${s} OR name ILIKE ${s} OR customer ILIKE ${s})`;
    }
    sql += ' ORDER BY part_number';
    const result = await query(sql, p.vals());
    res.json(result.rows);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/products/groups', async (_, res) => {
  try {
    const result = await query('SELECT DISTINCT product_group FROM products ORDER BY product_group');
    res.json(result.rows.map(r => r.product_group));
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    const product = result.rows[0];
    product.bom_items = await getBOMItems(product.id);
    res.json(product);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const { part_number, product_group, variant_code, name,
            customer = '', country_spec = '', spec = '', notes = '', bom_items = [] } = req.body;
    if (!part_number || !product_group)
      return res.status(400).json({ detail: '품번과 제품군은 필수입니다' });

    const existing = await query('SELECT id FROM products WHERE part_number = $1', [part_number]);
    if (existing.rows.length) return res.status(409).json({ detail: '이미 존재하는 품번입니다' });

    const r = await query(
      `INSERT INTO products (part_number, product_group, variant_code, name, customer, country_spec, spec, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [part_number, product_group, variant_code || '', name, customer, country_spec, spec, notes]
    );
    const productId = r.rows[0].id;

    for (let i = 0; i < bom_items.length; i++) {
      const item = bom_items[i];
      const part = await getOrCreatePart(item.part_number, item.part_name, item.spec || '', item.unit || 'EA');
      await query(
        'INSERT INTO bom_items (product_id, part_id, quantity, row_order, position, notes) VALUES ($1,$2,$3,$4,$5,$6)',
        [productId, part.id, item.quantity || 1, i, item.position || '', item.notes || '']
      );
    }

    const created = await query('SELECT * FROM products WHERE id = $1', [productId]);
    res.status(201).json(created.rows[0]);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, customer, country_spec, spec, notes } = req.body;
    const existing = await query('SELECT id FROM products WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    await query(
      `UPDATE products SET
         name=COALESCE($1,name), customer=COALESCE($2,customer),
         country_spec=COALESCE($3,country_spec), spec=COALESCE($4,spec),
         notes=COALESCE($5,notes), updated_at=NOW()
       WHERE id=$6`,
      [name, customer, country_spec, spec, notes, req.params.id]
    );
    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const existing = await query('SELECT id FROM products WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    await query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.put('/api/products/:id/bom', async (req, res) => {
  try {
    const existing = await query('SELECT id FROM products WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    await query('DELETE FROM bom_items WHERE product_id = $1', [req.params.id]);
    const items = req.body.filter(it => it.part_number || it.part_name);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const part = await getOrCreatePart(item.part_number || '', item.part_name || '', item.spec || '', item.unit || 'EA');
      await query(
        'INSERT INTO bom_items (product_id, part_id, quantity, row_order, position, notes) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.id, part.id, item.quantity || 1, i, item.position || '', item.notes || '']
      );
    }
    await query('UPDATE products SET updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ message: 'BOM 저장 완료' });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// IMPORT
// ======================================================
async function importBOMData(parsed, overwrite) {
  const { meta, bom_items } = parsed;
  const existing = await query('SELECT * FROM products WHERE part_number = $1', [meta.part_number]);
  const existingProduct = existing.rows[0];

  if (existingProduct && !overwrite) {
    return { status: 'skipped', part_number: meta.part_number, reason: '이미 존재하는 품번 (덮어쓰기 옵션 필요)' };
  }

  let productId;
  if (existingProduct) {
    await query('DELETE FROM bom_items WHERE product_id = $1', [existingProduct.id]);
    await query(
      `UPDATE products SET product_group=$1, variant_code=$2, name=$3, customer=$4,
       country_spec=$5, spec=$6, updated_at=NOW() WHERE id=$7`,
      [meta.product_group, meta.variant_code, meta.name, meta.customer || '',
       meta.country_spec || '', meta.spec || '', existingProduct.id]
    );
    productId = existingProduct.id;
  } else {
    const r = await query(
      `INSERT INTO products (part_number, product_group, variant_code, name, customer, country_spec, spec)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [meta.part_number, meta.product_group, meta.variant_code, meta.name,
       meta.customer || '', meta.country_spec || '', meta.spec || '']
    );
    productId = r.rows[0].id;
  }

  for (let i = 0; i < bom_items.length; i++) {
    const item = bom_items[i];
    const part = await getOrCreatePart(item.part_number, item.part_name, item.spec || '', item.unit || 'EA');
    await query(
      'INSERT INTO bom_items (product_id, part_id, quantity, row_order, notes) VALUES ($1,$2,$3,$4,$5)',
      [productId, part.id, item.quantity || 1, i, item.notes || '']
    );
  }

  return { status: 'success', part_number: meta.part_number, bom_items_count: bom_items.length,
           action: existingProduct ? 'updated' : 'created' };
}

app.post('/api/import/excel', upload.array('files'), async (req, res) => {
  try {
    const overwrite = req.query.overwrite === 'true';
    const results = [];
    for (const file of req.files) {
      try {
        const parsed = parseExcelBOM(file.path);
        const r = await importBOMData(parsed, overwrite);
        results.push({ filename: file.originalname, ...r });
      } catch (e) {
        results.push({ filename: file.originalname, status: 'error', reason: e.message });
      }
    }
    res.json({ results });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/import/scan-folder', async (req, res) => {
  try {
    const { folder_path, overwrite } = req.query;
    if (!fs.existsSync(folder_path)) return res.status(400).json({ detail: '폴더를 찾을 수 없습니다' });
    const files = fs.readdirSync(folder_path)
      .filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'));
    const results = [];
    for (const filename of files) {
      try {
        const parsed = parseExcelBOM(path.join(folder_path, filename));
        const r = await importBOMData(parsed, overwrite === 'true');
        results.push({ filename, ...r });
      } catch (e) {
        results.push({ filename, status: 'error', reason: e.message });
      }
    }
    res.json({ total: files.length, results });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/products/:id/export', async (req, res) => {
  try {
    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    const product = result.rows[0];
    const items = await getBOMItems(product.id);
    const buf = exportBOMToExcel(product, items);
    const filename = encodeURIComponent(`${product.part_number}_BOM.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buf);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// COMPARE
// ======================================================
async function buildCompareResult(id1, id2) {
  const [r1, r2] = await Promise.all([
    query('SELECT * FROM products WHERE id = $1', [id1]),
    query('SELECT * FROM products WHERE id = $1', [id2]),
  ]);
  const p1 = r1.rows[0], p2 = r2.rows[0];
  if (!p1 || !p2) return null;

  const [items1, items2] = await Promise.all([getBOMItems(p1.id), getBOMItems(p2.id)]);
  const idx1 = Object.fromEntries(items1.map(i => [i.part.part_number, i]));
  const idx2 = Object.fromEntries(items2.map(i => [i.part.part_number, i]));
  const allKeys = [...new Set([...Object.keys(idx1), ...Object.keys(idx2)])];

  const summary = { same: 0, added: 0, removed: 0, qty_diff: 0, spec_diff: 0 };
  const diffs = allKeys.map(key => {
    const i1 = idx1[key], i2 = idx2[key];
    let status;
    if (i1 && !i2) status = 'removed';
    else if (!i1 && i2) status = 'added';
    else if (i1.part.spec !== i2.part.spec) status = 'spec_diff';
    else if (i1.quantity !== i2.quantity) status = 'qty_diff';
    else status = 'same';
    summary[status]++;
    const toDict = item => item
      ? { part_number: item.part.part_number, part_name: item.part.part_name,
          spec: item.part.spec, quantity: item.quantity }
      : null;
    return { key, status, item1: toDict(i1), item2: toDict(i2) };
  });

  return {
    product1: { id: p1.id, part_number: p1.part_number, name: p1.name },
    product2: { id: p2.id, part_number: p2.part_number, name: p2.name },
    summary, diffs,
  };
}

app.get('/api/compare', async (req, res) => {
  try {
    const { id1, id2, diff_only } = req.query;
    const result = await buildCompareResult(id1, id2);
    if (!result) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    if (diff_only === 'true') result.diffs = result.diffs.filter(d => d.status !== 'same');
    res.json(result);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/compare/export', async (req, res) => {
  try {
    const { id1, id2 } = req.query;
    const result = await buildCompareResult(id1, id2);
    if (!result) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    const buf = exportComparisonToExcel(result.product1.part_number, result.product2.part_number, result.diffs);
    const filename = encodeURIComponent(`비교_${result.product1.part_number}_vs_${result.product2.part_number}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buf);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// BULK EDIT
// ======================================================
app.get('/api/bulk-edit/search', async (req, res) => {
  try {
    const { q = '', part_number = q, part_name = q } = req.query;
    const p = params();
    let sql = 'SELECT * FROM parts WHERE 1=1';
    if (part_number) sql += ` AND part_number ILIKE ${p.add(`%${part_number}%`)}`;
    if (part_name && part_name !== part_number)
      sql += ` AND part_name ILIKE ${p.add(`%${part_name}%`)}`;
    sql += ' LIMIT 50';
    const parts = (await query(sql, p.vals())).rows;

    const results = await Promise.all(parts.map(async part => {
      const usageRows = (await query(`
        SELECT bi.id AS bom_item_id, bi.quantity, pr.id AS product_id,
               pr.part_number, pr.name AS product_name, pr.product_group
        FROM bom_items bi JOIN products pr ON bi.product_id = pr.id
        WHERE bi.part_id = $1
      `, [part.id])).rows;
      return { ...part, usage_count: usageRows.length, usage: usageRows };
    }));

    res.json(results);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/bulk-edit/preview', async (req, res) => {
  try {
    const { action, target_part_number, product_ids, new_part_number, new_part_name,
            new_spec, new_quantity } = req.body;
    const previews = (await Promise.all(product_ids.map(async pid => {
      const pr = (await query('SELECT * FROM products WHERE id = $1', [pid])).rows[0];
      if (!pr) return null;
      const items = await getBOMItems(pid);
      const affected = items
        .filter(item => item.part.part_number === target_part_number)
        .map(item => {
          const before = { part_number: item.part.part_number, part_name: item.part.part_name,
                           spec: item.part.spec, quantity: item.quantity };
          let after = null;
          if (action === 'replace') {
            after = { part_number: new_part_number || before.part_number,
                      part_name: new_part_name || before.part_name,
                      spec: new_spec !== undefined ? new_spec : before.spec,
                      quantity: new_quantity || before.quantity };
          } else if (action === 'update_qty') {
            after = { ...before, quantity: new_quantity };
          } else if (action === 'delete') {
            after = null;
          }
          return { bom_item_id: item.id, before, after };
        });

      if (action === 'add' && new_part_number) {
        affected.push({ bom_item_id: null, before: null,
                        after: { part_number: new_part_number, part_name: new_part_name || '',
                                 spec: new_spec || '', quantity: new_quantity || 1 } });
      }

      return { product_id: pid, part_number: pr.part_number, product_name: pr.name, affected_items: affected };
    }))).filter(Boolean);

    res.json({ previews, total_products: previews.length });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/bulk-edit/apply', async (req, res) => {
  try {
    const { action, target_part_number, product_ids, reason, operator = '관리자',
            new_part_number, new_part_name, new_spec, new_unit, new_quantity } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ detail: '변경 사유를 입력해주세요' });

    // 스냅샷을 DB에 저장
    const snapshot = {};
    for (const pid of product_ids) {
      const pr = (await query('SELECT * FROM products WHERE id = $1', [pid])).rows[0];
      if (pr) snapshot[pid] = { part_number: pr.part_number, items: await getBOMItems(pid) };
    }

    const affectedProducts = [];
    const changesLog = {};

    for (const pid of product_ids) {
      const pr = (await query('SELECT * FROM products WHERE id = $1', [pid])).rows[0];
      if (!pr) continue;
      const items = await getBOMItems(pid);
      const productChanges = [];

      for (const item of items.filter(it => it.part.part_number === target_part_number)) {
        if (action === 'delete') {
          await query('DELETE FROM bom_items WHERE id = $1', [item.id]);
          productChanges.push({ action: 'deleted', part: item.part.part_number });
        } else if (action === 'update_qty') {
          await query('UPDATE bom_items SET quantity=$1 WHERE id=$2', [new_quantity, item.id]);
          productChanges.push({ action: 'qty_updated', before: item.quantity, after: new_quantity });
        } else if (action === 'replace') {
          const newPart = await getOrCreatePart(new_part_number, new_part_name || '', new_spec || '', new_unit || 'EA');
          await query('UPDATE bom_items SET part_id=$1, quantity=COALESCE($2,quantity) WHERE id=$3',
            [newPart.id, new_quantity || null, item.id]);
          productChanges.push({ action: 'replaced', before: item.part.part_number, after: new_part_number });
        }
      }

      if (action === 'add' && new_part_number) {
        const newPart = await getOrCreatePart(new_part_number, new_part_name || '', new_spec || '', new_unit || 'EA');
        const maxOrder = items.reduce((max, i) => Math.max(max, i.row_order), -1) + 1;
        await query('INSERT INTO bom_items (product_id, part_id, quantity, row_order) VALUES ($1,$2,$3,$4)',
          [pid, newPart.id, new_quantity || 1, maxOrder]);
        productChanges.push({ action: 'added', part: new_part_number });
      }

      if (productChanges.length > 0) {
        affectedProducts.push(pr.part_number);
        changesLog[pr.part_number] = productChanges;
        await query('UPDATE products SET updated_at=NOW() WHERE id=$1', [pid]);
      }
    }

    const r = await query(
      `INSERT INTO change_logs (action_type, operator, reason, affected_products, changes, snapshot_data)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [action, operator, reason, JSON.stringify(affectedProducts), JSON.stringify(changesLog), JSON.stringify(snapshot)]
    );

    res.json({ success: true, affected_products: affectedProducts,
               change_log_id: r.rows[0].id, message: `${affectedProducts.length}개 제품 수정 완료` });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// HISTORY
// ======================================================
app.get('/api/history', async (req, res) => {
  try {
    const { limit = 50, offset = 0, action_type = '' } = req.query;
    const p = params();
    let sql = 'SELECT * FROM change_logs WHERE 1=1';
    if (action_type) sql += ` AND action_type = ${p.add(action_type)}`;
    const cntResult = await query(sql.replace('SELECT *', 'SELECT COUNT(*) AS cnt'), p.vals());
    const total = parseInt(cntResult.rows[0].cnt);
    sql += ` ORDER BY timestamp DESC LIMIT ${p.add(parseInt(limit))} OFFSET ${p.add(parseInt(offset))}`;
    const items = (await query(sql, p.vals())).rows;
    res.json({ total, items });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/history/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM change_logs WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/history/:id/rollback', async (req, res) => {
  try {
    const result = await query('SELECT * FROM change_logs WHERE id = $1', [req.params.id]);
    const log = result.rows[0];
    if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });
    if (log.is_rolled_back) return res.status(400).json({ detail: '이미 롤백된 이력입니다' });
    if (!log.snapshot_data) return res.status(400).json({ detail: '스냅샷 데이터가 없습니다' });

    const snapshot = typeof log.snapshot_data === 'string'
      ? JSON.parse(log.snapshot_data) : log.snapshot_data;

    for (const [pidStr, data] of Object.entries(snapshot)) {
      const pid = parseInt(pidStr);
      await query('DELETE FROM bom_items WHERE product_id = $1', [pid]);
      for (const item of (data.items || [])) {
        const part = await getOrCreatePart(item.part.part_number, item.part.part_name,
                                           item.part.spec || '', item.part.unit || 'EA');
        await query(
          'INSERT INTO bom_items (product_id, part_id, quantity, row_order, notes) VALUES ($1,$2,$3,$4,$5)',
          [pid, part.id, item.quantity, item.row_order, item.notes || '']
        );
      }
      await query('UPDATE products SET updated_at=NOW() WHERE id=$1', [pid]);
    }

    await query('UPDATE change_logs SET is_rolled_back=1 WHERE id=$1', [log.id]);
    const r = await query(
      `INSERT INTO change_logs (action_type, operator, reason, affected_products)
       VALUES ('rollback','시스템',$1,$2) RETURNING id`,
      [`이력 #${log.id} 롤백`, log.affected_products]
    );

    res.json({ success: true, message: '롤백 완료', rollback_log_id: r.rows[0].id });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// COMMON PARTS
// ======================================================
app.get('/api/common-parts', async (req, res) => {
  try {
    const { product_group = '' } = req.query;
    const p = params();
    let sql = `SELECT ct.*, pt.part_number, pt.part_name, pt.spec, pt.unit
               FROM common_part_templates ct JOIN parts pt ON ct.part_id = pt.id WHERE 1=1`;
    if (product_group) sql += ` AND ct.product_group = ${p.add(product_group)}`;
    const rows = (await query(sql, p.vals())).rows;
    res.json(rows.map(r => ({
      id: r.id, product_group: r.product_group, default_quantity: parseFloat(r.default_quantity),
      part: { id: r.part_id, part_number: r.part_number, part_name: r.part_name, spec: r.spec, unit: r.unit },
    })));
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/common-parts', async (req, res) => {
  try {
    const { product_group, part_number, part_name, spec = '', unit = 'EA', default_quantity = 1 } = req.body;
    if (!product_group || !part_number) return res.status(400).json({ detail: '제품군과 부품번호는 필수입니다' });
    const part = await getOrCreatePart(part_number, part_name || '', spec, unit);
    const r = await query(
      'INSERT INTO common_part_templates (product_group, part_id, default_quantity) VALUES ($1,$2,$3) RETURNING id',
      [product_group, part.id, default_quantity]
    );
    res.status(201).json({ id: r.rows[0].id, message: '공용 부품 등록 완료' });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ detail: '이미 등록된 공용 부품입니다' });
    res.status(500).json({ detail: e.message });
  }
});

app.delete('/api/common-parts/:id', async (req, res) => {
  try {
    const r = await query('DELETE FROM common_part_templates WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ detail: '찾을 수 없습니다' });
    res.status(204).send();
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/common-parts/suggest/:group', async (req, res) => {
  try {
    const group = req.params.group;
    const products = (await query('SELECT * FROM products WHERE product_group = $1', [group])).rows;
    if (!products.length) return res.json({ suggestion: '해당 제품군의 제품이 없습니다', candidates: [] });

    const partFreq = {};
    const total = products.length;
    for (const p of products) {
      const items = await getBOMItems(p.id);
      const seen = new Set();
      items.forEach(item => {
        const pn = item.part.part_number;
        if (!seen.has(pn)) {
          seen.add(pn);
          if (!partFreq[pn]) partFreq[pn] = { count: 0, name: item.part.part_name };
          partFreq[pn].count++;
        }
      });
    }

    const candidates = Object.entries(partFreq)
      .filter(([, v]) => v.count / total >= 0.5)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([pn, v]) => ({ part_number: pn, part_name: v.name,
                            frequency: v.count, percentage: Math.round(v.count / total * 100) }));

    const aiSuggestion = suggestCommonParts(group, partFreq, total);
    res.json({ candidates, ai_suggestion: aiSuggestion });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// NOTIFICATIONS
// ======================================================
app.post('/api/notifications/generate', async (req, res) => {
  try {
    const { change_log_id } = req.query;
    const result = await query('SELECT * FROM change_logs WHERE id = $1', [change_log_id]);
    const log = result.rows[0];
    if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });

    const affected = Array.isArray(log.affected_products) ? log.affected_products : JSON.parse(log.affected_products || '[]');
    const changes = typeof log.changes === 'object' ? log.changes : JSON.parse(log.changes || '{}');
    const emailText = generateNotificationEmail({
      actionType: log.action_type, affectedProducts: affected, changes,
      reason: log.reason, operator: log.operator, timestamp: log.timestamp,
    });

    let subject = 'BOM 변경 알림', bodyLines = [];
    for (const line of emailText.split('\n')) {
      if (!subject && (line.toLowerCase().startsWith('subject:') || line.startsWith('제목:'))) {
        subject = line.split(':').slice(1).join(':').trim();
      } else {
        bodyLines.push(line);
      }
    }
    res.json({ subject, body: bodyLines.join('\n').trim(), raw: emailText });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/notifications/send', async (req, res) => {
  try {
    const { change_log_id, recipient_group_ids = [], extra_emails = [], custom_body } = req.body;
    const log = (await query('SELECT * FROM change_logs WHERE id = $1', [change_log_id])).rows[0];
    if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });

    const allRecipients = [...extra_emails];
    for (const gid of recipient_group_ids) {
      const group = (await query('SELECT * FROM recipient_groups WHERE id = $1', [gid])).rows[0];
      if (group) allRecipients.push(...(Array.isArray(group.emails) ? group.emails : JSON.parse(group.emails || '[]')));
    }
    const uniqueRecipients = [...new Set(allRecipients)];
    if (!uniqueRecipients.length) return res.status(400).json({ detail: '수신자가 없습니다' });

    let subject = 'BOM 변경 알림', body = custom_body || '';
    if (!body) {
      const affected = Array.isArray(log.affected_products) ? log.affected_products : JSON.parse(log.affected_products || '[]');
      const changes = typeof log.changes === 'object' ? log.changes : JSON.parse(log.changes || '{}');
      const emailText = generateNotificationEmail({
        actionType: log.action_type, affectedProducts: affected, changes,
        reason: log.reason, operator: log.operator, timestamp: log.timestamp,
      });
      const bodyLines = [];
      for (const line of emailText.split('\n')) {
        if (line.toLowerCase().startsWith('subject:') || line.startsWith('제목:')) {
          subject = line.split(':').slice(1).join(':').trim();
        } else { bodyLines.push(line); }
      }
      body = bodyLines.join('\n').trim();
    }

    const psScript = `
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.Subject = @'
${subject.replace(/'/g, "''")}
'@
$mail.Body = @'
${body.replace(/'/g, "''")}
'@
$mail.To = "${uniqueRecipients.join('; ')}"
$mail.Display()
`;
    const r = spawnSync('powershell', ['-Command', psScript],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status === 0) {
      res.json({ success: true, message: 'Outlook 초안 생성 완료 (검토 후 발송해주세요)' });
    } else {
      res.json({ success: false, message: r.stderr || 'Outlook 실행 실패' });
    }
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/notifications/recipients', async (_, res) => {
  try {
    const rows = (await query('SELECT * FROM recipient_groups')).rows;
    res.json(rows.map(g => ({
      ...g,
      emails: Array.isArray(g.emails) ? g.emails : JSON.parse(g.emails || '[]'),
      default_for_actions: Array.isArray(g.default_for_actions) ? g.default_for_actions : JSON.parse(g.default_for_actions || '[]'),
    })));
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/notifications/recipients', async (req, res) => {
  try {
    const { group_name, emails = [], default_for_actions = [] } = req.body;
    const r = await query(
      'INSERT INTO recipient_groups (group_name, emails, default_for_actions) VALUES ($1,$2,$3) RETURNING id',
      [group_name, JSON.stringify(emails), JSON.stringify(default_for_actions)]
    );
    res.status(201).json({ id: r.rows[0].id, message: '수신자 그룹 생성 완료' });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.put('/api/notifications/recipients/:id', async (req, res) => {
  try {
    const { group_name, emails = [], default_for_actions = [] } = req.body;
    await query(
      'UPDATE recipient_groups SET group_name=$1, emails=$2, default_for_actions=$3 WHERE id=$4',
      [group_name, JSON.stringify(emails), JSON.stringify(default_for_actions), req.params.id]
    );
    res.json({ message: '수정 완료' });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.delete('/api/notifications/recipients/:id', async (req, res) => {
  try {
    await query('DELETE FROM recipient_groups WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// START SERVER
// ======================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  BOM 관리 시스템 실행 중`);
    console.log(`  브라우저에서 열기: http://localhost:${PORT}`);
    console.log(`  종료: Ctrl+C`);
    console.log(`${'='.repeat(50)}\n`);
  });
}

module.exports = app;
