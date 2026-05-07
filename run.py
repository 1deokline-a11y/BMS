"""BOM 관리 시스템 실행 스크립트"""
import subprocess
import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def install_deps():
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "-q"],
        cwd=BASE_DIR, check=True
    )

def main():
    print("=" * 50)
    print("  BOM 관리 시스템 시작 중...")
    print("=" * 50)

    os.makedirs(os.path.join(BASE_DIR, "data"), exist_ok=True)
    os.makedirs(os.path.join(BASE_DIR, "backups"), exist_ok=True)

    try:
        import fastapi
    except ImportError:
        print("패키지 설치 중...")
        install_deps()

    print("서버 시작: http://localhost:8000")
    print("종료: Ctrl+C")
    print()

    subprocess.run(
        [sys.executable, "-m", "uvicorn", "backend.main:app",
         "--host", "0.0.0.0", "--port", "8000", "--reload"],
        cwd=BASE_DIR
    )

if __name__ == "__main__":
    main()
