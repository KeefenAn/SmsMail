#!/usr/bin/env node
'use strict';

/**
 * 短信邮差 / SmsMail
 * 手机（SmsForwarder）--Webhook--> 本服务 --SMTP--> 邮箱
 * 同时提供一个网页收件箱，邮件发不出去也能在网页里看到原文。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  loadConfig,
  saveConfig,
  publicConfig,
  patchFromClient,
  deepMerge,
  randomToken
} = require('./lib/config');
const { Store } = require('./lib/store');
const { extractCode, buildEmail } = require('./lib/format');
const { sendMail } = require('./lib/smtp');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const RETRY_DELAYS = [30e3, 2 * 60e3, 10 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

function log(msg, level = 'info') {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${stamp}] ${level.toUpperCase()} ${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function tokenEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const hb = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parsePayload(req, buf) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const text = buf.toString('utf8').trim();
  if (!text) return {};
  if (ct.includes('json') || /^[{[]/.test(text)) {
    try {
      const obj = JSON.parse(text);
      return obj && typeof obj === 'object' ? obj : { content: text };
    } catch {
      /* 继续尝试表单 */
    }
  }
  if (ct.includes('urlencoded') || /^[^=&]+=[^&]*/.test(text)) {
    const out = {};
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    return out;
  }
  return { content: text };
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function createServer(options = {}) {
  const configPath =
    options.configPath || process.env.SMSMAIL_CONFIG || path.join(ROOT, 'config.json');
  const dataDir = options.dataDir || process.env.SMSMAIL_DATA || path.join(ROOT, 'data');

  const cfg = loadConfig(configPath);
  fs.mkdirSync(dataDir, { recursive: true });
  const store = new Store(path.join(dataDir, 'messages.json'), { maxMessages: cfg.maxMessages });

  const clients = new Set();
  const inflight = new Set();
  const timers = new Set();
  const rateBuckets = new Map();

  function broadcast(obj) {
    if (!clients.size) return;
    const data = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of [...clients]) {
      try {
        res.write(data);
      } catch {
        clients.delete(res);
      }
    }
  }

  function rateLimited(key, limit = 180, windowMs = 60_000) {
    const now = Date.now();
    const b = rateBuckets.get(key);
    if (!b || now > b.reset) {
      rateBuckets.set(key, { count: 1, reset: now + windowMs });
      return false;
    }
    b.count += 1;
    return b.count > limit;
  }

  const rlSweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
  }, 300_000);
  rlSweeper.unref();

  // ---------------- 邮件投递 ----------------

  async function deliver(id) {
    if (inflight.has(id)) return;
    const msg = store.get(id);
    if (!msg) return;
    if (!cfg.smtp.host || !cfg.smtp.to.length) {
      store.patch(id, {
        mail: {
          status: 'failed',
          attempts: msg.mail ? msg.mail.attempts || 0 : 0,
          at: Date.now(),
          error: '未配置 SMTP 服务器或收件人'
        }
      });
      broadcast({ type: 'update', message: store.get(id) });
      return;
    }

    inflight.add(id);
    const attempts = ((msg.mail && msg.mail.attempts) || 0) + 1;
    try {
      const { subject, text, html } = buildEmail(cfg, msg);
      await sendMail({ ...cfg.smtp, subject, text, html });
      store.patch(id, { mail: { status: 'sent', attempts, at: Date.now(), error: null } });
      broadcast({ type: 'update', message: store.get(id) });
      log(`邮件已发送 ${id} -> ${cfg.smtp.to.join(', ')}`);
    } catch (err) {
      const willRetry = attempts < Math.max(0, cfg.retryMax);
      const error = String((err && err.message) || err);
      store.patch(id, {
        mail: { status: willRetry ? 'retry' : 'failed', attempts, at: Date.now(), error }
      });
      broadcast({ type: 'update', message: store.get(id) });
      log(`邮件发送失败 ${id}（第 ${attempts} 次）：${error}`, willRetry ? 'warn' : 'error');
      if (willRetry) {
        const delay = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)];
        const t = setTimeout(() => {
          timers.delete(t);
          deliver(id);
        }, delay);
        if (t.unref) t.unref();
        timers.add(t);
      }
    } finally {
      inflight.delete(id);
    }
  }

  // ---------------- 短信入库 ----------------

  function verifySign(payload) {
    if (!cfg.hookSecret) return { ok: true, skipped: true };
    const ts = String(payload.timestamp || '');
    const sign = String(payload.sign || '').trim();
    if (!ts || !sign) return { ok: false, reason: '缺少 timestamp/sign' };
    const expected = crypto
      .createHmac('sha256', cfg.hookSecret)
      .update(`${ts}\n${cfg.hookSecret}`, 'utf8')
      .digest('base64');
    const ok = tokenEq(sign, expected) || tokenEq(sign, encodeURIComponent(expected));
    return { ok, reason: ok ? '' : 'sign 校验不通过' };
  }

  function firstNonEmpty(...vals) {
    for (const v of vals) {
      if (v === undefined || v === null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return '';
  }

  function checkFilters(from, content) {
    const f = cfg.filters || {};
    for (const kw of f.denySenders || []) {
      if (kw && from.includes(kw)) return `发件人命中黑名单「${kw}」`;
    }
    if ((f.allowSenders || []).length) {
      const allow = f.allowSenders.some((kw) => kw && from.includes(kw));
      if (!allow) return '不在发件人白名单';
    }
    for (const kw of f.dropKeywords || []) {
      if (kw && content.includes(kw)) return `内容命中丢弃关键词「${kw}」`;
    }
    return null;
  }

  function ingest(payload, meta = {}) {
    const from =
      firstNonEmpty(
        payload.from,
        payload.phone,
        payload.sender,
        payload.number,
        payload.mobile,
        payload.title
      ) || '未知号码';
    const content = firstNonEmpty(
      payload.content,
      payload.text,
      payload.msg,
      payload.body,
      payload.message,
      payload.org_content
    );
    if (!content) return { ok: false, error: 'content 为空，没有可转发的短信内容' };

    const sign = verifySign(payload);
    if (!sign.ok) {
      log(`签名校验失败：${sign.reason}`, 'warn');
      if (cfg.strictSign) return { ok: false, error: sign.reason };
    }

    if (cfg.dedupeSeconds > 0) {
      const dup = store.findRecent(from, content, cfg.dedupeSeconds * 1000);
      if (dup) return { ok: true, duplicate: true, id: dup.id };
    }

    const dropped = checkFilters(from, content);
    if (dropped) {
      log(`已过滤（${dropped}）：${from} ${content.slice(0, 40)}`);
      return { ok: true, dropped, reason: dropped };
    }

    const now = Date.now();
    const msg = {
      id: `${now.toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
      from,
      content,
      code: extractCode(content),
      receivedAt: now,
      device: firstNonEmpty(payload.device_mark, payload.device) || '',
      slot: firstNonEmpty(payload.card_slot, payload.slot) || '',
      source: firstNonEmpty(payload.source, meta.source) || 'hook',
      ip: meta.ip || '',
      mail: { status: 'pending', attempts: 0, at: null, error: null }
    };

    store.append(msg);
    broadcast({ type: 'new', message: msg });
    log(`收到短信 ${from} -> ${content.replace(/\s+/g, ' ').slice(0, 60)}`);
    deliver(msg.id);
    return { ok: true, id: msg.id, code: msg.code || null };
  }

  // ---------------- HTTP ----------------

  function baseUrl(req, url) {
    if (cfg.publicUrl) return cfg.publicUrl.replace(/\/+$/, '');
    const proto =
      String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() ||
      url.protocol.replace(':', '');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || url.host);
    return `${proto}://${host}`;
  }

  function hookUrlFor(req, url) {
    return `${baseUrl(req, url)}/hook/${cfg.hookToken}`;
  }

  function isAuthorized(req, url) {
    const header = req.headers['x-auth-token'];
    const auth = String(req.headers.authorization || '');
    const bearer = /^Bearer\s+(.+)$/i.exec(auth);
    const qs = url.searchParams.get('token');
    const cookie = /(?:^|;\s*)smsmail=([^;]+)/.test(String(req.headers.cookie || ''))
      ? decodeURIComponent(/smsmail=([^;]+)/.exec(String(req.headers.cookie || ''))[1])
      : '';
    const provided = header || (bearer && bearer[1]) || qs || cookie;
    return !!provided && tokenEq(String(provided).trim(), cfg.adminToken);
  }

  function serveStatic(p, res) {
    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache'
      });
      res.end(data);
    });
  }

  async function handleHook(req, res, url) {
    const ip = clientIp(req);
    if (rateLimited(`hook:${ip}`)) return json(res, 429, { ok: false, error: '请求过于频繁' });

    const m = /^\/hook\/(.+)$/.exec(url.pathname);
    const token = (m ? decodeURIComponent(m[1]) : '') ||
      url.searchParams.get('token') ||
      req.headers['x-hook-token'] ||
      '';
    if (!tokenEq(String(token).trim(), cfg.hookToken)) {
      return json(res, 401, { ok: false, error: 'hook token 无效' });
    }

    if (req.method === 'GET' && !url.searchParams.get('content') && !url.searchParams.get('from')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<div style="font-family:system-ui;padding:40px;line-height:1.8">' +
          '<h2>✅ 短信邮差推送接口已就绪</h2>' +
          '<p>这个地址是给手机 App（SmsForwarder）用的，不用在浏览器里打开。</p>' +
          '<p>把完整地址填进 App 的「WebServer」，webParams 留空即可。</p></div>'
      );
      return;
    }

    if (!['GET', 'POST', 'PUT', 'PATCH'].includes(req.method)) {
      return json(res, 405, { ok: false, error: '不支持的请求方法' });
    }

    let payload = {};
    if (req.method !== 'GET') {
      const buf = await readBody(req);
      payload = parsePayload(req, buf);
    }
    const query = Object.fromEntries(url.searchParams);
    payload = { ...query, ...payload };

    const result = ingest(payload, { ip, source: 'hook' });
    return json(res, result.ok ? 200 : 400, result);
  }

  async function handleApi(req, res, url) {
    const p = url.pathname;
    const method = req.method || 'GET';

    if (p === '/api/ping') {
      return json(res, 200, { ok: true, name: 'sms-mailer', time: Date.now() });
    }

    if (p === '/api/login') {
      if (method !== 'POST') return json(res, 405, { ok: false, error: '请用 POST' });
      const body = parsePayload(req, await readBody(req));
      const token = String(body.token || body.adminToken || body.password || '').trim();
      if (!tokenEq(token, cfg.adminToken)) {
        await new Promise((r) => setTimeout(r, 400));
        log(`登录失败，来自 ${clientIp(req)}`, 'warn');
        return json(res, 401, { ok: false, error: '令牌不正确' });
      }
      res.setHeader(
        'set-cookie',
        `smsmail=${encodeURIComponent(cfg.adminToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      );
      return json(res, 200, { ok: true, config: publicConfig(cfg, hookUrlFor(req, url)) });
    }

    if (!isAuthorized(req, url)) {
      return json(res, 401, { ok: false, error: '未登录或令牌已失效' });
    }

    if (p === '/api/messages' && method === 'GET') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const q = url.searchParams.get('q') || '';
      return json(res, 200, { ok: true, ...store.list({ q, limit, offset }), stats: store.stats() });
    }

    const single = /^\/api\/messages\/([^/]+)$/.exec(p);
    if (single) {
      const id = decodeURIComponent(single[1]);
      if (method === 'GET') {
        const item = store.get(id);
        return item ? json(res, 200, { ok: true, message: item }) : json(res, 404, { ok: false, error: '不存在' });
      }
      if (method === 'DELETE') {
        const ok = store.remove(id);
        if (ok) broadcast({ type: 'delete', id });
        return json(res, ok ? 200 : 404, { ok });
      }
      return json(res, 405, { ok: false, error: '不支持的方法' });
    }

    const resend = /^\/api\/messages\/([^/]+)\/resend$/.exec(p);
    if (resend && method === 'POST') {
      const id = decodeURIComponent(resend[1]);
      const item = store.get(id);
      if (!item) return json(res, 404, { ok: false, error: '不存在' });
      store.patch(id, { mail: { status: 'pending', attempts: 0, at: null, error: null } });
      broadcast({ type: 'update', message: store.get(id) });
      deliver(id);
      return json(res, 202, { ok: true });
    }

    if (p === '/api/config' && method === 'GET') {
      return json(res, 200, { ok: true, config: publicConfig(cfg, hookUrlFor(req, url)) });
    }

    if (p === '/api/config' && method === 'PUT') {
      const body = parsePayload(req, await readBody(req));
      const patch = patchFromClient(body || {});
      const next = deepMerge(cfg, patch);
      next.smtp.to = (next.smtp.to || []).map((s) => String(s).trim()).filter(Boolean);
      if (!next.smtp.fromAddress) next.smtp.fromAddress = next.smtp.user || '';
      saveConfig(configPath, next);
      for (const k of Object.keys(cfg)) delete cfg[k];
      Object.assign(cfg, next);
      store.maxMessages = cfg.maxMessages;
      log('配置已更新');
      return json(res, 200, { ok: true, config: publicConfig(cfg, hookUrlFor(req, url)) });
    }

    if (p === '/api/tokens' && method === 'POST') {
      const body = parsePayload(req, await readBody(req));
      const which = String(body.which || '');
      if (which === 'hook') cfg.hookToken = randomToken(16);
      else if (which === 'admin') cfg.adminToken = randomToken(18);
      else return json(res, 400, { ok: false, error: 'which 只能是 hook 或 admin' });
      saveConfig(configPath, cfg);
      return json(res, 200, { ok: true, config: publicConfig(cfg, hookUrlFor(req, url)) });
    }

    if (p === '/api/test' && method === 'POST') {
      const demo = {
        id: 'test-' + Date.now(),
        from: '10690000',
        content: '【短信邮差】这是一条测试短信，如果你的邮箱收到了，说明一切正常。验证码 123456。',
        code: '123456',
        receivedAt: Date.now(),
        device: '测试',
        slot: '卡1'
      };
      try {
        const { subject, text, html } = buildEmail(cfg, demo);
        await sendMail({ ...cfg.smtp, subject, text, html });
        return json(res, 200, { ok: true, message: '测试邮件已发出，请查收（含垃圾箱）' });
      } catch (err) {
        return json(res, 500, { ok: false, error: String(err.message || err) });
      }
    }

    if (p === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write('retry: 3000\n\n');
      res.write(`data: ${JSON.stringify({ type: 'hello', stats: store.stats() })}\n\n`);
      clients.add(res);
      const hb = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* 忽略 */
        }
      }, 25000);
      if (hb.unref) hb.unref();
      req.on('close', () => {
        clearInterval(hb);
        clients.delete(res);
      });
      return;
    }

    return json(res, 404, { ok: false, error: '接口不存在' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/healthz') {
      return json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
    }
    if (url.pathname === '/hook' || url.pathname.startsWith('/hook/')) {
      return handleHook(req, res, url);
    }
    if (url.pathname.startsWith('/api/')) {
      return handleApi(req, res, url);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(url.pathname, res);
    }
    return json(res, 405, { ok: false, error: '不支持的方法' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err && err.status ? err.status : 500;
      log(`请求处理异常 ${req.method} ${req.url}：${err && err.stack ? err.stack : err}`, 'error');
      if (!res.headersSent) json(res, status, { ok: false, error: String((err && err.message) || err) });
      else res.end();
    });
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;

  async function close() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    clearInterval(rlSweeper);
    for (const c of clients) {
      try {
        c.end();
      } catch {
        /* 忽略 */
      }
    }
    clients.clear();
    await new Promise((resolve) => server.close(resolve));
  }

  // 进程重启后补发未成功的邮件
  setTimeout(() => {
    for (const m of store.pending()) {
      log(`重启补发：${m.id}`);
      deliver(m.id);
    }
  }, 1500).unref();

  return { server, cfg, store, deliver, close };
}

async function main() {
  let app;
  try {
    app = createServer({});
  } catch (err) {
    console.error(`启动失败：${err.message}`);
    process.exit(1);
  }
  const { server, cfg } = app;

  // 容器/托管平台通常用 PORT 环境变量指定监听端口
  const port = Number(process.env.PORT) || cfg.port;
  const host = process.env.HOST || cfg.host;

  server.listen(port, host, () => {
    log(`短信邮差已启动  http://${host}:${port}`);
    log(`网页收件箱令牌：${cfg.adminToken}`);
    log(`手机推送地址  ：http://<服务器地址>:${port}/hook/${cfg.hookToken}`);
    if (!cfg.smtp.host) log('注意：还没配置 SMTP，邮件发不出去（网页里仍可收短信）', 'warn');
  });

  server.on('error', (err) => {
    console.error(`监听失败：${err.message}`);
    process.exit(1);
  });

  const shutdown = async (sig) => {
    log(`收到 ${sig}，正在退出…`);
    try {
      await app.close();
    } catch {
      /* 忽略 */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log(`未处理的 Promise 拒绝：${err}`, 'error'));
}

if (require.main === module) main();

module.exports = { createServer };
