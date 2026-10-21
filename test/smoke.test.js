'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../server');
const { startMockSmtp } = require('./support/mock-smtp');
const { parseMail, waitFor } = require('./support/mail-utils');

const ADMIN = 'admin-token-for-test';
const HOOK = 'hook-token-for-test';

describe('端到端：短信入库 → 发信 → 网页可查', () => {
  let mock;
  let app;
  let base;
  let tmp;
  let configPath;

  const auth = () => ({ 'x-auth-token': ADMIN });

  const postHook = (fields, token = HOOK) =>
    fetch(`${base}/hook/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    });

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smsmail-'));
    mock = await startMockSmtp();
    configPath = path.join(tmp, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          port: 0,
          host: '127.0.0.1',
          adminToken: ADMIN,
          hookToken: HOOK,
          subject: '【短信】[from][code]',
          smtp: {
            host: '127.0.0.1',
            port: mock.port,
            secure: false,
            starttls: false,
            user: 'test@example.com',
            pass: 'testpass',
            fromName: '短信邮差',
            fromAddress: 'test@example.com',
            to: ['boss@example.com']
          },
          filters: { dropKeywords: ['退订'], allowSenders: [], denySenders: [] }
        },
        null,
        2
      )
    );
    app = createServer({ configPath, dataDir: path.join(tmp, 'data') });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${app.server.address().port}`;
  });

  after(async () => {
    await app.close();
    await mock.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('健康检查返回 200', async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  test('错误的 hook 令牌被拒绝', async () => {
    const res = await postHook({ from: '10086', content: 'hello' }, 'wrong-token');
    assert.equal(res.status, 401);
  });

  test('短信入库并触发一封格式正确的邮件', async () => {
    const res = await postHook({
      from: '10690001',
      content: '【某银行】您的验证码是 483920，5分钟内有效，请勿泄露。',
      card_slot: '卡1',
      device_mark: '备用机'
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.id);

    const mail = await waitFor(() => mock.messages[0], { message: '没等到邮件' });
    const parsed = parseMail(mail.data);

    assert.deepEqual(mail.to, ['boss@example.com']);
    assert.equal(mail.from, 'test@example.com');
    assert.match(parsed.subject, /10690001/);
    assert.match(parsed.subject, /483920/);
    assert.match(parsed.text, /您的验证码是 483920/);
    assert.match(parsed.text, /卡1/);
    assert.match(parsed.text, /备用机/);
    assert.match(parsed.html, /483920/);
  });

  test('网页 API 能查到短信并识别验证码', async () => {
    const res = await fetch(`${base}/api/messages`, { headers: auth() });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.total, 1);
    assert.equal(data.items[0].code, '483920');
    assert.equal(data.items[0].mail.status, 'sent');
    assert.equal(data.stats.total, 1);
  });

  test('没有令牌访问 API 返回 401', async () => {
    const res = await fetch(`${base}/api/messages`);
    assert.equal(res.status, 401);
  });

  test('查询参数带令牌同样可用（SSE 场景）', async () => {
    const res = await fetch(`${base}/api/messages?token=${ADMIN}`);
    assert.equal(res.status, 200);
  });

  test('重复推送被去重', async () => {
    const res = await postHook({
      from: '10690001',
      content: '【某银行】您的验证码是 483920，5分钟内有效，请勿泄露。'
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.duplicate, true);
  });

  test('命中丢弃关键词的短信不入库', async () => {
    const res = await fetch(`${base}/hook/${HOOK}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '95588', content: '【推广】回复退订' })
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.dropped);
  });

  test('支持 JSON 报文与 text 字段别名', async () => {
    const res = await fetch(`${base}/hook/${HOOK}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=utf-8' },
      body: JSON.stringify({ from: '10086', text: '您本月话费 38.00 元，余额 12.50 元。' })
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.id);

    await waitFor(() => mock.messages.length >= 2, { message: '第二封邮件没发出' });
  });

  test('列表按号码搜索有效', async () => {
    const res = await fetch(`${base}/api/messages?q=10690001`, { headers: auth() });
    const data = await res.json();
    assert.equal(data.total, 1);

    const all = await (await fetch(`${base}/api/messages`, { headers: auth() })).json();
    assert.equal(all.total, 2);
  });

  test('重发接口会重新投递', async () => {
    const list = await (await fetch(`${base}/api/messages`, { headers: auth() })).json();
    const target = list.items.find((m) => m.from === '10690001');

    const res = await fetch(`${base}/api/messages/${target.id}/resend`, {
      method: 'POST',
      headers: auth()
    });
    assert.equal(res.status, 202);
    await waitFor(() => mock.messages.length >= 3, { message: '重发没生效' });
  });

  test('删除接口生效', async () => {
    const list = await (await fetch(`${base}/api/messages`, { headers: auth() })).json();
    const target = list.items[0];

    const res = await fetch(`${base}/api/messages/${target.id}`, {
      method: 'DELETE',
      headers: auth()
    });
    assert.equal(res.status, 200);

    const after = await (await fetch(`${base}/api/messages`, { headers: auth() })).json();
    assert.equal(after.total, 1);
  });

  test('登录返回配置，且不泄露邮箱授权码', async () => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: ADMIN })
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.config.hookUrl.endsWith(`/hook/${HOOK}`));
    assert.ok(!JSON.stringify(data.config).includes('testpass'));

    const bad = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'nope' })
    });
    assert.equal(bad.status, 401);
  });

  test('网页改配置会落盘', async () => {
    const res = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: '【备用机】[from][code]',
        smtp: { to: 'a@example.com, c@example.com' }
      })
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.config.subject, '【备用机】[from][code]');
    assert.deepEqual(data.config.smtp.to, ['a@example.com', 'c@example.com']);

    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(onDisk.subject, '【备用机】[from][code]');
  });

  test('测试发信接口可用', async () => {
    const before = mock.messages.length;
    const res = await fetch(`${base}/api/test`, { method: 'POST', headers: auth() });
    const data = await res.json();
    assert.equal(data.ok, true);
    await waitFor(() => mock.messages.length > before, { message: '测试邮件没发出' });
  });

  test('静态页面可访问', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<html/i);
    assert.match(html, /短信邮差/);
  });

  test('未知接口返回 404 而不是崩溃', async () => {
    const res = await fetch(`${base}/api/not-exist`, { headers: auth() });
    assert.equal(res.status, 404);
  });
});
