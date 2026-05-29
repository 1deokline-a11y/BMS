'use strict';
const JSZip = require('jszip');
const fs = require('fs');

async function find() {
  const zip = await JSZip.loadAsync(fs.readFileSync('CLAUDE Ai 교육 결과 보고서 서식.pptx'));

  // 슬라이드 레이아웃7 (빈 화면) - 실제 슬라이드에 적용되는 레이아웃의 이미지 확인
  for (let i = 1; i <= 12; i++) {
    const path = 'ppt/slideLayouts/slideLayout' + i + '.xml';
    if (!zip.file(path)) continue;
    const xml = await zip.file(path).async('string');
    const pics = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) || [];
    if (pics.length) {
      console.log('Layout' + i + ' has ' + pics.length + ' images');
      pics.forEach(function(p, j) {
        const xOff = p.match(/a:off x="(\d+)" y="(\d+)"/);
        const ext  = p.match(/a:ext cx="(\d+)" cy="(\d+)"/);
        const rId  = p.match(/r:embed="(rId\d+)"/);
        console.log('  img' + j + ' rId:' + (rId ? rId[1] : '?')
          + ' x:' + (xOff ? xOff[1] : '?') + ' y:' + (xOff ? xOff[2] : '?')
          + ' cx:' + (ext ? ext[1] : '?') + ' cy:' + (ext ? ext[2] : '?'));
      });
    }
  }

  // 슬라이드 마스터 이미지 확인
  const master = await zip.file('ppt/slideMasters/slideMaster1.xml').async('string');
  const mpics = master.match(/<p:pic>[\s\S]*?<\/p:pic>/g) || [];
  console.log('\nMaster has ' + mpics.length + ' images');
  mpics.forEach(function(p, j) {
    const xOff = p.match(/a:off x="(\d+)" y="(\d+)"/);
    const ext  = p.match(/a:ext cx="(\d+)" cy="(\d+)"/);
    const rId  = p.match(/r:embed="(rId\d+)"/);
    console.log('  img' + j + ' rId:' + (rId ? rId[1] : '?')
      + ' x:' + (xOff ? xOff[1] : '?') + ' y:' + (xOff ? xOff[2] : '?')
      + ' cx:' + (ext ? ext[1] : '?') + ' cy:' + (ext ? ext[2] : '?'));
  });

  // 마스터 rels
  const masterRel = await zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels').async('string');
  const imgRels = masterRel.match(/Id="(rId\d+)"[^>]+image[^>]+Target="([^"]+)"/g) || [];
  console.log('\nMaster image rels:', imgRels);

  // 슬라이드 slide2~4 에서 이미지 확인
  for (let i = 2; i <= 4; i++) {
    const path = 'ppt/slides/slide' + i + '.xml';
    if (!zip.file(path)) continue;
    const xml = await zip.file(path).async('string');
    const pics = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) || [];
    if (pics.length) {
      console.log('\nSlide' + i + ' has ' + pics.length + ' images');
      pics.forEach(function(p, j) {
        const xOff = p.match(/a:off x="(\d+)" y="(\d+)"/);
        const ext  = p.match(/a:ext cx="(\d+)" cy="(\d+)"/);
        const name = p.match(/cNvPr[^>]+name="([^"]+)"/);
        console.log('  img' + j + (name ? ' [' + name[1] + ']' : '')
          + ' x:' + (xOff ? xOff[1] : '?') + ' y:' + (xOff ? xOff[2] : '?')
          + ' cx:' + (ext ? ext[1] : '?') + ' cy:' + (ext ? ext[2] : '?'));
      });
    }
  }
}

find().catch(function(e) { console.error('Error:', e.message); });
