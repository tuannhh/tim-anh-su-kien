@echo off
chcp 65001 >nul
title MISA - Tim anh AI
cd /d "%~dp0"
echo ============================================
echo   MISA - TIM ANH AI
echo   Mo trinh duyet vao: http://localhost:3000
echo   (Dong cua so nay de tat he thong)
echo ============================================
start http://localhost:3000
node server.js
pause
