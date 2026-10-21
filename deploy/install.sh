#!/usr/bin/env bash
# 短信邮差 一键安装脚本（Ubuntu / Debian）
# 用法：把整个文件夹传到服务器，然后
#   cd sms-mailer && sudo bash deploy/install.sh
set -euo pipefail

APP_DIR=/opt/smsmail
RUN_USER=smsmail
SVC=smsmail
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

info() { printf '\033[36m›\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行：sudo bash deploy/install.sh"
  exit 1
fi

# ---------- 1. Node.js ----------
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${major:-0}" -ge 20 ]; then
    NODE_BIN="$(command -v node)"
    ok "已检测到 Node.js $(node -v)"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  case "$(uname -m)" in
    x86_64|amd64) ARCH=linux-x64 ;;
    aarch64|arm64) ARCH=linux-arm64 ;;
    *) echo "不支持的架构：$(uname -m)"; exit 1 ;;
  esac

  need_pkg() {
    command -v "$1" >/dev/null 2>&1 && return 0
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -qq >/dev/null 2>&1 || true
      apt-get install -y -qq "$2" >/dev/null 2>&1 || true
    fi
  }
  need_pkg curl curl
  need_pkg xz xz-utils
  need_pkg tar tar

  info "未找到 Node.js 20+，正在下载 Node.js 22 (${ARCH})…"
  NODE_BASE="https://nodejs.org/dist/latest-v22.x"
  NODE_FILE="$(curl -fsSL "${NODE_BASE}/SHASUMS256.txt" 2>/dev/null | grep "linux-${ARCH}\.tar\.xz" | awk '{print $2}' | head -n1 || true)"
  if [ -z "$NODE_FILE" ]; then
    NODE_VER="v22.14.0"
    NODE_BASE="https://nodejs.org/dist/${NODE_VER}"
    NODE_FILE="node-${NODE_VER}-linux-${ARCH}.tar.xz"
  fi
  mkdir -p /opt/node
  curl -fSL --retry 3 "${NODE_BASE}/${NODE_FILE}" -o "/tmp/${NODE_FILE}"
  tar -xJf "/tmp/${NODE_FILE}" -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ln -sf /opt/node/bin/npm /usr/local/bin/npm
  NODE_BIN=/opt/node/bin/node
  ok "Node.js 已安装到 /opt/node（$("$NODE_BIN" -v)）"
fi

# ---------- 2. 用户 ----------
if ! id "$RUN_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$RUN_USER"
  ok "已创建系统用户 $RUN_USER"
fi

# ---------- 3. 复制程序 ----------
info "复制程序到 $APP_DIR"
mkdir -p "$APP_DIR/data"
cp "$SRC_DIR/server.js" "$APP_DIR/"
cp "$SRC_DIR/package.json" "$APP_DIR/"
rm -rf "$APP_DIR/lib" "$APP_DIR/public"
cp -r "$SRC_DIR/lib" "$APP_DIR/lib"
cp -r "$SRC_DIR/public" "$APP_DIR/public"
cp "$SRC_DIR/config.example.json" "$APP_DIR/config.example.json"

# ---------- 4. 配置文件 ----------
if [ -f "$APP_DIR/config.json" ]; then
  warn "检测到已存在的 config.json，保留不覆盖"
else
  ADMIN_TOKEN="$("$NODE_BIN" -e "console.log(require('crypto').randomBytes(18).toString('hex'))")"
  HOOK_TOKEN="$("$NODE_BIN" -e "console.log(require('crypto').randomBytes(16).toString('hex'))")"
  "$NODE_BIN" - "$ADMIN_TOKEN" "$HOOK_TOKEN" <<'NODE'
const fs = require('fs');
const [adminToken, hookToken] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync('/opt/smsmail/config.example.json', 'utf8'));
cfg.adminToken = adminToken;
cfg.hookToken = hookToken;
fs.writeFileSync('/opt/smsmail/config.json', JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
NODE
  ok "已生成 config.json（含随机令牌）"
fi

chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
chmod 600 "$APP_DIR/config.json"

# ---------- 5. systemd ----------
info "安装 systemd 服务"
sed "s#__NODE_BIN__#$NODE_BIN#g" "$SRC_DIR/deploy/smsmail.service" > /etc/systemd/system/${SVC}.service
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"
sleep 1.5

if systemctl is-active --quiet "$SVC"; then
  ok "服务已启动"
else
  echo "服务启动失败，查看日志：journalctl -u $SVC -n 50 --no-pager"
  exit 1
fi

# ---------- 6. 输出信息 ----------
IP="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
ADMIN_TOKEN="$("$NODE_BIN" -p "require('/opt/smsmail/config.json').adminToken")"
HOOK_TOKEN="$("$NODE_BIN" -p "require('/opt/smsmail/config.json').hookToken")"
PORT="$("$NODE_BIN" -p "require('/opt/smsmail/config.json').port || 8787")"

cat <<EOF

════════════════════════════════════════════
 短信邮差安装完成

 网页收件箱 ： http://${IP}:${PORT}
 登录令牌   ： ${ADMIN_TOKEN}

 手机推送地址（填到 SmsForwarder 的 WebServer）
 http://${IP}:${PORT}/hook/${HOOK_TOKEN}

 下一步：
   1. 编辑 /opt/smsmail/config.json，填 SMTP 账号和收件邮箱
   2. systemctl restart ${SVC}
   3. 打开网页点「发一封测试邮件」验证
════════════════════════════════════════════
EOF

warn "如果打不开网页，记得在云服务器安全组里放行 TCP ${PORT}"
warn "建议配好域名 + HTTPS 之后再长期使用（见 README）"
