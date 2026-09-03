/**
 * dsh-web-verify-panel — host half.
 *
 * Routes the agent's "open a web page for visual verification" requests into
 * the DSH window's right-hand sidebar (the dsh-better-sidebar embedded
 * browser) instead of the system browser, so computer_screenshot captures the
 * page *inside* the DSH window and never loses sight of the session panel.
 *
 * Pieces:
 *   - tool `web_verify_open(url)` — the agent's entry point
 *   - three loopback-only HTTP routes (open / poll / ack) forming a tiny
 *     host→client queue (better-sidebar has no host→client push channel)
 *   - a systemPrompt section steering the model away from Start-Process
 *
 * Safety: no top-level inject, every service is optional and wrapped, apply()
 * never throws — a failure here must never take down the loader tree.
 */
import path from 'node:path';
import { patchPreset } from './router-preset.mjs';

export const name = 'dsh-web-verify-panel';
export const version = '1.0.1';

const ROUTE_OPEN = '/web-verify-panel/open';
const ROUTE_POLL = '/web-verify-panel/poll';
const ROUTE_ACK = '/web-verify-panel/ack';

const ITEM_TTL_MS = 60_000;
const ACK_KEEP_MS = 10_000;
const ACK_WAIT_MS = 12_000;

/** @type {Map<string, {id:string,url:string,title:string,ts:number,delivered:boolean,acked:boolean}>} */
const items = new Map();
let seq = 0;

function isLoopback(req) {
  const ra = req.socket && req.socket.remoteAddress;
  return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function prune() {
  const now = Date.now();
  for (const [id, item] of items) {
    if (now - item.ts > ITEM_TTL_MS || (item.acked && now - item.ts > ACK_KEEP_MS)) {
      items.delete(id);
    }
  }
}

function normalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.href;
}

/** Exported for tests. Returns the queue id. */
export function enqueue(rawUrl, rawTitle) {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;
  prune();
  const id = String(++seq);
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim().slice(0, 200) : url;
  items.set(id, { id, url, title, ts: Date.now(), delivered: false, acked: false });
  return id;
}

async function handleOpen(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    res.end();
    return;
  }
  if (!isLoopback(req)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, error: 'bad json' });
    return;
  }
  const id = enqueue(body?.url, body?.title);
  if (!id) {
    sendJson(res, 400, { ok: false, error: 'only http/https URLs are supported' });
    return;
  }
  sendJson(res, 200, { ok: true, id });
}

async function handlePoll(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' });
    res.end();
    return;
  }
  if (!isLoopback(req)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  prune();
  const fresh = [];
  for (const item of items.values()) {
    if (!item.delivered) {
      item.delivered = true;
      fresh.push({ id: item.id, url: item.url, title: item.title });
    }
  }
  sendJson(res, 200, { ok: true, items: fresh });
}

async function handleAck(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    res.end();
    return;
  }
  if (!isLoopback(req)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const body = JSON.parse(await readBody(req));
    const item = items.get(String(body?.id ?? ''));
    if (item) {
      item.acked = true;
      if (Array.isArray(body?.rect) && body.rect.length === 4 && body.rect.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        item.rect = body.rect.map((n) => Math.max(0, Math.min(1, n)));
      }
    }
  } catch { /* ignore */ }
  sendJson(res, 200, { ok: true });
}

/** Fallback region when the client could not locate the browser iframe. */
const DEFAULT_RECT = [0.55, 0, 1, 1];

function makeTool() {
  return {
    name: 'web_verify_open',
    description: [
      '【网页可视化验证的唯一首选方式】在 DSH 窗口右侧栏的内置网页面板中打开一个网页（http/https，支持 localhost/127.0.0.1 的本地开发服务），用于"实际打开网页并截图验证"的场景。任何需要打开网页做可视化验证的需求，都必须先调用本工具；禁止用 pwsh/bash 执行 Start-Process、cmd /c start、explorer 等方式打开系统浏览器——系统浏览器窗口会遮挡 DSH 会话界面，导致 computer_screenshot 截不到目标、验证失败。',
      '本工具返回 opened=true 与 rect（页面区域在 DSH 窗口内的 0..1 分数矩形）。等待 2-3 秒让页面渲染，然后调用 computer_screenshot 并传 region=rect，只截取页面区域；若要看会话上下文再整屏截图。截图前确保 DSH 窗口处于前台、未被遮挡或最小化。',
      '本工具返回 opened=false 或页面为空白时，说明面板未确认或目标站点拒绝被嵌入（X-Frame-Options / frame-ancestors）；此时请勿改用其他方式打开浏览器，可再次调用本工具或改用 web_search 收集信息，并在回复中向用户如实说明。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要打开的完整 URL，仅支持 http/https（本地服务如 http://127.0.0.1:3000 也可以）' },
        title: { type: 'string', description: '可选的标签页标题' },
      },
      required: ['url'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          opened: { type: 'boolean' },
          url: { type: 'string' },
          rect: { type: 'array', items: { type: 'number' } },
          note: { type: 'string' },
        },
        required: ['ok', 'opened', 'url', 'rect', 'note'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `web_verify_open: ${value.opened ? '页面已打开' : '请求已入队，等待界面确认'} ${value.url}`,
          value.rect ? `region: [${value.rect.map((n) => n.toFixed(3)).join(', ')}]` : '',
          value.note,
        ].filter(Boolean).join('\n'),
      }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const url = normalizeUrl(args?.url);
      if (!url) throw new Error('web_verify_open: 仅支持 http/https URL');
      const id = enqueue(url, args?.title);
      const deadline = Date.now() + ACK_WAIT_MS;
      while (Date.now() < deadline) {
        const item = items.get(id);
        if (!item) break;
        if (item.acked) {
          const rect = Array.isArray(item.rect) && item.rect.length === 4 ? item.rect : null;
          return {
            ok: true,
            opened: true,
            url,
            rect: rect ?? DEFAULT_RECT,
            note: rect
              ? `页面已在 DSH 窗口右侧栏的内置网页面板中打开（面板已临时加宽以便显示完整内容）。请等待 2-3 秒让页面加载，然后调用 computer_screenshot 并传 region=${JSON.stringify(rect)} 只截取页面区域。region 分数相对于 DSH 窗口：窗口占满屏幕时即屏幕分数；若窗口非全屏或多显示器，可先整屏截一张，根据返回的 width/height/virtual_offset 校准后再用 region。`
              : `页面请求已送达，但未识别到页面 iframe（目标站点可能禁止被嵌入，或面板尚未渲染完成）。请先整屏 computer_screenshot 确认：若面板为空白，不要改用其他方式打开浏览器，可改用 web_search 收集信息并在回复中如实说明。`,
          };
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return {
        ok: true,
        opened: false,
        url,
        rect: DEFAULT_RECT,
        note: '打开请求已发送，但未收到界面确认（DSH 窗口可能未打开，或 dsh-better-sidebar 侧边栏未启用）。请求会保留约 60 秒，界面就绪后仍会自动打开；可稍后 computer_screenshot 查看，或请用户点开 DSH 窗口。',
      };
    },
  };
}

const PROMPT_TEXT =
  '【网页可视化验证：唯一允许的方式】\n' +
  '需要实际打开网页做可视化验证（截图确认）时：必须先调用 web_verify_open 工具，把页面打开到 DSH 窗口右侧栏的内置网页面板。' +
  '严禁使用任何其他方式打开网页或浏览器——包括但不限于 pwsh/bash 的 Start-Process、cmd /c start、explorer、msedge/chrome/firefox 命令行、Invoke-WebRequest、Python webbrowser 等（系统浏览器会遮挡会话窗口，导致 computer_screenshot 验证失败）。' +
  'web_verify_open 返回后等 2-3 秒渲染，再用 computer_screenshot 的 region 参数截取它返回的 rect（只截页面区域，不要整屏截图；若窗口非全屏或多显示器，先整屏截一张定位校准）。' +
  '若返回 opened=false 或页面空白（站点可能禁止嵌入）：不要改用其他方式打开浏览器，可再次调用 web_verify_open 或改用 web_search 收集信息，并在回复中向用户如实说明。';

function optionalInject(ctx, services, fn, label) {
  try {
    ctx.inject(services, (sctx) => {
      try {
        fn(sctx);
      } catch (err) {
        console.warn(`[dsh-web-verify-panel] ${label} 注册失败：`, err);
      }
    });
  } catch (err) {
    console.warn(`[dsh-web-verify-panel] ${label} 服务不可用：`, err);
  }
}

export function apply(ctx) {
  // ── make web_verify_open available on a session's FIRST turn ──
  // The Router Standard preset keeps a small first-turn core tool set; patch
  // the user's preset copy so web_verify_open is in it (idempotent, backup
  // kept, never fatal). Takes effect on the next DSH restart.
  try {
    const home = process.env.DSH_HOME;
    if (home) {
      const res = patchPreset(path.join(home, '.agent-presets'));
      if (res?.patched) console.log('[dsh-web-verify-panel] Router preset patched: web_verify_open is now in the first-turn core set (restart DSH to apply)');
    }
  } catch { /* non-fatal */ }

  // ── HTTP routes (loopback-only) ──
  optionalInject(ctx, ['webServer'], (sctx) => {
    for (const route of [
      { kind: 'exact', path: ROUTE_OPEN, handler: handleOpen },
      { kind: 'exact', path: ROUTE_POLL, handler: handlePoll },
      { kind: 'exact', path: ROUTE_ACK, handler: handleAck },
    ]) {
      try {
        sctx.webServer.register(route);
      } catch {
        // hot-reload self-heal: drop the stale registration and retry once
        try {
          const table = sctx.webServer.exact;
          if (table && typeof table.has === 'function' && table.has(route.path)) table.delete(route.path);
          sctx.webServer.register(route);
        } catch (err2) {
          console.warn('[dsh-web-verify-panel] 路由注册失败（' + route.path + '）：', err2);
        }
      }
    }
  }, 'webServer');

  // ── agent tool ──
  optionalInject(ctx, ['tools'], (sctx) => {
    const register = () => sctx.tools.register(makeTool());
    if (typeof sctx.effect === 'function') sctx.effect(register);
    else register();
  }, 'tools');

  // ── system prompt steer (order 3: right after the persona slot, so the
  //    "web_verify_open is the ONLY way to open pages" rule is read early) ──
  optionalInject(ctx, ['systemPrompt'], (sctx) => {
    sctx.systemPrompt.section({ name: 'tool:web_verify_open', order: 3, text: PROMPT_TEXT });
  }, 'systemPrompt');
}

export default { name, version, apply };
