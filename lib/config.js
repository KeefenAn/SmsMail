'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULTS = {
  port: 8787,
  host: '0.0.0.0',
  publicUrl: '',
  adminToken: '',
  hookToken: '',
  hookSecret: '',
  strictSign: false,
  dedupeSeconds: 30,
  retryMax: 6,
  maxMessages: 5000,
  timezone: 'Asia/Shanghai',
  subject: '【短信】[from][code]',
  smtp: {
    host: '',
    port: 465,
    secure: true,
    starttls: 'auto',
    user: '',
    pass: '',
    fromName: '短信邮差',
    fromAddress: '',
    to: []
  },
  filters: {
    dropKeywords: [],
    allowSenders: [],
    denySenders: []
  }
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('hex');
}

function loadConfig(file) {
  let raw = {};
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (text) {
      try {
        raw = JSON.parse(text);
      } catch (err) {
        throw new Error(`配置文件 ${file} 不是合法 JSON：${err.message}`);
      }
    }
  }
  const cfg = deepMerge(DEFAULTS, raw);

  cfg.port = Number(cfg.port) || 8787;
  cfg.smtp.port = Number(cfg.smtp.port) || 465;
  cfg.smtp.secure = cfg.smtp.secure !== false;
  if (!Array.isArray(cfg.smtp.to)) cfg.smtp.to = String(cfg.smtp.to || '').split(/[,;]/).filter(Boolean);
  cfg.smtp.to = cfg.smtp.to.map((s) => String(s).trim()).filter(Boolean);
  if (!cfg.smtp.fromAddress) cfg.smtp.fromAddress = cfg.smtp.user || '';
  for (const k of ['dropKeywords', 'allowSenders', 'denySenders']) {
    if (!Array.isArray(cfg.filters[k])) cfg.filters[k] = [];
  }

  let changed = false;
  if (!cfg.adminToken) {
    cfg.adminToken = randomToken(18);
    changed = true;
  }
  if (!cfg.hookToken) {
    cfg.hookToken = randomToken(16);
    changed = true;
  }

  if (changed || !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  }
  return cfg;
}

function saveConfig(file, cfg) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** 给前端看的配置：隐去密钥 */
function publicConfig(cfg, hookUrl) {
  return {
    publicUrl: cfg.publicUrl,
    hookUrl,
    adminToken: cfg.adminToken,
    hookToken: cfg.hookToken,
    hookSecretSet: !!cfg.hookSecret,
    timezone: cfg.timezone,
    subject: cfg.subject,
    dedupeSeconds: cfg.dedupeSeconds,
    retryMax: cfg.retryMax,
    smtp: {
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: cfg.smtp.secure,
      starttls: cfg.smtp.starttls,
      user: cfg.smtp.user,
      passSet: !!cfg.smtp.pass,
      fromName: cfg.smtp.fromName,
      fromAddress: cfg.smtp.fromAddress,
      to: cfg.smtp.to
    },
    filters: cfg.filters
  };
}

/** 前端提交的部分配置 -> 合法配置补丁 */
function patchFromClient(body) {
  const p = {};
  const str = (v) => (typeof v === 'string' ? v.trim() : undefined);

  if (str(body.subject) !== undefined) p.subject = body.subject;
  if (str(body.timezone)) p.timezone = body.timezone;
  if (str(body.publicUrl) !== undefined) p.publicUrl = str(body.publicUrl);
  if (body.dedupeSeconds !== undefined) p.dedupeSeconds = Math.max(0, Number(body.dedupeSeconds) || 0);
  if (body.retryMax !== undefined) p.retryMax = Math.min(12, Math.max(0, Number(body.retryMax) || 0));

  if (isPlainObject(body.smtp)) {
    p.smtp = {};
    const s = body.smtp;
    if (str(s.host) !== undefined) p.smtp.host = str(s.host);
    if (s.port !== undefined) p.smtp.port = Number(s.port) || 465;
    if (s.secure !== undefined) p.smtp.secure = !!s.secure;
    if (str(s.starttls) !== undefined) p.smtp.starttls = s.starttls;
    if (str(s.user) !== undefined) p.smtp.user = str(s.user);
    if (typeof s.pass === 'string' && s.pass.trim().length) p.smtp.pass = s.pass.trim();
    if (str(s.fromName) !== undefined) p.smtp.fromName = str(s.fromName);
    if (str(s.fromAddress) !== undefined) p.smtp.fromAddress = str(s.fromAddress);
    if (s.to !== undefined) {
      const list = Array.isArray(s.to) ? s.to : String(s.to).split(/[,;\s，、]+/);
      p.smtp.to = list.map((x) => String(x).trim()).filter((x) => /.+@.+/.test(x));
    }
  }

  if (isPlainObject(body.filters)) {
    p.filters = {};
    for (const k of ['dropKeywords', 'allowSenders', 'denySenders']) {
      if (body.filters[k] !== undefined) {
        const list = Array.isArray(body.filters[k])
          ? body.filters[k]
          : String(body.filters[k]).split(/[\n,;，、]+/);
        p.filters[k] = list.map((x) => String(x).trim()).filter(Boolean);
      }
    }
  }

  return p;
}

module.exports = {
  DEFAULTS,
  loadConfig,
  saveConfig,
  publicConfig,
  patchFromClient,
  deepMerge,
  randomToken
};
