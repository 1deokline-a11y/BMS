from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from ..database import get_db
from ..models import Product, Part, BOMItem
from ..schemas import ProductCreate, ProductUpdate, ProductOut, ProductWithBOM, BOMItemCreate

router = APIRouter(prefix="/api/products", tags=["products"])


def _get_or_create_part(db: Session, part_number: str, part_name: str,
                         spec: str = "", unit: str = "EA") -> Part:
    part = db.query(Part).filter(Part.part_number == part_number).first()
    if not part:
        part = Part(part_number=part_number, part_name=part_name, spec=spec, unit=unit)
        db.add(part)
        db.flush()
    return part


@router.get("", response_model=List[ProductOut])
def list_products(
    group: Optional[str] = None,
    customer: Optional[str] = None,
    country_spec: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Product)
    if group:
        q = q.filter(Product.product_group == group)
    if customer:
        q = q.filter(Product.customer.ilike(f"%{customer}%"))
    if country_spec:
        q = q.filter(Product.country_spec.ilike(f"%{country_spec}%"))
    if search:
        q = q.filter(
            Product.part_number.ilike(f"%{search}%") |
            Product.name.ilike(f"%{search}%") |
            Product.customer.ilike(f"%{search}%")
        )
    return q.order_by(Product.part_number).all()


@router.get("/groups")
def list_groups(db: Session = Depends(get_db)):
    rows = db.query(Product.product_group).distinct().order_by(Product.product_group).all()
    return [r[0] for r in rows]


@router.get("/{product_id}", response_model=ProductWithBOM)
def get_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="제품을 찾을 수 없습니다")
    return p


@router.post("", response_model=ProductOut, status_code=201)
def create_product(data: ProductCreate, db: Session = Depends(get_db)):
    existing = db.query(Product).filter(Product.part_number == data.part_number).first()
    if existing:
        raise HTTPException(status_code=409, detail="이미 존재하는 품번입니다")

    product = Product(
        part_number=data.part_number,
        product_group=data.product_group,
        variant_code=data.variant_code,
        name=data.name,
        customer=data.customer,
        country_spec=data.country_spec,
        spec=data.spec,
        notes=data.notes,
    )
    db.add(product)
    db.flush()

    for i, item_data in enumerate(data.bom_items):
        part = _get_or_create_part(db, item_data.part_number, item_data.part_name,
                                    item_data.spec, item_data.unit)
        bom_item = BOMItem(
            product_id=product.id,
            part_id=part.id,
            quantity=item_data.quantity,
            row_order=i,
            position=item_data.position,
            notes=item_data.notes,
        )
        db.add(bom_item)

    db.commit()
    db.refresh(product)
    return product


@router.put("/{product_id}", response_model=ProductOut)
def update_product(product_id: int, data: ProductUpdate, db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="제품을 찾을 수 없습니다")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(p, field, value)
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="제품을 찾을 수 없습니다")
    db.delete(p)
    db.commit()


@router.put("/{product_id}/bom")
def replace_bom(product_id: int, items: List[BOMItemCreate], reason: str = Query("BOM 수정"),
                db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="제품을 찾을 수 없습니다")

    db.query(BOMItem).filter(BOMItem.product_id == product_id).delete()
    for i, item_data in enumerate(items):
        part = _get_or_create_part(db, item_data.part_number, item_data.part_name,
                                    item_data.spec, item_data.unit)
        db.add(BOMItem(
            product_id=product_id,
            part_id=part.id,
            quantity=item_data.quantity,
            row_order=i,
            position=item_data.position,
            notes=item_data.notes,
        ))

    p.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "BOM 저장 완료"}
