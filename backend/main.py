import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, Base
from .routers import products, import_excel, compare, bulk_edit, history, common_parts, notifications

Base.metadata.create_all(bind=engine)

app = FastAPI(title="BOM 관리 시스템", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(products.router)
app.include_router(import_excel.router)
app.include_router(compare.router)
app.include_router(bulk_edit.router)
app.include_router(history.router)
app.include_router(common_parts.router)
app.include_router(notifications.router)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")


@app.get("/", include_in_schema=False)
def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}
