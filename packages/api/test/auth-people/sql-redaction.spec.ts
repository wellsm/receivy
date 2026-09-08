import { equal, ok, rejects } from 'node:assert/strict';
import { it, mock } from 'node:test';
import { Runtime } from '@ez4/common';
import { db } from '../fixtures/financial';

it('preserves SQL results/errors but never logs SQL or parameter contents even in debug mode', async () => {
  const output: unknown[] = [],
    originalError = console.error,
    originalDebug = console.debug;
  const debug = mock.method(Runtime, 'isDebug', () => true),
    scope = Runtime.getScope();
  Runtime.setScope({ traceId: 'SQL_REDACTION_SECRET' });
  console.error = (...args) => {
    output.push(args);
  };
  console.debug = (...args) => {
    output.push(args);
  };
  try {
    const [row] = await db.rawQuery('SELECT :value::text AS result', { value: 'SQL_REDACTION_SECRET' });
    equal(row?.['result'], 'SQL_REDACTION_SECRET');
    await rejects(() => db.rawQuery('SELECT :value::uuid', { value: 'SQL_REDACTION_SECRET' }));
  } finally {
    console.error = originalError;
    console.debug = originalDebug;
    debug.mock.restore();
    Runtime.setScope(scope ?? { traceId: crypto.randomUUID() });
  }
  const text = JSON.stringify(output);
  ok(output.length >= 2);
  equal(text.includes('SQL_REDACTION_SECRET'), false);
  equal(text.includes('SELECT'), false);
  ok(text.includes('query_failed'));
  ok(text.includes('query_succeeded'));
});
