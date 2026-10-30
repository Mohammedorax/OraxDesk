import { describe, expect, it } from "vitest";
import {
  RUNBOOKS,
  SECRET_PLACEHOLDER,
  composeRunbook,
  runbookDefaults,
  type Runbook,
} from "./runbooks";

function recipe(id: string): Runbook {
  const found = RUNBOOKS.find((r) => r.id === id);
  if (!found) throw new Error(`no recipe named ${id}`);
  return found;
}

/**
 * The composer is the only thing standing between a person and a pasted
 * command, so these tests are about what the command contains and, more
 * importantly, what it must never contain.
 */
describe("composeRunbook", () => {
  it("puts the Office choices into the configuration the ODT is handed", () => {
    const office = recipe("office");
    const values = {
      ...runbookDefaults(office),
      product: "ProPlus2019Volume",
      language: "en-us",
      bitness: "32",
      odtDir: "D:\\Deploy Tools\\odt",
    };
    const result = composeRunbook(office, values);
    if (!result.ok) throw new Error(`refused: ${result.reason} ${result.params.join(",")}`);
    expect(result.command).toContain('OfficeClientEdition="32"');
    expect(result.command).toContain('Channel="PerpetualVL2019"');
    expect(result.command).toContain('Product ID="ProPlus2019Volume"');
    expect(result.command).toContain('Language ID="en-us"');
    expect(result.command).toContain('"D:\\Deploy Tools\\odt\\setup.exe"');
  });

  it("quotes both MSI paths, so a folder with a space stays one argument", () => {
    const msi = recipe("msi");
    const result = composeRunbook(msi, {
      msiPath: "C:\\Install Media\\CRRuntime.msi",
      logPath: "C:\\Install Media\\crystal.log",
    });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.command).toBe(
      'msiexec /i "C:\\Install Media\\CRRuntime.msi" /qn /norestart /l*v "C:\\Install Media\\crystal.log"',
    );
  });

  it("names the SQL instance, features and service account", () => {
    const sql = recipe("sqlserver");
    const result = composeRunbook(sql, {
      ...runbookDefaults(sql),
      instance: "APP01",
      features: "SQLEngine,FullText",
      serviceAccount: "DOMAIN\\sqlsvc",
    });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.command).toContain('INSTANCENAME="APP01"');
    expect(result.command).toContain('FEATURES="SQLEngine,FullText"');
    expect(result.command).toContain('SQLSVCACCOUNT="DOMAIN\\sqlsvc"');
  });

  it("never echoes the sa password into the SQL command", () => {
    const secret = "Sup3r!Secret#42";
    for (const id of ["sqlserver", "restore"]) {
      const runbook = recipe(id);
      const result = composeRunbook(runbook, {
        ...runbookDefaults(runbook),
        password: secret,
      });
      if (!result.ok) throw new Error(`${id} refused: ${result.reason}`);
      expect(result.command, id).not.toContain(secret);
      expect(result.command, id).toContain(SECRET_PLACEHOLDER);
    }
  });

  it("puts the restore paths and database name into both statements", () => {
    const restore = recipe("restore");
    const result = composeRunbook(restore, {
      backupPath: "D:\\Backups\\app.bak",
      databaseName: "app",
      dataDir: "D:\\SQL\\DATA\\",
      password: "unused",
    });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.command).toContain("RESTORE FILELISTONLY FROM DISK='D:\\Backups\\app.bak'");
    expect(result.command).toContain("RESTORE DATABASE [app] FROM DISK='D:\\Backups\\app.bak'");
    expect(result.command).toContain("TO 'D:\\SQL\\DATA\\app.mdf'");
    expect(result.command).toContain("TO 'D:\\SQL\\DATA\\app_log.ldf'");
  });

  it("refuses a blank required parameter instead of composing half a command", () => {
    const msi = recipe("msi");
    const result = composeRunbook(msi, { msiPath: "   ", logPath: "C:\\Temp\\crystal.log" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing");
    expect(result.params).toEqual(["msiPath"]);
    expect(result).not.toHaveProperty("command");
  });

  it("refuses a parameter id the recipe does not have", () => {
    const msi = recipe("msi");
    const result = composeRunbook(msi, {
      ...runbookDefaults(msi),
      msiexecFlags: "/qn",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
    expect(result.params).toEqual(["msiexecFlags"]);
  });

  it("refuses a choice value that is not on the list", () => {
    const sql = recipe("sqlserver");
    const result = composeRunbook(sql, {
      ...runbookDefaults(sql),
      features: "SQLEngine; Remove-Item C:\\ -Recurse",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
    expect(result.params).toEqual(["features"]);
  });

  it("composes the parameter-free preflight without asking for anything", () => {
    const preflight = recipe("preflight");
    expect(preflight.params).toEqual([]);
    const result = composeRunbook(preflight, {});
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.command).toContain("Get-CimInstance Win32_OperatingSystem");
    expect(result.command).toContain("Get-PSDrive C");
  });

  it("does not put the secret parameter in the starting values", () => {
    const sql = recipe("sqlserver");
    expect(runbookDefaults(sql)).not.toHaveProperty("password");
  });

  it("composes every recipe from its own defaults", () => {
    // A default that is blank, or a choice that is not on its own list, would
    // ship a recipe nobody can use; this is the check that keeps the typed
    // data honest without opening the dialog.
    for (const runbook of RUNBOOKS) {
      const result = composeRunbook(runbook, runbookDefaults(runbook));
      expect(result.ok, runbook.id).toBe(true);
      if (result.ok) expect(result.command.trim().length, runbook.id).toBeGreaterThan(0);
    }
  });
});
