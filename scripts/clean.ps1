#Requires -Version 7.0
<#
.SYNOPSIS
    Reclaim space under target/ without throwing away the build cache.

.DESCRIPTION
    Two things under target/ grow without bound on a long-lived checkout and
    are worth deleting on their own:

      * target/<profile>/incremental is only useful for the crate being edited
        right now; a build regenerates it, and in this repository it reaches
        several gigabytes within a day of work.
      * the *.pdb files beside every binary and test executable are only read
        by a debugger. Nothing needs them to build or to run tests.

    Everything else — .rlib, .rmeta, the dependency artifacts — is kept, so
    the next build still reuses every crate that did not change.

    Use -All when the disk is already full or after switching toolchains: at
    that point nothing in the cache can be reused, and `cargo clean` semantics
    (delete the whole target/) are the honest answer.

    This is a developer tool, not part of a build. It refuses to guess when
    target/ does not exist, and -WhatIf shows what it would remove.

.PARAMETER Profile
    Which build profile to prune: debug (the default) or release.

.PARAMETER All
    Remove the whole target/ directory, exactly like `cargo clean`. This is
    the only option that removes reusable artifacts.

.EXAMPLE
    ./scripts/clean.ps1
    Frees the incremental cache and debug symbols of the debug profile.

.EXAMPLE
    ./scripts/clean.ps1 -Profile release -WhatIf
    Shows what the release profile would lose, and deletes nothing.

.EXAMPLE
    ./scripts/clean.ps1 -All
    Removes target/ entirely. The next build starts from zero.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('debug', 'release')]
    [string]$Profile = 'debug',

    [switch]$All
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'target'

function Get-SizeBytes([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $sum = (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if ($null -eq $sum) { return 0 }
    return [double]$sum
}

function Format-Gb([double]$Bytes) {
    return '{0:N1} GB' -f ($Bytes / 1GB)
}

if (-not (Test-Path -LiteralPath $target)) {
    Write-Host "nothing to clean: $target does not exist"
    exit 0
}

if ($All) {
    $before = Get-SizeBytes $target
    if ($PSCmdlet.ShouldProcess($target, 'remove the whole build cache')) {
        Remove-Item -LiteralPath $target -Recurse -Force
        Write-Host "removed $target, freed $(Format-Gb $before)"
        Write-Host 'the next build starts from zero'
    }
    exit 0
}

$profileDir = Join-Path $target $Profile
if (-not (Test-Path -LiteralPath $profileDir)) {
    Write-Host "nothing to clean: $profileDir does not exist (has the $Profile profile ever been built?)"
    exit 0
}

$before = Get-SizeBytes $target

$incremental = Join-Path $profileDir 'incremental'
if (Test-Path -LiteralPath $incremental) {
    $size = Get-SizeBytes $incremental
    if ($PSCmdlet.ShouldProcess($incremental, "remove the incremental cache ($(Format-Gb $size))")) {
        Remove-Item -LiteralPath $incremental -Recurse -Force
    }
}
else {
    Write-Verbose "no incremental cache under $profileDir"
}

# `-Filter` rather than `-Include`: with -Recurse, -Include only matches when
# the path ends in a wildcard, which is an easy way to delete nothing at all.
$symbols = @(Get-ChildItem -LiteralPath $profileDir -Recurse -File -Force -Filter '*.pdb' -ErrorAction SilentlyContinue)
if ($symbols.Count -gt 0) {
    $size = ($symbols | Measure-Object -Property Length -Sum).Sum
    if ($PSCmdlet.ShouldProcess("$($symbols.Count) debug symbol files ($(Format-Gb $size))", 'remove')) {
        $symbols | Remove-Item -Force
    }
}
else {
    Write-Verbose "no .pdb files under $profileDir"
}

if ($WhatIfPreference) { exit 0 }

$after = Get-SizeBytes $target
Write-Host "freed $(Format-Gb ($before - $after)) under $target; reusable crate artifacts are kept"
exit 0
