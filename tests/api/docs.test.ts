import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { openApiSpec } from '../../src/docs/openapi';
import { buildRouter, type RouteDependencies } from '../../src/routes';
import { buildTestApp } from '../helpers/testApp';

/** Lists "METHOD /path" for every route registered on the real router, in OpenAPI path syntax. */
function registeredRoutes(): string[] {
  const router = buildRouter({ healthChecks: [] } as unknown as RouteDependencies);
  return router.stack
    .flatMap((layer) => {
      const route = layer.route as { path: string; methods?: Record<string, boolean> } | undefined;
      if (!route) return [];
      const path = route.path.replace(/:(\w+)/g, '{$1}');
      return Object.keys(route.methods ?? {}).map((method) => `${method.toUpperCase()} ${path}`);
    })
    .filter((route) => !route.includes('/docs'))
    .sort();
}

function documentedRoutes(): string[] {
  return Object.entries(openApiSpec.paths)
    .flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`))
    .sort();
}

describe('Swagger / OpenAPI docs', () => {
  it('serves Swagger UI at /docs without authentication', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/docs/').redirects(1);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('swagger-ui');
  });

  it('serves the Swagger UI assets', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/docs/swagger-ui-init.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Chat Backend System API');
  });

  it('serves the raw OpenAPI JSON', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/chat/create',
        '/chat/{chatId}/message/send',
        '/chat/{chatId}/messages',
        '/chat/{chatId}/message/{messageId}/read',
        '/chat/{chatId}/lastseen',
        '/user/{userId}/chats',
      ]),
    );
  });

  it('documents exactly the routes the server registers (no missing or stale entries)', () => {
    expect(documentedRoutes()).toEqual(registeredRoutes());
  });

  it('has no dangling $ref', () => {
    const json = JSON.stringify(openApiSpec);
    const refs = [...json.matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]!);
    const defined = Object.keys(openApiSpec.components.schemas);
    expect(refs.filter((ref) => !defined.includes(ref))).toEqual([]);
  });
});
