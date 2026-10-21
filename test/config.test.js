'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadConfig,
  saveConfig,
  publicConfig,
  patchFromClient,
  deepMerge
} = require('../lib/config');

describe('配置文件加载', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smsmail-cfg-'));
    file = path.join(dir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('文件不存在时生成默认配置并写入随机令牌', () => {
    const cfg = loadConfig(file);
    assert.ok(fs.existsSync(file));
    assert.match(cfg.adminToken, /^[0-9a-f]{36}$/);
    assert.match(cfg.hookToken, /^[0-9a-f]{32}$/);
    assert.equal(cfg.port, 8787);
    assert.equal(cfg.smtp.secure, true);

    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.adminToken, cfg.adminToken);
  });

  test('已有令牌不会被覆盖', () => {
    fs.writeFileSync(file, JSON.stringify({ adminToken: 'keep-me', hookToken: 'keep-hook' }));
    const cfg = loadConfig(file);
    assert.equal(cfg.adminToken, 'keep-me');
    assert.equal(cfg.hookToken, 'keep-hook');
  });

  test('收件人字符串自动拆成数组', () => {
    fs.writeFileSync(file, JSON.stringify({ smtp: { to: 'a@x.com; b@y.com,,c@z.com' } }));
    const cfg = loadConfig(file);
    assert.deepEqual(cfg.smtp.to, ['a@x.com', 'b@y.com', 'c@z.com']);
  });

  test('非法 JSON 给出明确报错', () => {
    fs.writeFileSync(file, '{ not json');
    assert.throws(() => loadConfig(file), /不是合法 JSON/);
  });

  test('保存后能原样读回', () => {
    const cfg = loadConfig(file);
    cfg.subject = '【新主题】[from]';
    saveConfig(file, cfg);
    const again = loadConfig(file);
    assert.equal(again.subject, '【新主题】[from]');
  });
});

describe('给前端的配置', () => {
  test('隐藏授权码，只暴露是否已设置', () => {
    const cfg = loadConfig(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'smsmail-pub-')), 'c.json'));
    cfg.smtp.pass = 'super-secret';
    const pub = publicConfig(cfg, 'https://example.com/hook/t');
    assert.equal(pub.smtp.passSet, true);
    assert.equal(pub.smtp.pass, undefined);
    assert.ok(!JSON.stringify(pub).includes('super-secret'));
    assert.equal(pub.hookUrl, 'https://example.com/hook/t');
  });
});

describe('patchFromClient 输入清洗', () => {
  test('忽略未声明的字段', () => {
    const patch = patchFromClient({ hacker: 1, adminToken: 'evil' });
    assert.equal(patch.adminToken, undefined);
    assert.equal(patch.hacker, undefined);
  });

  test('空的授权码不会覆盖已有值', () => {
    const patch = patchFromClient({ smtp: { host: 'smtp.qq.com', pass: '' } });
    assert.equal(patch.smtp.pass, undefined);
    assert.equal(patch.smtp.host, 'smtp.qq.com');
  });

  test('空格形式的授权码也会被丢弃', () => {
    const patch = patchFromClient({ smtp: { pass: '   ' } });
    assert.equal(patch.smtp.pass, undefined);
  });

  test('非法邮箱被过滤，合法邮箱被去空格', () => {
    const patch = patchFromClient({ smtp: { to: ' a@b.com , not-an-email , c@d.com ' } });
    assert.deepEqual(patch.smtp.to, ['a@b.com', 'c@d.com']);
  });

  test('过滤词支持换行与中文逗号分隔', () => {
    const patch = patchFromClient({ filters: { dropKeywords: '退订\n回复TD，广告' } });
    assert.deepEqual(patch.filters.dropKeywords, ['退订', '回复TD', '广告']);
  });

  test('数值字段被夹到合理范围', () => {
    assert.equal(patchFromClient({ retryMax: 999 }).retryMax, 12);
    assert.equal(patchFromClient({ retryMax: -5 }).retryMax, 0);
  });
});

describe('deepMerge', () => {
  test('嵌套对象逐层合并', () => {
    const base = { a: 1, smtp: { host: 'h', to: ['x'] } };
    const out = deepMerge(base, { smtp: { to: ['y'] } });
    assert.deepEqual(out, { a: 1, smtp: { host: 'h', to: ['y'] } });
  });

  test('不修改原对象', () => {
    const base = { smtp: { host: 'h' } };
    deepMerge(base, { smtp: { host: 'changed' } });
    assert.equal(base.smtp.host, 'h');
  });

  test('undefined 不会覆盖已有值', () => {
    const out = deepMerge({ a: 1 }, { a: undefined });
    assert.equal(out.a, 1);
  });
});
