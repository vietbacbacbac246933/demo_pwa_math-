param(
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$Destination,
  [int]$MaxEntries = 200,
  [long]$MaxBytes = 83886080
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = [System.IO.Path]::GetFullPath($Destination)
$rootPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$count = 0
$total = 0

$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  foreach ($entry in $zip.Entries) {
    if ([string]::IsNullOrEmpty($entry.Name)) { continue }

    $name = $entry.FullName.Replace('\', '/')
    if ($name.StartsWith('/') -or $name -match '^[A-Za-z]:' -or $name -match '(^|/)\.\.(/|$)') {
      throw "File zip chứa đường dẫn không an toàn: $name"
    }

    $target = [System.IO.Path]::GetFullPath((Join-Path $root $name))
    if (-not $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "File zip nằm ngoài thư mục tạm: $name"
    }

    $count += 1
    $total += $entry.Length
    if ($count -gt $MaxEntries) { throw "File zip có quá nhiều mục (tối đa $MaxEntries)." }
    if ($total -gt $MaxBytes) { throw 'File zip giải nén vượt quá giới hạn dung lượng.' }

    $parent = [System.IO.Path]::GetDirectoryName($target)
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
  }
}
finally {
  $zip.Dispose()
}
