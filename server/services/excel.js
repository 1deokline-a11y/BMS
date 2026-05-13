'use strict';
const XLSX = require('xlsx');
const path = require('path');

const HEADER_KEYWORDS = {
  part_number: ['품목코드', '품번', '부품번호', '자재번호', 'part no', 'part number', '구매품번', '품 번', '자재코드'],
  part_name: ['품목명', '품명', '부품명', '자재명', 'part name', '명칭'],
  spec: ['규격명', '규격', '사양', 'spec', 'specification'],
  unit: ['단위', 'unit'],
  quantity: ['소요량', '수량', 'qty', 'quantity', '사용량'],
  notes: ['비고', 'remark', 'note', '참고'],
};

function normalize(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i].map(c => normalize(c).toLowerCase());
    const colMap = {};
    for (const [field, keywords] of Object.entries(HEADER_KEYWORDS)) {
      for (let j = 0; j < row.length; j++) {
        if (keywords.some(kw => row[j].includes(kw)) && !(field in colMap)) {
          colMap[field] = j;
          break;
        }
      }
    }
    const matched = ['part_number', 'part_name', 'quantity'].filter(f => f in colMap).length;
    if (matched >= 2) return { headerIdx: i, colMap };
  }
  return { headerIdx: null, colMap: {} };
}

function parseMetaFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const parts = base.split('_');
  const partNumber = parts[0] || base;
  const m = partNumber.match(/^([A-Z]\d{2}-[A-Z]\d)-(\d{4})/);
  const productGroup = m ? m[1] : partNumber.substring(0, 6);
  const variantCode = m ? m[2] : '0000';
  const name = parts.slice(1).join('_');

  let customer = '', countrySpec = '', spec = '';
  for (const p of parts.slice(1)) {
    if (p.includes('향')) countrySpec = (countrySpec ? countrySpec + ', ' : '') + p;
    else if (/\d+C/.test(p)) spec = p;
    else if (/^[A-Z]{2,}/.test(p) && p.length <= 20) customer = p;
  }

  return { part_number: partNumber, product_group: productGroup, variant_code: variantCode, name, customer, country_spec: countrySpec, spec };
}

function parseExcelBOM(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true, sheetStubs: true });
  const meta = parseMetaFromFilename(filePath);

  // Pick best sheet: prefer one with BOM-like content
  let wsName = wb.SheetNames[0];
  for (const name of wb.SheetNames) {
    if (/bom|부품|자재/i.test(name)) { wsName = name; break; }
  }
  const ws = wb.Sheets[wsName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const { headerIdx, colMap } = findHeaderRow(rows);
  if (headerIdx === null) return { meta, bom_items: [] };

  const bomItems = [];
  const SKIP = new Set(['', '-', 'N/A', 'n/a', null, undefined]);
  const TOTAL_RE = /^(합\s*계|소\s*계|날\s*짜|작성일|일자|total|subtotal|date)$/i;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const partNumber = normalize(row[colMap.part_number]);
    const partName = normalize(row[colMap.part_name]);
    if (SKIP.has(partNumber) && SKIP.has(partName)) continue;
    if (!partNumber && !partName) continue;
    // 합계/소계/날짜 행 스킵
    if (TOTAL_RE.test(partNumber) || TOTAL_RE.test(partName)) continue;

    let quantity = 1;
    if ('quantity' in colMap) {
      const q = parseFloat(normalize(row[colMap.quantity]));
      if (!isNaN(q)) quantity = q;
    }

    bomItems.push({
      part_number: partNumber || `UNKNOWN-${i}`,
      part_name: partName || '',
      spec: 'spec' in colMap ? normalize(row[colMap.spec]) : '',
      unit: 'unit' in colMap ? (normalize(row[colMap.unit]) || 'EA') : 'EA',
      quantity,
      notes: 'notes' in colMap ? normalize(row[colMap.notes]) : '',
      row_order: bomItems.length,
    });
  }

  return { meta, bom_items: bomItems };
}

function exportBOMToExcel(product, bomItems) {
  const wb = XLSX.utils.book_new();
  const header = ['순번', '품번', '품명', '규격', '단위', '수량', '비고'];
  const data = [header, ...bomItems.map((item, i) => [
    i + 1,
    item.part?.part_number || item.part_number || '',
    item.part?.part_name || item.part_name || '',
    item.part?.spec || item.spec || '',
    item.part?.unit || item.unit || 'EA',
    item.quantity || 1,
    item.notes || '',
  ])];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [6, 25, 30, 30, 8, 8, 20].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'BOM');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function exportComparisonToExcel(p1, p2, diffs) {
  const wb = XLSX.utils.book_new();
  const statusLabel = { added: '추가됨', removed: '삭제됨', qty_diff: '수량차이', spec_diff: '규격차이', same: '동일' };
  const header = [
    `[${p1}] 부품번호`, `[${p1}] 부품명`, `[${p1}] 규격`, `[${p1}] 수량`,
    `[${p2}] 부품번호`, `[${p2}] 부품명`, `[${p2}] 규격`, `[${p2}] 수량`,
    '구분',
  ];
  const data = [
    [`BOM 비교: ${p1} vs ${p2}`],
    header,
    ...diffs.map(d => {
      const i1 = d.item1 || {};
      const i2 = d.item2 || {};
      return [
        i1.part_number || '', i1.part_name || '', i1.spec || '', i1.quantity || '',
        i2.part_number || '', i2.part_name || '', i2.spec || '', i2.quantity || '',
        statusLabel[d.status] || d.status,
      ];
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = Array(9).fill({ wch: 22 });
  XLSX.utils.book_append_sheet(wb, ws, 'BOM 비교');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseExcelBOM, exportBOMToExcel, exportComparisonToExcel };
