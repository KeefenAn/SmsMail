'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const layout = document.querySelector('.layout');

  const state = {
    token: localStorage.getItem('smsmail.token') || '',
    config: null,
    items: [],
    stats: {},
    q: '',
    selected: null,
    es: null,
    timer: null
  };

  // ---------------- 基础工具 ----------------

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  async function copy(text, label = '已复制') {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast(label);
      } catch {
        toast('复制失败，请手动选择');
      }
      ta.remove();
    }
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (state.token) headers['x-auth-token'] = state.token;
    if (opts.body && !headers['content-type']) headers['content-type'] = 'application/json';
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* 忽略非 JSON */
    }
    if (res.status === 401 && path !== '/api/login') {
      showLogin('登录已失效，请重新输入令牌');
      throw new Error('未登录');
    }
    if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
    return data;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    if (new Date().toDateString() === d.toDateString()) return hm;
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  function fmtFull(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
      d.getMinutes()
    )}:${p(d.getSeconds())}`;
  }

  function avatarText(from) {
    const digits = (String(from).match(/\d/g) || []).join('');
    if (digits) return digits.slice(0, 3);
    return String(from).slice(0, 2).toUpperCase();
  }

  // ---------------- 登录 ----------------

  function showLogin(msg) {
    $('login').hidden = false;
    $('app').hidden = true;
    if (msg) {
      $('loginErr').textContent = msg;
      $('loginErr').hidden = false;
    }
    setTimeout(() => $('loginToken').focus(), 60);
  }

  function hideLogin() {
    $('login').hidden = true;
    $('loginErr').hidden = true;
    $('app').hidden = false;
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('loginToken').value.trim();
    if (!token) return;
    try {
      const data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ token })
      });
      state.token = token;
      state.config = data.config;
      localStorage.setItem('smsmail.token', token);
      $('loginToken').value = '';
      hideLogin();
      await refresh();
      connectSSE();
    } catch (err) {
      $('loginErr').textContent = err.message || '登录失败';
      $('loginErr').hidden = false;
    }
  });

  // ---------------- 列表 ----------------

  function renderStats() {
    const s = state.stats || {};
    const last = s.lastAt ? fmtTime(s.lastAt) : '—';
    $('stats').innerHTML = [
      `<span class="chip">全部 <b>${s.total || 0}</b></span>`,
      `<span class="chip">今天 <b>${s.today || 0}</b></span>`,
      `<span class="chip">最近一条 <b>${esc(last)}</b></span>`,
      s.failed ? `<span class="chip" style="color:var(--danger)">发送失败 <b>${s.failed}</b></span>` : ''
    ].join('');
  }

  function badgeFor(m) {
    const out = [];
    if (m.code) out.push(`<span class="badge code">${esc(m.code)}</span>`);
    if (m.slot) out.push(`<span class="badge">${esc(m.slot)}</span>`);
    const st = m.mail && m.mail.status;
    if (st === 'failed') out.push('<span class="badge fail">邮件失败</span>');
    else if (st === 'retry') out.push('<span class="badge retry">重试中</span>');
    else if (st === 'pending') out.push('<span class="badge">发送中</span>');
    return out.join('');
  }

  function renderList() {
    const list = $('list');
    const items = state.items;
    if (!items.length) {
      list.innerHTML = '';
      const url = (state.config && state.config.hookUrl) || '';
      $('empty').innerHTML = state.q
        ? '<span class="big">🔍</span>没有匹配「' + esc(state.q) + '」的短信'
        : '<span class="big">📭</span>还没有收到短信<br>' +
          '把手机端的推送地址设成下面这个，短信就会自动出现在这里：' +
          '<div style="margin-top:10px"><code style="word-break:break-all">' +
          esc(url) +
          '</code></div>';
      $('empty').hidden = false;
      return;
    }
    $('empty').hidden = true;
    list.innerHTML = items
      .map((m) => {
        const active = state.selected && state.selected.id === m.id ? ' active' : '';
        return `<li class="item${active}" data-id="${esc(m.id)}">
          <div class="avatar">${esc(avatarText(m.from))}</div>
          <div class="item-body">
            <div class="row1">
              <span class="from">${esc(m.from)}</span>
              <span class="time">${esc(fmtTime(m.receivedAt))}</span>
            </div>
            <div class="preview">${esc(String(m.content).replace(/\s+/g, ' '))}</div>
            <div class="item-foot">${badgeFor(m)}</div>
          </div>
        </li>`;
      })
      .join('');
  }

  $('list').addEventListener('click', (e) => {
    const li = e.target.closest('.item');
    if (!li) return;
    const msg = state.items.find((m) => m.id === li.dataset.id);
    if (msg) openDetail(msg);
  });

  async function refresh() {
    const data = await api(`/api/messages?limit=300&q=${encodeURIComponent(state.q)}`);
    state.items = data.items || [];
    state.stats = data.stats || {};
    renderStats();
    renderList();
    if (state.selected) {
      const still = state.items.find((m) => m.id === state.selected.id);
      if (still) fillDetail(still);
      else closeDetail();
    }
  }

  // ---------------- 详情 ----------------

  function openDetail(m) {
    state.selected = m;
    fillDetail(m);
    $('detail').hidden = false;
    layout.classList.remove('no-detail');
    renderList();
  }

  function closeDetail() {
    state.selected = null;
    $('detail').hidden = true;
    layout.classList.add('no-detail');
    renderList();
  }

  function fillDetail(m) {
    $('dFrom').textContent = m.from;
    const meta = [fmtFull(m.receivedAt)];
    if (m.slot) meta.push(m.slot);
    if (m.device) meta.push(m.device);
    $('dMeta').textContent = meta.join(' · ');
    $('dText').textContent = m.content;

    if (m.code) {
      $('dCode').hidden = false;
      $('dCodeVal').textContent = m.code;
    } else {
      $('dCode').hidden = true;
    }

    const st = m.mail || {};
    let text = '';
    if (st.status === 'sent') text = `✅ 邮件已发送 · ${fmtFull(st.at)}`;
    else if (st.status === 'retry')
      text = `⏳ 发送失败，第 ${st.attempts} 次重试中：${st.error || ''}`;
    else if (st.status === 'pending') text = '⏳ 正在发送邮件…';
    else if (st.status === 'failed') text = `❌ 邮件发送失败（已重试 ${st.attempts} 次）：${st.error || ''}`;
    $('dMail').textContent = text;
  }

  $('dClose').addEventListener('click', closeDetail);
  $('dCopy').addEventListener('click', () => state.selected && copy(state.selected.content, '原文已复制'));
  $('dCopyCode').addEventListener('click', () => state.selected && state.selected.code && copy(state.selected.code, '验证码已复制'));

  $('dResend').addEventListener('click', async () => {
    if (!state.selected) return;
    try {
      await api(`/api/messages/${encodeURIComponent(state.selected.id)}/resend`, { method: 'POST' });
      toast('已重新排入发送队列');
    } catch (e) {
      toast(e.message);
    }
  });

  $('dDelete').addEventListener('click', async () => {
    if (!state.selected) return;
    if (!confirm('删除这条短信记录？（不影响已发邮件）')) return;
    try {
      await api(`/api/messages/${encodeURIComponent(state.selected.id)}`, { method: 'DELETE' });
      state.items = state.items.filter((m) => m.id !== state.selected.id);
      closeDetail();
      renderStats();
      toast('已删除');
    } catch (e) {
      toast(e.message);
    }
  });

  // ---------------- 实时推送 ----------------

  function setLive(ok) {
    $('live').className = 'dot ' + (ok ? 'on' : 'off');
    $('statusText').textContent = ok ? '实时连接中' : '连接断开，正在重连…';
  }

  function connectSSE() {
    if (state.es) state.es.close();
    const es = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
    state.es = es;
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (data.type === 'new') {
        if (!state.q || match(data.message)) {
          state.items.unshift(data.message);
          renderList();
          const el = document.querySelector(`.item[data-id="${data.message.id}"]`);
          if (el) {
            el.classList.add('flash');
            setTimeout(() => el.classList.remove('flash'), 1300);
          }
        }
        bumpStats(data.message);
      } else if (data.type === 'update') {
        const i = state.items.findIndex((m) => m.id === data.message.id);
        if (i >= 0) state.items[i] = data.message;
        renderList();
        if (state.selected && state.selected.id === data.message.id) {
          state.selected = data.message;
          fillDetail(data.message);
        }
      } else if (data.type === 'delete') {
        state.items = state.items.filter((m) => m.id !== data.id);
        renderList();
      } else if (data.type === 'hello') {
        state.stats = data.stats || state.stats;
        renderStats();
      }
    };
  }

  function match(m) {
    const q = state.q.toLowerCase();
    return (
      String(m.from).toLowerCase().includes(q) ||
      String(m.content).toLowerCase().includes(q) ||
      (m.code && String(m.code).includes(q))
    );
  }

  function bumpStats(m) {
    state.stats.total = (state.stats.total || 0) + 1;
    state.stats.today = (state.stats.today || 0) + 1;
    state.stats.lastAt = m.receivedAt;
    renderStats();
  }

  // ---------------- 搜索 ----------------

  $('search').addEventListener('input', (e) => {
    state.q = e.target.value.trim();
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      refresh().catch((err) => toast(err.message));
    }, 250);
  });

  // ---------------- 设置 ----------------

  function splitList(v) {
    return String(v || '')
      .split(/[\n,;，、]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function openSettings() {
    const c = state.config || {};
    const smtp = c.smtp || {};
    $('hookUrl').value = c.hookUrl || '';
    $('hookNote').textContent = '令牌相当于密码，别发到公开的群里';
    $('smtpHost').value = smtp.host || '';
    $('smtpPort').value = smtp.port || 465;
    $('smtpUser').value = smtp.user || '';
    $('smtpPass').value = '';
    $('smtpPass').placeholder = smtp.passSet ? '已设置，留空表示不修改' : '邮箱授权码（不是登录密码）';
    $('smtpFromName').value = smtp.fromName || '';
    $('smtpFromAddr').value = smtp.fromAddress || '';
    $('smtpTo').value = (smtp.to || []).join(', ');
    $('subjectTpl').value = c.subject || '';
    $('dropKeywords').value = ((c.filters && c.filters.dropKeywords) || []).join(', ');
    $('allowSenders').value = ((c.filters && c.filters.allowSenders) || []).join(', ');
    $('denySenders').value = ((c.filters && c.filters.denySenders) || []).join(', ');
    $('adminTokenShow').textContent = c.adminToken || '';
    $('testResult').textContent = '';
    $('saveHint').textContent = '';
    $('settings').hidden = false;
  }

  $('btnSettings').addEventListener('click', openSettings);
  $('sClose').addEventListener('click', () => {
    $('settings').hidden = true;
  });
  $('settings').addEventListener('click', (e) => {
    if (e.target === $('settings')) $('settings').hidden = true;
  });

  $('copyHook').addEventListener('click', () => copy($('hookUrl').value, '推送地址已复制'));

  $('btnSave').addEventListener('click', async () => {
    const btn = $('btnSave');
    btn.disabled = true;
    $('saveHint').textContent = '保存中…';
    try {
      const body = {
        subject: $('subjectTpl').value,
        smtp: {
          host: $('smtpHost').value.trim(),
          port: Number($('smtpPort').value) || 465,
          user: $('smtpUser').value.trim(),
          pass: $('smtpPass').value,
          fromName: $('smtpFromName').value.trim(),
          fromAddress: $('smtpFromAddr').value.trim(),
          to: splitList($('smtpTo').value)
        },
        filters: {
          dropKeywords: splitList($('dropKeywords').value),
          allowSenders: splitList($('allowSenders').value),
          denySenders: splitList($('denySenders').value)
        }
      };
      const data = await api('/api/config', { method: 'PUT', body: JSON.stringify(body) });
      state.config = data.config;
      $('saveHint').textContent = '已保存';
      toast('设置已保存');
      setTimeout(() => ($('saveHint').textContent = ''), 2500);
    } catch (e) {
      $('saveHint').textContent = '保存失败：' + e.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('btnTest').addEventListener('click', async () => {
    const btn = $('btnTest');
    btn.disabled = true;
    $('testResult').textContent = '发送中…';
    try {
      const r = await api('/api/test', { method: 'POST' });
      $('testResult').textContent = r.message || '已发送';
    } catch (e) {
      $('testResult').textContent = '失败：' + e.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('rotateHook').addEventListener('click', async () => {
    if (!confirm('生成新的推送令牌后，手机 App 里的地址需要同步更新，确定吗？')) return;
    try {
      const data = await api('/api/tokens', { method: 'POST', body: JSON.stringify({ which: 'hook' }) });
      state.config = data.config;
      $('hookUrl').value = data.config.hookUrl;
      toast('新令牌已生成，记得改手机端');
    } catch (e) {
      toast(e.message);
    }
  });

  $('rotateAdmin').addEventListener('click', async () => {
    if (!confirm('生成新的网页登录令牌后，当前页面会用新令牌继续登录，确定吗？')) return;
    try {
      const data = await api('/api/tokens', { method: 'POST', body: JSON.stringify({ which: 'admin' }) });
      state.config = data.config;
      state.token = data.config.adminToken;
      localStorage.setItem('smsmail.token', state.token);
      $('adminTokenShow').textContent = state.token;
      connectSSE();
      toast('新的登录令牌已生效');
    } catch (e) {
      toast(e.message);
    }
  });

  // ---------------- 收尾 ----------------

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('settings').hidden) $('settings').hidden = true;
      else if (!$('detail').hidden) closeDetail();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (state.es) state.es.close();
  });

  async function boot() {
    layout.classList.add('no-detail');
    // 支持 ?token=xxx 直接登录（方便做成书签）
    const urlToken = new URLSearchParams(location.search).get('token');
    if (urlToken) {
      state.token = urlToken.trim();
      localStorage.setItem('smsmail.token', state.token);
      history.replaceState(null, '', location.pathname);
    }
    if (!state.token) return showLogin();
    try {
      const data = await api('/api/config');
      state.config = data.config;
      hideLogin();
      await refresh();
      connectSSE();
    } catch {
      showLogin('令牌无效，请重新输入');
    }
  }

  boot();
})();
