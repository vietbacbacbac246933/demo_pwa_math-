# =====================================================================
# An cac file/thu muc runtime cua web o goc du an de thu muc gon.
#
# CHI doi thuoc tinh Hidden cua Windows. KHONG di chuyen, KHONG xoa,
# KHONG sua noi dung — GitHub Pages, Cloudflare Pages va Service Worker
# van doc dung cac file nay o goc repository.
#
#   powershell -ExecutionPolicy Bypass -File _system/tools/hide-runtime.ps1
#   powershell -ExecutionPolicy Bypass -File _system/tools/hide-runtime.ps1 -Show
#
# -Show: bo thuoc tinh Hidden (hien lai) de kiem tra/sua file.
# =====================================================================

[CmdletBinding()]
param(
  [switch]$Show
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# File/thu muc web phai nam o goc project (GitHub Pages + Cloudflare doc o day).
$targets = @(
  'index.html',
  'teacher.html',
  'manifest.webmanifest',
  'sw.js',
  '_headers',
  '_routes.json',
  'wrangler.jsonc',
  'README.md',
  '.assetsignore',
  '.dev.vars',
  '.dev.vars.example',
  '.gitattributes',
  '.gitignore',
  '.nojekyll',
  'assets',
  'exams',
  'functions',
  'backups',
  '.wrangler',
  'Bai_4'
)

$flag = if ($Show) { '-h' } else { '+h' }
$changed = 0

foreach ($name in $targets) {
  $path = Join-Path $root $name
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $item = Get-Item -LiteralPath $path -Force
  if ($Show) {
    if ($item.Attributes -band [System.IO.FileAttributes]::Hidden) {
      & attrib.exe -h $path | Out-Null
      $changed++
    }
  } else {
    if (-not ($item.Attributes -band [System.IO.FileAttributes]::Hidden)) {
      & attrib.exe +h $path | Out-Null
      $changed++
    }
  }
}

if ($Show) {
  Write-Host ("Da hien lai {0} muc. File web van o goc du an." -f $changed)
} else {
  Write-Host ("Da an {0} muc runtime. Thu muc goc chi con _system\ va Start\." -f $changed)
}
