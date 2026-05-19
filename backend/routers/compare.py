from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import io

from ..database import get_db
from ..models import Product, BOMItem, Part
from ..services.excel_exporter import export_comparison_to_excel

router = APIRouter(prefix="/api/compare", tags=["compare"])


def _bom_index(items: list) -> dict:
    """BOM 항목을 부품번호 기준으로 인덱싱"""
    idx = {}
    for item in items:
        key = item.part.part_number
        idx[key] = item
    return idx


def compare_boms(db: Session, id1: int, id2: int) -> dict:
    p1 = db.query(Product).filter(Product.id == id1).first()
    p2 = db.query(Product).filter(Product.id == id2).first()
    if not p1 or not p2:
        raise HTTPException(status_code=404, detail="제품을 찾을 수 없습니다")

    idx1 = _bom_index(p1.bom_items)
    idx2 = _bom_index(p2.bom_items)
    all_keys = list(dict.fromkeys(list(idx1.keys()) + list(idx2.keys())))

    diffs = []
    summary = {"same": 0, "added": 0, "removed": 0, "qty_diff": 0, "spec_diff": 0}

    for key in all_keys:
        i1 = idx1.get(key)
        i2 = idx2.get(key)

        if i1 and not i2:
            status = "removed"
        elif i2 and not i1:
            status = "added"
        else:
            if i1.quantity != i2.quantity and i1.part.spec == i2.part.spec:
                status = "qty_diff"
            elif i1.part.spec != i2.part.spec:
                status = "spec_diff"
            else:
                status = "same"

        summary[status] = summary.get(status, 0) + 1

        def item_to_dict(item):
            if not item:
                return None
            return {
                "id": item.id,
                "part_number": item.part.part_number,
                "part_name": item.part.part_name,
                "spec": item.part.spec,
                "unit": item.part.unit,
                "quantity": item.quantity,
                "notes": item.notes,
            }

        diffs.append({
            "key": key,
            "status": status,
            "item1": item_to_dict(i1),
            "item2": item_to_dict(i2),
        })

    def prod_dict(p):
        return {
            "id": p.id,
            "part_number": p.part_number,
            "name": p.name,
            "customer": p.customer,
            "country_spec": p.country_spec,
        }

    return {
        "product1": prod_dict(p1),
        "product2": prod_dict(p2),
        "summary": summary,
        "diffs": diffs,
    }


@router.get("")
def get_comparison(
    id1: int = Query(...),
    id2: int = Query(...),
    diff_only: bool = False,
    db: Session = Depends(get_db),
):
    result = compare_boms(db, id1, id2)
    if diff_only:
        result["diffs"] = [d for d in result["diffs"] if d["status"] != "same"]
    return result


@router.get("/export")
def export_comparison(
    id1: int = Query(...),
    id2: int = Query(...),
    db: Session = Depends(get_db),
):
    result = compare_boms(db, id1, id2)
    p1 = db.query(Product).filter(Product.id == id1).first()
    p2 = db.query(Product).filter(Product.id == id2).first()

    excel_bytes = export_comparison_to_excel(
        {"part_number": p1.part_number, "name": p1.name},
        {"part_number": p2.part_number, "name": p2.name},
        [{"part": {"part_number": d["item1"]["part_number"] if d["item1"] else "",
                   "part_name": d["item1"]["part_name"] if d["item1"] else "",
                   "spec": d["item1"]["spec"] if d["item1"] else ""},
          "quantity": d["item1"]["quantity"] if d["item1"] else 0} for d in result["diffs"]],
        [{"part": {"part_number": d["item2"]["part_number"] if d["item2"] else "",
                   "part_name": d["item2"]["part_name"] if d["item2"] else "",
                   "spec": d["item2"]["spec"] if d["item2"] else ""},
          "quantity": d["item2"]["quantity"] if d["item2"] else 0} for d in result["diffs"]],
        result,
    )
    filename = f"비교_{p1.part_number}_vs_{p2.part_number}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
