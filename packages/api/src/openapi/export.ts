import { getHttpServicesMetadata } from '@ez4/gateway/library';
import { buildReflection } from '@ez4/project/library';
import type { AnySchema, ObjectSchema } from '@ez4/schema';
import { registerTriggers } from '@ez4/schema/library';

// JSON Schema output is intentionally heterogeneous; the input is typed EZ4 metadata.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
let registered = false;
export function schemaToOpenApi(schema: AnySchema): Json {
  let result: Json;
  const definitions = schema.definitions ?? {};
  switch (schema.type) {
    case 'object': {
      const properties = Object.fromEntries(
        Object.entries(schema.properties).map(([name, value]) => [value.alias ?? name, schemaToOpenApi(value)])
      );
      const required = Object.entries(schema.properties)
        .filter(([, value]) => !value.optional)
        .map(([name, value]) => value.alias ?? name);
      result = {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: schema.additional ? schemaToOpenApi(schema.additional.value) : !!schema.definitions?.extensible
      };
      break;
    }
    case 'array':
      result = { type: 'array', items: schemaToOpenApi(schema.element) };
      break;
    case 'union':
      result = { anyOf: schema.elements.map(schemaToOpenApi) };
      break;
    case 'enum':
      result = { enum: schema.options.map((option) => option.value) };
      break;
    case 'string':
      result = { type: 'string', ...(schema.format ? { format: schema.format } : {}) };
      break;
    case 'number':
      result = { type: schema.format === 'integer' ? 'integer' : 'number' };
      break;
    case 'boolean':
      result = { type: 'boolean' };
      break;
    default:
      throw new Error(`Unsupported reflected schema kind: ${schema.type}`);
  }
  const mapping: Record<string, string> = {
    value: 'const',
    default: 'default',
    minValue: 'minimum',
    maxValue: 'maximum',
    minLength: schema.type === 'array' ? 'minItems' : 'minLength',
    maxLength: schema.type === 'array' ? 'maxItems' : 'maxLength',
    pattern: 'pattern'
  };
  for (const [name, value] of Object.entries(definitions)) if (mapping[name]) result[mapping[name]!] = value;
  if (schema.description) result.description = schema.description;
  return schema.nullable ? { anyOf: [result, { type: 'null' }] } : result;
}
function parameters(schema: ObjectSchema | undefined, location: 'path' | 'query' | 'header') {
  return Object.entries(schema?.properties ?? {}).map(([name, value]) => ({
    name: value.alias ?? name,
    in: location,
    required: location === 'path' || !value.optional,
    schema: schemaToOpenApi(value)
  }));
}
export function buildOpenApi(sourceFiles = ['./src/api.ts']): {
  openapi: string;
  info: Json;
  paths: Record<string, Json>;
  components: Json;
} {
  // Schema triggers preserve String.Max/UUID and Number.Integer. Provider/deployment
  // triggers are deliberately not loaded: no environment values or infrastructure I/O.
  if (!registered) {
    registerTriggers();
    registered = true;
  }
  const reflected = getHttpServicesMetadata(buildReflection(sourceFiles));
  if (reflected.errors.length) throw new Error(reflected.errors.map((error) => error.message).join('\n'));
  const services = Object.values(reflected.services);
  if (services.length !== 1) throw new Error('Expected exactly one reflected HTTP service');
  const paths: Record<string, Json> = {};
  for (const route of services[0]!.routes) {
    if (route.disabled) continue;
    const [verb, routePath] = route.path.split(' ');
    if (!verb || !routePath || verb === 'ANY') throw new Error('Unsupported HTTP route');
    const path = routePath.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}'),
      request = route.handler.request,
      response = route.handler.response;
    const responses: Json = {};
    for (const status of Array.isArray(response.status) ? response.status : [response.status])
      responses[String(status)] = {
        description: status < 300 ? 'Success' : 'Response',
        ...(response.body ? { content: { 'application/json': { schema: schemaToOpenApi(response.body) } } } : {}),
        ...(response.headers
          ? {
              headers: Object.fromEntries(
                Object.entries(response.headers.properties).map(([name, value]) => [
                  value.alias ?? name,
                  { schema: schemaToOpenApi(value) }
                ])
              )
            }
          : {})
      };
    responses.default = {
      description: 'Sanitized API error; status remains meaningful. Monetary domain values must be safe integer cents.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } }
    };
    const media = route.path === 'POST /auth/apple/callback' ? 'application/x-www-form-urlencoded' : 'application/json';
    const operation: Json = {
      operationId: route.name ?? route.handler.name,
      security: route.authorizer ? [{ bearerAuth: [] }] : [],
      parameters: [
        ...parameters(request?.parameters, 'path'),
        ...parameters(request?.query, 'query'),
        ...parameters(request?.headers, 'header')
      ],
      ...(request?.body
        ? { requestBody: { required: !request.body.optional, content: { [media]: { schema: schemaToOpenApi(request.body) } } } }
        : {}),
      responses
    };
    (paths[path] ??= {})[verb.toLowerCase()] = operation;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Receivy API',
      version: '0.1.0',
      description:
        'Generated offline from pinned EZ4 0.52.0 route/schema reflection. Mount under the configured API base path. Private operations authorize ownership server-side. Browser clients use the Next BFF; capability URLs are private bearer capabilities, not examples.'
    },
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        ApiError: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message', 'correlationId'],
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            correlationId: { type: 'string', format: 'uuid' },
            fieldErrors: { type: 'object', additionalProperties: { type: 'string' } }
          }
        }
      }
    }
  };
}
