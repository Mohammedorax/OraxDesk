# Runbooks: unattended installs over a support session

These are the recipes an agent runs through `dvv_job` on a machine it is
supporting. Each one is a command a person could type; the job wrapper is what
makes it survive the call.

## The shape of every runbook

1. **Preflight** with `dvv_run` (short, waits): OS version, free disk, admin,
   whether the installer is already present. A failed preflight is cheaper than
   a failed install.
2. **Get the media** with `dvv_files`/`dvv_run` (download) — a 3 GB ISO is a
   download, not a job step.
3. **Start the install** with `dvv_job action=start`, `platform=windows`.
4. **Poll** with `dvv_job action=status` (RUNNING or the exit code) and
   `action=log` every 30–60 s. A job that has not finished is not a failure.
5. **Verify** with a short `dvv_run`: the service is running, the version is
   the one that was asked for, the database answers.
6. **Report** what ran, the exit code, and the log path.

The install runs as the signed-in user unless OraxDesk itself is elevated.
Setup programs that need elevation will show UAC and stop; there is no way
around that from a session, and pretending otherwise produces a job that looks
finished and changed nothing.

## Preflight

```powershell
# dvv_run, timeoutMs 20000
$os = Get-CimInstance Win32_OperatingSystem
"$($os.Caption) $($os.Version)"
"disk free GB: {0:N1}" -f ((Get-PSDrive C).Free / 1GB)
"admin: $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator))"
```

## Office (a specific version and language)

The Office Deployment Tool is a free download and needs no account. It installs
whatever the XML names, which is the point: "Office 2021, Arabic, 64-bit" is a
configuration, not a version of setup.exe.

```xml
<!-- configuration.xml -->
<Configuration>
  <Add OfficeClientEdition="64" Channel="PerpetualVL2021">
    <Product ID="ProPlus2021Volume">
      <Language ID="ar-sa" />
    </Product>
  </Add>
  <RemoveMSI />
  <Display Level="None" AcceptEULA="TRUE" />
</Configuration>
```

```powershell
# dvv_run: fetch the ODT and the configuration
Invoke-WebRequest "<odt-url>" -OutFile C:\Temp\odt\odt.exe
Invoke-WebRequest "<configuration-url>" -OutFile C:\Temp\odt\configuration.xml
C:\Temp\odt\odt.exe /extract:C:\Temp\odt /quiet
# dvv_job action=start
C:\Temp\odt\setup.exe /configure C:\Temp\odt\configuration.xml
```

Verify: `Get-ItemProperty "HKLM:\Software\Microsoft\Office\ClickToRun\Configuration"`.

## MSI packages (Crystal Reports runtime and similar)

```powershell
# dvv_job action=start
msiexec /i "C:\Temp\CRRuntime.msi" /qn /norestart /l*v "C:\Temp\crystal.log"
```

The exit code is the installer's own: `0` and `3010` (reboot required) are
success, `1603` is a failure whose reason is in the log.

## SQL Server (2019 or 2022; 2014 is out of support)

```ini
; C:\Temp\sqlconfig.ini
[OPTIONS]
ACTION="Install"
QUIET="True"
IACCEPTSQLSERVERLICENSETERMS="True"
FEATURES="SQLEngine"
INSTANCENAME="MSSQLSERVER"
SQLSVCACCOUNT="NT AUTHORITY\SYSTEM"
SECURITYMODE="SQL"
SAPWD="<strong-password>"
TCPENABLED="1"
UPDATEENABLED="False"
```

```powershell
# dvv_job action=start (after extracting or mounting the ISO)
D:\setup.exe /ConfigurationFile=C:\Temp\sqlconfig.ini
```

Verify: `Get-Service MSSQLSERVER`, then `sqlcmd -S . -Q "SELECT @@VERSION"`.

## Restore a database

```powershell
# dvv_run: read the logical file names first
sqlcmd -S . -U sa -P "<pw>" -Q "RESTORE FILELISTONLY FROM DISK='C:\Temp\db.bak'"
# then restore, moving the files to the instance's data directory
sqlcmd -S . -U sa -P "<pw>" -Q "RESTORE DATABASE [app] FROM DISK='C:\Temp\db.bak' WITH MOVE 'app' TO 'C:\Program Files\Microsoft SQL Server\MSSQL16.MSSQLSERVER\MSSQL\DATA\app.mdf', MOVE 'app_log' TO '...\app_log.ldf', REPLACE"
```

## Job hygiene

- A job runs **detached**: closing the support session does not stop it, and
  `dvv_job action=cancel` is the only way to stop it.
- The log lives on that machine under `%LOCALAPPDATA%\OraxDesk\jobs\`; a job
  whose session ended can still be read if the machine is reachable again.
- Renaming or deleting the job's files under that folder detaches the record
  from its evidence; the plane keeps the handle, the person keeps the files.
- The job table is in memory. Restarting the plane forgets the handles, not the
  work: the log is still there, and so is whatever the installer did.
