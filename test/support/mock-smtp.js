'use strict';

/**
 * 假的 SMTP 服务器，只用于测试。
 * 支持 EHLO / AUTH LOGIN / AUTH PLAIN / MAIL / RCPT / DATA / QUIT。
 *
 * 单独跑：node test/support/mock-smtp.js 2525
 */

const net = require('node:net');

function startMockSmtp({ port = 0, host = '127.0.0.1', user = 'test@example.com', pass = 'testpass' } = {}) {
  const messages = [];

  const server = net.createServer((sock) => {
    let buf = '';
    let inData = false;
    let dataLines = [];
    let envelope = { from: '', to: [] };
    let authState = null;
    let authUser = '';

    sock.setEncoding('utf8');
    sock.write('220 mock.smtp ESMTP ready\r\n');

    const reply = (s) => sock.write(s + '\r\n');

    sock.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push({
              from: envelope.from,
              to: envelope.to.slice(),
              data: dataLines.join('\r\n'),
              user: authUser
            });
            dataLines = [];
            envelope = { from: '', to: [] };
            reply('250 2.0.0 Ok: queued');
          } else {
            dataLines.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }

        if (authState === 'user') {
          authUser = Buffer.from(line, 'base64').toString('utf8');
          authState = 'pass';
          reply('334 UGFzc3dvcmQ6');
          continue;
        }
        if (authState === 'pass') {
          const pwd = Buffer.from(line, 'base64').toString('utf8');
          authState = null;
          if (authUser === user && pwd === pass) reply('235 2.7.0 Authentication successful');
          else reply('535 5.7.8 Authentication credentials invalid');
          continue;
        }

        const up = line.toUpperCase();
        if (up.startsWith('EHLO')) {
          sock.write('250-mock.smtp\r\n');
          sock.write('250-8BITMIME\r\n');
          sock.write('250-AUTH LOGIN PLAIN\r\n');
          sock.write('250 SMTPUTF8\r\n');
        } else if (up.startsWith('HELO')) {
          reply('250 mock.smtp');
        } else if (up === 'AUTH LOGIN') {
          authState = 'user';
          reply('334 VXNlcm5hbWU6');
        } else if (up.startsWith('AUTH PLAIN')) {
          const parts = line.split(' ');
          const token = parts[2] ? Buffer.from(parts[2], 'base64').toString('utf8') : '';
          const [, u, p] = token.split('\u0000');
          if (u === user && p === pass) {
            authUser = u;
            reply('235 2.7.0 Authentication successful');
          } else {
            reply('535 5.7.8 Authentication credentials invalid');
          }
        } else if (up.startsWith('MAIL FROM')) {
          envelope.from = (line.match(/<([^>]*)>/) || [])[1] || '';
          reply('250 2.1.0 Ok');
        } else if (up.startsWith('RCPT TO')) {
          envelope.to.push((line.match(/<([^>]*)>/) || [])[1] || '');
          reply('250 2.1.5 Ok');
        } else if (up === 'DATA') {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (up === 'RSET' || up === 'NOOP') {
          reply('250 2.0.0 Ok');
        } else if (up === 'QUIT') {
          reply('221 2.0.0 Bye');
          sock.end();
        } else {
          reply('502 5.5.2 Command not implemented');
        }
      }
    });

    sock.on('error', () => {});
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        messages,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

module.exports = { startMockSmtp };

if (require.main === module) {
  const port = Number(process.argv[2] || 2525);
  startMockSmtp({ port }).then((m) => {
    console.log(`假 SMTP 已启动 127.0.0.1:${m.port}（账号 test@example.com / testpass）`);
    setInterval(() => {
      while (m.messages.length) {
        const msg = m.messages.shift();
        console.log('--- 收到邮件 ---');
        console.log(msg.data.slice(0, 800));
      }
    }, 500);
  });
}
