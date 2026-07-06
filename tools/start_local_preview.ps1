param(
    [int]$Port = 5000
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WorkspaceRoot = Resolve-Path (Join-Path $ProjectRoot "..")
$Python = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$Deps = Join-Path $WorkspaceRoot ".tmp_pydeps_hydrocore31"
$Launcher = Join-Path $ProjectRoot "dev_local_preview.py"
$LogDir = Join-Path $ProjectRoot "logs"
$OutLog = Join-Path $LogDir "local_preview.out.log"
$ErrLog = Join-Path $LogDir "local_preview.err.log"

New-Item -ItemType Directory -Force $LogDir | Out-Null

if (-not (Test-Path $Python)) {
    throw "Bundled Python not found: $Python"
}

if (-not (Test-Path $Deps)) {
    throw "Python dependencies not found: $Deps"
}

if (-not (Test-Path $Launcher)) {
    throw "Local preview launcher not found: $Launcher"
}

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($process -and $process.Path -eq $Python) {
        Stop-Process -Id $process.Id -Force
    }
}

$processInfo = [System.Diagnostics.ProcessStartInfo]::new()
$processInfo.FileName = $env:ComSpec
$processInfo.WorkingDirectory = $ProjectRoot
$processInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$processInfo.UseShellExecute = $false
$processInfo.RedirectStandardOutput = $false
$processInfo.RedirectStandardError = $false
$processInfo.CreateNoWindow = $true
$processInfo.Arguments = "/d /c `"`"$Python`" `"$Launcher`" > `"$OutLog`" 2> `"$ErrLog`"`""

$cleanEnv = @{}
foreach ($entry in [System.Environment]::GetEnvironmentVariables().GetEnumerator()) {
    $cleanEnv[$entry.Key.ToString().ToUpperInvariant()] = @{
        Name = $entry.Key.ToString()
        Value = $entry.Value.ToString()
    }
}

$targetEnv = $processInfo.Environment
if ($null -eq $targetEnv) {
    $targetEnv = $processInfo.EnvironmentVariables
}

$targetEnv.Clear()
foreach ($entry in $cleanEnv.Values) {
    $targetEnv[$entry.Name] = $entry.Value
}

$proc = [System.Diagnostics.Process]::new()
$proc.StartInfo = $processInfo
[void]$proc.Start()

$url = "http://127.0.0.1:$Port/ui/"
$deadline = (Get-Date).AddSeconds(10)
$ok = $false

while ((Get-Date) -lt $deadline) {
    try {
        $status = (Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 2).StatusCode
        if ($status -eq 200) {
            $ok = $true
            break
        }
    } catch {
        Start-Sleep -Milliseconds 500
    }
}

if (-not $ok) {
    $err = ""
    if (Test-Path $ErrLog) {
        $err = Get-Content -Raw $ErrLog
    }
    throw "Local preview did not become healthy at $url. ProcessId=$($proc.Id). Error log: $err"
}

[pscustomobject]@{
    Ok = $true
    Url = $url
    ProcessId = $proc.Id
    Stdout = $OutLog
    Stderr = $ErrLog
}
