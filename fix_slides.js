'use strict';
const JSZip = require('jszip');
const fs    = require('fs');

const FILE = 'AJW_BMS_소개자료_260527_A4.pptx';

// 대외비 위치 (A4 EMU)
const MARK_X  = 9104204;
const MARK_Y  = 5345;
const MARK_CX = 801795;
const MARK_CY = 390207;

// 대외비 도형 XML 생성
function daeoebiShapeXml(fillColor, shapeId) {
  return [
    '<p:sp>',
      '<p:nvSpPr>',
        '<p:cNvPr id="' + shapeId + '" name="대외비표시"/>',
        '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>',
        '<p:nvPr/>',
      '</p:nvSpPr>',
      '<p:spPr>',
        '<a:xfrm><a:off x="' + MARK_X + '" y="' + MARK_Y + '"/>',
        '<a:ext cx="' + MARK_CX + '" cy="' + MARK_CY + '"/></a:xfrm>',
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
        '<a:solidFill><a:srgbClr val="' + fillColor + '"/></a:solidFill>',
        '<a:ln w="25400"><a:solidFill><a:srgbClr val="F59E0B"/></a:solidFill></a:ln>',
      '</p:spPr>',
      '<p:txBody>',
        '<a:bodyPr anchor="ctr"/>',
        '<a:lstStyle/>',
        '<a:p><a:pPr algn="ctr"/>',
          '<a:r>',
            '<a:rPr lang="ko-KR" altLang="en-US" sz="1200" b="1" dirty="0">',
              '<a:solidFill><a:srgbClr val="F59E0B"/></a:solidFill>',
              '<a:latin typeface="Malgun Gothic"/>',
              '<a:ea typeface="Malgun Gothic"/>',
            '</a:rPr>',
            '<a:t>대외비</a:t>',
          '</a:r>',
        '</a:p>',
      '</p:txBody>',
    '</p:sp>',
  ].join('');
}

// 슬라이드 XML 에서 다음 사용 가능한 shape id 반환
function nextShapeId(xml) {
  const ids = (xml.match(/cNvPr id="(\d+)"/g) || [])
    .map(function(m) { return parseInt(m.match(/\d+/)[0]); });
  return ids.length ? Math.max.apply(null, ids) + 1 : 9900;
}

// </p:spTree> 바로 앞에 shape 삽입
function insertShape(xml, shapeXml) {
  return xml.replace('</p:spTree>', shapeXml + '</p:spTree>');
}

async function main() {
  const zip = await JSZip.loadAsync(fs.readFileSync(FILE));

  // ── 1. 슬라이드 3, 7, 18: 남색(#1E3A5F) 대외비 추가 ──
  //    (마스터 TIF 가 하얀배경으로 보이는 문제 → 슬라이드 위에 덮어씀)
  const darkSlides = [
    {num: 3,  color: '1E3A5F'},
    {num: 7,  color: '1E3A5F'},
    {num: 18, color: '1E3A5F'},
  ];
  for (const s of darkSlides) {
    const path = 'ppt/slides/slide' + s.num + '.xml';
    let xml = await zip.file(path).async('string');
    const id  = nextShapeId(xml);
    xml = insertShape(xml, daeoebiShapeXml(s.color, id));
    zip.file(path, xml);
    console.log('✅ slide' + s.num + ' 대외비 남색 추가 (id:' + id + ')');
  }

  // ── 2. 슬라이드 12~17: 각 슬라이드 색 대외비 추가 ──
  const featureSlides = [
    {num: 12, color: '2563EB'},   // 대시보드 - 파랑
    {num: 13, color: '059669'},   // BOM 열람 - 초록
    {num: 14, color: '7C3AED'},   // BOM 비교 - 보라
    {num: 15, color: 'DB2777'},   // BOM 수정 - 핑크
    {num: 16, color: '0891B2'},   // BOM 생성 - 청록
    {num: 17, color: '64748B'},   // 변경이력 - 회색
  ];
  for (const s of featureSlides) {
    const path = 'ppt/slides/slide' + s.num + '.xml';
    let xml = await zip.file(path).async('string');
    const id  = nextShapeId(xml);
    xml = insertShape(xml, daeoebiShapeXml(s.color, id));
    zip.file(path, xml);
    console.log('✅ slide' + s.num + ' 대외비 추가 (#' + s.color + ', id:' + id + ')');
  }

  // ── 3. 슬라이드 12~17: 타원 cx≠cy 수정 → 완벽한 원 ──
  //    원래 cx=297180, cy=365760 → cy를 cx와 동일하게
  //    대상: ellipse sp의 ext, 그 위에 겹쳐진 text 박스의 ext 모두
  const circleSlides = [12, 13, 14, 15, 16, 17];
  for (const n of circleSlides) {
    const path = 'ppt/slides/slide' + n + '.xml';
    let xml = await zip.file(path).async('string');
    const before = (xml.match(/cy="365760"/g) || []).length;

    // cx=297180 이고 cy=365760 인 ext 를 cy=297180 으로 수정
    // (이 크기 쌍은 원래 원이었다가 가로만 축소된 타원 - 둘 다 297180 으로 맞춤)
    xml = xml.replace(
      /(<a:ext cx="297180" cy=")365760(")/g,
      '$1297180$2'
    );
    // 같은 크기의 off (위치는 건드리지 않음, ext만 수정)
    const after = (xml.match(/cy="365760"/g) || []).length;
    zip.file(path, xml);
    console.log('✅ slide' + n + ' 타원 수정: ' + (before - after) + '개 cy 365760→297180');
  }

  // ── 4. 저장 ─────────────────────────────────────────
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(FILE, buf);
  console.log('\n✅ 완료:', FILE, '(' + (buf.length / 1024).toFixed(0) + 'KB)');
}

main().catch(function(e) { console.error('❌ 오류:', e.message, '\n', e.stack); });
