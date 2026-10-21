'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { sendMail, buildMime, encodeHeaderText, formatAddress, SmtpError } = require('../lib/smtp');
const { startMockSmtp } = require('./support/mock-smtp');
const { parseMail } = require('./support/mail-utils');

describe('邮件头编码', () => {
  test('纯 ASCII 原样输出', () => {
    assert.equal(encodeHeaderText('Hello world'), 'Hello world');
  });

  test('中文编码成 base64 encoded-word', () => {
    const out = encodeHeaderText('短信邮差');
    assert.match(out, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    const b64 = out.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, '');
    assert.equal(Buffer.from(b64, 'base64').toString('utf8'), '短信邮差');
  });

  test('长中文会拆成多个 encoded-word', () => {
    const out = encodeHeaderText('这是一段很长很长的中文主题用来测试自动折行处理逻辑是否正确');
    assert.match(out, /\?=\r\n =\?/, '多个 encoded-word 之间应该用 CRLF+空格续行');
  });

  test('换行被清理，无法注入额外邮件头', () => {
    const out = encodeHeaderText('abc\r\nBcc: evil@example.com');
    assert.ok(!out.includes('\r'));
    assert.ok(!out.includes('\n'));
  });

  test('地址格式化', () => {
    assert.equal(formatAddress('', 'a@b.com'), '<a@b.com>');
    assert.equal(formatAddress('SmsMail', 'a@b.com'), '"SmsMail" <a@b.com>');
    assert.match(formatAddress('短信邮差', 'a@b.com'), /^=\?UTF-8\?B\?.*\?= <a@b\.com>$/);
  });
});

describe('buildMime 报文结构', () => {
  const raw = buildMime({
    fromName: '短信邮差',
    fromAddress: 'sender@example.com',
    to: ['a@example.com', 'b@example.com'],
    subject: '【短信】10690001',
    text: '纯文本正文',
    html: '<b>HTML 正文</b>'
  });

  test('包含必要的邮件头', () => {
    for (const header of ['From:', 'To:', 'Subject:', 'Date:', 'Message-ID:', 'MIME-Version:']) {
      assert.ok(raw.includes(header), `缺少 ${header}`);
    }
  });

  test('两个收件人都在 To 里', () => {
    assert.match(raw, /To: <a@example\.com>, <b@example\.com>/);
  });

  test('multipart/alternative 能被解析回原文', () => {
    const parsed = parseMail(raw);
    assert.equal(parsed.text.trim(), '纯文本正文');
    assert.equal(parsed.html.trim(), '<b>HTML 正文</b>');
    assert.equal(parsed.subject, '【短信】10690001');
  });

  test('以 . 开头的行会被 dot-stuffing 保护', () => {
    const withDot = buildMime({
      fromAddress: 'a@example.com',
      to: ['b@example.com'],
      subject: 'x',
      text: '.隐藏的一行'
    });
    // 原文是 base64 传输的，报文里不应该出现裸的 "\r\n.\r\n"
    assert.ok(!withDot.includes('\r\n.\r\n'));
  });
});

describe('SMTP 会话', () => {
  let mock;
  before(async () => {
    mock = await startMockSmtp();
  });
  after(async () => {
    await mock.close();
  });

  const base = () => ({
    host: '127.0.0.1',
    port: mock.port,
    secure: false,
    starttls: false,
    user: 'test@example.com',
    pass: 'testpass',
    fromName: '短信邮差',
    fromAddress: 'test@example.com',
    to: ['boss@example.com'],
    subject: '测试主题',
    text: '测试正文',
    timeoutMs: 5000
  });

  test('认证成功并把邮件投递出去', async () => {
    const result = await sendMail(base());
    assert.equal(result.ok, true);
    const mail = mock.messages[mock.messages.length - 1];
    assert.deepEqual(mail.to, ['boss@example.com']);
    assert.equal(mail.user, 'test@example.com');
    assert.match(parseMail(mail.data).text, /测试正文/);
  });

  test('授权码错误时报 535 且信息可读', async () => {
    await assert.rejects(
      () => sendMail({ ...base(), pass: 'wrong-pass' }),
      (err) => {
        assert.ok(err instanceof SmtpError);
        assert.equal(err.code, 535);
        assert.match(err.message, /认证失败/);
        return true;
      }
    );
  });

  test('要求 STARTTLS 但服务器不支持时拒绝发送', async () => {
    await assert.rejects(
      () => sendMail({ ...base(), starttls: true }),
      (err) => {
        assert.match(err.message, /STARTTLS/);
        return true;
      }
    );
  });

  test('没有收件人时提前失败', async () => {
    await assert.rejects(() => sendMail({ ...base(), to: [] }), /收件邮箱/);
  });

  test('连不上服务器时报连接错误', async () => {
    await assert.rejects(
      () => sendMail({ ...base(), port: 1, timeoutMs: 3000 }),
      (err) => {
        assert.match(err.message, /失败/);
        return true;
      }
    );
  });
});
