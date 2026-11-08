@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

rem ==================================================================
rem  START.bat - Nhap de moi + kiem tra + commit + push len GitHub Pages
rem
rem  Cach dung:
rem    - ChEp file .html / thu muc export / .zip vao thu muc nay
rem    - Nhap doi START.bat
rem
rem  Tuy chon:
rem    START.bat --dry-run     Chi xem ke hoach, khong sua/commit/push
rem    START.bat --no-push     Import + commit nhung khong push
rem    START.bat --yes         Khong hoi lai, dung mac dinh
rem    START.bat --help        Xem huong dan cua importer
rem ==================================================================

set "NO_PUSH=0"
set "DRY_RUN=0"
set "NO_CONFIRM=0"
set "PAUSE_AT_END=0"
if "%~1"=="" set "PAUSE_AT_END=1"

echo %* | findstr /i /c:"--no-push" >nul && set "NO_PUSH=1"
echo %* | findstr /i /c:"--dry-run" >nul && set "DRY_RUN=1"
echo %* | findstr /i /c:"--yes" >nul && set "NO_CONFIRM=1"

echo %* | findstr /i /c:"--help" >nul && (
  node tools\import-exam.js --help
  exit /b 0
)

echo.
echo ============================================================
echo  THU VIEN DE THI - NHAP DE MOI VA DEPLOY GITHUB PAGES
echo ============================================================
echo.

rem ---------- Kiem tra moi truong ----------
where node >nul 2>nul
if errorlevel 1 goto no_node

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 goto no_git

if "%DRY_RUN%"=="1" goto run_import

for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%B"
if /I not "%BRANCH%"=="main" (
  echo [LOI] Dang o nhanh "%BRANCH%", khong phai "main".
  echo       Chuyen ve main roi chay lai:  git checkout main
  goto failed
)

set "DIRTY_BEFORE=%TEMP%\exam-library-status-before.txt"
rem Chi canh bao thay doi cua file DA theo doi (khong tinh file de moi vua chep vao).
git status --porcelain --untracked-files=no > "%DIRTY_BEFORE%" 2>nul
for %%A in ("%DIRTY_BEFORE%") do if %%~zA GTR 0 (
  echo [CANH BAO] Dang co thay doi chua commit truoc khi import:
  echo.
  type "%DIRTY_BEFORE%"
  echo.
  echo START.bat se commit TAT CA thay doi bang "git add -A".
  if "!NO_CONFIRM!"=="1" (
    echo Tiep tuc vi co --yes.
  ) else (
    set /p "CONTINUE=Tiep tuc? [y/N]: "
    if /I not "!CONTINUE!"=="y" goto cancelled
  )
  echo.
)

rem ---------- 1. Import ----------
:run_import
echo [1/5] Nhap de moi vao thu vien...
echo.
node tools\import-exam.js %*
if errorlevel 2 goto cancelled
if errorlevel 1 goto import_failed

rem ---------- 2. Manifest hash cho Service Worker ----------
echo.
echo [2/5] Cap nhat hash de cho Service Worker...
node tools\build-cache-manifest.js
if errorlevel 1 goto failed

rem ---------- 3. Kiem tra ----------
echo.
echo [3/5] Kiem tra thu vien...
node tools\check-library.js
if errorlevel 1 goto failed

if "%DRY_RUN%"=="1" (
  echo.
  echo DRY RUN: khong commit, khong push.
  goto success
)

rem ---------- 4. Commit ----------
echo.
echo [4/5] Commit thay doi...
git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo Khong co thay doi nao de commit.
  goto success
)

set "NEWFILES="
for /f "delims=" %%F in ('git diff --cached --name-only --diff-filter=AM -- exams/ 2^>nul') do (
  set "NEWFILES=!NEWFILES! %%~nxF"
)
if defined NEWFILES (
  set "MSG=Them de moi vao thu vien:!NEWFILES!"
) else (
  set "MSG=Cap nhat thu vien de thi"
)
git commit -m "!MSG!"
if errorlevel 1 goto failed

rem ---------- 4. Push ----------
if "%NO_PUSH%"=="1" (
  echo.
  echo [5/5] Bo qua push vi co --no-push.
  goto success
)

echo.
echo [5/5] Push len origin main...
git push origin main
if errorlevel 1 goto push_failed

echo.
echo GitHub Pages se tu xuat ban sau 1-2 phut.
echo Mo lai trang va nhan Ctrl+F5 neu trinh duyet con hien ban cu.
goto success

rem ==================================================================
rem  Ket thuc
rem ==================================================================
:success
echo.
echo ============================================================
echo  XONG
echo ============================================================
if "%PAUSE_AT_END%"=="1" pause
exit /b 0

:cancelled
echo.
echo Da huy. Khong commit, khong push.
if "%PAUSE_AT_END%"=="1" pause
exit /b 1

:import_failed
echo.
echo [LOI] Import that bai. Importer da tu dong hoan tac.
echo       Khong commit, khong push.
if "%PAUSE_AT_END%"=="1" pause
exit /b 1

:push_failed
echo.
echo [LOI] Push that bai. Commit da tao tren may nhung chua len GitHub.
echo.
echo Goi y:
echo   git pull --rebase origin main
echo   git push origin main
if "%PAUSE_AT_END%"=="1" pause
exit /b 1

:no_node
echo [LOI] Khong tim thay Node.js.
echo       Tai va cai dat tai: https://nodejs.org/
if "%PAUSE_AT_END%"=="1" pause
exit /b 1

:no_git
echo [LOI] Thu muc nay khong phai git repository.
echo       Hay mo dung thu muc chua file START.bat.
if "%PAUSE_AT_END%"=="1" pause
exit /b 1

:failed
echo.
echo [LOI] Da dung vi buoc kiem tra that bai.
echo       Chua commit, chua push.
if "%PAUSE_AT_END%"=="1" pause
exit /b 1
