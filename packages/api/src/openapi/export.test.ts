import { describe, expect, it } from 'vitest';
import { buildOpenApi, schemaToOpenApi } from './export';

describe('pinned EZ4 reflected OpenAPI', () => {
  it('retains required fields, constraints, nullability and split unions from real route metadata', () => {
    const document = buildOpenApi();
    expect(Object.keys(document.paths).length).toBeGreaterThan(35);
    const create = document.paths['/billings']!.post!;
    expect(create.security).toEqual([{ bearerAuth: [] }]);
    expect(create.requestBody.content['application/json'].schema.required).toContain('totalCents');
    expect(create.requestBody.content['application/json'].schema.properties.split.properties.parts.items.anyOf).toHaveLength(2);
    expect(create.requestBody.content['application/json'].schema.properties.type.enum).toEqual(['once', 'until', 'indefinite']);
    expect(document.paths['/expenses']).toBeUndefined();
    expect(document.paths['/recurrences']).toBeUndefined();
    const start = document.paths['/auth/apple/native/start']!.post!;
    expect(start.requestBody.content['application/json'].schema.properties.clientChallenge.maxLength).toBe(43);
    expect(start.security).toEqual([]);
    const publicGet = document.paths['/public/charges/{token}']!.get!;
    expect(publicGet.security).toEqual([]);
    expect(publicGet.parameters[0]).toMatchObject({ in: 'path', name: 'token', required: true });
    expect(publicGet.responses['200'].content['application/json'].schema.properties.pix.anyOf).toContainEqual({ type: 'null' });
    expect(document.paths['/auth/apple/callback']!.post!.requestBody.content['application/x-www-form-urlencoded']).toBeDefined();
    expect(document.paths['/charges/{id}/public-link']!.post!.requestBody.required).toBe(false);
    expect(JSON.stringify(document)).not.toMatch(/privateKeyBase64|local\.env|\/Users\//);
  });
  it('fails closed for unsupported schema variants instead of producing permissive contracts', () => {
    expect(() => schemaToOpenApi({ type: 'unrecognized' } as never)).toThrow(/Unsupported/);
  });
});
