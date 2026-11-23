param(
    [Parameter(Mandatory=$true)][string]$NsisCompiler,
    [Parameter(Mandatory=$true)][string]$OutputRoot
)
$ErrorActionPreference = 'Stop'
$caseId = [Guid]::NewGuid().ToString('N')
$caseRoot = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) $caseId
New-Item -ItemType Directory -Force $caseRoot | Out-Null
$hookPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src-tauri/nsis/installer-hooks.nsh'))
$fixturePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/rename-installer.nsi'))
$registryPath = "HKCU:\Software\fromd-agent-tests\$caseId"
try {
    & $NsisCompiler /V2 "/DFROMD_TEST_ROOT=$caseRoot" "/DFROMD_TEST_ID=$caseId" "/DFROMD_HOOKS=$hookPath" $fixturePath
    if ($LASTEXITCODE -ne 0) { throw "NSIS fixture compilation failed: $LASTEXITCODE" }
    $probe = Start-Process -FilePath (Join-Path $caseRoot 'probe-rename.exe') -Wait -PassThru
    if ($probe.ExitCode -ne 0) { throw "NSIS rename regression failed: $($probe.ExitCode)" }
    $result = [IO.File]::ReadAllText((Join-Path $caseRoot 'result.txt'))
    if (-not $result.StartsWith('PASS:')) { throw "Unexpected regression result: $result" }
    Write-Output $result
    Write-Output "Evidence: $caseRoot"
} finally {
    # Only this invocation's isolated key; production registrations/shortcuts are never changed.
    if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
}
