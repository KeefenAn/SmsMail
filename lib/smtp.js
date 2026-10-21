'use strict';

/**
 * 极简 SMTP 客户端（零依赖）
 * 支持：465 隐式 TLS / 587·25 STARTTLS / AUTH LOGIN|PLAIN / multipart 邮件
 * 只做一件事：把一封邮件交给 SMTP 服务器。
 */

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

class SmtpError extends Error {
  constructor(message, code, response) {
    super(message);
    this.name = 'SmtpError';
    this.code = code;
    this.response = response;
  }
}

class Session {
  constructor(opts = {}) {
    this.opts = opts;
    this.sock = null;
    this.buf = '';
    this.partial = [];
    this.ready = [];
    this.pending = null;
    this.dead = null;
    this.caps = new Set();
  }

  // ---------- 底层 IO ----------

  attach(sock) {
    this.sock = sock;
    this.buf = '';
    this.partial = [];
    this.ready = [];
    this.dead = null;
    sock.setEncoding('utf8');
    if (this.opts.timeoutMs) sock.setTimeout(this.opts.timeoutMs);
    sock.on('data', (chunk) => this._onData(chunk));
    sock.on('error', (err) => this._abort(err));
    sock.on('timeout', () => this._abort(new SmtpError('SMTP 连接超时')));
    sock.on('close', () => this._abort(new SmtpError('SMTP 连接被服务器关闭')));
  }

  _detach() {
    const s = this.sock;
    if (!s) return;
    s.removeAllListeners('data');
    s.removeAllListeners('error');
    s.removeAllListeners('timeout');
    s.removeAllListeners('close');
    this.sock = null;
  }

  _onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      let line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.partial.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const lines = this.partial;
        this.partial = [];
        const p = this.pending;
        if (p) {
          this.pending = null;
          p.resolve(lines);
        } else {
          this.ready.push(lines);
        }
      }
    }
  }

  _abort(err) {
    const p = this.pending;
    this.pending = null;
    if (p) p.reject(err);
    else this.dead = err;
  }

  _read() {
    if (this.ready.length) return Promise.resolve(this.ready.shift());
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  async _send(raw, label, okCodes) {
    if (!this.sock || this.sock.destroyed) throw new SmtpError('SMTP 连接不可用');
    this.sock.write(raw + '\r\n');
    const lines = await this._read();
    const code = parseInt(String(lines[lines.length - 1] || '').slice(0, 3), 10);
    const ok = Array.isArray(okCodes) ? okCodes.includes(code) : code === okCodes;
    if (!ok) {
      throw new SmtpError(`${label} 被拒绝（${code || '???'}）：${lines.join(' / ')}`, code, lines);
    }
    return { code, lines };
  }

  async _cmd(line, okCodes) {
    return this._send(line, line.split(' ')[0], okCodes);
  }

  // ---------- 连接 ----------

  async connect() {
    const { host } = this.opts;
    const port = Number(this.opts.port) || 465;
    if (!host) throw new SmtpError('未配置 SMTP 服务器地址');
    const secure = this.opts.secure === true || (this.opts.secure !== false && port === 465);

    if (secure) await this._openTls({ host, port });
    else await this._openPlain({ host, port });

    const greet = await this._read();
    this._check(greet, [220], 'SMTP 握手');

    let ehlo = await this._ehlo();

    const wantStarttls = this.opts.starttls !== false;
    if (!secure && wantStarttls) {
      if (this.caps.has('STARTTLS')) {
        await this._cmd('STARTTLS', 220);
        const plain = this.sock;
        this._detach();
        await this._openTls({ host, port, socket: plain });
        ehlo = await this._ehlo();
      } else if (this.opts.starttls === true) {
        throw new SmtpError('服务器未提供 STARTTLS，已在未加密连接中止');
      }
    }

    if (this.opts.user) await this._auth();

    return this;
  }

  _check(lines, codes, label) {
    const code = parseInt(String(lines[lines.length - 1] || '').slice(0, 3), 10);
    if (!codes.includes(code)) {
      throw new SmtpError(`${label} 失败（${code || '???'}）：${lines.join(' / ')}`, code, lines);
    }
    return code;
  }

  _openPlain({ host, port }) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host, port });
      const onErr = (err) => reject(new SmtpError(`连接 ${host}:${port} 失败：${err.message}`));
      sock.once('error', onErr);
      sock.once('connect', () => {
        sock.removeListener('error', onErr);
        this._rawSock = null;
        this.attach(sock);
        resolve();
      });
    });
  }

  _openTls({ host, port, socket }) {
    return new Promise((resolve, reject) => {
      const options = {
        host: host,
        port: port,
        servername: host,
        rejectUnauthorized: !this.opts.tlsInsecure
      };
      if (socket) {
        options.socket = socket;
        delete options.host;
        delete options.port;
      }
      const sock = tls.connect(options);
      const onErr = (err) =>
        reject(new SmtpError(`TLS ${host}:${port} 失败：${err.message}`, null, null));
      sock.once('error', onErr);
      sock.once('secureConnect', () => {
        sock.removeListener('error', onErr);
        this.attach(sock);
        resolve();
      });
    });
  }

  async _ehlo() {
    let res;
    try {
      res = await this._cmd(`EHLO ${this.opts.ehloName || 'smtpmail.local'}`, 250);
    } catch (err) {
      // 老服务器可能只认 HELO
      res = await this._cmd(`HELO ${this.opts.ehloName || 'smtpmail.local'}`, 250);
    }
    this.caps = new Set();
    for (const line of res.lines.slice(1)) {
      const text = line.slice(4).trim().toUpperCase();
      if (text) this.caps.add(text.split(/\s+/)[0]);
    }
    return res;
  }

  async _auth() {
    const user = String(this.opts.user || '');
    const pass = String(this.opts.pass || '');
    if (!pass) throw new SmtpError('未配置 SMTP 授权码/密码');

    try {
      await this._send('AUTH LOGIN', 'AUTH', 334);
      await this._send(Buffer.from(user, 'utf8').toString('base64'), 'AUTH 用户名', 334);
      await this._send(Buffer.from(pass, 'utf8').toString('base64'), 'AUTH 密码', 235);
      return;
    } catch (err) {
      if (err.code === 535 || err.code === 534) {
        throw new SmtpError(`邮箱认证失败：授权码错误或未开启 SMTP 服务（${err.message}）`, 535);
      }
      // 部分服务器只支持 PLAIN
    }

    const token = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64');
    await this._send(`AUTH PLAIN ${token}`, 'AUTH PLAIN', 235);
  }

  async sendEnvelope({ from, to, raw }) {
    const fromAddr = extractAddress(from);
    await this._cmd(`MAIL FROM:<${fromAddr}>`, [250, 251]);
    for (const rcpt of to) {
      const addr = extractAddress(rcpt);
      if (!addr) continue;
      await this._cmd(`RCPT TO:<${addr}>`, [250, 251]);
    }
    await this._cmd('DATA', 354);
    const payload = dotStuff(raw);
    await this._send(payload + (payload.endsWith('\r\n') ? '' : '\r\n') + '.', 'DATA 正文', 250);
  }

  async quit() {
    try {
      await this._cmd('QUIT', [221, 250]);
    } catch {
      /* 忽略 */
    }
    this.destroy();
  }

  destroy() {
    try {
      if (this.sock) this.sock.destroy();
    } catch {
      /* 忽略 */
    }
    this._detach();
    this.dead = null;
  }
}

// ---------- 工具函数 ----------

function extractAddress(value) {
  const s = String(value || '').trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}

function stripCRLF(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
}

function encodeHeaderText(str) {
  const s = stripCRLF(str);
  if (!s) return '';
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const b64 = Buffer.from(s, 'utf8').toString('base64');
  const chunks = b64.match(/.{1,60}/g) || [''];
  return chunks.map((c) => `=?UTF-8?B?${c}?=`).join('\r\n ');
}

function formatAddress(name, address) {
  const addr = stripCRLF(address);
  const nm = stripCRLF(name);
  if (!nm) return `<${addr}>`;
  if (/^[\x20-\x7E]*$/.test(nm) && !/["\\]/.test(nm)) {
    return `"${nm}" <${addr}>`;
  }
  return `${encodeHeaderText(nm)} <${addr}>`;
}

function b64Body(text) {
  const b64 = Buffer.from(String(text), 'utf8').toString('base64');
  return b64.replace(/.{1,76}/g, (m) => m + '\r\n').replace(/\r\n$/, '');
}

function dotStuff(body) {
  return String(body)
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? '.' + line : line))
    .join('\r\n');
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomId(len = 16) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function buildMime({ fromName, fromAddress, to, subject, text, html, messageId }) {
  const boundary = `----=_smsmail_${randomId(20)}`;
  const domain = (extractAddress(fromAddress).split('@')[1] || 'localhost').replace(/[^\w.-]/g, '');
  const mid = messageId || `<${Date.now()}.${randomId(12)}@${domain}>`;

  const head = [
    `From: ${formatAddress(fromName, fromAddress)}`,
    `To: ${to.map((a) => formatAddress('', a)).join(', ')}`,
    `Subject: ${encodeHeaderText(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${mid}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    'X-Mailer: SmsMail/1.0'
  ];

  const parts = [];
  parts.push(
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Body(text)
    ].join('\r\n')
  );
  if (html) {
    parts.push(
      [
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64Body(html)
      ].join('\r\n')
    );
  }
  parts.push(`--${boundary}--`, '');

  return head.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + '\r\n';
}

/**
 * @param {object} o host port secure starttls user pass fromName fromAddress to[] subject text html timeoutMs tlsInsecure
 */
async function sendMail(o) {
  const to = Array.isArray(o.to) ? o.to.filter(Boolean) : String(o.to || '').split(/[,;]/).filter(Boolean);
  if (!to.length) throw new SmtpError('未配置收件邮箱');

  const fromAddress = o.fromAddress || o.user;
  const fromName = o.fromName || '';
  const raw = buildMime({
    fromName,
    fromAddress,
    to,
    subject: o.subject,
    text: o.text,
    html: o.html
  });

  const session = new Session({
    host: o.host,
    port: o.port,
    secure: o.secure,
    starttls: o.starttls === undefined ? 'auto' : o.starttls,
    tlsInsecure: !!o.tlsInsecure,
    timeoutMs: o.timeoutMs || 25000,
    user: o.user,
    pass: o.pass,
    ehloName: o.ehloName
  });

  try {
    await session.connect();
    await session.sendEnvelope({ from: formatAddress(fromName, fromAddress), to, raw });
    await session.quit();
    return { ok: true, to };
  } catch (err) {
    session.destroy();
    throw err;
  }
}

module.exports = { sendMail, buildMime, SmtpError, encodeHeaderText, formatAddress };
