from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel


class PartBase(BaseModel):
    part_number: str
    part_name: str
    spec: str = ""
    unit: str = "EA"


class PartCreate(PartBase):
    pass


class PartOut(PartBase):
    id: int

    class Config:
        from_attributes = True


class BOMItemBase(BaseModel):
    quantity: float = 1.0
    row_order: int = 0
    position: str = ""
    notes: str = ""


class BOMItemCreate(BOMItemBase):
    part_number: str
    part_name: str
    spec: str = ""
    unit: str = "EA"


class BOMItemOut(BOMItemBase):
    id: int
    product_id: int
    part_id: int
    part: PartOut

    class Config:
        from_attributes = True


class ProductBase(BaseModel):
    part_number: str
    product_group: str
    variant_code: str
    name: str
    customer: str = ""
    country_spec: str = ""
    spec: str = ""
    notes: str = ""


class ProductCreate(ProductBase):
    bom_items: List[BOMItemCreate] = []


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    customer: Optional[str] = None
    country_spec: Optional[str] = None
    spec: Optional[str] = None
    notes: Optional[str] = None


class ProductOut(ProductBase):
    id: int
    file_path: str = ""
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProductWithBOM(ProductOut):
    bom_items: List[BOMItemOut] = []


class CommonPartTemplateCreate(BaseModel):
    product_group: str
    part_number: str
    part_name: str
    spec: str = ""
    unit: str = "EA"
    default_quantity: float = 1.0


class CommonPartTemplateOut(BaseModel):
    id: int
    product_group: str
    default_quantity: float
    part: PartOut

    class Config:
        from_attributes = True


class ChangeLogOut(BaseModel):
    id: int
    action_type: str
    operator: str
    timestamp: datetime
    reason: str
    affected_products: str
    changes: str
    is_rolled_back: bool

    class Config:
        from_attributes = True


class RecipientGroupCreate(BaseModel):
    group_name: str
    emails: List[str] = []
    default_for_actions: List[str] = []


class RecipientGroupOut(BaseModel):
    id: int
    group_name: str
    emails: str
    default_for_actions: str

    class Config:
        from_attributes = True


class BulkEditRequest(BaseModel):
    action: str  # replace, update_qty, delete, add
    target_part_number: str
    product_ids: List[int]
    reason: str
    new_part_number: Optional[str] = None
    new_part_name: Optional[str] = None
    new_spec: Optional[str] = None
    new_unit: Optional[str] = None
    new_quantity: Optional[float] = None


class NotificationRequest(BaseModel):
    change_log_id: int
    recipient_group_ids: List[int] = []
    extra_emails: List[str] = []
    custom_body: Optional[str] = None
