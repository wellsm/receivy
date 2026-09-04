import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["--dir", "packages/mobile", "doctor"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

process.stdout.write(output);

if (result.status === 0) {
  process.exit(0);
}

const failedChecks = output.match(/^✖ .+$/gm) ?? [];
const isKnownSdk56HermesWarning =
  failedChecks.length === 1 &&
  failedChecks[0]?.includes("Expo SDK versions affected by Hermes V1 regressions") &&
  output.includes("expo@56.0.21") &&
  output.includes("1 check failed");

if (!isKnownSdk56HermesWarning) {
  process.exit(result.status ?? 1);
}

console.warn(
  "Expo Doctor: acknowledged the known Hermes V1 warning while Receivy remains pinned to Expo SDK 56.",
);
