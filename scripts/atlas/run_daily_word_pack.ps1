$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\")).Path
$Python = "C:\Users\fan\anaconda3\python.exe"
$SourceCommit = "39cfb9672c0906b63569e0453c2e6abfb9ab182a"
$CsvPath = Join-Path $Root ".local\forge\sources\ecdict-$SourceCommit.csv"
$BatchId = "priority-word-pack-{0}" -f (Get-Date -Format "yyyyMMdd")
$BatchDir = Join-Path $Root ".local\forge\batches\$BatchId"
$LogDir = Join-Path $Root ".local\forge\logs"
$LogPath = Join-Path $LogDir ("daily-word-pack-{0}.log" -f (Get-Date -Format "yyyyMMdd"))

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$StartedAt = Get-Date -Format o
"[$StartedAt] Word Atlas daily task started." | Add-Content -LiteralPath $LogPath -Encoding UTF8
Push-Location $Root
try {
    "[$(Get-Date -Format o)] Root: $Root" | Add-Content -LiteralPath $LogPath -Encoding UTF8
    if (-not (Test-Path -LiteralPath $Python)) {
        throw "Python executable not found: $Python"
    }
    if (-not (Test-Path -LiteralPath $CsvPath)) {
        throw "ECDICT source CSV not found: $CsvPath"
    }
    if (Test-Path -LiteralPath (Join-Path $BatchDir "media\install-manifest.json")) {
        "[$(Get-Date -Format o)] Batch $BatchId is already installed; skipping." | Tee-Object -FilePath $LogPath -Append
        return
    }
    & $Python "scripts\atlas\run_word_pack.py" `
        --csv-path $CsvPath `
        --source-commit $SourceCommit `
        --batch-id $BatchId `
        --count 3 `
        --apply 2>&1 | Tee-Object -FilePath $LogPath -Append
    $ExitCode = $LASTEXITCODE
    if ($ExitCode -ne 0) {
        throw "Word Atlas daily pipeline failed with exit code $ExitCode"
    }
    "[$(Get-Date -Format o)] Word Atlas daily task completed successfully." | Add-Content -LiteralPath $LogPath -Encoding UTF8
} catch {
    "[$(Get-Date -Format o)] ERROR: $($_.Exception.Message)" | Add-Content -LiteralPath $LogPath -Encoding UTF8
    exit 1
}
finally {
    Pop-Location
}
