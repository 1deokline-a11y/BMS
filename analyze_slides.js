'use strict';
const JSZip = require('jszip');
const fs    = require('fs');

async function main() {
  const zip = await JSZip.loadAsync(fs.readFileSync('AJW_BMS_소개자료_260527_A4.pptx'));

  // 슬라이드별 모든 도형 분석
  const targets = [3, 7, 12, 13, 14, 15, 16, 17, 18];
  for (const n of targets) {
    const path = 'ppt/slides/slide' + n + '.xml';
    if (!zip.file(path)) continue;
    const xml = await zip.file(path).async('string');
    console.log('\n======= slide' + n + ' =======');

    // 모든 sp(도형) 정보 추출
    const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
    let m, spIdx = 0;
    while ((m = spRe.exec(xml)) !== null) {
      const sp = m[1];
      const name  = sp.match(/cNvPr[^>]+name="([^"]+)"/);
      const fills = sp.match(/<a:solidFill>[\s\S]*?<a:srgbClr val="([^"]+)"/g) || [];
      const geom  = sp.match(/prst="([^"]+)"/);
      const cx    = sp.match(/a:ext cx="(\d+)"/);
      const cy    = sp.match(/a:ext cx="\d+" cy="(\d+)"/);
      const txt   = sp.match(/<a:t>([^<]+)<\/a:t>/g);

      spIdx++;
      console.log('  sp' + spIdx + ' [' + (name ? name[1] : '?') + ']'
        + ' geom:' + (geom ? geom[1] : 'rect')
        + ' cx:' + (cx ? cx[1] : '?') + ' cy:' + (cy ? cy[1] : '?')
        + ' fills:' + fills.map(function(f) { const c = f.match(/val="([^"]+)"/); return c ? '#' + c[1] : '?'; }).join(',')
        + (txt ? ' txt:"' + txt.map(function(t) { return t.replace(/<[^>]+>/g, ''); }).join('') + '"' : ''));
    }

    // pic(이미지) 정보
    const picRe = /<p:pic>([\s\S]*?)<\/p:pic>/g;
    let pm;
    while ((pm = picRe.exec(xml)) !== null) {
      const pic  = pm[1];
      const name = pic.match(/cNvPr[^>]+name="([^"]+)"/);
      const rId  = pic.match(/r:embed="(rId\d+)"/);
      const cx   = pic.match(/a:ext cx="(\d+)"/);
      const cy   = pic.match(/a:ext cx="\d+" cy="(\d+)"/);
      console.log('  PIC [' + (name ? name[1] : '?') + '] rId:' + (rId ? rId[1] : '?')
        + ' cx:' + (cx ? cx[1] : '?') + ' cy:' + (cy ? cy[1] : '?'));
    }
  }
}

main().catch(function(e) { console.error(e.message); });
