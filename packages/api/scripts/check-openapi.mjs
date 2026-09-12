import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regenerates the OpenAPI document into a temp folder and compares it with docs/api-oas.yml.
const root = fileURLToPath(new URL('../', import.meta.url));
const published = join(root, '../../docs/api-oas.yml');
const folder = mkdtempSync(join(tmpdir(), 'receivy-oas-'));

try {
  execFileSync(
    process.execPath,
    ['--env-file=local.env', './node_modules/@ez4/project/bin/cli.mjs', 'generate', '-e', 'local.env', '--', 'gateway:oas', folder],
    { cwd: root, stdio: 'ignore' }
  );

  const current = readFileSync(published, 'utf8');
  const generated = readFileSync(join(folder, 'api-oas.yml'), 'utf8');

  if (current !== generated) {
    throw new Error('OpenAPI is stale. Run pnpm --filter @receivy/api openapi:generate.');
  }

  console.log('OpenAPI matches reflected routes and schemas.');
} finally {
  rmSync(folder, { recursive: true, force: true });
}
