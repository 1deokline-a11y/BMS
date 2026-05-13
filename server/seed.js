'use strict';
const path = require('path');
const fs = require('fs');

function collectExcelFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      result.push(...collectExcelFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.xlsx') && !entry.name.startsWith('~$')) {
      result.push(path.join(dir, entry.name));
    }
  }
  return result;
}

async function seedFromExcel(getOrCreatePart, parseExcelBOM, supabase) {
  try {
    const bomRoot = path.join(__dirname, '..', 'BOM 자료');
    const filePaths = collectExcelFiles(bomRoot);
    if (!filePaths.length) return;
    console.log(`[seed] ${filePaths.length}개 파일 확인 중...`);

    // 1단계: 모든 파일 파싱
    const allParsed = [];
    for (const filePath of filePaths) {
      try {
        const parsed = parseExcelBOM(filePath);
        if (parsed.meta.part_number) allParsed.push(parsed);
      } catch (e) {
        console.error(`[seed] 파싱 실패 ${path.basename(filePath)}:`, e.message);
      }
    }

    // 2단계: 제품 upsert (신규/기존 모두 최신 데이터로 유지)
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .upsert(allParsed.map(p => ({
        part_number:   p.meta.part_number,
        product_group: p.meta.product_group,
        variant_code:  p.meta.variant_code,
        name:          p.meta.name,
        customer:      p.meta.customer      || '',
        country_spec:  p.meta.country_spec  || '',
        spec:          p.meta.spec          || '',
        notes:         '',
      })), { onConflict: 'part_number' })
      .select();
    if (prodErr) throw prodErr;

    // 기존 BOM 항목 전체 삭제 후 재삽입 (Excel이 항상 원본)
    const productIds = products.map(p => p.id);
    for (const pid of productIds) {
      await supabase.from('bom_items').delete().eq('product_id', pid);
    }
    const toInsert = allParsed;

    // 3단계: 고유 부품 배치 UPSERT
    const uniqueParts = new Map();
    for (const { bom_items } of toInsert) {
      for (const item of bom_items) {
        if (!uniqueParts.has(item.part_number)) {
          uniqueParts.set(item.part_number, {
            part_number: item.part_number,
            part_name:   item.part_name   || '',
            spec:        item.spec        || '',
            unit:        item.unit        || 'EA',
          });
        }
      }
    }
    const { data: parts, error: partErr } = await supabase
      .from('parts')
      .upsert([...uniqueParts.values()], { onConflict: 'part_number' })
      .select();
    if (partErr) throw partErr;

    // 부품번호 → ID 맵
    const partIdMap = new Map(parts.map(p => [p.part_number, p.id]));
    // 제품 품번 → ID 맵
    const productIdMap = new Map(products.map(p => [p.part_number, p.id]));

    // 4단계: BOM 항목 배치 INSERT (500개씩 청크)
    const bomRows = [];
    for (const { meta, bom_items } of toInsert) {
      const productId = productIdMap.get(meta.part_number);
      if (!productId) continue;
      bom_items.forEach((item, i) => {
        const partId = partIdMap.get(item.part_number);
        if (!partId) return;
        bomRows.push({
          product_id: productId,
          part_id:    partId,
          quantity:   item.quantity || 1,
          row_order:  i,
          position:   '',
          notes:      item.notes || '',
        });
      });
    }

    const CHUNK = 500;
    for (let i = 0; i < bomRows.length; i += CHUNK) {
      const { error } = await supabase.from('bom_items').insert(bomRows.slice(i, i + CHUNK));
      if (error) throw error;
    }

    console.log(`[seed] 완료: 제품 ${products.length}개, 부품 ${parts.length}개, BOM항목 ${bomRows.length}개`);
  } catch (e) {
    console.error('[seed] 오류:', e.message);
  }
}

module.exports = { seedFromExcel };
