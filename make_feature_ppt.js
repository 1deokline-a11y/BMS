'use strict';
const puppeteer  = require('puppeteer-core');
const PptxGenJS  = require('pptxgenjs');
const path       = require('path');
const fs         = require('fs');

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const BASE   = 'http://localhost:8000';
const SS_DIR = path.join(__dirname, '_screenshots');
fs.mkdirSync(SS_DIR, { recursive: true });

// ── 캡처 대상 탭 정의 ───────────────────────────────
const PAGES = [
  {
    id: 'dashboard',
    url: `${BASE}/#dashboard`,
    file: 'dashboard.png',
    title: '대시보드',
    subtitle: 'Dashboard',
    color: '2563EB',
    waitFor: '#dash-drill-panel',
    // 화살표: [{ from: [x%, y%], to: [x%, y%], label, labelSide }]
    arrows: [
      { fx:0.12, fy:0.18, tx:0.20, ty:0.30, label:'분류 탭\n(기구물 / 수동소자)' },
      { fx:0.50, fy:0.18, tx:0.50, ty:0.32, label:'드릴다운 4단계\n(분류군→제품군→제품코드→품번)' },
      { fx:0.85, fy:0.50, tx:0.78, ty:0.42, label:'선택 품번\n클릭 시 BOM 즉시 표시' },
    ],
  },
  {
    id: 'products',
    url: `${BASE}/#products`,
    file: 'products.png',
    title: 'BOM 열람',
    subtitle: '부품 · 완제품 통합 검색',
    color: '059669',
    waitFor: '#prod-drill-card',
    arrows: [
      { fx:0.60, fy:0.10, tx:0.68, ty:0.15, label:'품번 / 품명 검색' },
      { fx:0.15, fy:0.20, tx:0.22, ty:0.28, label:'분류 드릴다운\n(4단계 탐색)' },
      { fx:0.50, fy:0.68, tx:0.45, ty:0.62, label:'부품 검색 결과\n클릭 → 상세/수정/삭제' },
    ],
  },
  {
    id: 'compare',
    url: `${BASE}/#compare`,
    file: 'compare.png',
    title: 'BOM 비교',
    subtitle: '두 BOM의 차이점 시각화',
    color: '7C3AED',
    waitFor: '#cmp-drill-card1',
    arrows: [
      { fx:0.15, fy:0.20, tx:0.20, ty:0.28, label:'BOM1 선택\n드릴다운 탐색' },
      { fx:0.55, fy:0.20, tx:0.60, ty:0.28, label:'BOM2 선택\n드릴다운 탐색' },
      { fx:0.50, fy:0.82, tx:0.50, ty:0.72, label:'비교 결과\n색상으로 차이 표시' },
    ],
  },
  {
    id: 'bulk-edit',
    url: `${BASE}/#bulk-edit`,
    file: 'bulk_edit.png',
    title: 'BOM 수정',
    subtitle: '인라인 편집 · 일괄 교체',
    color: 'DB2777',
    waitFor: '#edit-drill-card',
    arrows: [
      { fx:0.20, fy:0.18, tx:0.28, ty:0.25, label:'제품 드릴다운 검색' },
      { fx:0.50, fy:0.55, tx:0.50, ty:0.48, label:'BOM 인라인 에디터\n(행 추가·수정·삭제)' },
      { fx:0.75, fy:0.75, tx:0.70, ty:0.68, label:'일괄 교체\n공통 부품 한번에 적용' },
    ],
  },
  {
    id: 'new-bom',
    url: `${BASE}/#new-bom`,
    file: 'new_bom.png',
    title: 'BOM 생성',
    subtitle: '신규 BOM 입력 · 품번 채번',
    color: '0891B2',
    waitFor: '#page-new-bom',
    arrows: [
      { fx:0.72, fy:0.10, tx:0.66, ty:0.14, label:'품번 채번 버튼\n자동 품번 생성' },
      { fx:0.82, fy:0.10, tx:0.80, ty:0.14, label:'엑셀 임포트\n기존 파일 업로드' },
      { fx:0.30, fy:0.32, tx:0.35, ty:0.26, label:'제품 기본 정보\n입력 영역' },
      { fx:0.50, fy:0.70, tx:0.50, ty:0.60, label:'BOM 항목 테이블\n행 추가·입력' },
    ],
  },
  {
    id: 'history',
    url: `${BASE}/#history`,
    file: 'history.png',
    title: '변경 이력',
    subtitle: '모든 변경 자동 기록 · 롤백',
    color: '64748B',
    waitFor: '#page-history',
    arrows: [
      { fx:0.15, fy:0.15, tx:0.20, ty:0.22, label:'유형 필터\n(교체·수량변경·삭제 등)' },
      { fx:0.50, fy:0.50, tx:0.50, ty:0.42, label:'변경 이력 목록\n날짜·내용·대상 제품 확인' },
      { fx:0.78, fy:0.50, tx:0.72, ty:0.44, label:'롤백 버튼\n이전 상태로 즉시 복구' },
    ],
  },
];

// ── Puppeteer 스크린샷 ───────────────────────────────
async function takeScreenshots() {
  console.log('🌐 Chrome 실행 중...');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });

  for (const pg of PAGES) {
    console.log(`  📸 ${pg.title} 캡처 중...`);
    const page = await browser.newPage();
    await page.goto(pg.url, { waitUntil: 'networkidle0', timeout: 20000 });
    try {
      await page.waitForSelector(pg.waitFor, { timeout: 6000 });
    } catch (_) { /* 없어도 진행 */ }
    await new Promise(r => setTimeout(r, 1200)); // 렌더 안정화
    await page.screenshot({ path: path.join(SS_DIR, pg.file), fullPage: false });
    await page.close();
    console.log(`  ✅ ${pg.file} 저장됨`);
  }

  await browser.close();
  console.log('📸 스크린샷 완료\n');
}

// ── PPT 생성 ─────────────────────────────────────────
function buildPPT() {
  console.log('📊 PPT 생성 중...');
  const prs = new PptxGenJS();
  prs.layout = 'LAYOUT_WIDE'; // 13.33" × 7.5"

  const C = {
    navy:'1E3A5F', white:'FFFFFF', dark:'0F172A',
    accent:'F59E0B', gray:'64748B', grayL:'F8FAFC',
  };

  // ── 표지 슬라이드 ────────────────────────────────
  {
    const s = prs.addSlide();
    s.addShape(prs.ShapeType.rect, {
      x:0, y:0, w:'100%', h:'100%',
      fill:{type:'gradient', gradType:'linear',
        stops:[{position:0,color:'1E3A5F'},{position:100,color:'0F172A'}]},
    });
    s.addShape(prs.ShapeType.rect, {x:0, y:0, w:0.3, h:'100%', fill:{color:C.accent}});
    s.addText('주요 기능 화면 소개', {
      x:0.8, y:1.6, w:11.5, h:1.4,
      fontSize:44, bold:true, color:C.white, fontFace:'Malgun Gothic',
    });
    s.addText('BOM Management System — 실제 화면 기반 기능 안내', {
      x:0.8, y:3.1, w:11, h:0.6,
      fontSize:17, color:'A5C8F0', fontFace:'Malgun Gothic',
    });
    s.addShape(prs.ShapeType.rect, {x:0.8, y:3.8, w:2.5, h:0.06, fill:{color:C.accent}});
    s.addText('통신선로개발팀 · 2026', {
      x:0.8, y:4.05, w:5, h:0.4,
      fontSize:13, color:'7FAFD1', fontFace:'Malgun Gothic',
    });
    // 목차 미리보기
    PAGES.forEach((pg, i) => {
      s.addText(`${String(i+1).padStart(2,'0')}  ${pg.title}`, {
        x:9.2, y:1.8 + i*0.75, w:4.0, h:0.6,
        fontSize:13, color: i===0 ? C.accent : 'AABBD0',
        fontFace:'Malgun Gothic', bold:i===0,
      });
    });
  }

  // ── 기능별 슬라이드 (스크린샷 + 화살표) ─────────
  for (const pg of PAGES) {
    const ssPath = path.join(SS_DIR, pg.file);
    if (!fs.existsSync(ssPath)) {
      console.warn(`  ⚠️  ${pg.file} 없음, 슬라이드 건너뜀`);
      continue;
    }

    const s = prs.addSlide();

    // ── 배경 ──────────────────────────────────────
    s.addShape(prs.ShapeType.rect, {
      x:0, y:0, w:'100%', h:'100%', fill:{color:C.grayL},
    });

    // ── 상단 헤더 바 ───────────────────────────────
    s.addShape(prs.ShapeType.rect, {
      x:0, y:0, w:'100%', h:0.72, fill:{color: pg.color},
    });
    s.addText(pg.title, {
      x:0.25, y:0.06, w:7, h:0.6,
      fontSize:24, bold:true, color:C.white, fontFace:'Malgun Gothic',
    });
    s.addText(pg.subtitle, {
      x:7.0, y:0.12, w:6.1, h:0.5,
      fontSize:14, color:'DDEEFF', fontFace:'Malgun Gothic',
      align:'right',
    });

    // ── 스크린샷 (좌측, 전체 높이의 87%) ──────────
    // 스크린샷 영역: x:0.18 ~ x:9.5, y:0.75 ~ y:7.3
    const SS_X = 0.18, SS_Y = 0.75;
    const SS_W = 9.2,  SS_H = 6.1;

    s.addImage({
      path: ssPath,
      x: SS_X, y: SS_Y, w: SS_W, h: SS_H,
    });

    // 스크린샷 테두리
    s.addShape(prs.ShapeType.rect, {
      x: SS_X, y: SS_Y, w: SS_W, h: SS_H,
      fill:{color:'FFFFFF', transparency:100},
      line:{color:'CBD5E1', width:1.5},
    });

    // ── 우측 설명 패널 ────────────────────────────
    const PX = 9.5, PW = 3.65; // 9.5 + 3.65 = 13.15 ✓
    s.addShape(prs.ShapeType.rect, {
      x: PX, y: 0.75, w: PW, h: 6.1,
      fill:{color:C.white}, line:{color:'E2E8F0', width:1}, rectRadius:0.08,
    });
    s.addShape(prs.ShapeType.rect, {
      x: PX, y: 0.75, w: PW, h: 0.38,
      fill:{color: pg.color}, rectRadius:0.08,
    });
    s.addText('주요 기능 설명', {
      x: PX+0.1, y: 0.77, w: PW-0.2, h: 0.33,
      fontSize:11, bold:true, color:C.white, fontFace:'Malgun Gothic',
    });

    // 설명 항목들 (화살표 라벨에서 추출)
    pg.arrows.forEach((arrow, i) => {
      const itemY = 1.3 + i * 1.55;

      // 번호 배지
      s.addShape(prs.ShapeType.rect, {
        x: PX+0.12, y: itemY, w: 0.32, h: 0.32,
        fill:{color: pg.color}, rectRadius:0.05,
      });
      s.addText(String(i+1), {
        x: PX+0.12, y: itemY, w: 0.32, h: 0.32,
        fontSize:11, bold:true, color:C.white, fontFace:'Arial',
        align:'center', valign:'middle',
      });

      // 설명 텍스트
      const lines = arrow.label.split('\n');
      s.addText(lines[0], {
        x: PX+0.52, y: itemY, w: PW-0.65, h: 0.35,
        fontSize:12, bold:true, color: pg.color, fontFace:'Malgun Gothic',
      });
      if (lines[1]) {
        s.addText(lines[1], {
          x: PX+0.52, y: itemY+0.35, w: PW-0.65, h: 0.55,
          fontSize:10.5, color:C.gray, fontFace:'Malgun Gothic', wrap:true,
        });
      }

      // 구분선
      if (i < pg.arrows.length - 1) {
        s.addShape(prs.ShapeType.rect, {
          x: PX+0.12, y: itemY+1.3, w: PW-0.24, h: 0.02,
          fill:{color:'E2E8F0'},
        });
      }
    });

    // ── 화살표 (스크린샷 내 위치 → 번호 표시) ────
    pg.arrows.forEach((arrow, i) => {
      // 스크린샷 내 절대 좌표 계산
      const ax = SS_X + arrow.fx * SS_W;
      const ay = SS_Y + arrow.fy * SS_H;

      // 번호 원형 마커
      s.addShape(prs.ShapeType.ellipse, {
        x: ax - 0.2, y: ay - 0.2, w: 0.4, h: 0.4,
        fill:{color: pg.color}, line:{color:C.white, width:2},
      });
      s.addText(String(i+1), {
        x: ax - 0.2, y: ay - 0.2, w: 0.4, h: 0.4,
        fontSize:11, bold:true, color:C.white, fontFace:'Arial',
        align:'center', valign:'middle',
      });

      // 화살표 라인 (마커 → 설명 패널 방향)
      // pptxgenjs는 음수 w/h 불가 → 바운딩박스로 계산 후 flipV로 방향 처리
      const x1 = ax + 0.2,        y1 = ay;
      const x2 = PX + 0.05,       y2 = 1.3 + i*1.55 + 0.16; // 패널 번호 중심
      const lineW = Math.max(Math.abs(x2 - x1), 0.01);
      const lineH = Math.max(Math.abs(y2 - y1), 0.01);
      const lineX = Math.min(x1, x2);
      const lineY = Math.min(y1, y2);
      // x1 < x2 항상 성립; y2 < y1 이면 위쪽으로 향하는 선 → flipV
      const goingUp = y2 < y1;
      s.addShape(prs.ShapeType.line, {
        x: lineX, y: lineY, w: lineW, h: lineH,
        flipV: goingUp,
        line:{
          color: pg.color,
          width: 1.5,
          dashType: 'dash',
          endArrowType: 'arrow',
        },
      });
    });

    // ── 하단 바 ───────────────────────────────────
    s.addShape(prs.ShapeType.rect, {
      x:0, y:7.15, w:'100%', h:0.35,
      fill:{color:C.navy},
    });
    s.addText('에이제이월드 BMS | AJ World BOM Management System', {
      x:0.2, y:7.17, w:10.5, h:0.28,
      fontSize:8.5, color:'AABBD0', fontFace:'Malgun Gothic',
    });
    s.addText(`${pg.title}`, {
      x:10.8, y:7.17, w:2.3, h:0.28,
      fontSize:8.5, color:'AABBD0', fontFace:'Malgun Gothic', align:'right',
    });
  }

  // ── 마지막: 기능 요약 슬라이드 ──────────────────
  {
    const s = prs.addSlide();
    s.addShape(prs.ShapeType.rect, {
      x:0, y:0, w:'100%', h:'100%',
      fill:{type:'gradient', gradType:'linear',
        stops:[{position:0,color:'1E3A5F'},{position:100,color:'0F172A'}]},
    });
    s.addShape(prs.ShapeType.rect, {x:0, y:0, w:0.3, h:'100%', fill:{color:C.accent}});
    s.addText('기능 요약', {
      x:0.8, y:0.5, w:11.5, h:0.85,
      fontSize:32, bold:true, color:C.white, fontFace:'Malgun Gothic',
    });
    s.addShape(prs.ShapeType.rect, {x:0.8, y:1.42, w:2.2, h:0.05, fill:{color:C.accent}});

    const W = 5.8;
    PAGES.forEach((pg, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 0.8 + col * (W + 0.55);
      const y = 1.65 + row * 1.42;
      s.addShape(prs.ShapeType.rect, {
        x, y, w:W, h:1.25,
        fill:{color:'FFFFFF', transparency:90},
        line:{color:'FFFFFF', width:1, transparency:70},
        rectRadius:0.08,
      });
      s.addShape(prs.ShapeType.rect, {
        x, y, w:0.12, h:1.25,
        fill:{color: pg.color}, rectRadius:0.08,
      });
      s.addText(pg.title, {
        x:x+0.22, y:y+0.12, w:W-0.3, h:0.42,
        fontSize:15, bold:true, color: pg.color, fontFace:'Malgun Gothic',
      });
      s.addText(pg.subtitle, {
        x:x+0.22, y:y+0.55, w:W-0.3, h:0.55,
        fontSize:11, color:'C7D7E8', fontFace:'Malgun Gothic', wrap:true,
      });
    });
  }

  const OUT = path.join(__dirname, 'AJW_BMS_기능소개_화면.pptx');
  return prs.writeFile({ fileName: OUT }).then(() => {
    console.log(`\n✅ PPT 생성 완료: AJW_BMS_기능소개_화면.pptx`);
  });
}

// ── 실행 ────────────────────────────────────────────
(async () => {
  try {
    await takeScreenshots();
    await buildPPT();
  } catch (e) {
    console.error('❌ 오류:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
