'use strict';

/** 测试用的小工具：解析邮件报文、轮询等待 */

function decodeWords(input) {
  return String(input)
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'))
    .replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_, q) =>
      Buffer.from(q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8')
    );
}

function parseHeaders(raw) {
  const headers = {};
  let current = null;
  for (const line of raw.split('\r\n')) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] += ' ' + line.trim();
      continue;
    }
    const i = line.indexOf(':');
    if (i > 0) {
      current = line.slice(0, i).toLowerCase();
      headers[current] = line.slice(i + 1).trim();
    }
  }
  return headers;
}

function decodeBody(body, encoding) {
  if (String(encoding || '').toLowerCase() === 'base64') {
    return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  return body;
}

/** 解析一封 MIME 邮件，返回 { headers, subject, text, html } */
function parseMail(raw) {
  const split = raw.indexOf('\r\n\r\n');
  const headRaw = split >= 0 ? raw.slice(0, split) : raw;
  const body = split >= 0 ? raw.slice(split + 4) : '';
  const headers = parseHeaders(headRaw);

  const result = {
    headers,
    subject: decodeWords(headers.subject || ''),
    text: '',
    html: ''
  };

  const boundary = /boundary="?([^";]+)"?/i.exec(headers['content-type'] || '');
  if (!boundary) {
    result.text = decodeBody(body, headers['content-transfer-encoding']);
    return result;
  }

  const marker = '--' + boundary[1];
  for (const chunk of body.split(marker)) {
    const part = chunk.replace(/^\r\n/, '');
    if (!part || part.startsWith('--')) continue;
    const i = part.indexOf('\r\n\r\n');
    if (i < 0) continue;
    const ph = parseHeaders(part.slice(0, i));
    const pb = part.slice(i + 4).replace(/\r\n$/, '');
    const content = decodeBody(pb, ph['content-transfer-encoding']);
    const type = String(ph['content-type'] || '').toLowerCase();
    if (type.startsWith('text/plain')) result.text = content;
    else if (type.startsWith('text/html')) result.html = content;
  }

  return result;
}

/** 轮询直到 callback 返回真值，超时报错 */
async function waitFor(fn, { timeout = 5000, interval = 40, message = '等待超时' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`${message}（${timeout}ms）`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { parseMail, decodeWords, waitFor, sleep };
