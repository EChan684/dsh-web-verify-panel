// Smoke test: exercises the host half's real logic with a mock cordis ctx —
// route registration, open → poll → ack queue flow, and the tool's ack wait.
import assert from 'node:assert/strict';
import * as plugin from '../lib/index.js';

const registeredRoutes = new Map();
const registeredTools = new Map();
const sections = [];

const mockCtx = {
  inject(services, cb) {
    const sctx = {
      webServer: {
        register(route) {
          if (registeredRoutes.has(route.path)) throw new Error('duplicate');
          registeredRoutes.set(route.path, route);
          return () => registeredRoutes.delete(route.path);
        },
        exact: registeredRoutes,
      },
      tools: { register: (t) => registeredTools.set(t.name, t), },
      effect: (fn) => fn(),
      systemPrompt: { section: (s) => sections.push(s) },
    };
    cb(sctx);
  },
};

plugin.apply(mockCtx);

assert.equal(registeredRoutes.size, 3, 'three routes registered');
assert.ok(registeredTools.has('web_verify_open'), 'tool registered');
assert.equal(sections.length, 1, 'system prompt section registered');

// mock req/res helpers
function mockReq(method, body) {
  const listeners = {};
  return {
    method,
    socket: { remoteAddress: '127.0.0.1' },
    on(ev, fn) { listeners[ev] = fn; },
    destroy() {},
    _emit() {
      if (body != null && listeners.data) listeners.data(Buffer.from(body));
      if (listeners.end) listeners.end();
    },
  };
}
function mockRes() {
  return {
    code: null,
    body: null,
    writeHead(code) { this.code = code; },
    end(b) { this.body = b; },
  };
}
async function callRoute(path, method, body) {
  const route = registeredRoutes.get(path);
  const req = mockReq(method, body);
  const res = mockRes();
  const p = route.handler(req, res);
  req._emit();
  await p;
  return res;
}

// 1. tool executes → item queued; start the tool (it waits for ack)
const tool = registeredTools.get('web_verify_open');
const resultPromise = tool.execute({ url: 'http://127.0.0.1:3000/demo', title: 'demo' });

// 2. client polls → gets the item
const pollRes = await callRoute('/web-verify-panel/poll', 'GET');
const polled = JSON.parse(pollRes.body);
assert.equal(polled.items.length, 1, 'poll returns the queued item');
assert.equal(polled.items[0].url, 'http://127.0.0.1:3000/demo');

// 3. second poll → queue drained
const pollRes2 = await callRoute('/web-verify-panel/poll', 'GET');
assert.equal(JSON.parse(pollRes2.body).items.length, 0, 'queue drained after first poll');

// 4. client acks → tool resolves opened=true
await callRoute('/web-verify-panel/ack', 'POST', JSON.stringify({ id: polled.items[0].id }));
const result = await resultPromise;
assert.equal(result.ok, true);
assert.equal(result.opened, true, 'tool reports opened after ack');

// 5. bad URL rejected by the tool
await assert.rejects(() => tool.execute({ url: 'file:///etc/passwd' }), /http/);

// 6. non-loopback rejected
{
  const route = registeredRoutes.get('/web-verify-panel/open');
  const req = mockReq('POST', JSON.stringify({ url: 'http://example.com' }));
  req.socket.remoteAddress = '10.0.0.5';
  const res = mockRes();
  const p = route.handler(req, res);
  req._emit();
  await p;
  assert.equal(res.code, 403, 'non-loopback forbidden');
}

// 7. unacked tool call times out gracefully with opened=false
const slow = await tool.execute({ url: 'https://example.com' });
assert.equal(slow.opened, false, 'no ack → opened=false with hint');

console.log('smoke test: all 7 checks passed');
