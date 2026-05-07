'use strict';
const { spawnSync } = require('child_process');

/**
 * Claude CLI 호출 - 유료 계정 인증 사용 (별도 API 키 불필요)
 */
function callClaude(prompt, timeoutMs = 90000) {
  try {
    const result = spawnSync('claude', ['-p', prompt], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
    });
    if (result.error) {
      if (result.error.code === 'ENOENT') return '[Claude CLI를 찾을 수 없습니다. Claude Code가 설치·로그인되어 있는지 확인하세요]';
      if (result.error.code === 'ETIMEDOUT') return '[AI 응답 시간 초과 - 다시 시도해주세요]';
      return `[AI 오류: ${result.error.message}]`;
    }
    return (result.stdout || '').trim() || '[AI 응답 없음]';
  } catch (e) {
    return `[AI 서비스 오류: ${e.message}]`;
  }
}

function generateNotificationEmail({ actionType, affectedProducts, changes, reason, operator, timestamp }) {
  const productList = affectedProducts.slice(0, 20).map(p => `  - ${p}`).join('\n');
  const changeLines = Object.entries(changes || {}).slice(0, 10).map(([k, v]) => {
    if (Array.isArray(v)) return `  - ${k}: ${v.map(c => c.action || JSON.stringify(c)).join(', ')}`;
    return `  - ${k}: ${JSON.stringify(v)}`;
  }).join('\n') || '  (첨부 파일 참조)';

  const prompt = `당신은 광통신장비 제조회사의 BOM 관리 담당자입니다.
아래 BOM 변경 정보를 바탕으로 유관부서(생산팀, 구매팀, 품질팀)에 보낼 공식 이메일을 한국어로 작성해주세요.

[변경 정보]
- 작업 유형: ${actionType}
- 작업자: ${operator}
- 작업 일시: ${timestamp}
- 변경 사유: ${reason}
- 영향 품번:
${productList}
- 주요 변경 내용:
${changeLines}

[요구사항]
- 첫 줄: Subject: 로 시작하는 제목
- 수신 부서에 대한 정중한 인사
- 변경 요약을 명확하게 서술
- 조치 필요 사항 안내
- 문의처 안내 포함
- 간결하고 전문적인 톤`;

  return callClaude(prompt);
}

function suggestCommonParts(productGroup, partFrequency, total) {
  const candidates = Object.entries(partFrequency)
    .filter(([, v]) => v.count / total >= 0.5)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([pn, v]) => `  - ${pn} (${v.name}): ${v.count}/${total} 제품 (${Math.round(v.count/total*100)}%)`)
    .join('\n') || '  (공통 부품 없음)';

  const prompt = `제품군 '${productGroup}'의 BOM 분석 결과:
50% 이상 제품에서 사용되는 부품:
${candidates}

이 부품들을 공용 부품으로 지정하는 것의 타당성을 분석하고,
주의사항을 간략히 한국어로 설명해주세요 (5줄 이내).`;

  return callClaude(prompt);
}

module.exports = { callClaude, generateNotificationEmail, suggestCommonParts };
