import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = resolve(dirname(require.resolve('@ez4/aws-gateway')), '..');
const runtimeRequire = createRequire(resolve(root, 'lib/request.ts'));

// Compile the same shipped TS template that EZ4 bundles for Lambda, not a copy.
function runtime(handler: (request: Record<string, unknown>) => unknown, body = false) {
  const logs: unknown[] = [];
  const exports: {
    apiEntryPoint?: (event: object, context: object) => Promise<{ statusCode: number; headers: Record<string, string>; body?: string }>;
  } = {};
  const code = ts.transpileModule(readFileSync(resolve(root, 'lib/request.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  runInNewContext(code, {
    require: runtimeRequire,
    exports,
    Buffer,
    JSON,
    Error,
    SyntaxError,
    setTimeout,
    clearTimeout,
    console: { error: (value: unknown) => logs.push(value), warn: (value: unknown) => logs.push(value) },
    __EZ4_HEADERS_SCHEMA: null,
    __EZ4_PARAMETERS_SCHEMA: null,
    __EZ4_QUERY_SCHEMA: null,
    __EZ4_IDENTITY_SCHEMA: null,
    __EZ4_BODY_SCHEMA: body ? { type: 'object', properties: {} } : null,
    __EZ4_RESPONSE_SCHEMA: null,
    __EZ4_ERRORS_MAP: null,
    __EZ4_PREFERENCES: {},
    __EZ4_CONTEXT: {},
    handle: handler,
    dispatch: async () => {}
  });
  return {
    logs,
    call: (payload?: string) =>
      exports.apiEntryPoint!(
        {
          headers: { 'x-trace-id': 'secret@example.com', 'x-forwarded-for': '203.0.113.99' },
          body: payload,
          isBase64Encoded: false,
          requestContext: { timeEpoch: 1, http: { method: 'POST', path: '/public/charges/secret-capability', sourceIp: '192.0.2.10' } }
        },
        { awsRequestId: 'a3a49925-d9d4-4919-a670-8c59dd0d04bd', getRemainingTimeInMillis: () => 30000 }
      )
  };
}

describe('pinned compiled gateway boundary', () => {
  it('uses genuine edge source IP and ignores caller trace/header identities', async () => {
    let incoming: Record<string, unknown> = {};
    const fixture = runtime((request) => {
      incoming = request;
      return { status: 204, headers: { 'cache-control': 'private, no-store' } };
    });
    const response = await fixture.call();
    expect(incoming.sourceIp).toBe('192.0.2.10');
    expect(response.headers['x-trace-id']).toMatch(/^[\da-f-]{36}$/);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('returns a sanitized 400 envelope for malformed JSON without logging its body', async () => {
    const fixture = runtime(() => ({ status: 204 }), true);
    const response = await fixture.call('{"email":"private@example.com","token":"secret-token",');
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body!)).toEqual({
      code: 'INVALID_REQUEST',
      message: 'Invalid request.',
      correlationId: response.headers['x-trace-id']
    });
    expect(JSON.stringify(fixture.logs)).not.toMatch(/private@example|secret-token|secret@example/);
  });
  it('keeps domain status and hides unexpected error messages and nested causes', async () => {
    const { HttpConflictError } = runtimeRequire('@ez4/gateway');
    for (const [error, status, code] of [
      [new HttpConflictError('private@example.com'), 409, 'CONFLICT'],
      [new Error('signed-url-secret', { cause: { sql: 'secret-token' } }), 500, 'INTERNAL_ERROR']
    ] as const) {
      const fixture = runtime(() => {
        throw error;
      });
      const response = await fixture.call();
      expect(response.statusCode).toBe(status);
      expect(JSON.parse(response.body!)).toMatchObject({ code, correlationId: response.headers['x-trace-id'] });
      expect(JSON.stringify([response, fixture.logs])).not.toMatch(/private@example|secret-token|signed-url-secret|secret@example/);
      expect(fixture.logs.length).toBeGreaterThan(0);
    }
  });
});
