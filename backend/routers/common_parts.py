from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models import CommonPartTemplate, Part, Product, BOMItem
from ..schemas import CommonPartTemplateCreate, CommonPartTemplateOut
from ..services.ai_service import suggest_common_parts

router = APIRouter(prefix="/api/common-parts", tags=["common-parts"])


@router.get("")
def list_common_parts(product_group: str = "", db: Session = Depends(get_db)):
    q = db.query(CommonPartTemplate)
    if product_group:
        q = q.filter(CommonPartTemplate.product_group == product_group)
    templates = q.all()
    return [
        {
            "id": t.id,
            "product_group": t.product_group,
            "default_quantity": t.default_quantity,
            "part": {
                "id": t.part.id,
                "part_number": t.part.part_number,
                "part_name": t.part.part_name,
                "spec": t.part.spec,
                "unit": t.part.unit,
            },
        }
        for t in templates
    ]


@router.post("", status_code=201)
def add_common_part(data: CommonPartTemplateCreate, db: Session = Depends(get_db)):
    part = db.query(Part).filter(Part.part_number == data.part_number).first()
    if not part:
        part = Part(
            part_number=data.part_number,
            part_name=data.part_name,
            spec=data.spec,
            unit=data.unit,
        )
        db.add(part)
        db.flush()

    existing = db.query(CommonPartTemplate).filter(
        CommonPartTemplate.product_group == data.product_group,
        CommonPartTemplate.part_id == part.id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="이미 등록된 공용 부품입니다")

    template = CommonPartTemplate(
        product_group=data.product_group,
        part_id=part.id,
        default_quantity=data.default_quantity,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return {"id": template.id, "message": "공용 부품 등록 완료"}


@router.delete("/{template_id}", status_code=204)
def delete_common_part(template_id: int, db: Session = Depends(get_db)):
    t = db.query(CommonPartTemplate).filter(CommonPartTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="찾을 수 없습니다")
    db.delete(t)
    db.commit()


@router.get("/suggest/{product_group}")
def suggest(product_group: str, db: Session = Depends(get_db)):
    """AI를 사용해 공용 부품 자동 추천 (claude CLI 사용)"""
    products = db.query(Product).filter(Product.product_group == product_group).all()
    if not products:
        return {"suggestion": "해당 제품군의 제품이 없습니다", "candidates": []}

    bom_data = []
    part_freq: dict = {}
    total = len(products)

    for p in products:
        items = [
            {"part_number": item.part.part_number, "part_name": item.part.part_name}
            for item in p.bom_items
        ]
        bom_data.append({"product": p.part_number, "items": items})
        seen = set()
        for item in items:
            pn = item["part_number"]
            if pn not in seen:
                seen.add(pn)
                if pn not in part_freq:
                    part_freq[pn] = {"count": 0, "name": item["part_name"]}
                part_freq[pn]["count"] += 1

    candidates = [
        {
            "part_number": pn,
            "part_name": v["name"],
            "frequency": v["count"],
            "percentage": round(v["count"] / total * 100, 1),
        }
        for pn, v in sorted(part_freq.items(), key=lambda x: -x[1]["count"])
        if v["count"] / total >= 0.5
    ]

    ai_comment = suggest_common_parts(product_group, bom_data)

    return {"candidates": candidates, "ai_suggestion": ai_comment}
