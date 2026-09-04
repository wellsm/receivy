import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const workspace = await readFile(
  new URL("../pnpm-workspace.yaml", import.meta.url),
  "utf8",
);

assert.equal(root.private, true);
assert.equal(root.packageManager, "pnpm@11.5.3");
assert.equal(root.engines.node, "24.x");
assert.match(workspace, /packages:\n\s+- "packages\/\*"/);

for (const name of ["api", "common", "mobile", "web"]) {
  await access(new URL(`../packages/${name}/`, import.meta.url));
}

console.log("workspace contract ok");
