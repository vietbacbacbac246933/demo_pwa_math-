# =====================================================================
# Cap nhat de thi va deploy len Cloudflare Pages.
#
#   powershell -ExecutionPolicy Bypass -File _system/tools/update-and-deploy.ps1
#   powershell -ExecutionPolicy Bypass -File _system/tools/update-and-deploy.ps1 -ExamPath "C:\de-moi.html"
#   powershell -ExecutionPolicy Bypass -File _system/tools/update-and-deploy.ps1 -CheckOnly
#
# Cac buoc:
#   1. (tuy chon) Nhap de moi bang _system/tools/import-exam.js
#   2. _system/tools/patch-exams.js       - o lop + hang doi nop bai
#   3. _system/tools/build-exam-data.js   - dap an chuan phia server
#   4. _system/tools/build-cache-manifest.js - hash de de chi tai de thay doi
#   5. _system/tools/check-library.js     - kiem tra danh muc/file de
#   6. _system/tools/test-sw-lazy.js      - chac chan khong tai truoc toan bo de
#   7. _system/tools/test-scoring.js      - doi chieu cham diem client/server
#   8. _system/tools/patch-exams.js --check
#   9. _system/tools/bump-cache-version.js - tang CACHE_VERSION
#  10. _system/tools/deploy-pages.ps1     - chi deploy file tinh da whitelist
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
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
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

  Invoke-Node (@('_system/tools/import-exam.js') + $importArgs)
}

# 2 + 6. patch-exams
Write-Section '2/8 Tich hop o lop + hang doi nop bai'
if ($CheckOnly) {
  Invoke-Node @('_system/tools/patch-exams.js', '--check')
} else {
  Invoke-Node @('_system/tools/patch-exams.js')
}

# 3. build-exam-data
Write-Section '3/8 Cap nhat dap an chuan phia server'
if ($CheckOnly) {
  Invoke-Node @('_system/tools/build-exam-data.js', '--check')
} else {
  Invoke-Node @('_system/tools/build-exam-data.js')
}

# 4. build-cache-manifest
Write-Section '4/8 Cap nhat hash de cho Service Worker'
if ($CheckOnly) {
  Invoke-Node @('_system/tools/build-cache-manifest.js', '--check')
} else {
  Invoke-Node @('_system/tools/build-cache-manifest.js')
}

# 5. check-library
Write-Section '5/9 Kiem tra thu vien de'
Invoke-Node @('_system/tools/check-library.js')

# 6. test-sw-lazy
Write-Section '6/9 Kiem tra cache luoi (khong tai truoc de)'
Invoke-Node @('_system/tools/test-sw-lazy.js')

# 7. test-scoring
Write-Section '7/9 Doi chieu cham diem client/server'
Invoke-Node @('_system/tools/test-scoring.js')

# 8. patch-exams --check
Write-Section '8/9 Xac nhan de da duoc tich hop day du'
Invoke-Node @('_system/tools/patch-exams.js', '--check')

if ($CheckOnly) {
  Write-Host ''
  Write-Host 'CHECK ONLY: da kiem tra xong, khong tang cache, khong deploy.' -ForegroundColor Green
  exit 0
}

# 9. Tang cache version
Write-Section '9/9 Tang CACHE_VERSION de trinh duyet nhan ban moi'
Invoke-Node @('_system/tools/bump-cache-version.js')

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
