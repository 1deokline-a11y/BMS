'use strict';
const JSZip = require('jszip');
const fs    = require('fs');

const FILE = 'AJW_BMS_소개자료_260527_A4.pptx';

// ── 글꼴 교체 함수 ───────────────────────────────────
function replaceFonts(xml) {
  // <a:latin typeface="X"/> → Helvetica  (+로 시작하는 테마 참조는 제외)
  xml = xml.replace(
    /<a:latin([^>]*?)typeface="(?!\+)([^"]*)"([^/]*?)\/>/g,
    function(m, pre, name, post) {
      return '<a:latin' + pre + 'typeface="Helvetica"' + post + '/>';
    }
  );

  // <a:ea typeface="X"/> → 나눔고딕  (비어있지 않고, 테마 참조가 아닌 경우)
  xml = xml.replace(
    /<a:ea([^>]*?)typeface="(?!\+)([^"]+)"([^/]*?)\/>/g,
    function(m, pre, name, post) {
      return '<a:ea' + pre + 'typeface="나눔고딕"' + post + '/>';
    }
  );

  // <a:cs typeface="X"/> → 나눔고딕
  xml = xml.replace(
    /<a:cs([^>]*?)typeface="(?!\+)([^"]*)"([^/]*?)\/>/g,
    function(m, pre, name, post) {
      return '<a:cs' + pre + 'typeface="나눔고딕"' + post + '/>';
    }
  );

  return xml;
}

// ── 타원 → 완벽한 원 (cx=297180, cy=365760 → cy=297180) ─
function fixEllipses(xml) {
  return xml.replace(
    /(<a:ext cx="297180" cy=")365760(")/g,
    '$1297180$2'
  );
}

async function main() {
  const zip = await JSZip.loadAsync(fs.readFileSync(FILE));

  // 글꼴을 적용할 XML 파일 대상
  const fontTargets = Object.keys(zip.files).filter(function(f) {
    return (
      f.endsWith('.xml') &&
      (f.startsWith('ppt/slides/') ||
       f.startsWith('ppt/slideLayouts/') ||
       f.startsWith('ppt/slideMasters/') ||
       f.startsWith('ppt/notesMasters/') ||
       f.startsWith('ppt/theme/'))
    );
  });

  console.log('🔤 글꼴 교체 대상 파일 수:', fontTargets.length);
  let fontChangedCount = 0;

  for (const path of fontTargets) {
    const original = await zip.file(path).async('string');
    const updated  = replaceFonts(original);
    if (updated !== original) {
      zip.file(path, updated);
      fontChangedCount++;
    }
  }
  console.log('✅ 글꼴 변경된 파일 수:', fontChangedCount);

  // ── 타원 수정: 슬라이드 12~17 ────────────────────────
  const circleSlides = [12, 13, 14, 15, 16, 17];
  for (const n of circleSlides) {
    const path = 'ppt/slides/slide' + n + '.xml';
    if (!zip.file(path)) continue;
    const original = await zip.file(path).async('string');
    const updated  = fixEllipses(original);
    const count = (original.match(/cy="365760"/g) || []).length -
                  (updated.match(/cy="365760"/g) || []).length;
    if (count > 0) {
      zip.file(path, updated);
      console.log('⭕ slide' + n + ' 타원 → 원형 ' + count + '개 수정');
    }
  }

  // ── 저장 ────────────────────────────────────────────
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(FILE, buf);
  console.log('\n✅ 완료:', FILE, '(' + (buf.length / 1024).toFixed(0) + 'KB)');
}

main().catch(function(e) { console.error('❌ 오류:', e.message, '\n', e.stack); });
