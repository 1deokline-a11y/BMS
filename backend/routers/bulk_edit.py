import json
import os
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product, Part, BOMItem, ChangeLog
from ..schemas import BulkEditRequest

router = APIRouter(prefix="/api/bulk-edit", tags=["bulk-edit"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKUP_DIR = os.path.join(BASE_DIR, "backups")


def _snapshot_bom(db: Session, product_ids: list) -> dict:
    snapshot = {}
    for pid in product_ids:
        product = db.query(Product).filter(Product.id == pid).first()
        if product:
            snapshot[pid] = {
                "part_number": product.part_number,
                "items": [
                    {
                        "id": item.id,
                        "part_number": item.part.part_number,
                        "part_name": item.part.part_name,
                        "spec": item.part.spec,
                        "unit": item.part.unit,
                        "quantity": item.quantity,
                        "row_order": item.row_order,
                        "notes": item.notes,
                    }
                    for item in product.bom_items
                ],
            }
    return snapshot


@router.get("/search")
def search_part_usage(
    part_number: str = Query(..., description="부품번호 (부분 일치)"),
    part_name: str = Query("", description="부품명 (부분 일치)"),
    db: Session = Depends(get_db),
):
    q = db.query(Part)
    if part_number:
        q = q.filter(Part.part_number.ilike(f"%{part_number}%"))
    if part_name:
        q = q.filter(Part.part_name.ilike(f"%{part_name}%"))
    parts = q.limit(50).all()

    results = []
    for part in parts:
        usage = []
        for bom_item in part.bom_items:
            product = bom_item.product
            usage.append({
                "product_id": product.id,
                "part_number": product.part_number,
                "product_name": product.name,
                "product_group": product.product_group,
                "quantity": bom_item.quantity,
                "bom_item_id": bom_item.id,
            })
        results.append({
            "part_id": part.id,
            "part_number": part.part_number,
            "part_name": part.part_name,
            "spec": part.spec,
            "unit": part.unit,
            "usage_count": len(usage),
            "usage": usage,
        })
    return results


@router.post("/preview")
def preview_bulk_edit(req: BulkEditRequest, db: Session = Depends(get_db)):
    previews = []
    for pid in req.product_ids:
        product = db.query(Product).filter(Product.id == pid).first()
        if not product:
            continue
        affected = []
        for item in product.bom_items:
            if item.part.part_number == req.target_part_number:
                after = {
                    "part_number": item.part.part_number,
                    "part_name": item.part.part_name,
                    "spec": item.part.spec,
                    "quantity": item.quantity,
                }
                if req.action == "replace":
                    after["part_number"] = req.new_part_number or after["part_number"]
                    after["part_name"] = req.new_part_name or after["part_name"]
                    after["spec"] = req.new_spec or after["spec"]
                elif req.action == "update_qty":
                    after["quantity"] = req.new_quantity
                elif req.action == "delete":
                    after = None

                affected.append({
                    "bom_item_id": item.id,
                    "before": {
                        "part_number": item.part.part_number,
                        "part_name": item.part.part_name,
                        "spec": item.part.spec,
                        "quantity": item.quantity,
                    },
                    "after": after,
                })

        if req.action == "add" and req.new_part_number:
            affected.append({
                "bom_item_id": None,
                "before": None,
                "after": {
                    "part_number": req.new_part_number,
                    "part_name": req.new_part_name or "",
                    "spec": req.new_spec or "",
                    "quantity": req.new_quantity or 1.0,
                },
            })

        previews.append({
            "product_id": product.id,
            "part_number": product.part_number,
            "product_name": product.name,
            "affected_items": affected,
        })
    return {"previews": previews, "total_products": len(previews)}


@router.post("/apply")
def apply_bulk_edit(req: BulkEditRequest, operator: str = "관리자",
                    db: Session = Depends(get_db)):
    if not req.reason.strip():
        raise HTTPException(status_code=400, detail="변경 사유를 입력해주세요")

    snapshot = _snapshot_bom(db, req.product_ids)
    snapshot_path = os.path.join(
        BACKUP_DIR,
        f"snapshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with open(snapshot_path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)

    affected_parts = []
    changes_log = {}

    for pid in req.product_ids:
        product = db.query(Product).filter(Product.id == pid).first()
        if not product:
            continue

        product_changes = []
        for item in list(product.bom_items):
            if item.part.part_number != req.target_part_number:
                continue

            if req.action == "delete":
                db.delete(item)
                product_changes.append({"action": "deleted", "part": item.part.part_number})

            elif req.action == "update_qty":
                old_qty = item.quantity
                item.quantity = req.new_quantity
                product_changes.append({"action": "qty_updated",
                                        "part": item.part.part_number,
                                        "before": old_qty, "after": req.new_quantity})

            elif req.action == "replace":
                new_part = db.query(Part).filter(
                    Part.part_number == req.new_part_number
                ).first()
                if not new_part:
                    new_part = Part(
                        part_number=req.new_part_number,
                        part_name=req.new_part_name or "",
                        spec=req.new_spec or "",
                        unit=req.new_unit or "EA",
                    )
                    db.add(new_part)
                    db.flush()
                old_pn = item.part.part_number
                item.part_id = new_part.id
                if req.new_quantity:
                    item.quantity = req.new_quantity
                product_changes.append({"action": "replaced",
                                        "before": old_pn, "after": req.new_part_number})

        if req.action == "add" and req.new_part_number:
            new_part = db.query(Part).filter(
                Part.part_number == req.new_part_number
            ).first()
            if not new_part:
                new_part = Part(
                    part_number=req.new_part_number,
                    part_name=req.new_part_name or "",
                    spec=req.new_spec or "",
                    unit=req.new_unit or "EA",
                )
                db.add(new_part)
                db.flush()
            max_order = max((i.row_order for i in product.bom_items), default=-1) + 1
            db.add(BOMItem(
                product_id=product.id,
                part_id=new_part.id,
                quantity=req.new_quantity or 1.0,
                row_order=max_order,
            ))
            product_changes.append({"action": "added", "part": req.new_part_number})

        if product_changes:
            affected_parts.append(product.part_number)
            changes_log[product.part_number] = product_changes
        product.updated_at = datetime.utcnow()

    log = ChangeLog(
        action_type=req.action,
        operator=operator,
        reason=req.reason,
        affected_products=json.dumps(affected_parts, ensure_ascii=False),
        changes=json.dumps(changes_log, ensure_ascii=False),
        snapshot_path=snapshot_path,
    )
    db.add(log)
    db.commit()

    return {
        "success": True,
        "affected_products": affected_parts,
        "change_log_id": log.id,
        "message": f"{len(affected_parts)}개 제품 수정 완료",
    }
