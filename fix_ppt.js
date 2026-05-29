'use strict';
const JSZip = require('jszip');
const fs    = require('fs');

const FILE = 'AJW_BMS_소개자료_260527_A4.pptx';

async function main() {
  const zip = await JSZip.loadAsync(fs.readFileSync(FILE));

  // ── 1. [Content_Types].xml 에 tif 형식 등록 ────────
  let ct = await zip.file('[Content_Types].xml').async('string');

  if (!ct.includes('Extension="tif"')) {
    ct = ct.replace(
      '<Default Extension="png"',
      '<Default Extension="tif" ContentType="image/tiff"/><Default Extension="png"'
    );
    console.log('✅ tif ContentType 추가');
  } else {
    console.log('ℹ️  tif ContentType 이미 존재');
  }

  // ── 2. Content_Types 의 notesSlide Override 중
  //       실제 파일이 없는 항목 제거 ─────────────────
  const notesMatches = [...ct.matchAll(/PartName="(\/ppt\/notesSlides\/notesSlide\d+\.xml)"/g)];
  let removedCount = 0;
  for (const m of notesMatches) {
    const innerPath = m[1].replace(/^\//, ''); // /ppt/notesSlides/... → ppt/notesSlides/...
    if (!zip.file(innerPath)) {
      // Override 전체 태그 제거
      ct = ct.replace(
        new RegExp('<Override PartName="' + m[1].replace(/\//g, '\\/') + '"[^/]*/>', 'g'),
        ''
      );
      removedCount++;
    }
  }
  if (removedCount) console.log('✅ 존재하지 않는 notesSlide Override', removedCount, '개 제거');
  else console.log('ℹ️  notesSlide 파일 누락 없음');

  zip.file('[Content_Types].xml', ct);

  // ── 3. 저장 ─────────────────────────────────────────
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(FILE, buf);
  console.log('\n✅ 완료:', FILE, '(' + (buf.length / 1024).toFixed(0) + 'KB)');
}

main().catch(function(e) { console.error('❌ 오류:', e.message); });
