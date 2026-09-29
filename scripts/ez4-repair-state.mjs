#!/usr/bin/env node
// Repairs an EZ4 remote state that no longer loads.
//
// When `ez4 destroy` (or a deploy) deletes a resource and then fails on another one that depends on it, EZ4 saves
// the state without the deleted entry but keeps its id in the `dependencies` of the entry that failed. The next
// command stops before doing anything:
//
//   Dependency <id> linked to entry <id> does not exists.
//
// This script removes from every entry the dependencies and connections that point at entries the state no longer
// has. It changes nothing else, and nothing in the AWS resources themselves.
//
// Dry run (default), prints what it would change:
//   aws-vault exec receivy -- node scripts/ez4-repair-state.mjs receivy-web dev
// Write (keeps a backup of the original next to the state, `<key>.backup-<timestamp>`):
//   aws-vault exec receivy -- node scripts/ez4-repair-state.mjs receivy-web dev --write
//
// Arguments: <projectName of ez4.project.js> <stage> [--write] [--region <region of the state bucket>]
import { createRequire } from "node:module";
import { hash } from "node:crypto";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [projectName, stage, ...flags] = process.argv.slice(2);

if (!projectName || !stage) {
  console.error("Usage: node scripts/ez4-repair-state.mjs <projectName> <stage> [--write] [--region <region>]");
  process.exit(2);
}

const write = flags.includes("--write");
const regionFlag = flags.indexOf("--region");
const region = regionFlag >= 0 ? flags[regionFlag + 1] : "sa-east-1";

// The AWS SDK is a dependency of @ez4/aws-common, not of the workspace: resolve it from that package in the pnpm store.
const store = fileURLToPath(new URL("../node_modules/.pnpm/", import.meta.url));
const common = readdirSync(store).find((name) => name.startsWith("@ez4+aws-common@"));

if (!common) {
  console.error("@ez4/aws-common is not installed: run `pnpm install` first.");
  process.exit(2);
}

const require = createRequire(`${store}${common}/node_modules/@ez4/aws-common/package.json`);
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");

const { Account } = await new STSClient({ region }).send(new GetCallerIdentityCommand());

// Same names EZ4 uses: one state bucket per account, one state file per project and stage.
const bucket = `ez4-${hash("sha256", Account).substring(0, 16)}`;
const key = `${projectName}/${stage}-deploy.ezstate`;

const s3 = new S3Client({ region });
const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
const original = await object.Body.transformToString();
const data = JSON.parse(original);
const state = data.state ?? {};

const label = (entry) => `${entry.type} ${entry.entryId.slice(0, 8)}`;

let removed = 0;

for (const entry of Object.values(state)) {
  for (const field of ["dependencies", "connections"]) {
    const references = entry[field];

    if (!Array.isArray(references)) {
      continue;
    }

    const missing = references.filter((reference) => !state[reference]);

    if (!missing.length) {
      continue;
    }

    entry[field] = references.filter((reference) => state[reference]);
    removed += missing.length;

    console.log(`${label(entry)}: ${field} loses ${missing.map((reference) => reference.slice(0, 8)).join(", ")}`);
  }
}

console.log(`State s3://${bucket}/${key}: ${Object.keys(state).length} entries, ${removed} broken reference(s).`);

if (!removed) {
  console.log("Nothing to repair.");
  process.exit(0);
}

if (!write) {
  console.log("Dry run: nothing was written. Run again with --write to apply.");
  process.exit(0);
}

const backupKey = `${key}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;

await s3.send(new PutObjectCommand({ Bucket: bucket, Key: backupKey, Body: original, ContentType: "application/json" }));

data.lastUpdate = new Date().toISOString();

await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(data, undefined, 2), ContentType: "application/json" }));

console.log(`Backup of the original: s3://${bucket}/${backupKey}`);
console.log("State repaired.");
