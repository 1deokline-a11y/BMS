@echo off
chcp 65001 >nul
title BOM 관리 시스템
echo.
echo ============================================
echo   BOM 관리 시스템 시작
echo ============================================
echo.
cd /d "%~dp0"
if not exist node_modules (
    echo 패키지 설치 중...
    npm install
)
echo.
echo 서버 시작 중... http://localhost:8000
echo 브라우저에서 위 주소를 열어주세요.
echo.
node server/index.js
pause
