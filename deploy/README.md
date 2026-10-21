# deploy

部署相关文件，配合 [部署指南](../docs/deploy.md) 使用。

| 文件 | 用途 |
| --- | --- |
| `install.sh` | 一键安装（Debian / Ubuntu）：装 Node、建用户、装服务、生成随机令牌 |
| `smsmail.service` | systemd 单元模板，`__NODE_BIN__` 会被脚本替换成实际的 node 路径 |
| `nginx-smsmail.conf` | Nginx 反代示例，已经为 SSE 关掉缓冲，配合 certbot 签证书 |

注意：

- 三个文件都是 **LF 换行**，用 Windows 记事本编辑后可能变成 CRLF，导致 `bash` 报
  `$'\r': command not found`。改完用 `file install.sh` 确认一下。
- `install.sh` 会保留已有的 `/opt/smsmail/config.json`，升级时不会覆盖你的配置。
