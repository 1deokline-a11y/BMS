'use strict';
// DB 전체 초기화 후 BOM 자료 폴더에서 재시드
// 실행: node server/scripts/reset-seed.js
try { require('dotenv').config({ path: require('path').join(__dirname, '../../.env') }); } catch(_) {}

const { supabase }        = require('../db');
const { parseExcelBOM }   = require('../services/excel');
const { getOrCreatePart } = require('../db');
const { seedFromExcel }   = require('../seed');

async function resetDB() {
  console.log('[reset] bom_items 삭제 중...');
  const { error: e1 } = await supabase.from('bom_items').delete().gt('id', 0);
  if (e1) throw new Error('bom_items 삭제 실패: ' + e1.message);

  console.log('[reset] products 삭제 중...');
  const { error: e2 } = await supabase.from('products').delete().gt('id', 0);
  if (e2) throw new Error('products 삭제 실패: ' + e2.message);

  console.log('[reset] parts 삭제 중...');
  const { error: e3 } = await supabase.from('parts').delete().gt('id', 0);
  if (e3) throw new Error('parts 삭제 실패: ' + e3.message);

  console.log('[reset] DB 초기화 완료\n');
}

async function main() {
  try {
    await resetDB();
    await seedFromExcel(getOrCreatePart, parseExcelBOM, supabase);
    console.log('\n[done] 리셋 및 재시드 완료!');
    process.exit(0);
  } catch (e) {
    console.error('[error]', e.message);
    process.exit(1);
  }
}

main();
