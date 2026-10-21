'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { extractCode, buildEmail, formatTime } = require('../lib/format');

describe('extractCode 验证码提取', () => {
  const cases = [
    ['【某银行】您的验证码是 483920，5分钟内有效。', '483920'],
    ['【某科技】验证码：771920', '771920'],
    ['您的 code 是 123456，请勿泄露', '123456'],
    ['本次登录验证码 1234', '1234'],
    ['123456 是您的验证码', '123456'],
    ['您的动态密码为 88991234', '88991234'],
    ['【提醒】您预约的体检已确认', null],
    ['您本月话费 38.00 元，余额 12.50 元。', null],
    ['订单 8891 已由快递员取件，预计今日送达', null],
    ['', null]
  ];

  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input).slice(0, 28)} → ${expected}`, () => {
      assert.equal(extractCode(input), expected);
    });
  }

  test('非字符串入参不抛异常', () => {
    assert.equal(extractCode(null), null);
    assert.equal(extractCode(123456), null);
  });
});

describe('buildEmail 邮件组装', () => {
  const cfg = {
    subject: '【短信】[from][code]',
    timezone: 'Asia/Shanghai'
  };
  const msg = {
    from: '10690001',
    content: '【某银行】您的验证码是 483920',
    code: '483920',
    receivedAt: Date.UTC(2026, 7, 5, 6, 22, 0),
    slot: '卡1',
    device: '备用机'
  };

  test('主题填充号码与验证码', () => {
    const { subject } = buildEmail(cfg, msg);
    assert.equal(subject, '【短信】10690001 验证码 483920');
  });

  test('没有验证码时主题不出现空占位', () => {
    const { subject } = buildEmail(cfg, { ...msg, code: null });
    assert.equal(subject, '【短信】10690001');
  });

  test('正文包含来源、时间、卡槽与原文', () => {
    const { text } = buildEmail(cfg, msg);
    assert.match(text, /发件号码：10690001/);
    assert.match(text, /接收时间：2026-08-05 14:22:00/);
    assert.match(text, /SIM 卡槽：卡1/);
    assert.match(text, /设备名称：备用机/);
    assert.match(text, /【某银行】您的验证码是 483920/);
  });

  test('HTML 版本对内容做了转义', () => {
    const { html } = buildEmail(cfg, { ...msg, content: '<script>alert(1)</script>' });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('formatTime 按配置时区格式化', () => {
    assert.equal(formatTime(Date.UTC(2026, 7, 5, 6, 22, 9), 'Asia/Shanghai'), '2026-08-05 14:22:09');
    assert.equal(formatTime(Date.UTC(2026, 7, 5, 6, 22, 9), 'UTC'), '2026-08-05 06:22:09');
  });
});
