# Load the MSVC x64 build environment into this shell, then optionally run one command in it.
#
# Why this exists: `cargo check` never links, so a Windows machine can look
# healthy for weeks while `cargo test` fails everywhere with
#
#   LINK : fatal error LNK1104: cannot open file 'msvcrt.lib'
#
# That error is not a broken rustc and it is not a missing crate. It is a
# `link.exe` found on PATH (from an installer that put its own bin directory
# there) with no `LIB` beside it, so the linker cannot find the C runtime. The
# fix is `vcvars64.bat`, and the reason this script exists rather than a line
# in the README is that `vcvars64.bat` only survives inside the `cmd` it ran
# in. Every new `pwsh` starts with an empty `LIB`.
#
#   . .\scripts\env-setup.ps1                      # dot-source: env lands in this shell
#   .\scripts\env-setup.ps1 -Command 'cargo test'  # set the env, run one command, exit with its code
#   .\scripts\env-setup.ps1 -Check                 # which toolchain, and is it complete?
#
# The script does not trust an installation it is pointed at. It looks for the
# one file whose absence is the failure above, `lib\x64\msvcrt.lib`, and
# refuses an installation that lacks it: a VS "Insiders" preview with only the
# compiler installed is exactly the state that produced LNK1104 here, and
# picking it because it sorts first would keep the failure and hide the cause.
#
# Nothing here writes outside the process: no registry, no persisted env, no
# machine state. Run it again in a new shell and it picks the same toolchain
# for the same reason.

[CmdletBinding()]
param(
    # A VS installation to use. Skipped if it has no complete x64 toolchain.
    [string] $VsInstall,

    # Run this command with the loaded environment. `cmd /c` executes it, so
    # `&&`, `>` and quotes behave as they do in a terminal.
    [string] $Command,

    # Report the toolchain that would be used and whether it can link, then
    # stop. Exit 1 when no complete toolchain exists.
    [switch] $Check
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# The one file every Windows x64 link needs. `lib\onecore\x64` is a different
# API set and does not satisfy an ordinary desktop link, so only the plain
# path counts.
$requiredLib = 'lib\x64\msvcrt.lib'

function Get-VsInstallCandidates {
    # vswhere is the supported way to ask, and it is also the only way that
    # sees Build Tools, which is what CI and most build agents install.
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere) {
        $found = & $vswhere -all -products * -property installationPath 2>$null
        foreach ($path in $found) {
            if ($path) { $path }
        }
    }

    # A machine can have VS on another drive with no vswhere record (a moved
    # or copied installation, which is common on build VMs). Look where the
    # installer puts it by default, on every drive that has a Visual Studio
    # directory, rather than assuming C:.
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $root) { continue }
        $vs = Join-Path $root 'Microsoft Visual Studio'
        if (-not (Test-Path -LiteralPath $vs)) { continue }
        Get-ChildItem -LiteralPath $vs -Directory -ErrorAction SilentlyContinue |
            ForEach-Object {
                Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue |
                    ForEach-Object { $_.FullName }
            }
    }
    foreach ($drive in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
        $vs = Join-Path $drive.Root 'Program Files\Microsoft Visual Studio'
        if (-not (Test-Path -LiteralPath $vs)) { continue }
        Get-ChildItem -LiteralPath $vs -Directory -ErrorAction SilentlyContinue |
            ForEach-Object {
                Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue |
                    ForEach-Object { $_.FullName }
            }
    }
}

function Test-VsInstall {
    <#
        A usable installation is one whose vcvars64.bat exists AND whose newest
        MSVC toolset carries the CRT import library. Both halves matter: the
        batch file alone is what a compiler-only preview ships.
    #>
    param([Parameter(Mandatory)][string] $Path)

    $vcvars = Join-Path $Path 'VC\Auxiliary\Build\vcvars64.bat'
    if (-not (Test-Path -LiteralPath $vcvars)) { return $null }

    $toolsRoot = Join-Path $Path 'VC\Tools\MSVC'
    if (-not (Test-Path -LiteralPath $toolsRoot)) { return $null }
    $toolset = Get-ChildItem -LiteralPath $toolsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $requiredLib) } |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $toolset) { return $null }

    [pscustomobject]@{
        Path    = $Path
        VcVars  = $vcvars
        Toolset = $toolset.Name
        Crt     = Join-Path $toolset.FullName $requiredLib
    }
}

function Select-VsInstall {
    param([string] $Preferred)

    # An explicit path is a request, not a hint: if it cannot link, say so
    # instead of silently building with something else. A build that quietly
    # used a different compiler than the one asked for is a result nobody can
    # reproduce.
    if ($Preferred) {
        $resolved = Test-VsInstall -Path $Preferred
        if (-not $resolved) {
            throw "'$Preferred' has no complete x64 toolchain (missing VC\Auxiliary\Build\vcvars64.bat or $requiredLib). Point -VsInstall at an installation with the MSVC x64 build tools and the Windows SDK."
        }
        return $resolved
    }

    $seen = @{}
    foreach ($candidate in (Get-VsInstallCandidates)) {
        # Normalise before de-duplicating: vswhere and the directory scan
        # name the same installation with different trailing separators.
        $path = $candidate.TrimEnd('\', '/')
        if (-not $path -or $seen.ContainsKey($path.ToLowerInvariant())) { continue }
        $seen[$path.ToLowerInvariant()] = $true
        $resolved = Test-VsInstall -Path $path
        if ($resolved) { return $resolved }
    }
    return $null
}

function Set-BuildEnvironment {
    <#
        Run vcvars64.bat, capture the environment it produced and copy it into
        this process. Capturing through `set` rather than re-implementing what
        the batch file does is deliberate: the SDK selection, the UCRT
        version and the toolset paths are Microsoft's to decide, and a copy of
        that logic here would drift on the next SDK install.
    #>
    param([Parameter(Mandatory)][string] $VcVars)

    $lines = & cmd.exe /d /s /c "call `"$VcVars`" >nul 2>&1 && set"
    if ($LASTEXITCODE -ne 0) {
        throw "vcvars64.bat failed with exit code $LASTEXITCODE ($VcVars)."
    }

    $applied = 0
    foreach ($line in $lines) {
        $at = $line.IndexOf('=')
        if ($at -le 0) { continue }
        $name = $line.Substring(0, $at)
        $value = $line.Substring($at + 1)
        # `set` also prints pseudo-variables such as `=C:=C:\path`; their name
        # starts with `=`, which the index check above already rejected.
        Set-Item -Path "Env:$name" -Value $value
        $applied++
    }
    if ($applied -eq 0) {
        throw "vcvars64.bat ran but produced no environment ($VcVars)."
    }
}

function Test-CrtOnLibPath {
    # The failure this script exists for is `LIB` without the CRT directory on
    # it, so check the variable the linker actually reads rather than trusting
    # that the batch file said so.
    $lib = $env:LIB
    if (-not $lib) { return $false }
    foreach ($dir in $lib.Split(';')) {
        if (-not $dir) { continue }
        if (Test-Path -LiteralPath (Join-Path $dir 'msvcrt.lib')) { return $true }
    }
    return $false
}

$install = $null
$selectionError = $null
try {
    $install = Select-VsInstall -Preferred $VsInstall
} catch {
    $selectionError = $_.Exception.Message
}
if (-not $install) {
    if (-not $selectionError) {
        $selectionError = 'No Visual Studio installation with a complete x64 toolchain was found. Install the "Desktop development with C++" workload (MSVC v143 x64 build tools and a Windows 10/11 SDK), then run this script again.'
    }
    # `-Check` is the mode a caller uses to gate a build, so it answers with an
    # exit code rather than a terminating error the caller has to catch.
    if ($Check) {
        Write-Output "NOT USABLE: $selectionError"
        exit 1
    }
    throw $selectionError
}

if ($Check) {
    Write-Output "Visual Studio : $($install.Path)"
    Write-Output "Toolset       : $($install.Toolset)"
    Write-Output "C runtime     : $($install.Crt)"
    exit 0
}

# Already loaded: vcvars is idempotent but re-running it resets `PATH` order,
# which can undo a caller's own prepend.
if (-not (Test-CrtOnLibPath)) {
    Set-BuildEnvironment -VcVars $install.VcVars
}

if (-not (Test-CrtOnLibPath)) {
    Write-Error "vcvars64.bat ran from $($install.Path) but no directory on LIB contains msvcrt.lib. Linking will fail with LNK1104; install the Windows SDK component for that toolset."
    return
}

if ($Command) {
    # `cmd /c` so the caller can use `&&`, redirection and quotes. The exit
    # code is returned unchanged: this script is a wrapper, and a wrapper that
    # reports success for a failed test run is worse than no wrapper.
    & cmd.exe /d /s /c $Command
    exit $LASTEXITCODE
}

Write-Verbose "MSVC $($install.Toolset) from $($install.Path) is loaded; LIB has the C runtime."
