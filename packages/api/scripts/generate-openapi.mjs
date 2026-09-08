import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildOpenApi } from '../src/openapi/export.ts';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const target = new URL('../../../docs/openapi.json', import.meta.url);
const generated = `${JSON.stringify(buildOpenApi(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8').catch(() => '')) !== generated)
    throw new Error('OpenAPI is stale. Run pnpm --filter @receivy/api openapi:generate.');
  console.log('OpenAPI matches reflected routes and schemas.');
} else {
  await writeFile(target, generated);
  console.log('Generated docs/openapi.json from pinned EZ4 reflection.');
}
