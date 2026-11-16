import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle, splitDraft } from '../worker.mjs';

const origin = 'https://editor.example.com';
const accessPassword = 'test_fixture_only_0123456789abcdef';
const authorization = 'Basic ' + btoa('editor:' + accessPassword);
const config = { APP_ORIGIN: origin, ACCESS_PASSWORD: accessPassword };
function request(path, { method = 'GET', data, headers = {}, from = origin, login = true } = {}) {
  return new Request(from + path, { method, body: data === undefined ? undefined : JSON.stringify(data),
    headers: { ...(login ? { Authorization: authorization } : {}),
      ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...headers } });
}

test('requires deployment settings and authenticates requests before touching storage', async () => {
  assert.equal((await handle(request('/api/articles'), {})).status, 503);
  assert.equal((await handle(request('/api/articles', { login: false,
    headers: { 'oai-authenticated-user-id': 'test-user' } }), config)).status, 401);
  const unauthorized = await handle(request('/api/articles', { login: false }), config);
  assert.equal(unauthorized.headers.get('cache-control'), 'no-store');
  assert.equal(unauthorized.headers.get('x-frame-options'), 'DENY');
  assert.equal((await handle(request('/api/articles', { from: 'https://other.example.com' }), config)).status, 403);
  assert.equal((await handle(request('/api/automation/cancel-queue'), { ...config, DB: {} })).status, 404);
});

test('rejects cross-origin writes and oversized JSON', async () => {
  const env = { ...config, DB: {} };
  assert.equal((await handle(request('/api/articles', { method: 'POST', headers: { Origin: 'https://other.example.com' }, data: {} }), env)).status, 403);
  assert.equal((await handle(request('/api/articles', { method: 'POST', data: { body: '稿'.repeat(400000) } }), env)).status, 400);
});

test('split preserves all source text', () => {
  const body = '一段测试文字。\n\n'.repeat(150);
  assert.equal(splitDraft(body, 400).join(''), body);
});

test('publish is opt-in, admits one request and requires a receipt to mark success', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const name of ['0000_workbench', '0001_automation', '0002_publication']) {
    sqlite.exec(readFileSync(new URL('../drizzle/' + name + '.sql', import.meta.url), 'utf8'));
  }
  const DB = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return {
      first: () => statement.get(),
      bind: (...args) => ({ first: () => statement.get(...args),
        all: () => ({ results: statement.all(...args) }),
        run: () => ({ meta: statement.run(...args) }) }),
    };
  } };
  const env = { ...config, DB, WECHAT_APP_ID: 'mock-id', WECHAT_APP_SECRET: 'mock-value' };
  const call = (path, settings) => handle(request(path, settings), env);
  const created = await call('/api/articles', { method: 'POST', data: {
    title: '模拟', author: '编辑', body: '<段落>', source: 'ai', image: 'data:image/png;base64,AA==',
  } });
  assert.equal(created.status, 201);
  const base = '/api/articles/' + (await created.json()).id;
  const { article } = await (await call(base)).json();
  const publish = () => call(base + '/publish', { method: 'POST', data: { revision: article.updated } });
  assert.equal((await publish()).status, 503);
  env.ENABLE_PUBLISH = 'true';
  let submits = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.hostname, 'api.weixin.qq.com');
    switch (url.pathname) {
      case '/cgi-bin/stable_token': return Response.json({ access_token: 'test' });
      case '/cgi-bin/material/add_material': return Response.json({ media_id: 'cover' });
      case '/cgi-bin/draft/add': {
        const payload = JSON.parse(options.body);
        assert.match(payload.articles[0].content, /AI 生成.*&lt;段落&gt;/);
        return Response.json({ media_id: 'draft' });
      }
      case '/cgi-bin/freepublish/submit': submits++; return Response.json({ publish_id: 'mock-pub' });
      case '/cgi-bin/freepublish/get': return Response.json({ publish_status: 0,
        article_detail: { item: [{ article_url: 'https://mp.weixin.qq.com/s/example' }] } });
      default: throw new Error('Unexpected mock endpoint');
    }
  });
  const responses = await Promise.all([publish(), publish()]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(submits, 1);
  assert.equal((await responses.find((r) => r.ok).json()).publication.state, 'submitted');
  const receipt = await call(base + '/receipt', { method: 'POST' });
  assert.equal((await receipt.json()).publication.state, 'published');
});
