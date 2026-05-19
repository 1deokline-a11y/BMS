from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from .database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    part_number = Column(String, unique=True, index=True, nullable=False)
    product_group = Column(String, index=True, nullable=False)
    variant_code = Column(String, nullable=False)
    name = Column(String, nullable=False)
    customer = Column(String, default="")
    country_spec = Column(String, default="")
    spec = Column(String, default="")
    notes = Column(Text, default="")
    file_path = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    bom_items = relationship("BOMItem", back_populates="product", cascade="all, delete-orphan", order_by="BOMItem.row_order")


class Part(Base):
    __tablename__ = "parts"

    id = Column(Integer, primary_key=True, index=True)
    part_number = Column(String, unique=True, index=True, nullable=False)
    part_name = Column(String, nullable=False)
    spec = Column(String, default="")
    unit = Column(String, default="EA")

    bom_items = relationship("BOMItem", back_populates="part")
    common_templates = relationship("CommonPartTemplate", back_populates="part")


class BOMItem(Base):
    __tablename__ = "bom_items"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    quantity = Column(Float, nullable=False, default=1.0)
    row_order = Column(Integer, default=0)
    position = Column(String, default="")
    notes = Column(Text, default="")

    product = relationship("Product", back_populates="bom_items")
    part = relationship("Part", back_populates="bom_items")


class CommonPartTemplate(Base):
    __tablename__ = "common_part_templates"

    id = Column(Integer, primary_key=True, index=True)
    product_group = Column(String, index=True, nullable=False)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    default_quantity = Column(Float, default=1.0)

    part = relationship("Part", back_populates="common_templates")


class ChangeLog(Base):
    __tablename__ = "change_logs"

    id = Column(Integer, primary_key=True, index=True)
    action_type = Column(String, nullable=False)
    operator = Column(String, default="관리자")
    timestamp = Column(DateTime, default=datetime.utcnow)
    reason = Column(Text, nullable=False)
    affected_products = Column(Text, default="[]")
    changes = Column(Text, default="{}")
    snapshot_path = Column(String, default="")
    is_rolled_back = Column(Boolean, default=False)


class RecipientGroup(Base):
    __tablename__ = "recipient_groups"

    id = Column(Integer, primary_key=True, index=True)
    group_name = Column(String, nullable=False)
    emails = Column(Text, default="[]")
    default_for_actions = Column(Text, default="[]")
