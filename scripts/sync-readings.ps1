param(
  [string]$Source = "https://0xlei.tech/words/atlas/extras/readings",
  [string]$Destination = (Join-Path $PSScriptRoot "..\.local\readings"),
  [ValidateRange(1, 32)]
  [int]$ThrottleLimit = 16
)

$ErrorActionPreference = "Stop"
$destinationPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null

$indexPath = Join-Path $destinationPath "index.json"
& curl.exe --silent --show-error --fail --location --ssl-no-revoke --retry 6 --retry-all-errors --retry-delay 1 --output $indexPath "$Source/index.json"
if ($LASTEXITCODE -ne 0) { throw "Reading index download failed." }

$index = Get-Content -Raw -Encoding UTF8 -LiteralPath $indexPath | ConvertFrom-Json
$ids = @($index.items | ForEach-Object {
  $id = [string]$_.id
  if ($id -notmatch '^[A-Za-z0-9._-]{1,100}$') { throw "Reading index contains an invalid ID." }
  $id
})

$failed = @($ids | ForEach-Object -Parallel {
  $id = $_
  $url = "$using:Source/$id.json"
  $output = Join-Path $using:destinationPath "$id.json"
  if (Test-Path -LiteralPath $output) { return }
  $temporary = "$output.part"
  $ErrorActionPreference = "Continue"
  $PSNativeCommandUseErrorActionPreference = $false
  & curl.exe --silent --show-error --fail --location --ssl-no-revoke --retry 6 --retry-all-errors --retry-delay 1 --output $temporary $url 2>&1 | Out-Null
  $curlExitCode = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($curlExitCode -ne 0) {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    Write-Output $id
    return
  }
  Move-Item -LiteralPath $temporary -Destination $output -Force
} -ThrottleLimit $ThrottleLimit)

if ($failed.Count -gt 0) {
  Write-Warning "$($failed.Count) articles could not be downloaded. Run this command again to resume."
  exit 2
}

Write-Output "Cached $($ids.Count) reading articles in $destinationPath"

