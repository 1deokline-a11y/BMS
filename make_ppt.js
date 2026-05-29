'use strict';
const PptxGenJS = require('pptxgenjs');
const prs = new PptxGenJS();
prs.layout = 'LAYOUT_WIDE'; // 13.33" × 7.5"

// ── 슬라이드 안전 영역 ────────────────────────────────
// 좌측 네이비 바: 0~0.18"
// 콘텐츠 시작: x = 0.55"
// 우측 최대 끝: 13.15" (0.18" 여백)
// 하단 바: y = 6.9"
const W = 13.33;   // 슬라이드 전체 폭
const SAFE_R = 13.15; // 콘텐츠 우측 한계
const X0 = 0.55;   // 콘텐츠 시작 x

const C = {
  navy:   '1E3A5F', blue:   '2563EB', skyBlue:'DBEAFE',
  accent: 'F59E0B', accentD:'D97706', accentL:'FEF3C7',
  green:  '059669', greenL: 'D1FAE5',
  gray:   '64748B', grayL:  'F1F5F9',
  white:  'FFFFFF', dark:   '0F172A', red:    'DC2626',
};

// ── 헬퍼: 배경 + 하단 바 (세로 글자 없음) ──────────────
function bgBar(slide) {
  slide.addShape(prs.ShapeType.rect, {
    x:0, y:0, w:'100%', h:'100%', fill:{color:C.white},
  });
  // 좌측 강조 바
  slide.addShape(prs.ShapeType.rect, {
    x:0, y:0, w:0.18, h:'100%', fill:{color:C.navy},
  });
  // 하단 바
  slide.addShape(prs.ShapeType.rect, {
    x:0, y:6.9, w:'100%', h:0.6, fill:{color:C.navy},
  });
  // 바닥글 왼쪽 텍스트
  slide.addText('에이제이월드 BMS | AJ World BOM Management System', {
    x:0.3, y:6.92, w:10.5, h:0.3,
    fontSize:9, color:'AABBD0', fontFace:'Malgun Gothic',
  });
  // 바닥글 오른쪽 텍스트 (안전 영역 안쪽: 10.8 + 2.2 = 13.0")
  slide.addText('통신선로개발팀', {
    x:10.8, y:6.92, w:2.2, h:0.3,
    fontSize:9, color:'AABBD0', fontFace:'Malgun Gothic', align:'right',
  });
}

// ── 헬퍼: 섹션 헤더 박스 ──────────────────────────────
function sectionBox(slide, text, x, y, w, color) {
  color = color || C.blue;
  slide.addShape(prs.ShapeType.rect, {
    x, y, w, h:0.42, fill:{color}, line:{color, width:0}, rectRadius:0.05,
  });
  slide.addText(text, {
    x:x+0.1, y:y+0.04, w:w-0.2, h:0.34,
    fontSize:12, bold:true, color:C.white, fontFace:'Malgun Gothic',
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 1 — 표지
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  s.addShape(prs.ShapeType.rect, {
    x:0, y:0, w:'100%', h:'100%',
    fill:{type:'gradient', gradType:'linear', stops:[
      {position:0, color:'1E3A5F'}, {position:100, color:'0F172A'},
    ]},
  });
  s.addShape(prs.ShapeType.rect, {
    x:9.8, y:0, w:0.06, h:'100%', fill:{color:C.accent},
  });
  s.addShape(prs.ShapeType.rect, {
    x:9.86, y:0, w:3.47, h:'100%', fill:{color:'FFFFFF', transparency:95},
  });

  s.addText('BOM Management\nSystem', {
    x:0.7, y:1.3, w:8.7, h:2.2,
    fontSize:48, bold:true, color:C.white, fontFace:'Malgun Gothic',
    lineSpacingMultiple:1.1,
  });
  s.addText('에이제이월드 BOM 관리 시스템 소개', {
    x:0.7, y:3.6, w:8.7, h:0.55,
    fontSize:18, color:'A5C8F0', fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {
    x:0.7, y:4.22, w:2.2, h:0.06, fill:{color:C.accent},
  });
  s.addText('통신선로개발팀 · 2026', {
    x:0.7, y:4.45, w:5, h:0.4,
    fontSize:13, color:'7FAFD1', fontFace:'Malgun Gothic',
  });

  const items = ['01  시스템 개요', '02  주요 기능', '03  추후 개발 방향'];
  items.forEach((t, i) => {
    s.addText(t, {
      x:10.1, y:2.3 + i*0.75, w:3.0, h:0.6,
      fontSize:13, color: i===0 ? C.accent : 'AABBD0',
      fontFace:'Malgun Gothic', bold:i===0,
    });
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 2 — 목차
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  bgBar(s);

  s.addText('목 차', {
    x:X0, y:0.25, w:8, h:0.65,
    fontSize:28, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {
    x:X0, y:0.88, w:1.1, h:0.05, fill:{color:C.accent},
  });

  // 3개 목차 카드: 전체 폭 (SAFE_R - X0) = 12.6" / 3 = 4.2" per card
  const cardW = 4.0;
  const gapX  = (SAFE_R - X0 - 3*cardW) / 2; // 약 0.3"
  const toc = [
    {num:'01', title:'시스템 개요',    subs:['추진 배경','시스템 개요','기대 효과'],              color:C.blue},
    {num:'02', title:'주요 기능 설명', subs:['대시보드','BOM 열람·비교·수정·생성','변경 이력 / 메일 / 화면 모드'], color:C.green},
    {num:'03', title:'추후 개발 방향', subs:['ERP 연동','접근 권한','에러 최소화','BOM 이미지화'], color:C.accentD},
  ];
  toc.forEach((item, i) => {
    const x = X0 + i*(cardW + gapX);
    s.addShape(prs.ShapeType.rect, {
      x, y:1.1, w:1.1, h:1.1, fill:{color:item.color}, rectRadius:0.08,
    });
    s.addText(item.num, {
      x, y:1.1, w:1.1, h:1.1,
      fontSize:30, bold:true, color:C.white, fontFace:'Arial',
      align:'center', valign:'middle',
    });
    s.addText(item.title, {
      x:x+0.05, y:2.35, w:cardW-0.1, h:0.55,
      fontSize:16, bold:true, color:C.navy, fontFace:'Malgun Gothic',
    });
    item.subs.forEach((sub, j) => {
      s.addShape(prs.ShapeType.rect, {
        x:x+0.05, y:3.0+j*0.6, w:0.06, h:0.28, fill:{color:item.color},
      });
      s.addText(sub, {
        x:x+0.2, y:2.98+j*0.6, w:cardW-0.3, h:0.32,
        fontSize:11.5, color:C.gray, fontFace:'Malgun Gothic',
      });
    });
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 3 — 섹션 01 표지
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  s.addShape(prs.ShapeType.rect, {
    x:0, y:0, w:'100%', h:'100%',
    fill:{type:'gradient', gradType:'linear', stops:[
      {position:0,color:'1E3A5F'},{position:100,color:'0F172A'},
    ]},
  });
  s.addShape(prs.ShapeType.rect, {x:0, y:3.2, w:4.5, h:0.06, fill:{color:C.accent}});
  s.addText('01', {
    x:0.6, y:1.5, w:3, h:1.6,
    fontSize:80, bold:true, color:'FFFFFF', fontFace:'Arial', transparency:15,
  });
  s.addText('시스템 개요', {
    x:0.6, y:3.4, w:9, h:0.9,
    fontSize:36, bold:true, color:C.white, fontFace:'Malgun Gothic',
  });
  s.addText('System Overview', {
    x:0.6, y:4.35, w:8, h:0.5,
    fontSize:16, color:'7FAFD1', fontFace:'Malgun Gothic',
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 4 — 추진 배경
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  bgBar(s);

  s.addText('추진 배경', {
    x:X0, y:0.2, w:9, h:0.6,
    fontSize:24, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {
    x:X0, y:0.78, w:0.9, h:0.05, fill:{color:C.accent},
  });

  // 카드 2×2 : 각 카드 w=6.0", gap=0.6"
  // 2열: X0=0.55, w=6.0 → ends 6.55; X=6.55+0.6=7.15, w=6.0 → ends 13.15 ✓
  const cardW = 6.0;
  const gap   = SAFE_R - X0 - 2*cardW; // 0.6"
  const problems = [
    {icon:'✏️', title:'휴먼에러 발생',         body:'엑셀 기반 수동 관리로 인한 오기입·누락 등\n데이터 신뢰도 저하 문제 발생',                     color:C.red},
    {icon:'🔍', title:'부품 파악 어려움',       body:'관련 부서가 특정 부품의 사용 위치·용도를\n파악하기 위해 다수 BOM을 수동으로 검토',             color:C.blue},
    {icon:'🔄', title:'다수 BOM 일괄 수정 부재', body:'공통 부품 변경 시 관련된 모든 BOM을\n개별적으로 수정해야 하는 반복 작업 발생',              color:C.accentD},
    {icon:'📊', title:'BOM 차이점 파악 어려움', body:'동일 모델이지만 구성이 다른 BOM 간\n차이점을 한눈에 비교하기 곤란',                        color:C.green},
  ];
  problems.forEach((p, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = X0 + col*(cardW + gap);
    const y = 1.0 + row*2.8;

    s.addShape(prs.ShapeType.rect, {
      x, y, w:cardW, h:2.5,
      fill:{color:C.grayL}, line:{color:'E2E8F0', width:1}, rectRadius:0.1,
    });
    s.addShape(prs.ShapeType.rect, {
      x, y, w:0.18, h:2.5, fill:{color:p.color}, rectRadius:0.1,
    });
    s.addText(p.icon, {
      x:x+0.3, y:y+0.2, w:0.7, h:0.7, fontSize:22, align:'center',
    });
    s.addText(p.title, {
      x:x+1.1, y:y+0.2, w:cardW-1.3, h:0.45,
      fontSize:14, bold:true, color:p.color, fontFace:'Malgun Gothic',
    });
    s.addText(p.body, {
      x:x+0.3, y:y+0.8, w:cardW-0.5, h:1.45,
      fontSize:11.5, color:C.gray, fontFace:'Malgun Gothic',
      lineSpacingMultiple:1.4, wrap:true,
    });
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 5 — 시스템 개요
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  bgBar(s);

  s.addText('시스템 개요', {
    x:X0, y:0.2, w:9, h:0.6,
    fontSize:24, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {
    x:X0, y:0.78, w:0.9, h:0.05, fill:{color:C.accent},
  });

  // 좌측 아키텍처 레이어 (w=7.3 → ends 7.85")
  const layerW = 7.3;
  const layers = [
    {label:'프론트엔드', detail:'Bootstrap 5 SPA · 반응형 (PC / 모바일)', color:C.blue,  icon:'🖥️'},
    {label:'백엔드 API',  detail:'Node.js + Express REST API',             color:C.green, icon:'⚙️'},
    {label:'데이터베이스',detail:'Supabase (PostgreSQL) · 클라우드 관리형', color:C.navy,  icon:'🗄️'},
  ];
  layers.forEach((l, i) => {
    const y = 1.15 + i*1.6;
    s.addShape(prs.ShapeType.rect, {
      x:X0, y, w:layerW, h:1.38,
      fill:{color:C.grayL}, line:{color:'CBD5E1', width:1}, rectRadius:0.1,
    });
    s.addShape(prs.ShapeType.rect, {
      x:X0, y, w:2.5, h:1.38, fill:{color:l.color}, rectRadius:0.1,
    });
    s.addText(l.icon+'  '+l.label, {
      x:X0+0.1, y:y+0.38, w:2.3, h:0.55,
      fontSize:13, bold:true, color:C.white, fontFace:'Malgun Gothic',
    });
    s.addText(l.detail, {
      x:X0+2.65, y:y+0.45, w:layerW-2.8, h:0.5,
      fontSize:12, color:C.gray, fontFace:'Malgun Gothic',
    });
    if (i < layers.length-1) {
      s.addText('↕', {
        x:X0+0.9, y:y+1.38, w:0.5, h:0.22,
        fontSize:13, color:C.gray, align:'center',
      });
    }
  });

  // 우측 사양 박스: x=8.05 → ends 8.05+5.1=13.15 ✓
  const rx = 8.05, rw = SAFE_R - rx; // 5.1"
  const specs = [
    ['플랫폼',  'Vercel (서버리스 배포)'],
    ['접속',    'Web Browser (PC · 모바일)'],
    ['화면',    '9개 탭 SPA 구조'],
    ['엑셀',    'BOM Import / Export 지원'],
  ];
  s.addShape(prs.ShapeType.rect, {
    x:rx, y:1.1, w:rw, h:5.3,
    fill:{color:C.skyBlue}, line:{color:C.blue, width:1}, rectRadius:0.1,
  });
  s.addText('시스템 사양', {
    x:rx+0.15, y:1.25, w:rw-0.3, h:0.45,
    fontSize:14, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  specs.forEach(([k, v], i) => {
    s.addShape(prs.ShapeType.rect, {
      x:rx+0.15, y:1.82+i*1.05, w:rw-0.3, h:0.85,
      fill:{color:C.white}, rectRadius:0.06,
    });
    s.addText(k, {
      x:rx+0.28, y:1.88+i*1.05, w:1.2, h:0.32,
      fontSize:10, color:C.blue, fontFace:'Malgun Gothic', bold:true,
    });
    s.addText(v, {
      x:rx+0.28, y:2.18+i*1.05, w:rw-0.45, h:0.38,
      fontSize:11.5, color:C.dark, fontFace:'Malgun Gothic',
    });
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 6 — 기대 효과
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  bgBar(s);

  s.addText('기대 효과', {
    x:X0, y:0.2, w:9, h:0.6,
    fontSize:24, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {
    x:X0, y:0.78, w:0.9, h:0.05, fill:{color:C.accent},
  });

  const rowW = SAFE_R - X0; // 12.6"
  const effects = [
    {
      icon:'✅', color:C.green, colorL:C.greenL,
      title:'휴먼에러 방지 → BOM 신뢰도 증대',
      detail:['엑셀 수기 입력 방식에서 시스템 입력 방식으로 전환','품번 채번 기능으로 오기입 원천 방지','변경 이력 자동 기록으로 데이터 추적 가능'],
    },
    {
      icon:'⚡', color:C.blue, colorL:C.skyBlue,
      title:'관련 부서 요청 시 신속한 대응',
      detail:['부품 검색을 통해 사용 제품 즉시 조회','BOM 엑셀 다운로드로 빠른 자료 제공','모바일 지원으로 현장에서도 실시간 확인 가능'],
    },
    {
      icon:'🚀', color:C.accentD, colorL:C.accentL,
      title:'업무 효율 증대',
      detail:['공통 부품 일괄 교체·수정 기능으로 반복 작업 제거','BOM 비교 기능으로 모델 간 차이점 즉시 파악','BOM 생성 시 자동 부품 제안으로 등록 시간 단축'],
    },
  ];
  effects.forEach((e, i) => {
    const y = 1.05 + i*1.88;
    s.addShape(prs.ShapeType.rect, {
      x:X0, y, w:rowW, h:1.72,
      fill:{color:e.colorL}, line:{color:'E2E8F0', width:1}, rectRadius:0.1,
    });
    s.addText(e.icon, {x:X0+0.15, y:y+0.12, w:0.7, h:0.7, fontSize:22, align:'center'});
    s.addText(e.title, {
      x:X0+1.0, y:y+0.1, w:rowW-1.2, h:0.5,
      fontSize:14, bold:true, color:e.color, fontFace:'Malgun Gothic',
    });
    e.detail.forEach((d, j) => {
      s.addShape(prs.ShapeType.rect, {
        x:X0+1.0, y:y+0.7+j*0.3, w:0.06, h:0.2, fill:{color:e.color},
      });
      s.addText(d, {
        x:X0+1.15, y:y+0.68+j*0.3, w:rowW-1.35, h:0.28,
        fontSize:11, color:C.gray, fontFace:'Malgun Gothic',
      });
    });
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 7 — 섹션 02 표지
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  s.addShape(prs.ShapeType.rect, {
    x:0, y:0, w:'100%', h:'100%',
    fill:{type:'gradient', gradType:'linear', stops:[
      {position:0,color:'064E3B'},{position:100,color:'0F172A'},
    ]},
  });
  s.addShape(prs.ShapeType.rect, {x:0, y:3.2, w:4.5, h:0.06, fill:{color:C.accent}});
  s.addText('02', {
    x:0.6, y:1.5, w:3, h:1.6,
    fontSize:80, bold:true, color:C.white, fontFace:'Arial', transparency:15,
  });
  s.addText('주요 기능 설명', {
    x:0.6, y:3.4, w:9, h:0.9,
    fontSize:36, bold:true, color:C.white, fontFace:'Malgun Gothic',
  });
  s.addText('Key Features', {
    x:0.6, y:4.35, w:8, h:0.5, fontSize:16, color:'6EE7B7', fontFace:'Malgun Gothic',
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 8 — 주요 기능 한눈에 보기 (4×2 카드)
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  bgBar(s);

  s.addText('주요 기능 한눈에 보기', {
    x:X0, y:0.2, w:9, h:0.6,
    fontSize:24, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {
    x:X0, y:0.78, w:1.2, h:0.05, fill:{color:C.accent},
  });

  // 4열: 각 카드 w=2.95", gap=0.1"  →  총 4*2.95 + 3*0.1 = 12.1" → ends 0.55+12.1=12.65" ✓
  const cW = 2.95, cGap = 0.12;
  const features = [
    {icon:'📊', name:'대시보드',  desc:'분류별 드릴다운\nBOM 조회',       color:C.blue},
    {icon:'📋', name:'BOM 열람', desc:'부품 검색·조회\n엑셀 다운로드',    color:C.green},
    {icon:'🔍', name:'BOM 비교', desc:'두 BOM 간\n차이점 시각화',          color:'7C3AED'},
    {icon:'✏️', name:'BOM 수정', desc:'인라인 편집\n즉시 반영',            color:'DB2777'},
    {icon:'➕', name:'BOM 생성', desc:'신규 BOM 입력\n엑셀 임포트',        color:'0891B2'},
    {icon:'🔢', name:'품번 채번', desc:'품번체계 기반\n자동 채번',           color:C.accentD},
    {icon:'📜', name:'변경 이력', desc:'모든 변경 기록\n롤백 지원',          color:C.gray},
    {icon:'📱', name:'화면 모드', desc:'PC / 모바일\n반응형 지원',           color:C.navy},
  ];
  features.forEach((f, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x   = X0 + col*(cW + cGap);
    const y   = 1.0 + row*2.82;

    s.addShape(prs.ShapeType.rect, {
      x, y, w:cW, h:2.6,
      fill:{color:C.white}, line:{color:'E2E8F0', width:1.5}, rectRadius:0.12,
    });
    s.addShape(prs.ShapeType.rect, {
      x, y, w:cW, h:0.18, fill:{color:f.color}, rectRadius:0.12,
    });
    s.addText(f.icon, {x, y:y+0.3, w:cW, h:0.8, fontSize:26, align:'center'});
    s.addText(f.name, {
      x:x+0.1, y:y+1.15, w:cW-0.2, h:0.45,
      fontSize:13, bold:true, color:f.color, fontFace:'Malgun Gothic', align:'center',
    });
    s.addText(f.desc, {
      x:x+0.1, y:y+1.62, w:cW-0.2, h:0.7,
      fontSize:10.5, color:C.gray, fontFace:'Malgun Gothic',
      align:'center', lineSpacingMultiple:1.3,
    });
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 9 — 기능 상세 ①: 대시보드 + BOM 열람
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  bgBar(s);

  s.addText('기능 상세 ①  대시보드 · BOM 열람', {
    x:X0, y:0.2, w:12, h:0.6,
    fontSize:22, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {
    x:X0, y:0.78, w:1.0, h:0.05, fill:{color:C.accent},
  });

  // 2열 레이아웃: 각 6.0", gap 0.6" → 0.55+6.0+0.6+6.0=13.15 ✓
  const colW = 6.0, midGap = 0.6;
  const lx = X0, rx = X0 + colW + midGap;

  // 구분선
  s.addShape(prs.ShapeType.rect, {
    x:X0+colW+midGap/2-0.02, y:1.0, w:0.04, h:5.6, fill:{color:'E2E8F0'},
  });

  sectionBox(s, '📊 대시보드', lx, 1.05, colW, C.blue);
  const dash = [
    ['분류별 드릴다운', '기구물·수동소자 분류 → 제품군 → 제품코드 → 품번 4단계 선택'],
    ['BOM 즉시 조회',  '선택 품번 클릭 시 해당 BOM 인라인 표시'],
    ['요약 통계',      '전체 제품 수·최근 수정일 등 현황 한눈에 파악'],
  ];
  dash.forEach(([k, v], i) => {
    s.addShape(prs.ShapeType.rect, {x:lx, y:1.62+i*1.05, w:0.06, h:0.5, fill:{color:C.blue}});
    s.addText(k, {x:lx+0.18, y:1.62+i*1.05, w:colW-0.25, h:0.32, fontSize:12, bold:true, color:C.navy, fontFace:'Malgun Gothic'});
    s.addText(v, {x:lx+0.18, y:1.94+i*1.05, w:colW-0.25, h:0.38, fontSize:11, color:C.gray, fontFace:'Malgun Gothic', wrap:true});
  });

  sectionBox(s, '📋 BOM 열람', rx, 1.05, colW, C.green);
  const bom = [
    ['통합 검색',      '품번·품명 입력 시 완제품 + 부품 동시 검색'],
    ['부품 상세',      '부품 클릭 → 사용 제품 목록·규격 인라인 확인'],
    ['엑셀 다운로드',  '현재 BOM을 원본 형식으로 즉시 다운로드'],
  ];
  bom.forEach(([k, v], i) => {
    s.addShape(prs.ShapeType.rect, {x:rx, y:1.62+i*1.05, w:0.06, h:0.5, fill:{color:C.green}});
    s.addText(k, {x:rx+0.18, y:1.62+i*1.05, w:colW-0.25, h:0.32, fontSize:12, bold:true, color:C.navy, fontFace:'Malgun Gothic'});
    s.addText(v, {x:rx+0.18, y:1.94+i*1.05, w:colW-0.25, h:0.38, fontSize:11, color:C.gray, fontFace:'Malgun Gothic', wrap:true});
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 10 — 기능 상세 ②: BOM 비교 + BOM 수정
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  bgBar(s);

  s.addText('기능 상세 ②  BOM 비교 · BOM 수정', {
    x:X0, y:0.2, w:12, h:0.6,
    fontSize:22, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {x:X0, y:0.78, w:1.0, h:0.05, fill:{color:C.accent}});

  const colW = 6.0, midGap = 0.6;
  const lx = X0, rx = X0 + colW + midGap;

  s.addShape(prs.ShapeType.rect, {
    x:X0+colW+midGap/2-0.02, y:1.0, w:0.04, h:5.6, fill:{color:'E2E8F0'},
  });

  sectionBox(s, '🔍 BOM 비교', lx, 1.05, colW, '7C3AED');
  const cmp = [
    ['드릴다운 선택', 'BOM1 · BOM2 각각 분류 탐색으로 비교 대상 지정'],
    ['색상 구분 표시', '추가(초록) / 삭제(빨강) / 변경(노랑) 항목 시각화'],
    ['엑셀 내보내기', '비교 결과를 색상 포함 엑셀 파일로 저장'],
  ];
  cmp.forEach(([k, v], i) => {
    s.addShape(prs.ShapeType.rect, {x:lx, y:1.62+i*1.05, w:0.06, h:0.5, fill:{color:'7C3AED'}});
    s.addText(k, {x:lx+0.18, y:1.62+i*1.05, w:colW-0.25, h:0.32, fontSize:12, bold:true, color:C.navy, fontFace:'Malgun Gothic'});
    s.addText(v, {x:lx+0.18, y:1.94+i*1.05, w:colW-0.25, h:0.38, fontSize:11, color:C.gray, fontFace:'Malgun Gothic', wrap:true});
  });

  sectionBox(s, '✏️ BOM 수정', rx, 1.05, colW, 'DB2777');
  const edit = [
    ['인라인 에디터', '별도 페이지 이동 없이 탭 내에서 직접 수정'],
    ['행 추가·삭제',  '부품 행을 자유롭게 추가 및 삭제'],
    ['일괄 교체',     '공통 부품을 여러 BOM에 한 번에 교체 적용'],
  ];
  edit.forEach(([k, v], i) => {
    s.addShape(prs.ShapeType.rect, {x:rx, y:1.62+i*1.05, w:0.06, h:0.5, fill:{color:'DB2777'}});
    s.addText(k, {x:rx+0.18, y:1.62+i*1.05, w:colW-0.25, h:0.32, fontSize:12, bold:true, color:C.navy, fontFace:'Malgun Gothic'});
    s.addText(v, {x:rx+0.18, y:1.94+i*1.05, w:colW-0.25, h:0.38, fontSize:11, color:C.gray, fontFace:'Malgun Gothic', wrap:true});
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 11 — 기능 상세 ③: BOM 생성 + 품번 채번 + 변경 이력
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  bgBar(s);

  s.addText('기능 상세 ③  BOM 생성 · 품번 채번 · 변경 이력', {
    x:X0, y:0.2, w:12.5, h:0.6,
    fontSize:20, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {x:X0, y:0.78, w:1.0, h:0.05, fill:{color:C.accent}});

  // 3열: 각 w=4.0", gap=0.1" → 3*4.0 + 2*0.1 = 12.2" → ends 0.55+12.2=12.75" ✓
  const bW = 4.0, bGap = 0.1;
  const blocks = [
    {title:'➕ BOM 생성',   color:'0891B2', x:X0,
      items:[
        ['직접 입력',   '제품 정보 입력 후 BOM 항목 직접 추가'],
        ['엑셀 임포트', '기존 엑셀 BOM 파일 업로드로 일괄 등록'],
        ['부품 제안',   'AI 기반 동일 제품군 공통 부품 자동 제안'],
      ]},
    {title:'🔢 품번 채번',  color:C.accentD, x:X0+bW+bGap,
      items:[
        ['체계 기반 채번',  '품번체계 파일 기준 단계별 선택으로 자동 생성'],
        ['신규 부품 등록',  '채번 즉시 parts DB에 등록 → BOM 탭 검색 가능'],
        ['품번 적용',       '생성된 품번을 신규 BOM 품번 필드에 원클릭 적용'],
      ]},
    {title:'📜 변경 이력',  color:C.gray, x:X0+2*(bW+bGap),
      items:[
        ['자동 기록',  '모든 BOM 변경(추가·수정·삭제)을 자동 저장'],
        ['이력 조회',  '변경 유형·날짜·내용 필터 검색'],
        ['롤백',       '이전 상태로 즉시 복구 가능'],
      ]},
  ];
  blocks.forEach(b => {
    sectionBox(s, b.title, b.x, 1.05, bW, b.color);
    b.items.forEach(([k, v], i) => {
      s.addShape(prs.ShapeType.rect, {x:b.x, y:1.62+i*1.6, w:0.06, h:0.5, fill:{color:b.color}});
      s.addText(k, {x:b.x+0.18, y:1.62+i*1.6, w:bW-0.25, h:0.35, fontSize:12, bold:true, color:C.navy, fontFace:'Malgun Gothic'});
      s.addText(v, {x:b.x+0.18, y:1.97+i*1.6, w:bW-0.25, h:0.85, fontSize:10.5, color:C.gray, fontFace:'Malgun Gothic', wrap:true});
    });
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 12 — 섹션 03 표지
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  s.addShape(prs.ShapeType.rect, {
    x:0, y:0, w:'100%', h:'100%',
    fill:{type:'gradient', gradType:'linear', stops:[
      {position:0,color:'78350F'},{position:100,color:'0F172A'},
    ]},
  });
  s.addShape(prs.ShapeType.rect, {x:0, y:3.2, w:4.5, h:0.06, fill:{color:C.accent}});
  s.addText('03', {
    x:0.6, y:1.5, w:3, h:1.6,
    fontSize:80, bold:true, color:C.white, fontFace:'Arial', transparency:15,
  });
  s.addText('추후 개발 방향', {
    x:0.6, y:3.4, w:9, h:0.9,
    fontSize:36, bold:true, color:C.white, fontFace:'Malgun Gothic',
  });
  s.addText('Future Development', {
    x:0.6, y:4.35, w:8, h:0.5, fontSize:16, color:'FCD34D', fontFace:'Malgun Gothic',
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 13 — 추후 개발 방향 (2×2 카드)
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  bgBar(s);

  s.addText('추후 개발 방향', {
    x:X0, y:0.2, w:9, h:0.6,
    fontSize:24, bold:true, color:C.navy, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {x:X0, y:0.78, w:1.0, h:0.05, fill:{color:C.accent}});

  // 2×2 카드: w=6.0", gap=0.6" → ends 13.15" ✓
  const cardW = 6.0, gap = 0.6;
  const roadmap = [
    {phase:'Phase 1', color:C.blue,   title:'ERP 연동',           icon:'🔗',
      detail:'ERP 시스템과의 API 연동을 통해 BOM 데이터를 실시간으로 공유하고 양방향 동기화 구현. 생산·구매 부서와의 데이터 일원화.'},
    {phase:'Phase 2', color:'7C3AED', title:'데이터 접근 권한 부여', icon:'🔒',
      detail:'사용자 계정 및 역할 기반 접근 제어(RBAC) 도입. 부서별 열람/수정 권한 차등 적용으로 데이터 보안 강화.'},
    {phase:'Phase 3', color:C.green,  title:'에러 최소화 및 최적화', icon:'⚡',
      detail:'입력값 유효성 검증 강화, 중복 품번 방지 로직 고도화. 대량 데이터 처리 성능 개선 및 쿼리 최적화.'},
    {phase:'Phase 4', color:C.accentD,title:'BOM 이상 자동 감지',    icon:'🔍',
      detail:'동종 제품군 BOM 구성 패턴을 통계적으로 비교·분석하여 공통 부품 누락, 수량·단위 이상 항목을 자동 탐지하고 담당자에게 경보 제공.'},
  ];
  roadmap.forEach((r, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x   = X0 + col*(cardW + gap);
    const y   = 1.0 + row*2.85;

    s.addShape(prs.ShapeType.rect, {
      x, y, w:cardW, h:2.65,
      fill:{color:C.grayL}, line:{color:'E2E8F0', width:1.5}, rectRadius:0.12,
    });
    s.addShape(prs.ShapeType.rect, {
      x:x+0.15, y:y+0.15, w:1.2, h:0.38,
      fill:{color:r.color}, rectRadius:0.06,
    });
    s.addText(r.phase, {
      x:x+0.15, y:y+0.15, w:1.2, h:0.38,
      fontSize:10, bold:true, color:C.white, fontFace:'Malgun Gothic',
      align:'center', valign:'middle',
    });

    s.addText(r.icon, {x:x+cardW-1.05, y:y+0.08, w:0.9, h:0.7, fontSize:24, align:'center'});

    s.addText(r.title, {
      x:x+0.15, y:y+0.65, w:cardW-0.3, h:0.5,
      fontSize:15, bold:true, color:r.color, fontFace:'Malgun Gothic',
    });
    s.addText(r.detail, {
      x:x+0.15, y:y+1.2, w:cardW-0.3, h:1.3,
      fontSize:10.5, color:C.gray, fontFace:'Malgun Gothic',
      lineSpacingMultiple:1.4, wrap:true,
    });
  });
}

// ══════════════════════════════════════════════════════
// SLIDE 14 — 마무리 / Q&A
// ══════════════════════════════════════════════════════
{
  const s = prs.addSlide();
  s.addShape(prs.ShapeType.rect, {
    x:0, y:0, w:'100%', h:'100%',
    fill:{type:'gradient', gradType:'linear', stops:[
      {position:0,color:'1E3A5F'},{position:100,color:'0F172A'},
    ]},
  });
  s.addShape(prs.ShapeType.rect, {x:0, y:0, w:0.3, h:'100%', fill:{color:C.accent}});

  s.addText('감사합니다', {
    x:0.8, y:1.8, w:11, h:1.5,
    fontSize:54, bold:true, color:C.white, fontFace:'Malgun Gothic',
  });
  s.addShape(prs.ShapeType.rect, {x:0.8, y:3.4, w:3.0, h:0.06, fill:{color:C.accent}});
  s.addText('에이제이월드 BOM Management System\n통신선로개발팀', {
    x:0.8, y:3.6, w:10, h:0.9,
    fontSize:15, color:'7FAFD1', fontFace:'Malgun Gothic', lineSpacingMultiple:1.5,
  });
  const summary = ['✅ 휴먼에러 방지 · BOM 신뢰도 증대','⚡ 업무 효율 향상 · 신속한 대응','🚀 지속적인 기능 고도화 예정'];
  summary.forEach((t, i) => {
    s.addText(t, {
      x:0.8, y:4.7+i*0.48, w:9, h:0.42,
      fontSize:13, color:'A5C8F0', fontFace:'Malgun Gothic',
    });
  });
  s.addText('Q & A', {
    x:10.5, y:2.5, w:2.65, h:1.5,
    fontSize:42, bold:true, color:C.accent, fontFace:'Arial', align:'center',
  });
}

// ── 저장 ─────────────────────────────────────────────
const OUT = 'AJW_BMS_소개자료_260527.pptx';
prs.writeFile({ fileName: OUT }).then(() => {
  console.log('✅ PPT 생성 완료:', OUT);
}).catch(e => { console.error('❌ 오류:', e.message); });