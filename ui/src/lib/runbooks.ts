import type { MessageKey } from "./i18n";

/**
 * The recipes in `docs/RUNBOOKS.md`, as data rather than JSX.
 *
 * WHY THEY LIVE HERE. The webview cannot run a remote command: the job runner
 * (`dvv_job`) belongs to the agent process, and the browser has no route to it.
 * So the one honest thing this screen can do is compose the exact command a
 * person or an agent would run, and hand it over. Keeping the composition in a
 * plain module means the quoting rules and the refusal on an incomplete recipe
 * are testable, instead of being a template buried in a component.
 *
 * THE PASSWORD RULE. A parameter flagged `secret` is never asked for in the
 * dialog, never stored, and its value is replaced with {@link SECRET_PLACEHOLDER}
 * before any recipe builder sees it. That is a property of the composer, not a
 * promise each builder keeps on its own: a builder cannot leak what it is
 * never given.
 */

/** What stands where a password belongs. Obvious enough to be edited by hand. */
export const SECRET_PLACEHOLDER = "<password>";

export interface RunbookChoice {
  value: string;
  labelKey: MessageKey;
}

export interface RunbookParam {
  id: string;
  labelKey: MessageKey;
  kind: "text" | "path" | "choice";
  /** A required parameter left blank refuses the whole recipe. */
  required: boolean;
  defaultValue?: string;
  choices?: RunbookChoice[];
  /** Never rendered as an input, and never echoed into the command. */
  secret?: boolean;
}

export interface Runbook {
  id: string;
  nameKey: MessageKey;
  purposeKey: MessageKey;
  /** Where the recipe needs UAC, and what happens when it appears. */
  elevationKey: MessageKey;
  /** A caveat that would otherwise make a correct command fail. */
  noteKey?: MessageKey;
  params: RunbookParam[];
  build: (values: Readonly<Record<string, string>>) => string;
}

export type ComposeRefusal =
  | { ok: false; reason: "unknown"; params: string[] }
  | { ok: false; reason: "missing"; params: string[] }
  | { ok: false; reason: "invalid"; params: string[] };

export type ComposeResult = { ok: true; command: string } | ComposeRefusal;

/**
 * Quote a Windows path for cmd or PowerShell, and leave an ordinary one alone.
 *
 * A path with spaces is the common case on a server ("Program Files"), and an
 * unquoted one turns into two arguments. A double quote is not legal in a
 * Windows file name anyway, so stripping one cannot change which file is meant.
 */
function winPath(value: string): string {
  const trimmed = value.trim().replace(/^"(.*)"$/, "$1").replace(/"/g, "");
  if (trimmed === "") return '""';
  return /[\s&|<>^]/.test(trimmed) ? `"${trimmed}"` : trimmed;
}

function joinWindows(dir: string, name: string): string {
  return `${dir.trim().replace(/[\\/]+$/, "")}\\${name}`;
}

/** An INI value is quoted with double quotes; the value itself cannot hold one. */
function iniValue(value: string): string {
  return value.trim().replace(/"/g, "");
}

/** A SQL string literal doubles its own quote. */
function sqlLiteral(value: string): string {
  return value.trim().replace(/'/g, "''");
}

/** A bracketed SQL identifier doubles its closing bracket. */
function sqlIdentifier(value: string): string {
  return value.trim().replace(/]/g, "]]");
}

/**
 * Channel per product id. The id selects what is installed; the channel selects
 * which servicing stream it belongs to, and the two must agree or the ODT
 * refuses the configuration.
 */
const OFFICE_CHANNELS: Readonly<Record<string, string>> = {
  ProPlus2021Volume: "PerpetualVL2021",
  ProPlus2019Volume: "PerpetualVL2019",
  O365ProPlusRetail: "Current",
};

function officeCommand(v: Readonly<Record<string, string>>): string {
  const odtDir = winPath(v.odtDir);
  const configuration = winPath(joinWindows(v.odtDir, "configuration.xml"));
  const setup = winPath(joinWindows(v.odtDir, "setup.exe"));
  const channel = OFFICE_CHANNELS[v.product] ?? "Current";
  // A here-string, not string concatenation: the XML keeps its own quotes and
  // the person can read exactly what the ODT is about to be handed.
  return [
    "$configuration = @'",
    "<Configuration>",
    `  <Add OfficeClientEdition="${v.bitness}" Channel="${channel}">`,
    `    <Product ID="${v.product}">`,
    `      <Language ID="${v.language}" />`,
    "    </Product>",
    "  </Add>",
    "  <RemoveMSI />",
    '  <Display Level="None" AcceptEULA="TRUE" />',
    "</Configuration>",
    "'@",
    `New-Item -ItemType Directory -Force ${odtDir} | Out-Null`,
    `Set-Content -Path ${configuration} -Value $configuration -Encoding UTF8`,
    `& ${setup} /configure ${configuration}`,
  ].join("\n");
}

function msiCommand(v: Readonly<Record<string, string>>): string {
  return `msiexec /i ${winPath(v.msiPath)} /qn /norestart /l*v ${winPath(v.logPath)}`;
}

function sqlCommand(v: Readonly<Record<string, string>>): string {
  const iniPath = winPath("C:\\Temp\\sqlconfig.ini");
  // `v.password` is already the placeholder. The composer put it there; this
  // builder has never seen the secret and has nothing it could print.
  const ini = [
    "[OPTIONS]",
    'ACTION="Install"',
    'QUIET="True"',
    'IACCEPTSQLSERVERLICENSETERMS="True"',
    `FEATURES="${iniValue(v.features)}"`,
    `INSTANCENAME="${iniValue(v.instance)}"`,
    `SQLSVCACCOUNT="${iniValue(v.serviceAccount)}"`,
    'SECURITYMODE="SQL"',
    `SAPWD="${iniValue(v.password)}"`,
    'TCPENABLED="1"',
    'UPDATEENABLED="False"',
  ];
  return [
    "$ini = @'",
    ...ini,
    "'@",
    `Set-Content -Path ${iniPath} -Value $ini -Encoding UTF8`,
    `& ${winPath(v.setupPath)} /ConfigurationFile=${iniPath}`,
  ].join("\n");
}

function restoreCommand(v: Readonly<Record<string, string>>): string {
  const backup = sqlLiteral(v.backupPath);
  const database = sqlIdentifier(v.databaseName);
  const dataDir = sqlLiteral(v.dataDir.trim().replace(/[\\/]+$/, ""));
  // Placeholder again, for the same reason as the installer above.
  const password = v.password;
  // Two commands on purpose: the logical file names are whatever the backup
  // was taken from, and guessing them is how a restore fails halfway.
  return [
    `sqlcmd -S . -U sa -P "${password}" -Q "RESTORE FILELISTONLY FROM DISK='${backup}'"`,
    `sqlcmd -S . -U sa -P "${password}" -Q "RESTORE DATABASE [${database}] FROM DISK='${backup}' WITH MOVE '${database}' TO '${dataDir}\\${database}.mdf', MOVE '${database}_log' TO '${dataDir}\\${database}_log.ldf', REPLACE"`,
  ].join("\n");
}

const SQL_PASSWORD: RunbookParam = {
  id: "password",
  labelKey: "runbooks.param.sqlPassword",
  kind: "text",
  required: false,
  secret: true,
};

/**
 * The order is the order of the document, because that is the order somebody
 * actually works in: look first, install second, restore last.
 */
export const RUNBOOKS: readonly Runbook[] = [
  {
    id: "preflight",
    nameKey: "runbooks.preflight.name",
    purposeKey: "runbooks.preflight.purpose",
    elevationKey: "runbooks.preflight.elevation",
    params: [],
    build: () =>
      [
        "$os = Get-CimInstance Win32_OperatingSystem",
        '"$($os.Caption) $($os.Version)"',
        '"disk free GB: {0:N1}" -f ((Get-PSDrive C).Free / 1GB)',
        '"admin: $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator))"',
      ].join("\n"),
  },
  {
    id: "office",
    nameKey: "runbooks.office.name",
    purposeKey: "runbooks.office.purpose",
    elevationKey: "runbooks.office.elevation",
    noteKey: "runbooks.office.note",
    params: [
      {
        id: "product",
        labelKey: "runbooks.param.officeProduct",
        kind: "choice",
        required: true,
        defaultValue: "ProPlus2021Volume",
        choices: [
          { value: "ProPlus2021Volume", labelKey: "runbooks.choice.office2021" },
          { value: "ProPlus2019Volume", labelKey: "runbooks.choice.office2019" },
          { value: "O365ProPlusRetail", labelKey: "runbooks.choice.office365" },
        ],
      },
      {
        id: "language",
        labelKey: "runbooks.param.officeLanguage",
        kind: "choice",
        required: true,
        defaultValue: "ar-sa",
        choices: [
          { value: "ar-sa", labelKey: "runbooks.choice.langAr" },
          { value: "en-us", labelKey: "runbooks.choice.langEn" },
          { value: "fr-fr", labelKey: "runbooks.choice.langFr" },
        ],
      },
      {
        id: "bitness",
        labelKey: "runbooks.param.officeBitness",
        kind: "choice",
        required: true,
        defaultValue: "64",
        choices: [
          { value: "64", labelKey: "runbooks.choice.bit64" },
          { value: "32", labelKey: "runbooks.choice.bit32" },
        ],
      },
      {
        id: "odtDir",
        labelKey: "runbooks.param.officeDir",
        kind: "path",
        required: true,
        defaultValue: "C:\\Temp\\odt",
      },
    ],
    build: officeCommand,
  },
  {
    id: "msi",
    nameKey: "runbooks.msi.name",
    purposeKey: "runbooks.msi.purpose",
    elevationKey: "runbooks.msi.elevation",
    noteKey: "runbooks.msi.note",
    params: [
      {
        id: "msiPath",
        labelKey: "runbooks.param.msiPath",
        kind: "path",
        required: true,
        defaultValue: "C:\\Temp\\CRRuntime.msi",
      },
      {
        id: "logPath",
        labelKey: "runbooks.param.msiLog",
        kind: "path",
        required: true,
        defaultValue: "C:\\Temp\\crystal.log",
      },
    ],
    build: msiCommand,
  },
  {
    id: "sqlserver",
    nameKey: "runbooks.sql.name",
    purposeKey: "runbooks.sql.purpose",
    elevationKey: "runbooks.sql.elevation",
    noteKey: "runbooks.sql.note",
    params: [
      {
        id: "setupPath",
        labelKey: "runbooks.param.sqlSetup",
        kind: "path",
        required: true,
        defaultValue: "D:\\setup.exe",
      },
      {
        id: "instance",
        labelKey: "runbooks.param.sqlInstance",
        kind: "text",
        required: true,
        defaultValue: "MSSQLSERVER",
      },
      {
        id: "features",
        labelKey: "runbooks.param.sqlFeatures",
        kind: "choice",
        required: true,
        defaultValue: "SQLEngine",
        choices: [
          { value: "SQLEngine", labelKey: "runbooks.choice.sqlEngine" },
          { value: "SQLEngine,FullText", labelKey: "runbooks.choice.sqlFullText" },
          { value: "SQLEngine,Replication", labelKey: "runbooks.choice.sqlReplication" },
        ],
      },
      {
        id: "serviceAccount",
        labelKey: "runbooks.param.sqlService",
        kind: "text",
        required: true,
        defaultValue: "NT AUTHORITY\\SYSTEM",
      },
      SQL_PASSWORD,
    ],
    build: sqlCommand,
  },
  {
    id: "restore",
    nameKey: "runbooks.restore.name",
    purposeKey: "runbooks.restore.purpose",
    elevationKey: "runbooks.restore.elevation",
    noteKey: "runbooks.restore.note",
    params: [
      {
        id: "backupPath",
        labelKey: "runbooks.param.restoreBackup",
        kind: "path",
        required: true,
        defaultValue: "C:\\Temp\\db.bak",
      },
      {
        id: "databaseName",
        labelKey: "runbooks.param.restoreDatabase",
        kind: "text",
        required: true,
        defaultValue: "app",
      },
      {
        id: "dataDir",
        labelKey: "runbooks.param.restoreDataDir",
        kind: "path",
        required: true,
        defaultValue: "C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA",
      },
      SQL_PASSWORD,
    ],
    build: restoreCommand,
  },
];

/** Start a recipe with its documented defaults, which are examples, not answers. */
export function runbookDefaults(recipe: Runbook): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of recipe.params) {
    if (!param.secret) values[param.id] = param.defaultValue ?? "";
  }
  return values;
}

/**
 * Compose one command, or refuse with the parameters that stopped it.
 *
 * Refusing is the point. A command with a hole in it looks runnable, gets
 * pasted, and fails at the far end where nobody is watching; naming the blank
 * parameter is cheaper for everybody. An unknown id or a value outside a
 * choice list is refused for the same reason: it never belonged in the recipe.
 */
export function composeRunbook(
  recipe: Runbook,
  values: Readonly<Record<string, string>>,
): ComposeResult {
  const byId = new Map(recipe.params.map((param) => [param.id, param] as const));

  const unknown = Object.keys(values).filter((id) => !byId.has(id));
  if (unknown.length > 0) return { ok: false, reason: "unknown", params: unknown.sort() };

  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const param of recipe.params) {
    if (param.secret) {
      // The only value a builder can ever see for a secret is the placeholder.
      resolved[param.id] = SECRET_PLACEHOLDER;
      continue;
    }
    const value = (values[param.id] ?? param.defaultValue ?? "").trim();
    if (value === "") {
      if (param.required) missing.push(param.id);
    } else if (param.kind === "choice" && !param.choices?.some((c) => c.value === value)) {
      invalid.push(param.id);
    }
    resolved[param.id] = value;
  }

  if (missing.length > 0) return { ok: false, reason: "missing", params: missing };
  if (invalid.length > 0) return { ok: false, reason: "invalid", params: invalid };

  return { ok: true, command: recipe.build(resolved) };
}
