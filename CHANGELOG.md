# 更新日志

本文件格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- 第二通道：Telegram / Bark / WebPush
- 短信导出 CSV / Markdown
- 可选的 SQLite 存储

## [1.0.0] - 2026-10-21

首个公开版本。

### 新增

- Webhook 接收短信（`/hook/<token>`），兼容 SmsForwarder 的表单与 JSON 报文
- 零依赖 SMTP 客户端：465 隐式 TLS、587/25 STARTTLS、AUTH LOGIN / PLAIN
- 验证码自动提取，支持「验证码是 483920」「code: 123456」等常见写法
- 邮件同时提供纯文本与 HTML 两种正文
- 邮件发送失败按 30s / 2m / 10m / 30m / 2h / 6h 退避重试，重启后自动补发
- 网页收件箱：实时刷新（SSE）、搜索、复制、手动重发、删除
- 网页内可修改 SMTP、收件人、主题模板、过滤规则
- 短信去重（同号码同内容 N 秒内只收一条）
- 过滤规则：丢弃关键词、发件人白名单 / 黑名单
- 双令牌鉴权（推送令牌 / 登录令牌），支持一键轮换
- 可选的 HMAC-SHA256 签名校验，防止推送地址被伪造
- 单 IP 每分钟 180 次限流
- Docker 镜像与 docker-compose 配置
- 一键安装脚本（systemd）、Nginx 反代模板
- 79 个测试：单元测试 + 端到端测试（自带假 SMTP 服务器）+ 文档链接自检
- GitHub Actions CI（Node 20 / 22 / 24）

[Unreleased]: https://github.com/KeefenAn/SmsMail/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/KeefenAn/SmsMail/releases/tag/v1.0.0
