/**
 * Contract test between the Swagger docs and the real API.
 *
 * For every documented request body, path parameter and query parameter, it sends
 * requests derived from the DOCUMENTED constraints to the real app and checks that:
 *   - the documented example is accepted (not a 400),
 *   - every documented required field really is required,
 *   - values just outside each documented limit are rejected with 400 naming the field,
 *   - values exactly at each documented limit are accepted.
 * If someone changes a validator without the docs following (or the reverse), this fails.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { openApiSpec } from '../../src/docs/openapi';
import { buildTestApp, type TestContext } from '../helpers/testApp';

interface PropSchema {
  type?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  example?: unknown;
}
interface ObjectSchema {
  properties: Record<string, PropSchema>;
  required?: string[];
}
interface Parameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  example?: unknown;
  schema: PropSchema;
}
interface Operation {
  parameters?: Parameter[];
  requestBody?: { content: { 'application/json': { schema: { $ref: string } } } };
}

const schemas = openApiSpec.components.schemas as unknown as Record<string, ObjectSchema>;
const resolve = (ref: string): ObjectSchema => schemas[ref.split('/').pop()!]!;

/** All documented operations that take a body or parameters. */
const operations = Object.entries(openApiSpec.paths).flatMap(([path, ops]) =>
  Object.entries(ops as Record<string, Operation>)
    .filter(([, op]) => op.requestBody || op.parameters?.length)
    .map(([method, op]) => ({ path, method, op, label: `${method.toUpperCase()} ${path}` })),
);

const bodyOperations = operations.filter((o) => o.op.requestBody);

const bodySchemaOf = (op: Operation) => resolve(op.requestBody!.content['application/json'].schema.$ref);

const exampleBody = (schema: ObjectSchema): Record<string, unknown> =>
  Object.fromEntries(Object.entries(schema.properties).map(([name, prop]) => [name, prop.example]));

/** A value that matches the documented constraints of a string field and has the given length. */
const stringOfLength = (prop: PropSchema, length: number): string =>
  prop.format === 'email' ? `${'a'.repeat(Math.max(1, length - '@example.com'.length))}@example.com` : 'a'.repeat(length);

describe('Swagger docs match the real validation', () => {
  let ctx: TestContext;
  let ids: { chatId: string; messageId: string; userId: string };

  beforeEach(async () => {
    ctx = await buildTestApp();
    const chatId = await ctx.createChat('user1', 'user2');
    const messageId = await ctx.sendMessage(chatId, 'user1', 'hello');
    ids = { chatId, messageId, userId: 'user1' };
  });

  /** Fills path params with real ids (or overrides), so only the part under test can fail validation. */
  const urlFor = (path: string, overrides: Record<string, string> = {}) =>
    path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(overrides[name] ?? ids[name as keyof typeof ids]));

  /** The documented examples name the acting user (senderId / userId / userAId); act as them. */
  const actorFor = (body: Record<string, unknown>) =>
    String(body.senderId ?? body.userId ?? body.userAId ?? 'user1');

  /** `actorBody` (default: `body`) decides the X-User-Id header; pass the unmodified example when mutating fields. */
  const send = (method: string, url: string, body?: Record<string, unknown>, actorBody = body) => {
    const actor = actorBody ? actorFor(actorBody) : 'user1';
    const req = method === 'get' ? request(ctx.app).get(url) : request(ctx.app).post(url).send(body ?? {});
    return req.set('X-User-Id', actor);
  };

  const expectFieldRejected = (res: request.Response, field: string) => {
    expect(res.status, `expected 400 for ${field}, got ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  };

  describe.each(bodyOperations)('$label request body', ({ path, method, op }) => {
    const schema = bodySchemaOf(op);

    it('accepts the documented example', async () => {
      const res = await send(method, urlFor(path), exampleBody(schema));
      expect(res.status, JSON.stringify(res.body)).not.toBe(400);
    });

    it.each(schema.required ?? [])('requires %s', async (field) => {
      const example = exampleBody(schema);
      const body = { ...example };
      delete body[field];
      expectFieldRejected(await send(method, urlFor(path), body, example), field);
    });

    it.each(Object.entries(schema.properties))('enforces the documented constraints of %s', async (field, prop) => {
      const base = exampleBody(schema);
      const withValue = (value: unknown) => send(method, urlFor(path), { ...base, [field]: value }, base);

      expectFieldRejected(await withValue(12345), field); // wrong type

      if (prop.maxLength !== undefined) {
        expectFieldRejected(await withValue(stringOfLength(prop, prop.maxLength + 1)), field);
        const atLimit = await withValue(stringOfLength(prop, prop.maxLength));
        expect(atLimit.status, `${field} at maxLength should be valid: ${JSON.stringify(atLimit.body)}`).not.toBe(400);
      }
      if (prop.minLength !== undefined && prop.minLength > 0) {
        expectFieldRejected(await withValue(''), field);
        expectFieldRejected(await withValue('   '), field); // values are trimmed before validation
      }
      if (prop.pattern) {
        expect(new RegExp(prop.pattern).test('bad id!')).toBe(false);
        expectFieldRejected(await withValue('bad id!'), field);
      }
      if (prop.format === 'email') {
        expectFieldRejected(await withValue('not-an-email'), field);
      }
    });

    it('ignores unknown fields', async () => {
      const res = await send(method, urlFor(path), { ...exampleBody(schema), unexpected: 'ignored' });
      expect(res.status).not.toBe(400);
    });
  });

  describe.each(operations.filter((o) => o.op.parameters?.length))('$label parameters', ({ path, method, op }) => {
    const params = op.parameters!;
    const body = op.requestBody ? exampleBody(bodySchemaOf(op)) : undefined;

    it.each(params.filter((p) => p.in === 'path'))('path param $name enforces its pattern and length', async (param) => {
      expectFieldRejected(await send(method, urlFor(path, { [param.name]: 'bad.id' }), body), param.name);
      expectFieldRejected(
        await send(method, urlFor(path, { [param.name]: 'a'.repeat(param.schema.maxLength! + 1) }), body),
        param.name,
      );
    });

    it.each(params.filter((p) => p.in === 'query'))('query param $name enforces its documented range', async (param) => {
      const url = (value: string) => `${urlFor(path)}?${param.name}=${encodeURIComponent(value)}`;
      if (param.schema.type === 'integer') {
        expectFieldRejected(await send(method, url(String(param.schema.minimum! - 1)), body), param.name);
        expectFieldRejected(await send(method, url(String(param.schema.maximum! + 1)), body), param.name);
        expectFieldRejected(await send(method, url('1.5'), body), param.name);
        expect((await send(method, url(String(param.schema.maximum)), body)).status).toBe(200);
        expect((await send(method, url(String(param.schema.minimum)), body)).status).toBe(200);
      }
      if (param.schema.pattern) {
        expectFieldRejected(await send(method, url('bad id!'), body), param.name);
      }
      expect(param.required).toBe(false);
      expect((await send(method, urlFor(path), body)).status).toBe(200); // optional: omitting it works
    });
  });

  it('applies the documented default page size', async () => {
    const limitParam = (openApiSpec.paths['/chat/{chatId}/messages'].get.parameters as Parameter[]).find(
      (p) => p.name === 'limit',
    )!;
    const res = await send('get', urlFor('/chat/{chatId}/messages'));
    expect(res.body.pagination.limit).toBe((limitParam.schema as { default?: number }).default);
  });

  it('documents a 413 for every body endpoint, and the server really enforces it', async () => {
    for (const { op } of bodyOperations) {
      expect(Object.keys((op as { responses: object }).responses)).toContain('413');
    }
    const res = await send('post', urlFor('/chat/{chatId}/message/send'), {
      senderId: 'user1',
      text: 'x'.repeat(110 * 1024),
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
