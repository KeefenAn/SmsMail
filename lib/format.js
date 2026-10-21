'use strict';

/**
 * 短信内容 -> 验证码提取 + 邮件正文组装
 */

const CODE_KEYWORDS =
  /(验证码|校验码|动态码|动态密码|确认码|激活码|安全码|登录码|短信密码|认证码|code|otp|verification)/i;

const CODE_PATTERNS = [
  // 验证码 123456 / 验证码是：123456 / code: 123456
  /(?:验证码|校验码|动态码|动态密码|确认码|激活码|安全码|登录码|认证码|code|otp)\D{0,12}?(\d{4,8})/i,
  // 123456 是您的验证码 / 123456为您的校验码
  /(\d{4,8})\D{0,8}?(?:是|为|即)?\s*(?:您的|你的|本次)?\s*(?:验证码|校验码|动态码|动态密码|确认码)/,
  // 6 位独立数字兜底（仅在出现关键词时启用）
  /(?<!\d)(\d{6})(?!\d)/
];

function extractCode(text) {
  if (!text) return null;
  const s = String(text);
  const hasKeyword = CODE_KEYWORDS.test(s);
  for (let i = 0; i < CODE_PATTERNS.length; i++) {
    if (i === 2 && !hasKeyword) continue;
    const m = s.match(CODE_PATTERNS[i]);
    if (m) return m[1];
  }
  return null;
}

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function formatTime(ts, timeZone) {
  const d = new Date(ts);
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timeZone || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(d);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  } catch {
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 组装邮件主题 + 正文
 * 主题模板可用占位符：[from] [code] [time] [device]
 */
function buildEmail(cfg, msg) {
  const when = formatTime(msg.receivedAt, cfg.timezone);
  const code = msg.code || '';
  const from = msg.from || '未知号码';

  let subject = cfg.subject || '【短信】[from][code]';
  subject = subject
    .replace(/\[from\]/g, from)
    .replace(/\[code\]/g, code ? ` 验证码 ${code}` : '')
    .replace(/\[time\]/g, when)
    .replace(/\[device\]/g, msg.device || '');

  const lines = [];
  lines.push(`发件号码：${from}`);
  lines.push(`接收时间：${when}`);
  if (msg.slot) lines.push(`SIM 卡槽：${msg.slot}`);
  if (msg.device) lines.push(`设备名称：${msg.device}`);
  lines.push('');
  lines.push('———— 短信内容 ————');
  lines.push(msg.content);
  lines.push('————————————————');
  if (code) {
    lines.push('');
    lines.push(`提取到的验证码：${code}`);
  }
  lines.push('');
  lines.push(`-- 由短信邮差于 ${when} 自动转发`);

  const text = lines.join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:14px;padding:22px 22px 18px;border:1px solid #e6e8ec;">
      <div style="font-size:13px;color:#8a8f98;letter-spacing:.4px;">短信邮差 · 自动转发</div>
      <div style="font-size:22px;font-weight:600;color:#111827;margin:6px 0 2px;">${escapeHtml(from)}</div>
      <div style="font-size:13px;color:#8a8f98;">${escapeHtml(when)}${msg.slot ? ' · ' + escapeHtml(msg.slot) : ''}</div>
      ${
        code
          ? `<div style="margin:16px 0 4px;padding:14px 16px;background:#eef3ff;border-radius:10px;text-align:center;">
               <div style="font-size:12px;color:#5b6b8c;margin-bottom:4px;">验证码</div>
               <div style="font-size:30px;font-weight:700;letter-spacing:6px;color:#2f5bd8;font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(code)}</div>
             </div>`
          : ''
      }
      <div style="margin-top:16px;padding:14px 16px;background:#f7f8fa;border-radius:10px;font-size:15px;line-height:1.7;color:#1f2937;white-space:pre-wrap;word-break:break-word;">${escapeHtml(msg.content)}</div>
      <div style="margin-top:18px;font-size:12px;color:#a0a6b0;">由「短信邮差」自动发送，如有疑问请在网页收件箱查看原文。</div>
    </div>
  </div>
</body></html>`;

  return { subject, text, html };
}

module.exports = { extractCode, buildEmail, formatTime, escapeHtml };
