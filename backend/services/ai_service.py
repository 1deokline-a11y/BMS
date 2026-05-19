"""Claude CLI를 사용한 AI 서비스 - 유료 계정 인증 사용 (별도 API 키 불필요)"""
import subprocess


def call_claude(prompt: str, timeout: int = 90) -> str:
    """claude CLI를 서브프로세스로 호출하여 AI 응답을 반환한다."""
    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        err = result.stderr.strip()
        return f"[AI 오류] {err}" if err else "[AI 응답 없음]"
    except subprocess.TimeoutExpired:
        return "[AI 응답 시간 초과 - 다시 시도해주세요]"
    except FileNotFoundError:
        return "[Claude CLI를 찾을 수 없습니다. Claude Code가 설치·로그인되어 있는지 확인하세요]"
    except Exception as e:
        return f"[AI 서비스 오류: {e}]"


def generate_notification_email(
    action_type: str,
    affected_products: list,
    changes: dict,
    reason: str,
    operator: str,
    timestamp: str,
) -> str:
    product_list = "\n".join(f"  - {p}" for p in affected_products[:20])
    change_summary = []
    for k, v in changes.items():
        if isinstance(v, dict) and "before" in v and "after" in v:
            change_summary.append(f"  - {k}: {v['before']} → {v['after']}")
    change_text = "\n".join(change_summary) if change_summary else "  (상세 변경 내역 첨부 파일 참조)"

    prompt = f"""
당신은 광통신장비 제조회사의 BOM 관리 담당자입니다.
아래 BOM 변경 정보를 바탕으로 유관부서(생산팀, 구매팀, 품질팀)에 보낼 공식 이메일을 한국어로 작성해주세요.

[변경 정보]
- 작업 유형: {action_type}
- 작업자: {operator}
- 작업 일시: {timestamp}
- 변경 사유: {reason}
- 영향 품번 목록:
{product_list}
- 주요 변경 내용:
{change_text}

[요구사항]
- 제목 포함 (Subject: 로 시작)
- 수신 부서에 대한 정중한 인사
- 변경 요약을 명확하게 서술
- 조치 필요 사항 안내 (있는 경우)
- 문의처 안내 포함
- 간결하고 전문적인 톤 유지
""".strip()

    return call_claude(prompt)


def suggest_common_parts(product_group: str, bom_data: list) -> str:
    """BOM 데이터를 분석하여 공용 부품을 자동 추천한다."""
    part_freq: dict = {}
    total = len(bom_data)
    for bom in bom_data:
        seen = set()
        for item in bom.get("items", []):
            pn = item.get("part_number", "")
            if pn and pn not in seen:
                seen.add(pn)
                part_freq[pn] = part_freq.get(pn, {"count": 0, "name": item.get("part_name", "")})
                part_freq[pn]["count"] += 1

    candidates = [
        f"  - {pn} ({v['name']}): {v['count']}/{total} 제품 사용 ({v['count']/total*100:.0f}%)"
        for pn, v in sorted(part_freq.items(), key=lambda x: -x[1]["count"])
        if v["count"] / total >= 0.5
    ]
    candidate_text = "\n".join(candidates) if candidates else "  (분석 가능한 공통 부품 없음)"

    prompt = f"""
아래는 제품군 '{product_group}'의 BOM 분석 결과입니다.
50% 이상의 제품에서 사용되는 부품 목록:
{candidate_text}

이 부품들을 공용 부품으로 지정하는 것의 타당성을 분석하고,
공용 부품 지정 시 주의사항을 간략히 한국어로 설명해주세요 (5줄 이내).
""".strip()

    return call_claude(prompt)
