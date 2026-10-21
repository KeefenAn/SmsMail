# 部署指南

三种方式，按顺手程度选：

| 方式 | 适合 | 耗时 |
| --- | --- | --- |
| [一键脚本](#方式一一键脚本推荐) | 有 Linux VPS、想少折腾 | 2 分钟 |
| [Docker](#方式二docker) | 机器上已经在跑容器 | 3 分钟 |
| [手动安装](#方式三手动安装) | 想自己控制目录结构 / 用别的 init | 5 分钟 |

## 准备

- 一台能 24 小时开机的机器（1 核 1G 的 VPS 足够；树莓派、NAS 也行）
- 一个能开 SMTP 的邮箱 + 授权码（见 [配置说明](configuration.md#邮箱-smtp-速查)）
- 可选：一个域名（配 HTTPS 用）

---

## 方式一：一键脚本（推荐）

支持 Ubuntu 20.04+ / Debian 11+，会自动装 Node.js（没有的话）、建系统用户、装 systemd 服务。

```bash
# 1. 上传到服务器
scp -r sms-mailer root@你的服务器IP:/root/

# 2. 安装
ssh root@你的服务器IP
cd /root/sms-mailer
sudo bash deploy/install.sh
```

装完会打印：

```
════════════════════════════════════════════
 短信邮差安装完成

 网页收件箱 ： http://1.2.3.4:8787
 登录令牌   ： 8f3a....

 手机推送地址（填到 SmsForwarder 的 WebServer）
 http://1.2.3.4:8787/hook/4c9e....
════════════════════════════════════════════
```

接着填 SMTP：

```bash
nano /opt/smsmail/config.json     # 改 smtp 那段
systemctl restart smsmail
journalctl -u smsmail -n 30 --no-pager
```

**打不开网页？** 云服务器控制台的安全组里放行 TCP 8787。

### 常用命令

```bash
systemctl status smsmail     # 状态
systemctl restart smsmail    # 重启
journalctl -u smsmail -f     # 实时日志
```

---

## 方式二：Docker

```bash
# 目录结构：当前目录下放 docker-compose.yml，data/ 用来存配置和短信
mkdir -p smsmail && cd smsmail
curl -O https://raw.githubusercontent.com/KeefenAn/SmsMail/main/docker-compose.yml

# 容器以 node 用户（uid 1000）运行，先把目录权限给它
mkdir -p data && sudo chown -R 1000:1000 data

docker compose up -d
docker compose logs -f
```

首次启动会在 `data/config.json` 里生成随机令牌，日志里能看到：

```
[2026-10-21 22:00:01] INFO 短信邮差已启动  http://0.0.0.0:8787
[2026-10-21 22:00:01] INFO 网页收件箱令牌：8f3a....
```

然后编辑 `data/config.json` 填 SMTP，`docker compose restart`。

不想用 compose：

```bash
docker run -d --name smsmail \
  -p 8787:8787 \
  -v "$PWD/data:/data" \
  -e TZ=Asia/Shanghai \
  --restart unless-stopped \
  sms-mailer:latest
```

---

## 方式三：手动安装

需要 Node.js **20+**（`node -v` 确认）。

```bash
useradd --system --home /opt/smsmail --shell /usr/sbin/nologin smsmail
mkdir -p /opt/smsmail && cp -r server.js lib public package.json config.example.json /opt/smsmail/
cd /opt/smsmail
cp config.example.json config.json
chown -R smsmail:smsmail /opt/smsmail
chmod 600 config.json

# 装服务
sed "s#__NODE_BIN__#$(command -v node)#g" deploy/smsmail.service > /etc/systemd/system/smsmail.service
systemctl daemon-reload && systemctl enable --now smsmail
```

或者用 pm2 / supervisor / 你喜欢的进程管理器，核心只有一条：

```bash
SMSMAIL_CONFIG=/opt/smsmail/config.json SMSMAIL_DATA=/opt/smsmail/data node /opt/smsmail/server.js
```

---

## 配 HTTPS（强烈建议）

推送令牌在 URL 里，走 HTTP 等于明文广播。有两种主流做法。

### Caddy（最省事）

```bash
apt install -y caddy
cat > /etc/caddy/Caddyfile <<'EOF'
sms.example.com {
    reverse_proxy 127.0.0.1:8787
}
EOF
systemctl reload caddy
```

Caddy 会自动申请并续期证书。

### Nginx + Certbot

```bash
apt install -y nginx certbot python3-certbot-nginx
cp deploy/nginx-smsmail.conf /etc/nginx/conf.d/smsmail.conf
sed -i 's/sms.example.com/你的域名/g' /etc/nginx/conf.d/smsmail.conf
nginx -t && systemctl reload nginx
certbot --nginx -d 你的域名
```

> Nginx 配置里单独给 `/api/events` 关掉了缓冲，否则网页的实时刷新会一直转圈。

### 挂上反代之后

把 `config.json` 改成只监听本机，并把对外地址写死：

```json
{
  "host": "127.0.0.1",
  "publicUrl": "https://sms.example.com"
}
```

然后 `systemctl restart smsmail`，安全组里把 8787 关掉，只留 80 / 443。

---

## 备份与迁移

所有状态都在两个地方：

```
config.json      配置 + 两个令牌
data/messages.json   短信历史
```

```bash
# 备份
tar czf smsmail-backup-$(date +%F).tar.gz -C /opt smsmail

# 迁移到新机器：解压到同路径，装一遍 systemd 服务即可
```

Docker 用户直接备份 `./data` 目录。

---

## 升级

```bash
# 脚本安装
cd /path/to/new-version && sudo bash deploy/install.sh   # 会保留 config.json 和 data/

# Docker
docker compose pull && docker compose up -d

# 手动
cp server.js lib public /opt/smsmail/ && systemctl restart smsmail
```

升级前建议先备份；`config.json` 只增字段不删字段，老配置一般能直接用。
