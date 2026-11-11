@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Quan ly thu vien de - Local Helper

rem ==================================================================
rem  START.bat - Mo giao dien quan ly de tren may giao vien.
rem
rem  Cach dung:
rem    - Nhap dup START.bat.
rem    - Giao dien se tu mo trong trinh duyet.
rem    - Chon de, kiem tra, roi bam "DANG LEN THU VIEN".
rem
rem  Cac tham so cu van duoc chuyen cho START-GITHUB.bat:
rem    START.bat --dry-run
rem    START.bat --no-push
rem    START.bat --github
rem
rem  Deploy truc tiep bang terminal (du phong):
rem    START-CLOUDFLARE.bat
rem ==================================================================

if not "%~1"=="" (
  if /I "%~1"=="--help" goto show_help
  if /I "%~1"=="-h" goto show_help
  if /I "%~1"=="--github" (
    call "%~dp0START-GITHUB.bat"
    exit /b %ERRORLEVEL%
  )
  call "%~dp0START-GITHUB.bat" %*
  exit /b %ERRORLEVEL%
)

echo.
echo ============================================================
echo  THU VIEN DE THI - QUAN LY VA DANG DE
echo ============================================================
echo.

rem ---------- 1. Kiem tra Node.js ----------
where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "_system\tools\local-helper.js" goto missing_files
if not exist "_system\tools\import-exam.js" goto missing_files
if not exist "_system\ui\add-exam.html" goto missing_files

rem ---------- 2. Kiem tra moi truong, Wrangler va dang nhap Cloudflare ----------
node _system\tools\check-environment.js
set "ENV_CODE=%ERRORLEVEL%"
if "%ENV_CODE%"=="1" goto env_failed
if "%ENV_CODE%"=="2" (
  echo [CANH BAO] Van co the mo giao dien, nhung hay xu ly cac canh bao ben tren
  echo             truoc khi bam DANG LEN THU VIEN.
  echo.
)

rem ---------- 3. Khoi chay Local Helper (an cua so terminal) ----------
set "HELPER_DIR=%LOCALAPPDATA%\ExamLibraryHelper"
set "SESSION_FILE=%HELPER_DIR%\session.json"
if not exist "%HELPER_DIR%" mkdir "%HELPER_DIR%" >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process -FilePath 'node' -ArgumentList @('_system/tools/local-helper.js','--open') -WorkingDirectory '%CD%' -WindowStyle Hidden -RedirectStandardOutput '%HELPER_DIR%\helper.out.log' -RedirectStandardError '%HELPER_DIR%\helper.err.log'"

rem ---------- 4. Cho Local Helper san sang ----------
set "READY=0"
for /l %%I in (1,1,60) do (
  if exist "%SESSION_FILE%" (
    node _system\tools\helper\session-ready.js "%SESSION_FILE%" >nul 2>nul
    if not errorlevel 1 (
      set "READY=1"
      goto helper_ready
    )
  )
  ping -n 2 127.0.0.1 >nul
)
goto startup_failed

:helper_ready
echo.
echo [OK] Local Helper dang chay.
echo      Giao dien se tu mo trong trinh duyet.
echo.
echo      Neu trinh duyet khong tu mo, hay nhap lai START.bat.
echo      Co the dong cua so nay. Local Helper tu tat sau 60 phut
echo      khong hoat dong, hoac bam "Tat tro ly" trong giao dien.
echo.
ping -n 4 127.0.0.1 >nul
exit /b 0

:show_help
echo.
echo START.bat               Mo giao dien quan ly de (khuyen dung)
echo START.bat --github      Chay quy trinh GitHub Pages cu
echo START.bat --dry-run     Chuyen tiep tuy chon cho START-GITHUB.bat
echo START-CLOUDFLARE.bat    Deploy truc tiep bang terminal neu giao dien loi
echo.
exit /b 0

:no_node
echo.
echo [LOI] Khong tim thay Node.js.
echo       Tai va cai dat tai: https://nodejs.org/
echo       Sau do mo lai START.bat.
echo.
pause
exit /b 1

:missing_files
echo.
echo [LOI] Thieu file cua he thong trong thu muc nay.
echo       Hay mo dung thu muc chua START.bat va kiem tra lai.
echo.
pause
exit /b 1

:env_failed
echo.
echo [LOI] Moi truong chua san sang de deploy.
echo       Hay xu ly cac loi ben tren roi chay lai START.bat.
echo.
pause
exit /b 1

:startup_failed
echo.
echo [LOI] Khong khoi dong duoc Local Helper.
if exist "%HELPER_DIR%\helper.err.log" (
  echo.
  echo --- Chi tiet loi ---
  powershell -NoProfile -Command "Get-Content -LiteralPath '%HELPER_DIR%\helper.err.log' -Tail 20" 2>nul
)
if exist "%HELPER_DIR%\helper.log" (
  echo.
  echo --- Log gan nhat ---
  powershell -NoProfile -Command "Get-Content -LiteralPath '%HELPER_DIR%\helper.log' -Tail 20" 2>nul
)
echo.
echo Goi y: chay truc tiep lenh sau de xem loi:
echo    node _system\tools\local-helper.js --open
echo.
pause
exit /b 1
