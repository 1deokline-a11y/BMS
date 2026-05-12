'use strict';
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const { db, getOrCreatePart, getBOMItems } = require('./db');
const { parseExcelBOM, exportBOMToExcel, exportComparisonToExcel } = require('./services/excel');
const { generateNotificationEmail, suggestCommonParts } = require('./services/ai');
const { seedFromExcel } = require('./seed');

// DB가 비어있으면 번들된 Excel 파일로 자동 초기화
seedFromExcel(db, getOrCreatePart, parseExcelBOM);

const app = express();
const PORT = 8000;
const BASE_DIR = path.join(__dirname, '..');
const TMP = process.env.VERCEL ? '/tmp' : BASE_DIR;
const UPLOAD_DIR = path.join(TMP, 'data', 'uploads');
const BACKUP_DIR = path.join(TMP, 'backups');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ dest: UPLOAD_DIR });

// Serve frontend
app.use('/', express.static(path.join(BASE_DIR, 'frontend')));

// ======================================================
// HEALTH
// ======================================================
app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '1.0.0' }));

// ======================================================
// PRODUCTS
// ======================================================
app.get('/api/products', (req, res) => {
  const { group, customer, country_spec, search } = req.query;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (group) { sql += ' AND product_group = ?'; params.push(group); }
  if (customer) { sql += ' AND customer LIKE ?'; params.push(`%${customer}%`); }
  if (country_spec) { sql += ' AND country_spec LIKE ?'; params.push(`%${country_spec}%`); }
  if (search) {
    sql += ' AND (part_number LIKE ? OR name LIKE ? OR customer LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY part_number';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/products/groups', (_, res) => {
  const rows = db.prepare('SELECT DISTINCT product_group FROM products ORDER BY product_group').all();
  res.json(rows.map(r => r.product_group));
});

app.get('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
  product.bom_items = getBOMItems(product.id);
  res.json(product);
});

app.post('/api/products', (req, res) => {
  const { part_number, product_group, variant_code, name, customer = '', country_spec = '',
          spec = '', notes = '', bom_items = [] } = req.body;
  if (!part_number || !product_group) return res.status(400).json({ detail: '품번과 제품군은 필수입니다' });
  const existing = db.prepare('SELECT id FROM products WHERE part_number = ?').get(part_number);
  if (existing) return res.status(409).json({ detail: '이미 존재하는 품번입니다' });

  const r = db.prepare(
    `INSERT INTO products (part_number, product_group, variant_code, name, customer, country_spec, spec, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(part_number, product_group, variant_code || '', name, customer, country_spec, spec, notes);

  const productId = r.lastInsertRowid;
  const insertItem = db.prepare(
    'INSERT INTO bom_items (product_id, part_id, quantity, row_order, position, notes) VALUES (?, ?, ?, ?, ?, ?)'
  );
  bom_items.forEach((item, i) => {
    const part = getOrCreatePart(item.part_number, item.part_name, item.spec || '', item.unit || 'EA');
    insertItem.run(productId, part.id, item.quantity || 1, i, item.position || '', item.notes || '');
  });

  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(productId));
});

app.put('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
  const { name, customer, country_spec, spec, notes } = req.body;
  db.prepare(
    `UPDATE products SET name=COALESCE(?,name), customer=COALESCE(?,customer),
     country_spec=COALESCE(?,country_spec), spec=COALESCE(?,spec), notes=COALESCE(?,notes),
     updated_at=datetime('now','localtime') WHERE id=?`
  ).run(name, customer, country_spec, spec, notes, req.params.id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

app.delete('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

app.put('/api/products/:id/bom', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
  const items = req.body;
  db.prepare('DELETE FROM bom_items WHERE product_id = ?').run(req.params.id);
  const insertItem = db.prepare(
    'INSERT INTO bom_items (product_id, part_id, quantity, row_order, position, notes) VALUES (?, ?, ?, ?, ?, ?)'
  );
  items.filter(it => it.part_number || it.part_name).forEach((item, i) => {
    const part = getOrCreatePart(item.part_number || '', item.part_name || '', item.spec || '', item.unit || 'EA');
    insertItem.run(req.params.id, part.id, item.quantity || 1, i, item.position || '', item.notes || '');
  });
  db.prepare("UPDATE products SET updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
  res.json({ message: 'BOM 저장 완료' });
});

// ======================================================
// IMPORT
// ======================================================
function importBOMData(parsed, overwrite) {
  const { meta, bom_items } = parsed;
  const existing = db.prepare('SELECT * FROM products WHERE part_number = ?').get(meta.part_number);

  if (existing && !overwrite) {
    return { status: 'skipped', part_number: meta.part_number,
             reason: `이미 존재하는 품번 (덮어쓰기 옵션 필요)` };
  }

  let productId;
  if (existing) {
    db.prepare('DELETE FROM bom_items WHERE product_id = ?').run(existing.id);
    db.prepare(
      `UPDATE products SET product_group=?, variant_code=?, name=?, customer=?,
       country_spec=?, spec=?, updated_at=datetime('now','localtime') WHERE id=?`
    ).run(meta.product_group, meta.variant_code, meta.name, meta.customer || '',
          meta.country_spec || '', meta.spec || '', existing.id);
    productId = existing.id;
  } else {
    const r = db.prepare(
      `INSERT INTO products (part_number, product_group, variant_code, name, customer, country_spec, spec)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(meta.part_number, meta.product_group, meta.variant_code, meta.name,
          meta.customer || '', meta.country_spec || '', meta.spec || '');
    productId = r.lastInsertRowid;
  }

  const insertItem = db.prepare(
    'INSERT INTO bom_items (product_id, part_id, quantity, row_order, notes) VALUES (?, ?, ?, ?, ?)'
  );
  bom_items.forEach((item, i) => {
    const part = getOrCreatePart(item.part_number, item.part_name, item.spec || '', item.unit || 'EA');
    insertItem.run(productId, part.id, item.quantity || 1, i, item.notes || '');
  });

  return {
    status: 'success',
    part_number: meta.part_number,
    bom_items_count: bom_items.length,
    action: existing ? 'updated' : 'created',
  };
}

app.post('/api/import/excel', upload.array('files'), (req, res) => {
  const overwrite = req.query.overwrite === 'true';
  const results = [];
  for (const file of req.files) {
    try {
      const parsed = parseExcelBOM(file.path);
      const r = importBOMData(parsed, overwrite);
      results.push({ filename: file.originalname, ...r });
    } catch (e) {
      results.push({ filename: file.originalname, status: 'error', reason: e.message });
    }
  }
  res.json({ results });
});

app.post('/api/import/scan-folder', (req, res) => {
  const { folder_path, overwrite } = req.query;
  if (!fs.existsSync(folder_path)) return res.status(400).json({ detail: '폴더를 찾을 수 없습니다' });
  const files = fs.readdirSync(folder_path)
    .filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'));
  const results = [];
  for (const filename of files) {
    const filePath = path.join(folder_path, filename);
    try {
      const parsed = parseExcelBOM(filePath);
      const r = importBOMData(parsed, overwrite === 'true');
      results.push({ filename, ...r });
    } catch (e) {
      results.push({ filename, status: 'error', reason: e.message });
    }
  }
  res.json({ total: files.length, results });
});

// BOM Excel export
app.get('/api/products/:id/export', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
  const items = getBOMItems(product.id);
  const buf = exportBOMToExcel(product, items);
  const filename = encodeURIComponent(`${product.part_number}_BOM.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(buf);
});

// ======================================================
// COMPARE
// ======================================================
function buildCompareResult(id1, id2) {
  const p1 = db.prepare('SELECT * FROM products WHERE id = ?').get(id1);
  const p2 = db.prepare('SELECT * FROM products WHERE id = ?').get(id2);
  if (!p1 || !p2) return null;

  const items1 = getBOMItems(p1.id);
  const items2 = getBOMItems(p2.id);

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
    const toDict = item => item ? {
      part_number: item.part.part_number, part_name: item.part.part_name,
      spec: item.part.spec, quantity: item.quantity,
    } : null;
    return { key, status, item1: toDict(i1), item2: toDict(i2) };
  });

  return {
    product1: { id: p1.id, part_number: p1.part_number, name: p1.name },
    product2: { id: p2.id, part_number: p2.part_number, name: p2.name },
    summary, diffs,
  };
}

app.get('/api/compare', (req, res) => {
  const { id1, id2, diff_only } = req.query;
  const result = buildCompareResult(id1, id2);
  if (!result) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
  if (diff_only === 'true') result.diffs = result.diffs.filter(d => d.status !== 'same');
  res.json(result);
});

app.get('/api/compare/export', (req, res) => {
  const { id1, id2 } = req.query;
  const result = buildCompareResult(id1, id2);
  if (!result) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
  const buf = exportComparisonToExcel(result.product1.part_number, result.product2.part_number, result.diffs);
  const filename = encodeURIComponent(`비교_${result.product1.part_number}_vs_${result.product2.part_number}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(buf);
});

// ======================================================
// BULK EDIT
// ======================================================
app.get('/api/bulk-edit/search', (req, res) => {
  const { part_number = '', part_name = '' } = req.query;
  let sql = 'SELECT * FROM parts WHERE 1=1';
  const params = [];
  if (part_number) { sql += ' AND part_number LIKE ?'; params.push(`%${part_number}%`); }
  if (part_name) { sql += ' AND part_name LIKE ?'; params.push(`%${part_name}%`); }
  sql += ' LIMIT 50';
  const parts = db.prepare(sql).all(...params);

  const results = parts.map(part => {
    const usageRows = db.prepare(`
      SELECT bi.id as bom_item_id, bi.quantity, p.id as product_id,
             p.part_number, p.name as product_name, p.product_group
      FROM bom_items bi JOIN products p ON bi.product_id = p.id
      WHERE bi.part_id = ?
    `).all(part.id);
    return { ...part, usage_count: usageRows.length, usage: usageRows };
  });

  res.json(results);
});

app.post('/api/bulk-edit/preview', (req, res) => {
  const { action, target_part_number, product_ids, new_part_number, new_part_name,
          new_spec, new_quantity } = req.body;
  const previews = product_ids.map(pid => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
    if (!product) return null;
    const items = getBOMItems(pid);
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

    return { product_id: pid, part_number: product.part_number, product_name: product.name, affected_items: affected };
  }).filter(Boolean);

  res.json({ previews, total_products: previews.length });
});

app.post('/api/bulk-edit/apply', (req, res) => {
  const { action, target_part_number, product_ids, reason, operator = '관리자',
          new_part_number, new_part_name, new_spec, new_unit, new_quantity } = req.body;

  if (!reason || !reason.trim()) return res.status(400).json({ detail: '변경 사유를 입력해주세요' });

  // Snapshot
  const snapshot = {};
  product_ids.forEach(pid => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
    if (product) {
      snapshot[pid] = { part_number: product.part_number, items: getBOMItems(pid) };
    }
  });
  const snapshotPath = path.join(BACKUP_DIR, `snapshot_${Date.now()}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');

  const affectedProducts = [];
  const changesLog = {};

  product_ids.forEach(pid => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
    if (!product) return;

    const items = getBOMItems(pid);
    const productChanges = [];

    items.filter(item => item.part.part_number === target_part_number).forEach(item => {
      if (action === 'delete') {
        db.prepare('DELETE FROM bom_items WHERE id = ?').run(item.id);
        productChanges.push({ action: 'deleted', part: item.part.part_number });
      } else if (action === 'update_qty') {
        db.prepare('UPDATE bom_items SET quantity = ? WHERE id = ?').run(new_quantity, item.id);
        productChanges.push({ action: 'qty_updated', before: item.quantity, after: new_quantity });
      } else if (action === 'replace') {
        const newPart = getOrCreatePart(new_part_number, new_part_name || '', new_spec || '', new_unit || 'EA');
        db.prepare('UPDATE bom_items SET part_id = ?, quantity = COALESCE(?, quantity) WHERE id = ?')
          .run(newPart.id, new_quantity || null, item.id);
        productChanges.push({ action: 'replaced', before: item.part.part_number, after: new_part_number });
      }
    });

    if (action === 'add' && new_part_number) {
      const newPart = getOrCreatePart(new_part_number, new_part_name || '', new_spec || '', new_unit || 'EA');
      const maxOrder = items.reduce((max, i) => Math.max(max, i.row_order), -1) + 1;
      db.prepare('INSERT INTO bom_items (product_id, part_id, quantity, row_order) VALUES (?, ?, ?, ?)')
        .run(pid, newPart.id, new_quantity || 1, maxOrder);
      productChanges.push({ action: 'added', part: new_part_number });
    }

    if (productChanges.length > 0) {
      affectedProducts.push(product.part_number);
      changesLog[product.part_number] = productChanges;
      db.prepare("UPDATE products SET updated_at=datetime('now','localtime') WHERE id=?").run(pid);
    }
  });

  const r = db.prepare(
    `INSERT INTO change_logs (action_type, operator, reason, affected_products, changes, snapshot_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(action, operator, reason, JSON.stringify(affectedProducts), JSON.stringify(changesLog), snapshotPath);

  res.json({
    success: true,
    affected_products: affectedProducts,
    change_log_id: r.lastInsertRowid,
    message: `${affectedProducts.length}개 제품 수정 완료`,
  });
});

// ======================================================
// HISTORY
// ======================================================
app.get('/api/history', (req, res) => {
  const { limit = 50, offset = 0, action_type = '' } = req.query;
  let sql = 'SELECT * FROM change_logs WHERE 1=1';
  const params = [];
  if (action_type) { sql += ' AND action_type = ?'; params.push(action_type); }
  const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as cnt')).get(...params).cnt;
  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  const items = db.prepare(sql).all(...params).map(h => ({
    ...h,
    affected_products: JSON.parse(h.affected_products || '[]'),
    is_rolled_back: !!h.is_rolled_back,
  }));
  res.json({ total, items });
});

app.get('/api/history/:id', (req, res) => {
  const log = db.prepare('SELECT * FROM change_logs WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });
  res.json({
    ...log,
    affected_products: JSON.parse(log.affected_products || '[]'),
    changes: JSON.parse(log.changes || '{}'),
    is_rolled_back: !!log.is_rolled_back,
  });
});

app.post('/api/history/:id/rollback', (req, res) => {
  const log = db.prepare('SELECT * FROM change_logs WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });
  if (log.is_rolled_back) return res.status(400).json({ detail: '이미 롤백된 이력입니다' });
  if (!log.snapshot_path || !fs.existsSync(log.snapshot_path))
    return res.status(400).json({ detail: '스냅샷 파일을 찾을 수 없습니다' });

  const snapshot = JSON.parse(fs.readFileSync(log.snapshot_path, 'utf8'));
  Object.entries(snapshot).forEach(([pidStr, data]) => {
    const pid = parseInt(pidStr);
    db.prepare('DELETE FROM bom_items WHERE product_id = ?').run(pid);
    const insertItem = db.prepare(
      'INSERT INTO bom_items (product_id, part_id, quantity, row_order, notes) VALUES (?, ?, ?, ?, ?)'
    );
    (data.items || []).forEach(item => {
      const part = getOrCreatePart(item.part.part_number, item.part.part_name, item.part.spec || '', item.part.unit || 'EA');
      insertItem.run(pid, part.id, item.quantity, item.row_order, item.notes || '');
    });
    db.prepare("UPDATE products SET updated_at=datetime('now','localtime') WHERE id=?").run(pid);
  });

  db.prepare('UPDATE change_logs SET is_rolled_back = 1 WHERE id = ?').run(log.id);
  const r = db.prepare(
    `INSERT INTO change_logs (action_type, operator, reason, affected_products)
     VALUES ('rollback', '시스템', ?, ?)`
  ).run(`이력 #${log.id} 롤백`, log.affected_products);

  res.json({ success: true, message: '롤백 완료', rollback_log_id: r.lastInsertRowid });
});

// ======================================================
// COMMON PARTS
// ======================================================
app.get('/api/common-parts', (req, res) => {
  const { product_group = '' } = req.query;
  let sql = `SELECT ct.*, p.part_number, p.part_name, p.spec, p.unit
             FROM common_part_templates ct JOIN parts p ON ct.part_id = p.id WHERE 1=1`;
  const params = [];
  if (product_group) { sql += ' AND ct.product_group = ?'; params.push(product_group); }
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => ({
    id: r.id,
    product_group: r.product_group,
    default_quantity: r.default_quantity,
    part: { id: r.part_id, part_number: r.part_number, part_name: r.part_name, spec: r.spec, unit: r.unit },
  })));
});

app.post('/api/common-parts', (req, res) => {
  const { product_group, part_number, part_name, spec = '', unit = 'EA', default_quantity = 1 } = req.body;
  if (!product_group || !part_number) return res.status(400).json({ detail: '제품군과 부품번호는 필수입니다' });
  const part = getOrCreatePart(part_number, part_name || '', spec, unit);
  try {
    const r = db.prepare(
      'INSERT INTO common_part_templates (product_group, part_id, default_quantity) VALUES (?, ?, ?)'
    ).run(product_group, part.id, default_quantity);
    res.status(201).json({ id: r.lastInsertRowid, message: '공용 부품 등록 완료' });
  } catch (e) {
    res.status(409).json({ detail: '이미 등록된 공용 부품입니다' });
  }
});

app.delete('/api/common-parts/:id', (req, res) => {
  const r = db.prepare('DELETE FROM common_part_templates WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ detail: '찾을 수 없습니다' });
  res.status(204).send();
});

app.get('/api/common-parts/suggest/:group', (req, res) => {
  const group = req.params.group;
  const products = db.prepare('SELECT * FROM products WHERE product_group = ?').all(group);
  if (!products.length) return res.json({ suggestion: '해당 제품군의 제품이 없습니다', candidates: [] });

  const partFreq = {};
  const total = products.length;
  products.forEach(p => {
    const items = getBOMItems(p.id);
    const seen = new Set();
    items.forEach(item => {
      const pn = item.part.part_number;
      if (!seen.has(pn)) {
        seen.add(pn);
        if (!partFreq[pn]) partFreq[pn] = { count: 0, name: item.part.part_name };
        partFreq[pn].count++;
      }
    });
  });

  const candidates = Object.entries(partFreq)
    .filter(([, v]) => v.count / total >= 0.5)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([pn, v]) => ({ part_number: pn, part_name: v.name,
                          frequency: v.count, percentage: Math.round(v.count / total * 100) }));

  const aiSuggestion = suggestCommonParts(group, partFreq, total);
  res.json({ candidates, ai_suggestion: aiSuggestion });
});

// ======================================================
// NOTIFICATIONS
// ======================================================
app.post('/api/notifications/generate', (req, res) => {
  const { change_log_id } = req.query;
  const log = db.prepare('SELECT * FROM change_logs WHERE id = ?').get(change_log_id);
  if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });

  const affected = JSON.parse(log.affected_products || '[]');
  const changes = JSON.parse(log.changes || '{}');
  const emailText = generateNotificationEmail({
    actionType: log.action_type, affectedProducts: affected, changes,
    reason: log.reason, operator: log.operator, timestamp: log.timestamp,
  });

  const lines = emailText.split('\n');
  let subject = '', bodyLines = [];
  let foundSubject = false;
  for (const line of lines) {
    if (!foundSubject && (line.toLowerCase().startsWith('subject:') || line.startsWith('제목:'))) {
      subject = line.split(':').slice(1).join(':').trim();
      foundSubject = true;
    } else {
      bodyLines.push(line);
    }
  }
  if (!subject) subject = 'BOM 변경 알림';
  res.json({ subject, body: bodyLines.join('\n').trim(), raw: emailText });
});

app.post('/api/notifications/send', (req, res) => {
  const { change_log_id, recipient_group_ids = [], extra_emails = [], custom_body } = req.body;
  const log = db.prepare('SELECT * FROM change_logs WHERE id = ?').get(change_log_id);
  if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });

  const allRecipients = [...extra_emails];
  recipient_group_ids.forEach(gid => {
    const group = db.prepare('SELECT * FROM recipient_groups WHERE id = ?').get(gid);
    if (group) allRecipients.push(...JSON.parse(group.emails || '[]'));
  });
  const uniqueRecipients = [...new Set(allRecipients)];
  if (!uniqueRecipients.length) return res.status(400).json({ detail: '수신자가 없습니다' });

  let subject = 'BOM 변경 알림';
  let body = custom_body || '';

  if (!body) {
    const affected = JSON.parse(log.affected_products || '[]');
    const changes = JSON.parse(log.changes || '{}');
    const emailText = generateNotificationEmail({
      actionType: log.action_type, affectedProducts: affected, changes,
      reason: log.reason, operator: log.operator, timestamp: log.timestamp,
    });
    const lines = emailText.split('\n');
    const bodyLines = [];
    for (const line of lines) {
      if (line.toLowerCase().startsWith('subject:') || line.startsWith('제목:')) {
        subject = line.split(':').slice(1).join(':').trim();
      } else {
        bodyLines.push(line);
      }
    }
    body = bodyLines.join('\n').trim();
  }

  // Outlook via PowerShell
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
  try {
    const r = spawnSync('powershell', ['-Command', psScript],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status === 0) {
      res.json({ success: true, message: 'Outlook 초안 생성 완료 (검토 후 발송해주세요)' });
    } else {
      res.json({ success: false, message: r.stderr || 'Outlook 실행 실패' });
    }
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Recipient Groups
app.get('/api/notifications/recipients', (_, res) => {
  const groups = db.prepare('SELECT * FROM recipient_groups').all();
  res.json(groups.map(g => ({
    ...g,
    emails: JSON.parse(g.emails || '[]'),
    default_for_actions: JSON.parse(g.default_for_actions || '[]'),
  })));
});

app.post('/api/notifications/recipients', (req, res) => {
  const { group_name, emails = [], default_for_actions = [] } = req.body;
  const r = db.prepare(
    'INSERT INTO recipient_groups (group_name, emails, default_for_actions) VALUES (?, ?, ?)'
  ).run(group_name, JSON.stringify(emails), JSON.stringify(default_for_actions));
  res.status(201).json({ id: r.lastInsertRowid, message: '수신자 그룹 생성 완료' });
});

app.put('/api/notifications/recipients/:id', (req, res) => {
  const { group_name, emails = [], default_for_actions = [] } = req.body;
  db.prepare(
    'UPDATE recipient_groups SET group_name=?, emails=?, default_for_actions=? WHERE id=?'
  ).run(group_name, JSON.stringify(emails), JSON.stringify(default_for_actions), req.params.id);
  res.json({ message: '수정 완료' });
});

app.delete('/api/notifications/recipients/:id', (req, res) => {
  db.prepare('DELETE FROM recipient_groups WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

// ======================================================
// START SERVER
// ======================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  ✅ BOM 관리 시스템 실행 중`);
    console.log(`  🌐 브라우저에서 열기: http://localhost:${PORT}`);
    console.log(`  종료: Ctrl+C`);
    console.log(`${'='.repeat(50)}\n`);
  });
}

module.exports = app;
