'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 消息存储：JSON Lines，一条一行，进程重启不丢。
 * 新消息 append 追加；修改字段时整体重写（带防抖），规模上限 maxMessages。
 */
class Store {
  constructor(file, { maxMessages = 5000 } = {}) {
    this.file = file;
    this.maxMessages = maxMessages;
    this.items = [];
    this.timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) return;
    const text = fs.readFileSync(this.file, 'utf8');
    const out = [];
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const item = JSON.parse(s);
        if (item && item.id) out.push(item);
      } catch {
        /* 跳过损坏行 */
      }
    }
    out.sort((a, b) => b.receivedAt - a.receivedAt);
    this.items = out.slice(0, this.maxMessages);
  }

  _appendLine(item) {
    fs.appendFileSync(this.file, JSON.stringify(item) + '\n');
  }

  _scheduleRewrite() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._rewrite();
    }, 300);
    if (this.timer.unref) this.timer.unref();
  }

  _rewrite() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.items.map((m) => JSON.stringify(m)).join('\n') + '\n');
    fs.renameSync(tmp, this.file);
  }

  append(item) {
    this.items.unshift(item);
    this._appendLine(item);
    if (this.items.length > this.maxMessages) {
      this.items = this.items.slice(0, this.maxMessages);
      this._scheduleRewrite();
    }
    return item;
  }

  get(id) {
    return this.items.find((m) => m.id === id) || null;
  }

  patch(id, fields) {
    const item = this.get(id);
    if (!item) return null;
    Object.assign(item, fields);
    this._scheduleRewrite();
    return item;
  }

  remove(id) {
    const idx = this.items.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    this._scheduleRewrite();
    return true;
  }

  clear() {
    this.items = [];
    this._scheduleRewrite();
  }

  findRecent(from, content, withinMs) {
    const since = Date.now() - withinMs;
    for (const m of this.items) {
      // 不提前 break：万一条目时间戳乱序，去重也不能失手
      if (m.receivedAt < since) continue;
      if (m.from === from && m.content === content) return m;
    }
    return null;
  }

  list({ q = '', limit = 100, offset = 0 } = {}) {
    let arr = this.items;
    const needle = String(q || '').trim().toLowerCase();
    if (needle) {
      arr = arr.filter(
        (m) =>
          m.from.toLowerCase().includes(needle) ||
          m.content.toLowerCase().includes(needle) ||
          (m.code && String(m.code).includes(needle))
      );
    }
    return {
      total: arr.length,
      items: arr.slice(offset, offset + limit)
    };
  }

  stats() {
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    return {
      total: this.items.length,
      today: this.items.filter((m) => now - m.receivedAt < day).length,
      lastAt: this.items.length ? this.items[0].receivedAt : 0,
      failed: this.items.filter((m) => m.mail && m.mail.status === 'failed').length
    };
  }

  /** 进程重启后，把没发出去的邮件重新排队 */
  pending() {
    return this.items.filter((m) => m.mail && (m.mail.status === 'pending' || m.mail.status === 'retry'));
  }
}

module.exports = { Store };
