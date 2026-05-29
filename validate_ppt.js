'use strict';
const JSZip = require('jszip');
const fs = require('fs');

async function validate() {
  const buf = fs.readFileSync('AJW_BMS_BOM시스템소개_교육보고서.pptx');
  const zip = await JSZip.loadAsync(buf);

  // presentation.xml.rels 전체 내용
  const presRel = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  console.log('=== presentation.xml.rels ===');
  console.log(presRel.substring(0, 3000));

  // sldIdLst 와 rels rId 교차 확인
  const presXml = await zip.file('ppt/presentation.xml').async('string');
  const sldIds = [...presXml.matchAll(/r:id="(rId\d+)"/g)].map(m => m[1]);
  console.log('\n=== sldIdLst rId 목록 ===');
  console.log(sldIds.join(', '));

  const relIds = [...presRel.matchAll(/Id="(rId\d+)"\s+Type="[^"]*\/slide"[^>]+Target="slides/g)].map(m => m[1]);
  console.log('\n=== rels 의 slide rId 목록 ===');
  console.log(relIds.join(', '));

  // sldIdLst 에 있지만 rels 에 없는 rId
  const missing = sldIds.filter(id => !presRel.includes(`Id="${id}"`));
  console.log('\n=== sldIdLst에 있지만 rels에 없는 rId ===');
  console.log(missing.length ? missing.join(', ') : '없음 (정상)');
}

validate().catch(e => console.error('Error:', e.message));
