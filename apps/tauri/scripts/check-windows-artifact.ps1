param(
    [Parameter(Mandatory = $true)][string]$Path,
    [ValidateSet(2, 3)][int]$ExpectedSubsystem = 2,
    [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$artifact = Get-Item -LiteralPath $Path
$bytes = [IO.File]::ReadAllBytes($artifact.FullName)
if ($bytes.Length -lt 64 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0x5a4d) {
    throw 'Not a Windows PE executable'
}
$peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
if ($peOffset -lt 0 -or $peOffset -gt $bytes.Length - 94 -or [BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x4550) {
    throw 'Invalid PE header'
}
$machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
$optionalMagic = [BitConverter]::ToUInt16($bytes, $peOffset + 24)
$subsystem = [BitConverter]::ToUInt16($bytes, $peOffset + 92)
$version = $artifact.VersionInfo.ProductVersion
Write-Output ('{0}: Machine=0x{1:X4}, Subsystem={2}, ProductVersion={3}' -f $artifact.FullName, $machine, $subsystem, $version)
if ($machine -ne 0x8664 -or $optionalMagic -ne 0x20b) { throw 'Expected a Windows x64 PE32+ application' }
if ($subsystem -ne $ExpectedSubsystem) { throw "Expected Subsystem=$ExpectedSubsystem, found $subsystem" }
if ($ExpectedVersion -and ($version -ne $ExpectedVersion -or $artifact.VersionInfo.FileVersion -ne $ExpectedVersion)) {
    throw "Expected product/file version $ExpectedVersion, found $version / $($artifact.VersionInfo.FileVersion)"
}
Write-Output 'PASS: Windows artifact matches the expected architecture, subsystem and requested version'
