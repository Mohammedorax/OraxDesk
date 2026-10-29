// Structural check for docs/openapi.yaml: valid YAML, every $ref resolves, and
// the documented paths match the Worker routes. Dependency-light on purpose
// (only the `yaml` parser), so it can run in the same step as the tests.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const doc = parse(readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8"));
const errors = [];

if (doc?.openapi !== "3.1.0") errors.push("openapi must be 3.1.0");
if (!doc?.info?.title) errors.push("info.title is required");
if (!Array.isArray(doc?.servers) || doc.servers.length === 0) errors.push("servers is required");

const refs = new Set();
function walk(node) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item);
    return;
  }
  if (typeof node.$ref === "string") refs.add(node.$ref);
  for (const value of Object.values(node)) walk(value);
}
walk(doc);

for (const ref of refs) {
  if (!ref.startsWith("#/")) {
    errors.push(`external $ref is not allowed here: ${ref}`);
    continue;
  }
  let current = doc;
  for (const part of ref.slice(2).split("/")) {
    current = current?.[part];
    if (current === undefined) break;
  }
  if (current === undefined) errors.push(`unresolved $ref: ${ref}`);
}

// Every route the Worker serves must be documented, and nothing else.
const expected = [
  "/healthz",
  "/v1/devices",
  "/v1/devices/by-number/{number}",
  "/v1/devices/{id}",
  "/v1/devices/{id}/address",
  "/v1/devices/{id}/revoke",
  "/v1/admin/devices/{id}/revoke",
  "/v1/signals",
  "/v1/signals/resolve",
  "/v1/signals/revoke",
];
const documented = Object.keys(doc?.paths ?? {});
for (const path of expected) if (!documented.includes(path)) errors.push(`missing path: ${path}`);
for (const path of documented) if (!expected.includes(path)) errors.push(`undocumented path: ${path}`);

if (errors.length > 0) {
  console.error(`openapi lint failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`openapi ok: ${documented.length} paths, ${refs.size} refs resolved`);
