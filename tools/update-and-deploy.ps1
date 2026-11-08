# =====================================================================
# Cap nhat de thi va deploy len Cloudflare Pages.
#
#   powershell -ExecutionPolicy Bypass -File tools/update-and-deploy.ps1
#   powershell -ExecutionPolicy Bypass -File tools/update-and-deploy.ps1 -ExamPath "C:\de-moi.html"
#   powershell -ExecutionPolicy Bypass -File tools/update-and-deploy.ps1 -CheckOnly
#
# Cac buoc:
#   1. (tuy chon) Nhap de moi bang tools/import-exam.js
#   2. tools/patch-exams.js       - o lop + hang doi nop bai
#   3. tools/build-exam-data.js   - dap an chuan phia server
#   4. tools/check-library.js     - kiem tra danh muc/file de
#   5. tools/test-scoring.js      - doi chieu cham diem client/server
#   6. tools/patch-exams.js --check
#   7. tools/bump-cache-version.js - tang CACHE_VERSION
#   8. tools/deploy-pages.ps1     - chi deploy file tinh da whitelist
#
# Khong commit, khong push GitHub, khong dung `wrangler pages deploy .`.
# =====================================================================

[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$ExamPath = '',
  [switch]$CheckOnly,
  [switch]$NoDeploy,
  [switch]$Yes,
  [switch]$SkipImport
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-Section([string]$text) {
  Write-Host ''
  Write-Host ('=== ' + $text + ' ===') -ForegroundColor Cyan
}

function Invoke-Node {
  param([string[]]$Arguments)
  Write-Host ('> node ' + ($Arguments -join ' ')) -ForegroundColor DarkGray
  & node @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw ('Lenh that bai (ma ' + $LASTEXITCODE + '): node ' + ($Arguments -join ' '))
  }
}

# 1. Nhap de moi: tu quet file trong thu muc project (giong START.bat).
#    Khi chay qua START-CLOUDFLARE.bat, buoc nay da duoc BAT lam (-SkipImport).
if ($CheckOnly) {
  Write-Host 'CHECK ONLY: bo qua buoc nhap de moi.' -ForegroundColor DarkGray
} elseif ($SkipImport) {
  Write-Host 'Nhap de moi da duoc START-CLOUDFLARE.bat xu ly.' -ForegroundColor DarkGray
} else {
  Write-Section '1/7 Nhap de moi (tu quet file trong thu muc project)'

  $importArgs = @()
  if (-not [string]::IsNullOrWhiteSpace($ExamPath)) {
    if (-not (Test-Path -LiteralPath $ExamPath)) {
      throw ('Khong tim thay file de: ' + $ExamPath)
    }
    $importArgs += $ExamPath
  }
  if ($Yes -and ($importArgs -notcontains '--yes')) {
    $importArgs += '--yes'
  }

  Invoke-Node (@('tools/import-exam.js') + $importArgs)
}

# 2 + 6. patch-exams
Write-Section '2/7 Tich hop o lop + hang doi nop bai'
if ($CheckOnly) {
  Invoke-Node @('tools/patch-exams.js', '--check')
} else {
  Invoke-Node @('tools/patch-exams.js')
}

# 3. build-exam-data
Write-Section '3/7 Cap nhat dap an chuan phia server'
if ($CheckOnly) {
  Invoke-Node @('tools/build-exam-data.js', '--check')
} else {
  Invoke-Node @('tools/build-exam-data.js')
}

# 4. check-library
Write-Section '4/7 Kiem tra thu vien de'
Invoke-Node @('tools/check-library.js')

# 5. test-scoring
Write-Section '5/7 Doi chieu cham diem client/server'
Invoke-Node @('tools/test-scoring.js')

# 6. patch-exams --check
Write-Section '6/7 Xac nhan de da duoc tich hop day du'
Invoke-Node @('tools/patch-exams.js', '--check')

if ($CheckOnly) {
  Write-Host ''
  Write-Host 'CHECK ONLY: da kiem tra xong, khong tang cache, khong deploy.' -ForegroundColor Green
  exit 0
}

# 7. Tang cache version
Write-Section '7/7 Tang CACHE_VERSION de trinh duyet nhan ban moi'
Invoke-Node @('tools/bump-cache-version.js')

if ($NoDeploy) {
  Write-Host ''
  Write-Host 'NO-DEPLOY: da chuan bi xong, chua deploy len Cloudflare.' -ForegroundColor Yellow
  Write-Host 'Chay lai khong co -NoDeploy de deploy.' -ForegroundColor Yellow
  exit 0
}

if (-not $Yes) {
  Write-Host ''
  $confirm = Read-Host 'Deploy len https://de-toan-thpt.pages.dev ngay? [y/N]'
  if ($confirm -notmatch '^(?i)y') {
    Write-Host 'Da huy deploy. Cac thay doi van nam tren may.' -ForegroundColor Yellow
    exit 0
  }
}

Write-Section 'Deploy len Cloudflare Pages'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'deploy-pages.ps1')
if ($LASTEXITCODE -ne 0) {
  throw ('Deploy that bai (ma ' + $LASTEXITCODE + ').')
}

Write-Host ''
Write-Host 'Kiem tra nhanh API...' -ForegroundColor DarkGray
& node -e "fetch('https://de-toan-thpt.pages.dev/api/health').then(r=>r.text()).then(t=>console.log('health:', t)).catch(e=>console.log('health check loi:', e.message))"

Write-Host ''
Write-Host 'XONG: da cap nhat de va deploy len https://de-toan-thpt.pages.dev/' -ForegroundColor Green
Write-Host 'Mo trang online mot lan de Service Worker tai ban moi.' -ForegroundColor Green
