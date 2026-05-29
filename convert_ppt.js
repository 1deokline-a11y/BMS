'use strict';
const JSZip = require('jszip');
const fs    = require('fs');
const path  = require('path');

const TEMPLATE_PATH = 'CLAUDE Ai 교육 결과 보고서 서식.pptx';
const SOURCE_PATH   = 'AJW_BMS_소개자료_260527.pptx';
const OUTPUT_PATH   = 'AJW_BMS_BOM시스템소개_교육보고서.pptx';

// 서식(A4) / 소개자료(WIDE) 가로 비율
const A4_W    = 9906000;
const WIDE_W  = 12192000;
const SCALE_X = A4_W / WIDE_W;   // ≈ 0.8125

// ── EMU 가로값 스케일링 ──────────────────────────────
function scaleHoriz(xml) {
  // <a:off x="N" y="N"/>
  xml = xml.replace(/(<a:off\s+)x="(-?\d+)"(\s+y="-?\d+")/g,
    (_, pre, x, ypart) => `${pre}x="${Math.round(Number(x) * SCALE_X)}"${ypart}`);
  // <a:ext cx="N" cy="N"/>
  xml = xml.replace(/(<a:ext\s+)cx="(-?\d+)"(\s+cy="-?\d+")/g,
    (_, pre, cx, cypart) => `${pre}cx="${Math.round(Number(cx) * SCALE_X)}"${cypart}`);
  // <a:chOff x="N" y="N"/>
  xml = xml.replace(/(<a:chOff\s+)x="(-?\d+)"(\s+y="-?\d+")/g,
    (_, pre, x, ypart) => `${pre}x="${Math.round(Number(x) * SCALE_X)}"${ypart}`);
  // <a:chExt cx="N" cy="N"/>
  xml = xml.replace(/(<a:chExt\s+)cx="(-?\d+)"(\s+cy="-?\d+")/g,
    (_, pre, cx, cypart) => `${pre}cx="${Math.round(Number(cx) * SCALE_X)}"${cypart}`);
  return xml;
}

// 슬라이드 번호 정렬
function slideNum(path) {
  return parseInt(path.match(/\d+/)[0]);
}

async function main() {
  console.log('📂 파일 로드 중...');
  const templateBuf = fs.readFileSync(TEMPLATE_PATH);
  const sourceBuf   = fs.readFileSync(SOURCE_PATH);

  const template = await JSZip.loadAsync(templateBuf);
  const source   = await JSZip.loadAsync(sourceBuf);

  // ── 서식 기반으로 출력 시작 ────────────────────────
  const output = await JSZip.loadAsync(templateBuf);

  // ── 소개자료 슬라이드 목록 (slide2 ~ slide20) ──────
  const srcSlides = Object.keys(source.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => slideNum(a) - slideNum(b));
  // slide1 제외 (서식의 표지 사용)
  const slidesToAdd = srcSlides.slice(1);   // index 1~ = slide2~
  console.log(`📄 소개자료 슬라이드 ${slidesToAdd.length}장 추가 예정 (slide2~${srcSlides.length})`);

  // ── 서식의 기존 slide2,3,4 제거 ───────────────────
  ['ppt/slides/slide2.xml','ppt/slides/slide3.xml','ppt/slides/slide4.xml',
   'ppt/slides/_rels/slide2.xml.rels','ppt/slides/_rels/slide3.xml.rels','ppt/slides/_rels/slide4.xml.rels',
   'ppt/notesSlides/notesSlide2.xml','ppt/notesSlides/notesSlide3.xml','ppt/notesSlides/notesSlide4.xml',
   'ppt/notesSlides/_rels/notesSlide2.xml.rels','ppt/notesSlides/_rels/notesSlide3.xml.rels',
   'ppt/notesSlides/_rels/notesSlide4.xml.rels',
  ].forEach(p => { try { output.remove(p); } catch(_) {} });

  // ── blank 레이아웃 rels XML 준비 (layout7 = 빈 화면) ─
  const blankLayoutRel = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout7.xml"/>
</Relationships>`;

  // ── 소개자료 슬라이드 2~20 을 output 에 추가 ───────
  // 서식 rels 에서 이미 사용 중인 rId 최대값 파악 → 그 이후부터 할당
  const presRelExisting = await output.file('ppt/_rels/presentation.xml.rels').async('string');
  const usedNums = [...presRelExisting.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1]));
  let nextId = Math.max(...usedNums) + 1;  // 기존 최대 rId + 1 부터
  console.log(`📌 rId 시작 번호: rId${nextId} (기존 최대 rId${Math.max(...usedNums)})`);
  const newRelEntries = [];
  const newSldIdEntries = [];
  let sldIdCounter = 300;

  for (const srcPath of slidesToAdd) {
    const num = slideNum(srcPath); // 2,3,...,20
    const dstSlideFile = `ppt/slides/slide${num}.xml`;
    const dstRelFile   = `ppt/slides/_rels/slide${num}.xml.rels`;

    // 슬라이드 XML: 가로 스케일 적용
    let slideXml = await source.file(srcPath).async('string');
    slideXml = scaleHoriz(slideXml);
    output.file(dstSlideFile, slideXml);

    // rels: blank 레이아웃(layout7) 으로 교체
    output.file(dstRelFile, blankLayoutRel);

    const rId = `rId${nextId}`;
    newRelEntries.push(
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${num}.xml"/>`
    );
    newSldIdEntries.push(`<p:sldId id="${sldIdCounter}" r:id="${rId}"/>`);
    sldIdCounter++;
    nextId++;
  }

  // ── 소개자료 미디어 파일 복사 ─────────────────────
  console.log('🖼️  미디어 파일 복사 중...');
  const srcMedia = Object.keys(source.files).filter(f => f.startsWith('ppt/media/'));
  for (const mPath of srcMedia) {
    const mData = await source.file(mPath).async('nodebuffer');
    output.file(mPath, mData);
  }

  // ── presentation.xml 수정 ─────────────────────────
  let presXml = await output.file('ppt/presentation.xml').async('string');

  // 슬라이드 사이즈 → A4 (이미 A4이지만 명시 확인)
  presXml = presXml.replace(/<p:sldSz[^>]+\/>/, `<p:sldSz cx="${A4_W}" cy="6858000" type="A4"/>`);

  // sldIdLst: 기존 slide2,3,4 항목 제거 후 새 슬라이드 추가
  presXml = presXml.replace(/<p:sldIdLst>[^]*?<\/p:sldIdLst>/, (m) => {
    // slide1(rId2) 만 남기고 나머지 제거
    const slide1Entry = m.match(/<p:sldId[^>]+rId2[^>]*\/>/)?.[0] || '';
    return `<p:sldIdLst>${slide1Entry}${newSldIdEntries.join('')}</p:sldIdLst>`;
  });

  output.file('ppt/presentation.xml', presXml);

  // ── presentation.xml.rels 수정 ───────────────────
  let presRel = await output.file('ppt/_rels/presentation.xml.rels').async('string');

  // 기존 slide2,3,4 rels 제거
  presRel = presRel.replace(/<Relationship[^>]+Target="slides\/slide[234]\.xml"[^>]*\/>/g, '');

  // 새 슬라이드 rels 추가 (</Relationships> 앞에 삽입)
  presRel = presRel.replace('</Relationships>',
    newRelEntries.join('\n') + '\n</Relationships>');

  output.file('ppt/_rels/presentation.xml.rels', presRel);

  // ── 서식 slide1 가로 스케일 불필요 (이미 A4) ─────
  // (template slide1 is already A4, no scaling needed)
  console.log('✅ 서식 표지(slide1) 그대로 유지');

  // ── 저장 ─────────────────────────────────────────
  console.log('💾 파일 저장 중...');
  const outBuf = await output.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(OUTPUT_PATH, outBuf);
  console.log(`\n✅ 완료: ${OUTPUT_PATH} (${(outBuf.length/1024).toFixed(0)}KB)`);
  console.log(`   슬라이드 구성: 서식 표지 1장 + 소개자료 ${slidesToAdd.length}장 = 총 ${slidesToAdd.length + 1}장`);
}

main().catch(e => { console.error('❌ 오류:', e.message, e.stack); });
