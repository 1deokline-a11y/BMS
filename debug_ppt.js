'use strict';
const JSZip = require('jszip');
const fs    = require('fs');

async function main() {
  const zip = await JSZip.loadAsync(fs.readFileSync('AJW_BMS_소개자료_260527_A4.pptx'));

  // [Content_Types].xml 확인
  const ct = await zip.file('[Content_Types].xml').async('string');
  console.log('=== Content_Types.xml ===');
  console.log(ct);

  // 원본 서식에서 Content_Types 확인
  const tmpl = await JSZip.loadAsync(fs.readFileSync('CLAUDE Ai 교육 결과 보고서 서식.pptx'));
  const tct  = await tmpl.file('[Content_Types].xml').async('string');
  console.log('\n=== 서식 Content_Types.xml ===');
  console.log(tct.substring(0, 800));

  // 소개자료 원본 Content_Types
  const src  = await JSZip.loadAsync(fs.readFileSync('AJW_BMS_소개자료_260527.pptx'));
  const sct  = await src.file('[Content_Types].xml').async('string');
  console.log('\n=== 소개자료 원본 Content_Types (tif 있는지) ===');
  console.log(sct.substring(0, 800));
}

main().catch(function(e) { console.error(e.message); });
