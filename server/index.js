'use strict';
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const { supabase, initDB, getOrCreatePart, getBOMItems } = require('./db');
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
app.use('/', (req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});
app.use('/', express.static(path.join(BASE_DIR, 'frontend')));

const dbReady = initDB()
  .then(() => seedFromExcel(getOrCreatePart, parseExcelBOM, supabase))
  .catch(e => console.error('[startup]', e.message));

app.use('/api', async (req, res, next) => {
  await dbReady;
  next();
});

// ======================================================
// HEALTH
// ======================================================
app.get('/api/health', async (_, res) => {
  try {
    await dbReady;
    res.json({ status: 'ok', version: '1.0.0', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});

// ── 대시보드 KPI 통계 ─────────────────────────────────
app.get('/api/dashboard/stats', async (_, res) => {
  try {
    await dbReady;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [
      { count: products_count },
      { count: parts_count },
      { count: changes_this_month },
      { count: empty_bom_count },
    ] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }).then(r => ({ count: r.count || 0 })),
      supabase.from('parts').select('*', { count: 'exact', head: true }).then(r => ({ count: r.count || 0 })),
      supabase.from('bom_history').select('*', { count: 'exact', head: true })
        .gte('timestamp', monthStart).then(r => ({ count: r.count || 0 })),
      supabase.from('products').select('id', { count: 'exact', head: false })
        .then(async r => {
          const allIds = (r.data || []).map(p => p.id);
          if (!allIds.length) return { count: 0 };
          const { data: withBom } = await supabase.from('bom_items')
            .select('product_id').in('product_id', allIds);
          const withBomSet = new Set((withBom || []).map(b => b.product_id));
          return { count: allIds.filter(id => !withBomSet.has(id)).length };
        }),
    ]);

    res.json({ products_count, parts_count, changes_this_month, empty_bom_count });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ── 대시보드 KPI 상세 목록 ────────────────────────────
app.get('/api/dashboard/detail', async (req, res) => {
  try {
    await dbReady;
    const { type } = req.query;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    if (type === 'products') {
      const { data } = await supabase.from('products').select('id,part_number,name,product_group').order('part_number');
      return res.json(data || []);
    }
    if (type === 'parts') {
      const { data } = await supabase.from('parts').select('id,part_number,part_name,spec,unit').order('part_number');
      return res.json(data || []);
    }
    if (type === 'changes_month') {
      const { data } = await supabase.from('bom_history').select('id,timestamp,reason,operator,affected_products')
        .gte('timestamp', monthStart).order('timestamp', { ascending: false });
      return res.json(data || []);
    }
    if (type === 'empty_bom') {
      const { data: allProds } = await supabase.from('products').select('id,part_number,name').order('part_number');
      const allIds = (allProds || []).map(p => p.id);
      if (!allIds.length) return res.json([]);
      const { data: withBom } = await supabase.from('bom_items').select('product_id').in('product_id', allIds);
      const withSet = new Set((withBom || []).map(b => b.product_id));
      return res.json((allProds || []).filter(p => !withSet.has(p.id)));
    }
    res.status(400).json({ detail: 'type 파라미터가 필요합니다' });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ======================================================
// PRODUCTS
// ======================================================
app.get('/api/products', async (req, res) => {
  try {
    const { group, customer, country_spec, search } = req.query;
    let q = supabase.from('products').select('*');
    if (group)        q = q.eq('product_group', group);
    if (customer)     q = q.ilike('customer', `%${customer}%`);
    if (country_spec) q = q.ilike('country_spec', `%${country_spec}%`);
    if (search)       q = q.or(`part_number.ilike.%${search}%,name.ilike.%${search}%,customer.ilike.%${search}%`);
    const { data, error } = await q.order('part_number');
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/products/groups', async (_, res) => {
  try {
    const { data, error } = await supabase.from('products').select('product_group');
    if (error) throw error;
    const groups = [...new Set((data || []).map(r => r.product_group))].sort();
    res.json(groups);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    data.bom_items = await getBOMItems(data.id);
    res.json(data);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const { part_number, product_group, variant_code, name,
            customer = '', country_spec = '', spec = '', notes = '', bom_items = [] } = req.body;
    if (!part_number || !product_group)
      return res.status(400).json({ detail: '품번과 제품군은 필수입니다' });

    const { data: existing } = await supabase.from('products').select('id').eq('part_number', part_number).maybeSingle();
    if (existing) return res.status(409).json({ detail: '이미 존재하는 품번입니다' });

    const { data: product, error } = await supabase
      .from('products')
      .insert({ part_number, product_group, variant_code: variant_code || '', name, customer, country_spec, spec, notes })
      .select().single();
    if (error) throw error;

    for (let i = 0; i < bom_items.length; i++) {
      const item = bom_items[i];
      const part = await getOrCreatePart(item.part_number, item.part_name, item.spec || '', item.unit || 'EA');
      await supabase.from('bom_items').insert({
        product_id: product.id, part_id: part.id,
        quantity: item.quantity || 1, row_order: i,
        position: item.position || '', notes: item.notes || '',
      });
    }
    res.status(201).json(product);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { data: existing } = await supabase.from('products').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    const { name, customer, country_spec, spec, notes } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined)         updates.name = name;
    if (customer !== undefined)     updates.customer = customer;
    if (country_spec !== undefined) updates.country_spec = country_spec;
    if (spec !== undefined)         updates.spec = spec;
    if (notes !== undefined)        updates.notes = notes;
    const { data, error } = await supabase.from('products').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { data: existing } = await supabase.from('products').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    const { error } = await supabase.from('products').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.put('/api/products/:id/bom', async (req, res) => {
  try {
    const { data: existing } = await supabase.from('products').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    await supabase.from('bom_items').delete().eq('product_id', req.params.id);
    const items = (req.body || []).filter(it => it.part_number || it.part_name);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const part = await getOrCreatePart(item.part_number || '', item.part_name || '', item.spec || '', item.unit || 'EA');
      await supabase.from('bom_items').insert({
        product_id: parseInt(req.params.id), part_id: part.id,
        quantity: item.quantity || 1, row_order: i,
        position: item.position || '', notes: item.notes || '',
      });
    }
    await supabase.from('products').update({ updated_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ message: 'BOM 저장 완료' });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// IMPORT
// ======================================================
async function importBOMData(parsed, overwrite) {
  const { meta, bom_items } = parsed;
  const { data: existing } = await supabase.from('products').select('*').eq('part_number', meta.part_number).maybeSingle();

  if (existing && !overwrite)
    return { status: 'skipped', part_number: meta.part_number, reason: '이미 존재하는 품번 (덮어쓰기 옵션 필요)' };

  let productId;
  if (existing) {
    await supabase.from('bom_items').delete().eq('product_id', existing.id);
    await supabase.from('products').update({
      product_group: meta.product_group, variant_code: meta.variant_code, name: meta.name,
      customer: meta.customer || '', country_spec: meta.country_spec || '',
      spec: meta.spec || '', updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
    productId = existing.id;
  } else {
    const { data: product, error } = await supabase
      .from('products')
      .insert({
        part_number: meta.part_number, product_group: meta.product_group,
        variant_code: meta.variant_code, name: meta.name,
        customer: meta.customer || '', country_spec: meta.country_spec || '', spec: meta.spec || '',
      })
      .select().single();
    if (error) throw error;
    productId = product.id;
  }

  for (let i = 0; i < bom_items.length; i++) {
    const item = bom_items[i];
    const part = await getOrCreatePart(item.part_number, item.part_name, item.spec || '', item.unit || 'EA');
    await supabase.from('bom_items').insert({
      product_id: productId, part_id: part.id,
      quantity: item.quantity || 1, row_order: i, notes: item.notes || '',
    });
  }
  return { status: 'success', part_number: meta.part_number, bom_items_count: bom_items.length,
           action: existing ? 'updated' : 'created' };
}

app.post('/api/import/excel/preview', upload.array('files'), async (req, res) => {
  try {
    const results = [];
    for (const file of req.files) {
      try {
        const parsed = parseExcelBOM(file.path, file.originalname);
        results.push({ filename: file.originalname, status: 'success', ...parsed });
      } catch (e) {
        results.push({ filename: file.originalname, status: 'error', reason: e.message });
      } finally {
        fs.unlink(file.path, () => {});
      }
    }
    res.json({ results });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/import/excel', upload.array('files'), async (req, res) => {
  try {
    const overwrite = req.query.overwrite === 'true';
    const results = [];
    for (const file of req.files) {
      try {
        const r = await importBOMData(parseExcelBOM(file.path, file.originalname), overwrite);
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
    const files = fs.readdirSync(folder_path).filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'));
    const results = [];
    for (const filename of files) {
      try {
        const r = await importBOMData(parseExcelBOM(path.join(folder_path, filename)), overwrite === 'true');
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
    const { data: product, error } = await supabase.from('products').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!product) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
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
const META_ROW_RE = /^(총\s*합|합\s*계|소\s*계|날\s*짜|작성일|일자|total|subtotal|date)$/i;
const DATE_LIKE_RE = /^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/;
const isMetaRow = it => {
  const pn = it.part.part_number || '';
  const nm = it.part.part_name || '';
  return META_ROW_RE.test(pn) || META_ROW_RE.test(nm) || DATE_LIKE_RE.test(pn) || DATE_LIKE_RE.test(nm);
};

async function buildCompareResult(id1, id2) {
  const [{ data: p1 }, { data: p2 }] = await Promise.all([
    supabase.from('products').select('*').eq('id', id1).maybeSingle(),
    supabase.from('products').select('*').eq('id', id2).maybeSingle(),
  ]);
  if (!p1 || !p2) return null;
  const [raw1, raw2] = await Promise.all([getBOMItems(p1.id), getBOMItems(p2.id)]);
  const [items1, items2] = [raw1.filter(it => !isMetaRow(it)), raw2.filter(it => !isMetaRow(it))];
  const idx1 = Object.fromEntries(items1.map(i => [i.part.part_number, i]));
  const idx2 = Object.fromEntries(items2.map(i => [i.part.part_number, i]));
  const allKeys = [...new Set([...Object.keys(idx1), ...Object.keys(idx2)])];
  const summary = { same: 0, added: 0, removed: 0, qty_diff: 0, spec_diff: 0 };
  const diffs = allKeys.map(key => {
    const i1 = idx1[key], i2 = idx2[key];
    let status;
    if (i1 && !i2)                         status = 'removed';
    else if (!i1 && i2)                    status = 'added';
    else if (i1.part.spec !== i2.part.spec) status = 'spec_diff';
    else if (i1.quantity !== i2.quantity)   status = 'qty_diff';
    else                                   status = 'same';
    summary[status]++;
    const toDict = it => it ? { part_number: it.part.part_number, part_name: it.part.part_name,
                                 spec: it.part.spec, unit: it.part.unit, quantity: it.quantity,
                                 notes: it.notes || '' } : null;
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
    const result = await buildCompareResult(req.query.id1, req.query.id2);
    if (!result) return res.status(404).json({ detail: '제품을 찾을 수 없습니다' });
    const colorOptions = {
      colorCommon:     req.query.colorCommon     === '1',
      colorIndividual: req.query.colorIndividual === '1',
      colorQty:        req.query.colorQty        === '1',
    };
    const buf = await exportComparisonToExcel(result.product1.part_number, result.product2.part_number, result.diffs, colorOptions);
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = encodeURIComponent(`${result.product1.part_number}, ${result.product2.part_number} BOM 비교 자료_${dateStr}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buf);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// PARTS  (부품 등록 / 검색)
// ======================================================
app.post('/api/parts', async (req, res) => {
  try {
    const { part_number, part_name, spec = '', unit = 'EA' } = req.body;
    if (!part_number || !part_name)
      return res.status(400).json({ detail: '품번(part_number)과 품명(part_name)은 필수입니다' });

    // 중복 확인
    const { data: existing } = await supabase
      .from('parts').select('id, part_number, part_name, spec, unit')
      .eq('part_number', part_number).maybeSingle();
    if (existing)
      return res.status(409).json({ detail: `이미 등록된 품번입니다 (${existing.part_name})`, existing });

    const part = await getOrCreatePart(part_number, part_name, spec, unit);
    res.status(201).json(part);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// PARTS SEARCH  (부품 검색 - BOM 탭용)
// ======================================================
app.get('/api/parts/search', async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (!q.trim()) return res.json([]);

    // part_number OR part_name 중 하나라도 포함
    const { data: parts, error } = await supabase
      .from('parts')
      .select('*')
      .or(`part_number.ilike.%${q}%,part_name.ilike.%${q}%`)
      .order('part_number')
      .limit(200);
    if (error) throw error;

    // 각 부품이 어떤 완제품에 사용되는지 조회
    const results = await Promise.all((parts || []).map(async part => {
      const { data: usage } = await supabase
        .from('bom_items')
        .select('quantity, products(id, part_number, name, product_group)')
        .eq('part_id', part.id);
      return {
        id: part.id,
        part_number: part.part_number,
        part_name: part.part_name,
        spec: part.spec || '',
        unit: part.unit || 'EA',
        used_in: (usage || [])
          .filter(r => r.products)
          .map(r => ({
            product_id: r.products.id,
            part_number: r.products.part_number,
            name: r.products.name,
            product_group: r.products.product_group,
            quantity: r.quantity,
          })),
      };
    }));
    res.json(results);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// 단일 부품 조회 (사용 제품 포함)
app.get('/api/parts/:id', async (req, res) => {
  try {
    const { data: part, error } = await supabase
      .from('parts').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!part) return res.status(404).json({ detail: '부품을 찾을 수 없습니다' });

    const { data: usage } = await supabase
      .from('bom_items')
      .select('quantity, products(id, part_number, name, product_group)')
      .eq('part_id', part.id);

    res.json({
      ...part,
      used_in: (usage || []).filter(r => r.products).map(r => ({
        product_id: r.products.id,
        part_number: r.products.part_number,
        name: r.products.name,
        product_group: r.products.product_group,
        quantity: r.quantity,
      })),
    });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// 부품 수정
app.put('/api/parts/:id', async (req, res) => {
  try {
    const { part_name, spec = '', unit = 'EA' } = req.body;
    if (!part_name) return res.status(400).json({ detail: '품명은 필수입니다' });

    const { data, error } = await supabase
      .from('parts')
      .update({ part_name, spec, unit })
      .eq('id', req.params.id)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// 부품 삭제
app.delete('/api/parts/:id', async (req, res) => {
  try {
    const force = req.query.force === 'true';

    // 사용 중인 BOM 항목 확인
    const { data: usage } = await supabase
      .from('bom_items')
      .select('id, products(part_number, name)')
      .eq('part_id', req.params.id);

    if ((usage || []).length > 0 && !force) {
      return res.status(409).json({
        detail: '이 부품은 BOM에서 사용 중입니다. force=true 로 강제 삭제하세요.',
        used_in: usage.filter(r => r.products).map(r => ({
          part_number: r.products.part_number,
          name: r.products.name,
        })),
      });
    }

    // BOM 항목에서 먼저 제거 후 부품 삭제
    if ((usage || []).length > 0) {
      await supabase.from('bom_items').delete().eq('part_id', req.params.id);
    }
    const { error } = await supabase.from('parts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// BULK EDIT
// ======================================================
app.get('/api/bulk-edit/search', async (req, res) => {
  try {
    const { q = '', part_number = q, part_name = q } = req.query;
    let query = supabase.from('parts').select('*');
    if (part_number) query = query.ilike('part_number', `%${part_number}%`);
    if (part_name && part_name !== part_number) query = query.ilike('part_name', `%${part_name}%`);
    const { data: parts, error } = await query.limit(50);
    if (error) throw error;

    const results = await Promise.all((parts || []).map(async part => {
      const { data: usage } = await supabase
        .from('bom_items')
        .select('id, quantity, product_id, products(id, part_number, name, product_group)')
        .eq('part_id', part.id);
      return {
        ...part,
        usage_count: (usage || []).length,
        usage: (usage || []).map(r => ({
          bom_item_id: r.id, quantity: r.quantity, product_id: r.product_id,
          part_number: r.products.part_number, product_name: r.products.name,
          product_group: r.products.product_group,
        })),
      };
    }));
    res.json(results);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/bulk-edit/preview', async (req, res) => {
  try {
    const { action, target_part_number, product_ids, new_part_number, new_part_name,
            new_spec, new_quantity } = req.body;
    const previews = (await Promise.all(product_ids.map(async pid => {
      const { data: pr } = await supabase.from('products').select('*').eq('id', pid).maybeSingle();
      if (!pr) return null;
      const items = await getBOMItems(pid);
      const affected = items
        .filter(item => item.part.part_number === target_part_number)
        .map(item => {
          const before = { part_number: item.part.part_number, part_name: item.part.part_name,
                           spec: item.part.spec, quantity: item.quantity };
          let after = null;
          if (action === 'replace')
            after = { part_number: new_part_number || before.part_number,
                      part_name: new_part_name || before.part_name,
                      spec: new_spec !== undefined ? new_spec : before.spec,
                      quantity: new_quantity || before.quantity };
          else if (action === 'update_qty') after = { ...before, quantity: new_quantity };
          else if (action === 'delete')     after = null;
          return { bom_item_id: item.id, before, after };
        });
      if (action === 'add' && new_part_number)
        affected.push({ bom_item_id: null, before: null,
                        after: { part_number: new_part_number, part_name: new_part_name || '',
                                 spec: new_spec || '', quantity: new_quantity || 1 } });
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

    const snapshot = {};
    for (const pid of product_ids) {
      const { data: pr } = await supabase.from('products').select('*').eq('id', pid).maybeSingle();
      if (pr) snapshot[pid] = { part_number: pr.part_number, items: await getBOMItems(pid) };
    }

    const affectedProducts = [], changesLog = {};

    for (const pid of product_ids) {
      const { data: pr } = await supabase.from('products').select('*').eq('id', pid).maybeSingle();
      if (!pr) continue;
      const items = await getBOMItems(pid);
      const productChanges = [];

      for (const item of items.filter(it => it.part.part_number === target_part_number)) {
        if (action === 'delete') {
          await supabase.from('bom_items').delete().eq('id', item.id);
          productChanges.push({ action: 'deleted', part: item.part.part_number, part_name: item.part.part_name });
        } else if (action === 'update_qty') {
          await supabase.from('bom_items').update({ quantity: new_quantity }).eq('id', item.id);
          productChanges.push({ action: 'qty_updated', part: item.part.part_number, part_name: item.part.part_name, before: item.quantity, after: new_quantity });
        } else if (action === 'replace') {
          const newPart = await getOrCreatePart(new_part_number, new_part_name || '', new_spec || '', new_unit || 'EA');
          await supabase.from('bom_items').update({
            part_id: newPart.id,
            ...(new_quantity != null ? { quantity: new_quantity } : {}),
          }).eq('id', item.id);
          productChanges.push({ action: 'replaced', before: item.part.part_number, before_name: item.part.part_name, after: new_part_number, after_name: new_part_name || '' });
        }
      }

      if (action === 'add' && new_part_number) {
        const newPart = await getOrCreatePart(new_part_number, new_part_name || '', new_spec || '', new_unit || 'EA');
        const maxOrder = items.reduce((max, i) => Math.max(max, i.row_order), -1) + 1;
        await supabase.from('bom_items').insert({
          product_id: pid, part_id: newPart.id, quantity: new_quantity || 1, row_order: maxOrder,
        });
        productChanges.push({ action: 'added', part: new_part_number, part_name: new_part_name || '' });
      }

      if (productChanges.length > 0) {
        affectedProducts.push(pr.part_number);
        changesLog[pr.part_number] = productChanges;
        await supabase.from('products').update({ updated_at: new Date().toISOString() }).eq('id', pid);
      }
    }

    const { data: log, error } = await supabase.from('change_logs').insert({
      action_type: action, operator, reason,
      affected_products: affectedProducts, changes: changesLog, snapshot_data: snapshot,
    }).select().single();
    if (error) throw error;

    res.json({ success: true, affected_products: affectedProducts,
               change_log_id: log.id, message: `${affectedProducts.length}개 제품 수정 완료` });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// HISTORY
// ======================================================
app.get('/api/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || 50);
    const offset = parseInt(req.query.offset || 0);
    const { action_type = '' } = req.query;
    let q = supabase.from('change_logs').select('*', { count: 'exact' });
    if (action_type) q = q.eq('action_type', action_type);
    const { data, count, error } = await q
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ total: count || 0, items: data || [] });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/history/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('change_logs').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });
    res.json(data);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/history/:id/rollback', async (req, res) => {
  try {
    const { data: log, error } = await supabase.from('change_logs').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });
    if (log.is_rolled_back) return res.status(400).json({ detail: '이미 롤백된 이력입니다' });
    if (!log.snapshot_data) return res.status(400).json({ detail: '스냅샷 데이터가 없습니다' });

    const snapshot = log.snapshot_data;
    for (const [pidStr, data] of Object.entries(snapshot)) {
      const pid = parseInt(pidStr);
      await supabase.from('bom_items').delete().eq('product_id', pid);
      for (const item of (data.items || [])) {
        const part = await getOrCreatePart(item.part.part_number, item.part.part_name,
                                           item.part.spec || '', item.part.unit || 'EA');
        await supabase.from('bom_items').insert({
          product_id: pid, part_id: part.id,
          quantity: item.quantity, row_order: item.row_order, notes: item.notes || '',
        });
      }
      await supabase.from('products').update({ updated_at: new Date().toISOString() }).eq('id', pid);
    }

    await supabase.from('change_logs').update({ is_rolled_back: 1 }).eq('id', log.id);
    const { data: rlog } = await supabase.from('change_logs').insert({
      action_type: 'rollback', operator: '시스템',
      reason: `이력 #${log.id} 롤백`, affected_products: log.affected_products,
    }).select().single();

    res.json({ success: true, message: '롤백 완료', rollback_log_id: rlog.id });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// COMMON PARTS
// ======================================================
app.get('/api/common-parts', async (req, res) => {
  try {
    const { product_group = '' } = req.query;
    let q = supabase.from('common_part_templates').select('*, parts(*)');
    if (product_group) q = q.eq('product_group', product_group);
    const { data, error } = await q;
    if (error) throw error;
    res.json((data || []).map(r => ({
      id: r.id, product_group: r.product_group, default_quantity: parseFloat(r.default_quantity),
      part: { id: r.parts.id, part_number: r.parts.part_number, part_name: r.parts.part_name,
              spec: r.parts.spec, unit: r.parts.unit },
    })));
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/common-parts', async (req, res) => {
  try {
    const { product_group, part_number, part_name, spec = '', unit = 'EA', default_quantity = 1 } = req.body;
    if (!product_group || !part_number) return res.status(400).json({ detail: '제품군과 부품번호는 필수입니다' });
    const part = await getOrCreatePart(part_number, part_name || '', spec, unit);
    const { data, error } = await supabase
      .from('common_part_templates')
      .insert({ product_group, part_id: part.id, default_quantity })
      .select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ detail: '이미 등록된 공용 부품입니다' });
      throw error;
    }
    res.status(201).json({ id: data.id, message: '공용 부품 등록 완료' });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.delete('/api/common-parts/:id', async (req, res) => {
  try {
    const { error, count } = await supabase.from('common_part_templates').delete().eq('id', req.params.id);
    if (error) throw error;
    if (count === 0) return res.status(404).json({ detail: '찾을 수 없습니다' });
    res.status(204).send();
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// 공용부품 일괄 등록
app.post('/api/common-parts/bulk', async (req, res) => {
  try {
    const { product_group, items } = req.body; // items: [{part_number, part_name, spec, unit, default_quantity}]
    if (!product_group || !Array.isArray(items) || !items.length)
      return res.status(400).json({ detail: '제품군과 항목 목록이 필요합니다' });

    const results = [];
    for (const item of items) {
      const part = await getOrCreatePart(item.part_number, item.part_name || '', item.spec || '', item.unit || 'EA');
      const { data, error } = await supabase.from('common_part_templates')
        .upsert({ product_group, part_id: part.id, default_quantity: item.default_quantity || 1 },
                 { onConflict: 'product_group,part_id' })
        .select().single();
      if (!error) results.push(data);
    }
    res.json({ registered: results.length });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/common-parts/suggest/:group', async (req, res) => {
  try {
    const group = req.params.group;
    const { data: products, error } = await supabase.from('products').select('*').eq('product_group', group);
    if (error) throw error;
    if (!products.length) return res.json({ suggestion: '해당 제품군의 제품이 없습니다', candidates: [] });

    // 개발품번(-0000) 및 BOM 비어있는 제품 제외
    const validProducts = [];
    for (const p of products) {
      if (/\-0000$/.test(p.part_number)) continue;   // 개발품번 제외
      const items = await getBOMItems(p.id);
      if (!items.length) continue;                    // 빈 BOM 제외
      validProducts.push({ product: p, items });
    }

    const total = validProducts.length;
    if (!total) return res.json({ candidates: [], suggestion: '분석 가능한 제품이 없습니다 (빈 BOM 및 개발품번 제외 후)' });

    const partFreq = {};
    for (const { items } of validProducts) {
      const seen = new Set();
      items.forEach(item => {
        const pn = item.part.part_number;
        if (!seen.has(pn)) {
          seen.add(pn);
          if (!partFreq[pn]) partFreq[pn] = { count: 0, name: item.part.part_name, quantities: [] };
          partFreq[pn].count++;
          partFreq[pn].quantities.push(parseFloat(item.quantity) || 1);
        }
      });
    }

    const candidates = Object.entries(partFreq)
      .filter(([, v]) => v.count / total >= 0.5)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([pn, v]) => {
        const qtys = v.quantities;
        // 최빈값(mode) 계산
        const freq = {};
        qtys.forEach(q => { freq[q] = (freq[q] || 0) + 1; });
        const modeQty = parseFloat(Object.entries(freq).sort((a,b) => b[1]-a[1])[0][0]);
        const allSame = new Set(qtys).size === 1;
        return {
          part_number: pn,
          part_name: v.name,
          frequency: v.count,
          percentage: Math.round(v.count / total * 100),
          qty_mode: modeQty,           // 최빈 수량
          qty_consistent: allSame,     // 모든 제품에서 동일한 수량인지
          qty_min: Math.min(...qtys),
          qty_max: Math.max(...qtys),
        };
      });
    const excluded = products.length - total;
    res.json({
      candidates,
      analyzed_count: total,
      excluded_count: excluded,
      ai_suggestion: suggestCommonParts(group, partFreq, total),
    });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

// ======================================================
// NOTIFICATIONS
// ======================================================
app.post('/api/notifications/generate', async (req, res) => {
  try {
    const { data: log, error } = await supabase.from('change_logs').select('*').eq('id', req.query.change_log_id).maybeSingle();
    if (error) throw error;
    if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });
    const emailText = generateNotificationEmail({
      actionType: log.action_type, affectedProducts: log.affected_products || [],
      changes: log.changes || {}, reason: log.reason, operator: log.operator, timestamp: log.timestamp,
    });
    let subject = 'BOM 변경 알림', bodyLines = [];
    for (const line of emailText.split('\n')) {
      if (!subject && (line.toLowerCase().startsWith('subject:') || line.startsWith('제목:')))
        subject = line.split(':').slice(1).join(':').trim();
      else bodyLines.push(line);
    }
    res.json({ subject, body: bodyLines.join('\n').trim(), raw: emailText });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/notifications/send', async (req, res) => {
  try {
    const { change_log_id, recipient_group_ids = [], extra_emails = [], custom_body } = req.body;
    const { data: log } = await supabase.from('change_logs').select('*').eq('id', change_log_id).maybeSingle();
    if (!log) return res.status(404).json({ detail: '이력을 찾을 수 없습니다' });

    const allRecipients = [...extra_emails];
    for (const gid of recipient_group_ids) {
      const { data: group } = await supabase.from('recipient_groups').select('*').eq('id', gid).maybeSingle();
      if (group) allRecipients.push(...(group.emails || []));
    }
    const uniqueRecipients = [...new Set(allRecipients)];
    if (!uniqueRecipients.length) return res.status(400).json({ detail: '수신자가 없습니다' });

    let subject = 'BOM 변경 알림', body = custom_body || '';
    if (!body) {
      const emailText = generateNotificationEmail({
        actionType: log.action_type, affectedProducts: log.affected_products || [],
        changes: log.changes || {}, reason: log.reason, operator: log.operator, timestamp: log.timestamp,
      });
      const bodyLines = [];
      for (const line of emailText.split('\n')) {
        if (line.toLowerCase().startsWith('subject:') || line.startsWith('제목:'))
          subject = line.split(':').slice(1).join(':').trim();
        else bodyLines.push(line);
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
    res.json(r.status === 0
      ? { success: true, message: 'Outlook 초안 생성 완료 (검토 후 발송해주세요)' }
      : { success: false, message: r.stderr || 'Outlook 실행 실패' });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.get('/api/notifications/recipients', async (_, res) => {
  try {
    const { data, error } = await supabase.from('recipient_groups').select('*');
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.post('/api/notifications/recipients', async (req, res) => {
  try {
    const { group_name, emails = [], default_for_actions = [] } = req.body;
    const { data, error } = await supabase
      .from('recipient_groups').insert({ group_name, emails, default_for_actions }).select().single();
    if (error) throw error;
    res.status(201).json({ id: data.id, message: '수신자 그룹 생성 완료' });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.put('/api/notifications/recipients/:id', async (req, res) => {
  try {
    const { group_name, emails = [], default_for_actions = [] } = req.body;
    const { error } = await supabase.from('recipient_groups')
      .update({ group_name, emails, default_for_actions }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: '수정 완료' });
  } catch (e) { res.status(500).json({ detail: e.message }); }
});

app.delete('/api/notifications/recipients/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('recipient_groups').delete().eq('id', req.params.id);
    if (error) throw error;
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
