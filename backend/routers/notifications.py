import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ChangeLog, RecipientGroup
from ..schemas import NotificationRequest, RecipientGroupCreate
from ..services.ai_service import generate_notification_email
from ..services.email_service import send_via_outlook, send_via_smtp, parse_email_text

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.post("/generate")
def generate_email(change_log_id: int, db: Session = Depends(get_db)):
    log = db.query(ChangeLog).filter(ChangeLog.id == change_log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="이력을 찾을 수 없습니다")

    affected = json.loads(log.affected_products)
    changes = json.loads(log.changes)

    email_text = generate_notification_email(
        action_type=log.action_type,
        affected_products=affected,
        changes=changes,
        reason=log.reason,
        operator=log.operator,
        timestamp=log.timestamp.strftime("%Y-%m-%d %H:%M"),
    )
    subject, body = parse_email_text(email_text)
    return {"subject": subject, "body": body, "raw": email_text}


@router.post("/send")
def send_notification(req: NotificationRequest, db: Session = Depends(get_db)):
    log = db.query(ChangeLog).filter(ChangeLog.id == req.change_log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="이력을 찾을 수 없습니다")

    all_recipients = list(req.extra_emails)
    for gid in req.recipient_group_ids:
        group = db.query(RecipientGroup).filter(RecipientGroup.id == gid).first()
        if group:
            emails = json.loads(group.emails)
            all_recipients.extend(emails)
    all_recipients = list(set(all_recipients))

    if not all_recipients:
        raise HTTPException(status_code=400, detail="수신자가 없습니다")

    affected = json.loads(log.affected_products)
    changes = json.loads(log.changes)
    if req.custom_body:
        subject = "BOM 변경 알림"
        body = req.custom_body
    else:
        email_text = generate_notification_email(
            action_type=log.action_type,
            affected_products=affected,
            changes=changes,
            reason=log.reason,
            operator=log.operator,
            timestamp=log.timestamp.strftime("%Y-%m-%d %H:%M"),
        )
        subject, body = parse_email_text(email_text)

    result = send_via_outlook(all_recipients, subject, body)
    return result


# 수신자 그룹 관리
@router.get("/recipients")
def list_recipients(db: Session = Depends(get_db)):
    groups = db.query(RecipientGroup).all()
    return [
        {
            "id": g.id,
            "group_name": g.group_name,
            "emails": json.loads(g.emails),
            "default_for_actions": json.loads(g.default_for_actions),
        }
        for g in groups
    ]


@router.post("/recipients", status_code=201)
def create_recipient(data: RecipientGroupCreate, db: Session = Depends(get_db)):
    group = RecipientGroup(
        group_name=data.group_name,
        emails=json.dumps(data.emails, ensure_ascii=False),
        default_for_actions=json.dumps(data.default_for_actions, ensure_ascii=False),
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return {"id": group.id, "message": "수신자 그룹 생성 완료"}


@router.put("/recipients/{group_id}")
def update_recipient(group_id: int, data: RecipientGroupCreate, db: Session = Depends(get_db)):
    group = db.query(RecipientGroup).filter(RecipientGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="그룹을 찾을 수 없습니다")
    group.group_name = data.group_name
    group.emails = json.dumps(data.emails, ensure_ascii=False)
    group.default_for_actions = json.dumps(data.default_for_actions, ensure_ascii=False)
    db.commit()
    return {"message": "수정 완료"}


@router.delete("/recipients/{group_id}", status_code=204)
def delete_recipient(group_id: int, db: Session = Depends(get_db)):
    group = db.query(RecipientGroup).filter(RecipientGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="그룹을 찾을 수 없습니다")
    db.delete(group)
    db.commit()
