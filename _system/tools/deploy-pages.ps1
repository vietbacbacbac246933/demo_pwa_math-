# =====================================================================
# Deploy an toàn lên Cloudflare Pages.
#
#   powershell -ExecutionPolicy Bypass -File _system/tools/deploy-pages.ps1
#
# Vì sao cần script này:
#   `wrangler pages deploy .` upload TOÀN BỘ thư mục hiện tại và KHÔNG đọc
#   `.assetsignore`. Làm vậy sẽ đưa `.dev.vars`, `backups/`, `_system/tools/`,
#   `migrations/`, `docs/`... lên web công khai.
#
# Script chỉ copy đúng các file tĩnh cần thiết sang một thư mục tạm, kiểm tra
# lại danh sách file, rồi mới deploy. Thư mục `functions/` vẫn được Wrangler
# đọc từ thư mục gốc project (không copy vào phần tĩnh).
# =====================================================================

[CmdletBinding()]
param(
  # Ten project tren Cloudflare Pages (da doi tu "de-toan-thpt" thanh
  # "openexam"; domain van la de-toan-thpt.pages.dev).
  [string]$ProjectName = 'openexam',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stage = Join-Path $env:TEMP 'de-toan-thpt-dist'

if (Test-Path $stage) {
  Remove-Item $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null

# Sinh lai manifest hash ngay truoc khi deploy. Buoc nay bao dam du chay
# deploy-pages.ps1 mot minh (khong qua update-and-deploy.ps1), Service Worker
# van thay dung hash cua tung de.
Push-Location $root
try {
  & node _system/tools/build-cache-manifest.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Khong sinh duoc assets/js/exam-revs.js.'
  }
}
finally {
  Pop-Location
}

# Chỉ những file/thư mục này được phép lên phần tĩnh.
$publicFiles = @(
  'index.html',
  'teacher.html',
  'sw.js',
  'manifest.webmanifest',
  '_headers',
  '_routes.json',
  '.nojekyll'
)
$publicDirs = @('assets', 'exams')

foreach ($name in $publicFiles) {
  $src = Join-Path $root $name
  if (-not (Test-Path $src)) {
    throw "Thiếu file bắt buộc: $name"
  }
  Copy-Item $src (Join-Path $stage $name)
}

foreach ($name in $publicDirs) {
  $src = Join-Path $root $name
  if (-not (Test-Path $src)) {
    throw "Thiếu thư mục bắt buộc: $name"
  }
  Copy-Item $src (Join-Path $stage $name) -Recurse
}

# File web ở gốc đang mang thuộc tính Hidden (để thư mục gọn). Copy-Item giữ
# nguyên thuộc tính đó, nên phải bỏ đi trong thư mục tạm: nếu không, các bước
# kiểm tra bên dưới và Wrangler có thể bỏ qua file ẩn.
Get-ChildItem $stage -Recurse -Force | ForEach-Object {
  if ($_.Attributes -band [System.IO.FileAttributes]::Hidden) {
    $_.Attributes = $_.Attributes -band (-bnot [System.IO.FileAttributes]::Hidden)
  }
}

# Kiểm tra an toàn: không cho file lạ, file ẩn hoặc đuôi file không mong muốn.
$allowedExtensions = @('', '.html', '.css', '.js', '.json', '.webmanifest', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp')
$files = @(Get-ChildItem $stage -Recurse -File -Force)

$unexpected = @($files | Where-Object {
  if ($_.Name -eq '.nojekyll') { return $false }
  $ext = $_.Extension.ToLowerInvariant()
  ($allowedExtensions -notcontains $ext) -or $_.Name.StartsWith('.')
})
if ($unexpected.Count -gt 0) {
  $list = ($unexpected | ForEach-Object { $_.FullName }) -join [Environment]::NewLine
  throw "Phát hiện file không được phép deploy:`n$list"
}

# Chặn thêm các tên nhạy cảm dù nằm trong thư mục công khai.
$secretPattern = '(?i)(\.dev\.vars|secret|password|cloudflare-secrets|\.env$)'
$suspicious = @($files | Where-Object { $_.Name -match $secretPattern })
if ($suspicious.Count -gt 0) {
  $list = ($suspicious | ForEach-Object { $_.FullName }) -join [Environment]::NewLine
  throw "Phát hiện file có tên nhạy cảm:`n$list"
}

Write-Host ("Sẽ deploy {0} file tĩnh từ: {1}" -f $files.Count, $stage)
$files | ForEach-Object {
  Write-Host ("  " + $_.FullName.Substring($stage.Length + 1))
}

Push-Location $root
try {
  # Dùng Wrangler đã có trên máy (project, PATH hoặc cache npx) thay vì
  # luôn gọi `npx wrangler` để tránh tự tải/nâng cấp ngoài ý muốn.
  & node _system/tools/helper/wrangler-exec.js pages deploy $stage --project-name $ProjectName --branch $Branch --commit-dirty=true
  if ($LASTEXITCODE -ne 0) {
    throw "Wrangler deploy thất bại (mã $LASTEXITCODE)."
  }
}
finally {
  Pop-Location
}
