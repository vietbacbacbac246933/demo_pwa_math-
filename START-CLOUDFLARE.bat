@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title Cap nhat de thi va deploy Cloudflare Pages

rem ==================================================================
rem  START-CLOUDFLARE.bat
rem
rem  Cach dung (giong START.bat):
rem    1. Chep file .html / thu muc export / .zip de moi vao thu muc nay.
rem    2. Nhap dup START-CLOUDFLARE.bat.
rem
rem  Script tu quet file moi o thu muc goc, nhap vao exams/, cap nhat
rem  catalog + dap an server, kiem tra, tang cache va deploy Cloudflare.
rem
rem  Tuy chon:
rem    --check-only          Chi kiem tra, khong nhap de, khong deploy
rem    --no-deploy           Chuan bi xong nhung chua deploy
rem    --yes                 Khong hoi lai
rem
rem  Cac tham so con lai duoc chuyen truc tiep cho tools/import-exam.js:
rem    --subject toan --number 3 --title "De Toan so 3"
rem
rem  Script nay KHONG commit/push GitHub va KHONG dung
rem  `wrangler pages deploy .`.
rem ==================================================================

set "HAS_ARGS=0"
if not "%~1"=="" set "HAS_ARGS=1"

set "CHECK_ONLY=0"
set "NO_DEPLOY=0"
set "WANT_YES=0"
set "IMPORT_ARGS="

:parse
if "%~1"=="" goto parsed

if /I "%~1"=="--check-only" (
  set "CHECK_ONLY=1"
  shift
  goto parse
)
if /I "%~1"=="--no-deploy" (
  set "NO_DEPLOY=1"
  shift
  goto parse
)
if /I "%~1"=="--yes" (
  set "WANT_YES=1"
  shift
  goto parse
)

rem Giu nguyen dau ngoac kep cua tham so (dung %1, khong phai %~1).
set "IMPORT_ARGS=%IMPORT_ARGS% %1"
shift
goto parse

:parsed

echo.
echo ============================================================
echo  CAP NHAT DE THI - CLOUDFLARE PAGES
echo ============================================================
echo.

rem ---------- 1. Nhap de moi (tu quet thu muc goc) ----------
if "%CHECK_ONLY%"=="1" goto after_import

echo [1/8] Nhap de moi vao thu vien...
echo.
if "%WANT_YES%"=="1" (
  node tools\import-exam.js %IMPORT_ARGS% --yes
) else (
  node tools\import-exam.js %IMPORT_ARGS%
)
if errorlevel 1 goto import_failed

:after_import

rem ---------- 2..7. Kiem tra, tang cache, deploy ----------
set "PS_ARGS=-SkipImport"
if "%CHECK_ONLY%"=="1" set "PS_ARGS=%PS_ARGS% -CheckOnly"
if "%NO_DEPLOY%"=="1" set "PS_ARGS=%PS_ARGS% -NoDeploy"
if "%WANT_YES%"=="1" set "PS_ARGS=%PS_ARGS% -Yes"

powershell -NoProfile -ExecutionPolicy Bypass -File "tools\update-and-deploy.ps1" %PS_ARGS%
set "CODE=%ERRORLEVEL%"
goto done

:import_failed
echo.
echo [LOI] Nhap de that bai. Khong kiem tra, khong deploy.
set "CODE=1"
goto done

:done
echo.
if "%CODE%"=="0" (
  echo ============================================================
  echo  XONG
  echo ============================================================
) else (
  echo ============================================================
  echo  [LOI] Ma %CODE% - xem thong bao ben tren.
  echo ============================================================
)

rem Chi pause khi chay bang cach nhap dup, khong pause khi goi tu script khac.
if "%HAS_ARGS%"=="0" pause
exit /b %CODE%
