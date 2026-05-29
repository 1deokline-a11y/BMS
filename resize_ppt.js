'use strict';
const JSZip = require('jszip');
const fs    = require('fs');

const SOURCE  = 'AJW_BMS_소개자료_260527.pptx';
const OUTPUT  = 'AJW_BMS_소개자료_260527_A4.pptx';

// 소개자료(WIDE 16:9) → 서식(A4 가로)
const SRC_W = 12192000;  // 현재 가로
const DST_W =  9906000;  // A4 가로
const SRC_H =  6858000;  // 현재 세로 (동일)
const DST_H =  6858000;  // A4 세로 (동일)
const SX = DST_W / SRC_W;  // 가로 축척 ≈ 0.8125
const SY = DST_H / SRC_H;  // 세로 축척 = 1.0

function scaleXml(xml) {
  // <a:off x="N" y="N"/>
  xml = xml.replace(/(<a:off\s+x=")(-?\d+)("\s+y=")(-?\d+)(")/g,
    (_, p1, x, p2, y, p3) =>
      `${p1}${Math.round(+x * SX)}${p2}${Math.round(+y * SY)}${p3}`);
  // <a:ext cx="N" cy="N"/>
  xml = xml.replace(/(<a:ext\s+cx=")(-?\d+)("\s+cy=")(-?\d+)(")/g,
    (_, p1, cx, p2, cy, p3) =>
      `${p1}${Math.round(+cx * SX)}${p2}${Math.round(+cy * SY)}${p3}`);
  // <a:chOff x="N" y="N"/>
  xml = xml.replace(/(<a:chOff\s+x=")(-?\d+)("\s+y=")(-?\d+)(")/g,
    (_, p1, x, p2, y, p3) =>
      `${p1}${Math.round(+x * SX)}${p2}${Math.round(+y * SY)}${p3}`);
  // <a:chExt cx="N" cy="N"/>
  xml = xml.replace(/(<a:chExt\s+cx=")(-?\d+)("\s+cy=")(-?\d+)(")/g,
    (_, p1, cx, p2, cy, p3) =>
      `${p1}${Math.round(+cx * SX)}${p2}${Math.round(+cy * SY)}${p3}`);
  return xml;
}

async function main() {
  console.log('📂 로드:', SOURCE);
  const zip = await JSZip.loadAsync(fs.readFileSync(SOURCE));

  // ── 슬라이드 크기 변경 ──────────────────────────
  let presXml = await zip.file('ppt/presentation.xml').async('string');
  presXml = presXml.replace(
    /<p:sldSz[^/]*\/>/,
    `<p:sldSz cx="${DST_W}" cy="${DST_H}" type="A4"/>`
  );
  zip.file('ppt/presentation.xml', presXml);
  console.log(`📐 슬라이드 크기: ${SRC_W} → ${DST_W} (×${SX.toFixed(4)})`);

  // ── 모든 슬라이드 콘텐츠 스케일 ─────────────────
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

  console.log(`📄 슬라이드 ${slideFiles.length}장 변환 중...`);
  for (const path of slideFiles) {
    let xml = await zip.file(path).async('string');
    xml = scaleXml(xml);
    zip.file(path, xml);
  }

  // 슬라이드 레이아웃도 스케일 (배경 이미지 위치 등)
  const layoutFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f));
  for (const path of layoutFiles) {
    let xml = await zip.file(path).async('string');
    xml = scaleXml(xml);
    zip.file(path, xml);
  }

  // 슬라이드 마스터도 스케일
  const masterFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f));
  for (const path of masterFiles) {
    let xml = await zip.file(path).async('string');
    xml = scaleXml(xml);
    zip.file(path, xml);
  }

  // ── 저장 ────────────────────────────────────────
  console.log('💾 저장 중...');
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(OUTPUT, buf);
  console.log(`\n✅ 완료: ${OUTPUT} (${(buf.length/1024).toFixed(0)}KB)`);
}

main().catch(e => console.error('❌ 오류:', e.message));
