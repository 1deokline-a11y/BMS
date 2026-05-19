import os
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product, Part, BOMItem
from ..services.excel_parser import parse_excel_bom

router = APIRouter(prefix="/api/import", tags=["import"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOAD_DIR = os.path.join(BASE_DIR, "data", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _get_or_create_part(db, part_number, part_name, spec="", unit="EA"):
    part = db.query(Part).filter(Part.part_number == part_number).first()
    if not part:
        part = Part(part_number=part_number, part_name=part_name, spec=spec, unit=unit)
        db.add(part)
        db.flush()
    return part


@router.post("/excel")
async def import_excel(
    files: list[UploadFile] = File(...),
    overwrite: bool = False,
    db: Session = Depends(get_db),
):
    results = []
    for upload in files:
        tmp_path = os.path.join(UPLOAD_DIR, upload.filename)
        try:
            with open(tmp_path, "wb") as f:
                content = await upload.read()
                f.write(content)

            parsed = parse_excel_bom(tmp_path)
            meta = parsed["meta"]
            bom_items = parsed["bom_items"]

            existing = db.query(Product).filter(
                Product.part_number == meta["part_number"]
            ).first()

            if existing and not overwrite:
                results.append({
                    "filename": upload.filename,
                    "status": "skipped",
                    "reason": f"이미 존재하는 품번: {meta['part_number']} (덮어쓰기 옵션 사용 시 가능)",
                    "part_number": meta["part_number"],
                })
                continue

            if existing and overwrite:
                db.query(BOMItem).filter(BOMItem.product_id == existing.id).delete()
                for field, val in meta.items():
                    if hasattr(existing, field):
                        setattr(existing, field, val)
                existing.file_path = tmp_path
                existing.updated_at = datetime.utcnow()
                product = existing
            else:
                product = Product(
                    **meta,
                    file_path=tmp_path,
                )
                db.add(product)
                db.flush()

            for i, item in enumerate(bom_items):
                part = _get_or_create_part(
                    db,
                    item["part_number"],
                    item["part_name"],
                    item.get("spec", ""),
                    item.get("unit", "EA"),
                )
                db.add(BOMItem(
                    product_id=product.id,
                    part_id=part.id,
                    quantity=item.get("quantity", 1.0),
                    row_order=i,
                    notes=item.get("notes", ""),
                ))

            db.commit()
            results.append({
                "filename": upload.filename,
                "status": "success",
                "part_number": meta["part_number"],
                "bom_items_count": len(bom_items),
                "action": "updated" if (existing and overwrite) else "created",
            })

        except Exception as e:
            db.rollback()
            results.append({
                "filename": upload.filename,
                "status": "error",
                "reason": str(e),
            })

    return {"results": results}


@router.post("/scan-folder")
def scan_folder(folder_path: str, overwrite: bool = False, db: Session = Depends(get_db)):
    """서버 로컬 폴더의 엑셀 파일을 일괄 임포트"""
    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=400, detail="폴더를 찾을 수 없습니다")

    xlsx_files = [
        os.path.join(folder_path, f)
        for f in os.listdir(folder_path)
        if f.lower().endswith(".xlsx") and not f.startswith("~$")
    ]

    results = []
    for filepath in xlsx_files:
        filename = os.path.basename(filepath)
        try:
            parsed = parse_excel_bom(filepath)
            meta = parsed["meta"]
            bom_items = parsed["bom_items"]

            existing = db.query(Product).filter(
                Product.part_number == meta["part_number"]
            ).first()

            if existing and not overwrite:
                results.append({"filename": filename, "status": "skipped",
                                 "part_number": meta["part_number"]})
                continue

            if existing and overwrite:
                db.query(BOMItem).filter(BOMItem.product_id == existing.id).delete()
                for field, val in meta.items():
                    if hasattr(existing, field):
                        setattr(existing, field, val)
                existing.file_path = filepath
                existing.updated_at = datetime.utcnow()
                product = existing
            else:
                product = Product(**meta, file_path=filepath)
                db.add(product)
                db.flush()

            for i, item in enumerate(bom_items):
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
                    product_id=product.id,
                    part_id=part.id,
                    quantity=item.get("quantity", 1.0),
                    row_order=i,
                    notes=item.get("notes", ""),
                ))

            db.commit()
            results.append({
                "filename": filename,
                "status": "success",
                "part_number": meta["part_number"],
                "bom_items_count": len(bom_items),
            })
        except Exception as e:
            db.rollback()
            results.append({"filename": filename, "status": "error", "reason": str(e)})

    return {"total": len(xlsx_files), "results": results}
