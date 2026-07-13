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

function parseExcelBOM(filePath, originalName) {
  const wb = XLSX.readFile(filePath, { cellDates: true, sheetStubs: true });
  const meta = parseMetaFromFilename(originalName || filePath);

  // Pick best sheet: prefer one with BOM-like content
  let wsName = wb.SheetNames[0];
  for (const name of wb.SheetNames) {
    if (/bom|부품|자재/i.test(name)) { wsName = name; break; }
  }
  const ws = wb.Sheets[wsName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 0행에서 제품명 추출 — "회사명 : ... / {품번} / {제품명}" 형식
  if (rows.length > 0) {
    const titleCell = normalize(rows[0][0]);
    const slashParts = titleCell.split('/');
    if (slashParts.length >= 3) {
      meta.name = slashParts.slice(2).join('/').trim();
    }
  }

  const { headerIdx, colMap } = findHeaderRow(rows);
  if (headerIdx === null) return { meta, bom_items: [] };

  const bomItems = [];
  const SKIP = new Set(['', '-', 'N/A', 'n/a', null, undefined]);
  const TOTAL_RE   = /^(합\s*계|소\s*계|날\s*짜|작성일|일자|total|subtotal|date)$/i;
  const DATE_RE    = /^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const partNumber = normalize(row[colMap.part_number]);
    const partName = normalize(row[colMap.part_name]);
    if (SKIP.has(partNumber) && SKIP.has(partName)) continue;
    if (!partNumber && !partName) continue;
    // 합계/소계/날짜 키워드 또는 날짜 형식 값인 행 스킵
    if (TOTAL_RE.test(partNumber) || TOTAL_RE.test(partName)) continue;
    if (DATE_RE.test(partNumber) || DATE_RE.test(partName)) continue;

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

async function exportComparisonToExcel(p1, p2, diffs, colorOptions = {}) {
  const ExcelJS = require('exceljs');
  const { colorCommon = false, colorIndividual = false, colorQty = false } = colorOptions;
  const statusLabel = { added: '추가됨', removed: '삭제됨', qty_diff: '수량차이', spec_diff: '규격차이', same: '동일' };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOM 비교');

  // 컬럼: BOM1(1-4) | 여백(5) | BOM2(6-9) | 구분(10)
  ws.columns = [
    { width: 22 }, { width: 28 }, { width: 22 }, { width: 10 },
    { width: 3 },
    { width: 22 }, { width: 28 }, { width: 22 }, { width: 10 },
    { width: 12 },
  ];

  // 제목 행
  const titleRow = ws.addRow([`BOM 비교: ${p1} vs ${p2}`]);
  ws.mergeCells('A1:J1');
  titleRow.getCell(1).font = { bold: true, size: 13 };

  // 헤더 행 (여백 컬럼은 빈 값 유지)
  const headerRow = ws.addRow([
    `[${p1}] 부품번호`, `[${p1}] 부품명`, `[${p1}] 규격`, `[${p1}] 수량`,
    '',
    `[${p2}] 부품번호`, `[${p2}] 부품명`, `[${p2}] 규격`, `[${p2}] 수량`,
    '구분',
  ]);
  [1, 2, 3, 4, 6, 7, 8, 9, 10].forEach(i => {
    const cell = headerRow.getCell(i);
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
  });

  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  let total1 = 0, total2 = 0;

  // 데이터 행
  for (const d of diffs) {
    const i1 = d.item1 || {};
    const i2 = d.item2 || {};
    total1 += parseFloat(i1.quantity) || 0;
    total2 += parseFloat(i2.quantity) || 0;
    const row = ws.addRow([
      i1.part_number || '', i1.part_name || '', i1.spec || '', i1.quantity || '',
      '',
      i2.part_number || '', i2.part_name || '', i2.spec || '', i2.quantity || '',
      statusLabel[d.status] || d.status,
    ]);

    if ((d.status === 'same' || d.status === 'spec_diff') && colorCommon) {
      [1, 2, 3, 4, 6, 7, 8, 9, 10].forEach(i => { row.getCell(i).fill = fill('FFD4F1D4'); });
    } else if (d.status === 'removed' && colorIndividual) {
      for (let i = 1; i <= 4; i++) row.getCell(i).fill = fill('FFFFD4D4');
    } else if (d.status === 'added' && colorIndividual) {
      for (let i = 6; i <= 9; i++) row.getCell(i).fill = fill('FFFFD4D4');
    } else if (d.status === 'qty_diff' && colorQty) {
      [1, 2, 3, 4, 6, 7, 8, 9, 10].forEach(i => { row.getCell(i).fill = fill('FFFFF3CD'); });
    }
  }

  // 합계 행: 부품이 아니므로 색칠하지 않고 전체 데이터 행의 맨 아래에 위치
  const roundQty = n => (n % 1 === 0 ? n : Math.round(n * 100) / 100);
  const totalRowIdx = ws.rowCount + 1;
  ws.addRow(['합계', '', '', roundQty(total1), '', '합계', '', '', roundQty(total2), '']);
  ws.mergeCells(`A${totalRowIdx}:C${totalRowIdx}`);
  ws.mergeCells(`F${totalRowIdx}:H${totalRowIdx}`);
  const totalRow = ws.getRow(totalRowIdx);
  totalRow.eachCell({ includeEmpty: true }, cell => { cell.font = { bold: true }; });
  totalRow.getCell(1).alignment = { horizontal: 'center' };
  totalRow.getCell(6).alignment = { horizontal: 'center' };

  return wb.xlsx.writeBuffer();
}

module.exports = { parseExcelBOM, exportBOMToExcel, exportComparisonToExcel };
