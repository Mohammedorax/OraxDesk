// Stage the `dvv` sidecar so a plain `cargo tauri build` bundles it.
//
// WHY THIS EXISTS
//
// The sidecar is what lets an AI agent reach this computer's agent plane.
// Without it the installer is a viewer and nothing else, and NOTHING SAYS
// SO: the build succeeds, the installer installs, and the feature is
// simply not there.
//
// It used to be worse than that. The `externalBin` entry lived in
// `tauri.release.conf.json`, a config that is merged only when it is named
// on the command line, so a plain `cargo tauri build` -- the command the
// README tells a person to run -- produced an installer with no sidecar in
// it. The build was green and the agent plane was dead.
//
// So the sidecar is now in the BASE config, which means a build that cannot
// find it FAILS rather than quietly shipping without it. The failure was
// seen and it said exactly what was missing:
//
//   resource path `binaries\dvv-x86_64-pc-windows-msvc.exe` doesn't exist
//
// WHICH IS WHEN IT HAS TO HAPPEN
//
// Before the APP build, not before the bundling. The sidecar is embedded in
// the app binary as a resource, and the embedding happens while the app is
// being compiled, so a sidecar staged afterwards is a sidecar that is too
// late. That is why this runs from `beforeBuildCommand`.
//
// WHAT IT DOES
//
// Tauri looks for the sidecar at `src-tauri/binaries/dvv-<target-triple>`.
// A local build is always for the host, and the host triple is what `rustc`
// reports.
//
// A file that is ALREADY there is left alone. The release workflow stages
// the sidecar itself, for a target that is not always the host -- a macOS
// universal binary, for one -- and that deliberate staging must not be
// overwritten by a host build.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The triple this machine builds for. */
function hostTriple() {
  const version = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = version.split("\n").find((line) => line.startsWith("host:"));
  if (!host) {
    throw new Error("rustc did not report a host triple; cannot stage the sidecar");
  }
  return host.slice("host:".length).trim();
}

const triple = hostTriple();
const extension = triple.includes("windows") ? ".exe" : "";

// The name Tauri looks for: the binary name, the target triple, and the
// platform's executable extension.
const staged = join(root, "src-tauri", "binaries", `dvv-${triple}${extension}`);

// A sidecar that is ALREADY staged is left alone. The release workflow
// stages the sidecar itself, for a target that is not always the host: a
// macOS UNIVERSAL binary, for one, which Tauri looks for under
// `dvv-universal-apple-darwin`. That deliberate staging must not be
// overwritten by a host build.
const alreadyStaged = [staged];
if (triple.includes("apple-darwin")) {
  alreadyStaged.push(join(root, "src-tauri", "binaries", "dvv-universal-apple-darwin"));
}
if (alreadyStaged.some((path) => existsSync(path))) {
  console.log(`the sidecar is already staged for ${triple}; leaving it alone`);
  process.exit(0);
}

const source = join(root, "target", "release", `dvv${extension}`);
if (!existsSync(source)) {
  execFileSync("cargo", ["build", "--release", "-p", "dvv"], {
    cwd: root,
    stdio: "inherit",
  });
}
if (!existsSync(source)) {
  throw new Error(
    `the sidecar was not built: ${source} does not exist.\n` +
      `Run "cargo build --release -p dvv" and try again.`,
  );
}

mkdirSync(dirname(staged), { recursive: true });
copyFileSync(source, staged);
console.log(`staged the sidecar for ${triple}: ${staged}`);
