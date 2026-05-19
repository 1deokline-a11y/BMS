import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ChangeLog, Product, Part, BOMItem

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("")
def list_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    action_type: str = Query(""),
    db: Session = Depends(get_db),
):
    q = db.query(ChangeLog)
    if action_type:
        q = q.filter(ChangeLog.action_type == action_type)
    total = q.count()
    logs = q.order_by(ChangeLog.timestamp.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": log.id,
                "action_type": log.action_type,
                "operator": log.operator,
                "timestamp": log.timestamp.isoformat(),
                "reason": log.reason,
                "affected_products": json.loads(log.affected_products),
                "is_rolled_back": log.is_rolled_back,
            }
            for log in logs
        ],
    }


@router.get("/{log_id}")
def get_history(log_id: int, db: Session = Depends(get_db)):
    log = db.query(ChangeLog).filter(ChangeLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="이력을 찾을 수 없습니다")
    return {
        "id": log.id,
        "action_type": log.action_type,
        "operator": log.operator,
        "timestamp": log.timestamp.isoformat(),
        "reason": log.reason,
        "affected_products": json.loads(log.affected_products),
        "changes": json.loads(log.changes),
        "snapshot_path": log.snapshot_path,
        "is_rolled_back": log.is_rolled_back,
    }


@router.post("/{log_id}/rollback")
def rollback_change(log_id: int, db: Session = Depends(get_db)):
    log = db.query(ChangeLog).filter(ChangeLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="이력을 찾을 수 없습니다")
    if log.is_rolled_back:
        raise HTTPException(status_code=400, detail="이미 롤백된 이력입니다")
    if not log.snapshot_path:
        raise HTTPException(status_code=400, detail="스냅샷이 없어 롤백할 수 없습니다")

    import os
    if not os.path.exists(log.snapshot_path):
        raise HTTPException(status_code=400, detail="스냅샷 파일을 찾을 수 없습니다")

    with open(log.snapshot_path, "r", encoding="utf-8") as f:
        snapshot = json.load(f)

    for pid_str, data in snapshot.items():
        pid = int(pid_str)
        product = db.query(Product).filter(Product.id == pid).first()
        if not product:
            continue

        db.query(BOMItem).filter(BOMItem.product_id == pid).delete()
        db.flush()

        for item in data.get("items", []):
            part = db.query(Part).filter(Part.part_number == item["part_number"]).first()
            if not part:
                part = Part(
                    part_number=item["part_number"],
                    part_name=item["part_name"],
                    spec=item.get("spec", ""),
                    unit=item.get("unit", "EA"),
                )
                db.add(part)
                db.flush()
            db.add(BOMItem(
                product_id=pid,
                part_id=part.id,
                quantity=item["quantity"],
                row_order=item.get("row_order", 0),
                notes=item.get("notes", ""),
            ))
        product.updated_at = datetime.utcnow()

    log.is_rolled_back = True
    rollback_log = ChangeLog(
        action_type="rollback",
        operator="시스템",
        reason=f"이력 #{log_id} 롤백",
        affected_products=log.affected_products,
        changes=json.dumps({"rolled_back_log_id": log_id}),
    )
    db.add(rollback_log)
    db.commit()

    return {"success": True, "message": "롤백 완료", "rollback_log_id": rollback_log.id}
