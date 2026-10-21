'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../lib/store');
const { sleep } = require('./support/mail-utils');

function makeMsg(overrides = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    from: '10086',
    content: '测试短信',
    code: null,
    receivedAt: Date.now(),
    mail: { status: 'sent', attempts: 1, at: Date.now(), error: null },
    ...overrides
  };
}

describe('短信存储', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smsmail-store-'));
    file = path.join(dir, 'messages.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('新消息排在最前面', () => {
    const store = new Store(file);
    store.append(makeMsg({ id: 'a', receivedAt: 1000 }));
    store.append(makeMsg({ id: 'b', receivedAt: 2000 }));
    assert.deepEqual(store.items.map((m) => m.id), ['b', 'a']);
  });

  test('重启后从磁盘恢复', async () => {
    const store = new Store(file);
    store.append(makeMsg({ id: 'x', content: '第一条' }));
    const reloaded = new Store(file);
    assert.equal(reloaded.items.length, 1);
    assert.equal(reloaded.items[0].content, '第一条');
  });

  test('patch 修改的字段会被持久化', async () => {
    const store = new Store(file);
    store.append(makeMsg({ id: 'p', mail: { status: 'pending', attempts: 0 } }));
    store.patch('p', { mail: { status: 'sent', attempts: 1 } });
    await sleep(420); // 等防抖写盘
    const reloaded = new Store(file);
    assert.equal(reloaded.get('p').mail.status, 'sent');
  });

  test('删除后不再出现', async () => {
    const store = new Store(file);
    store.append(makeMsg({ id: 'd1' }));
    store.append(makeMsg({ id: 'd2' }));
    assert.equal(store.remove('d1'), true);
    assert.equal(store.remove('nope'), false);
    assert.deepEqual(store.items.map((m) => m.id), ['d2']);
    await sleep(420);
    assert.equal(new Store(file).items.length, 1);
  });

  test('去重能命中最近的相同短信', () => {
    const store = new Store(file);
    store.append(makeMsg({ id: 'fresh', from: '1069', content: '新短信', receivedAt: Date.now() }));
    store.append(
      makeMsg({ id: 'old', from: '1069', content: '旧短信', receivedAt: Date.now() - 60_000 })
    );

    assert.ok(store.findRecent('1069', '新短信', 30_000));
    assert.equal(store.findRecent('1069', '旧短信', 30_000), null);
    assert.equal(store.findRecent('9999', '新短信', 30_000), null);
  });

  test('搜索匹配号码、正文与验证码', () => {
    const store = new Store(file);
    store.append(makeMsg({ id: '1', from: '10690001', content: '您的验证码是 483920', code: '483920' }));
    store.append(makeMsg({ id: '2', from: '10086', content: '话费提醒', code: null }));

    assert.equal(store.list({ q: '10690001' }).total, 1);
    assert.equal(store.list({ q: '话费' }).total, 1);
    assert.equal(store.list({ q: '483920' }).total, 1);
    assert.equal(store.list({ q: '' }).total, 2);
  });

  test('分页参数生效', () => {
    const store = new Store(file);
    for (let i = 0; i < 5; i++) store.append(makeMsg({ id: 'i' + i, receivedAt: 1000 + i }));
    const page = store.list({ limit: 2, offset: 1 });
    assert.equal(page.total, 5);
    assert.equal(page.items.length, 2);
    assert.equal(page.items[0].id, 'i3');
  });

  test('超过上限时裁剪旧数据', async () => {
    const store = new Store(file, { maxMessages: 3 });
    for (let i = 0; i < 6; i++) store.append(makeMsg({ id: 'm' + i, receivedAt: 1000 + i }));
    assert.equal(store.items.length, 3);
    await sleep(420);
    assert.equal(new Store(file).items.length, 3);
  });

  test('pending 只挑出待发/重试中的消息', () => {
    const store = new Store(file);
    store.append(makeMsg({ id: 'ok', mail: { status: 'sent' } }));
    store.append(makeMsg({ id: 'p', mail: { status: 'pending' } }));
    store.append(makeMsg({ id: 'r', mail: { status: 'retry' } }));
    store.append(makeMsg({ id: 'f', mail: { status: 'failed' } }));
    assert.deepEqual(store.pending().map((m) => m.id).sort(), ['p', 'r']);
  });

  test('统计信息正确', () => {
    const store = new Store(file);
    store.append(makeMsg({ id: 'a', receivedAt: Date.now() }));
    store.append(makeMsg({ id: 'b', receivedAt: Date.now() - 3 * 86400_000 }));
    store.append(makeMsg({ id: 'c', mail: { status: 'failed' } }));
    const stats = store.stats();
    assert.equal(stats.total, 3);
    assert.equal(stats.today, 2);
    assert.equal(stats.failed, 1);
  });
});
