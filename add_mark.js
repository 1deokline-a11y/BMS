'use strict';
const JSZip = require('jszip');
const fs    = require('fs');

const SOURCE   = 'AJW_BMS_소개자료_260527_A4.pptx';
const TEMPLATE = 'CLAUDE Ai 교육 결과 보고서 서식.pptx';
const OUTPUT   = 'AJW_BMS_소개자료_260527_A4.pptx';  // 덮어쓰기

async function main() {
  const zip  = await JSZip.loadAsync(fs.readFileSync(SOURCE));
  const tmpl = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));

  // ── 1. image1.tif 복사 (대외비 마크 이미지) ────────
  const markImg = await tmpl.file('ppt/media/image1.tif').async('nodebuffer');
  // 소개자료 A4 파일에 이미 있는 미디어 파일명 확인
  const existingMedia = Object.keys(zip.files).filter(function(f) { return f.startsWith('ppt/media/'); });
  // 충돌 없는 파일명으로 저장
  const markMediaPath = 'ppt/media/mark_daeoebi.tif';
  zip.file(markMediaPath, markImg);
  console.log('✅ 대외비 이미지 복사:', markMediaPath);

  // ── 2. 슬라이드 마스터 rels 에 이미지 관계 추가 ────
  const masterRelPath = 'ppt/slideMasters/_rels/slideMaster1.xml.rels';
  let masterRel = await zip.file(masterRelPath).async('string');

  // 기존 rId 최대값 파악
  const usedNums = (masterRel.match(/Id="rId(\d+)"/g) || []).map(function(m) { return parseInt(m.match(/\d+/)[0]); });
  const newRId = 'rId' + (Math.max.apply(null, usedNums.length ? usedNums : [0]) + 1);

  // 관계 추가
  masterRel = masterRel.replace('</Relationships>',
    '<Relationship Id="' + newRId + '" '
    + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
    + 'Target="../media/mark_daeoebi.tif"/>\n</Relationships>');
  zip.file(masterRelPath, masterRel);
  console.log('✅ 마스터 rels 추가:', newRId, '→ mark_daeoebi.tif');

  // ── 3. 슬라이드 마스터 XML 에 이미지 도형 삽입 ─────
  // 위치: 우측 상단 (서식과 동일한 A4 좌표 그대로 사용)
  // x=9104204 y=5345 cx=801795 cy=390207
  const markPicXml = [
    '<p:pic>',
      '<p:nvPicPr>',
        '<p:cNvPr id="9001" name="대외비마크"/>',
        '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>',
        '<p:nvPr/>',
      '</p:nvPicPr>',
      '<p:blipFill>',
        '<a:blip r:embed="' + newRId + '"/>',
        '<a:stretch><a:fillRect/></a:stretch>',
      '</p:blipFill>',
      '<p:spPr>',
        '<a:xfrm>',
          '<a:off x="9104204" y="5345"/>',
          '<a:ext cx="801795" cy="390207"/>',
        '</a:xfrm>',
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
      '</p:spPr>',
    '</p:pic>',
  ].join('');

  const masterPath = 'ppt/slideMasters/slideMaster1.xml';
  let masterXml = await zip.file(masterPath).async('string');

  // </p:spTree> 바로 앞에 삽입 (마스터의 도형 트리 끝)
  masterXml = masterXml.replace('</p:spTree>', markPicXml + '</p:spTree>');
  zip.file(masterPath, masterXml);
  console.log('✅ 마스터 XML 에 대외비 마크 삽입');

  // ── 4. 저장 ─────────────────────────────────────────
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(OUTPUT, buf);
  console.log('\n✅ 완료:', OUTPUT, '(' + (buf.length/1024).toFixed(0) + 'KB)');
  console.log('   대외비 마크가 슬라이드 마스터에 추가되어 전체 슬라이드에 표시됩니다.');
}

main().catch(function(e) { console.error('❌ 오류:', e.message); });
