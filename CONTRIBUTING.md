# 参与贡献

欢迎提 issue 和 PR。这个项目刻意保持「小而完整」，所以：

- **功能不是越多越好**，能用一个配置项解决的，不写代码
- **不引入第三方依赖**，除非有非常充分的理由（宁可用内置模块写 200 行）
- **前端不用框架**，保持原生 JS，保证离线可用

## 开发环境

只需要 Node.js 20+，不需要 `npm install`。

```bash
git clone https://github.com/KeefenAn/SmsMail.git
cd sms-mailer
node server.js          # http://127.0.0.1:8787，首启会生成 config.json 和随机令牌
```

想看邮件长什么样，另开一个终端：

```bash
npm run mock-smtp       # 假 SMTP，监听 127.0.0.1:2525
```

然后把 `config.json` 的 `smtp` 指向它：

```json
{ "smtp": { "host": "127.0.0.1", "port": 2525, "secure": false, "starttls": false,
            "user": "test@example.com", "pass": "testpass", "to": ["me@qq.com"] } }
```

## 测试

```bash
npm test         # node --test test/
npm run check    # 全仓库语法检查
```

`npm test` 会自己拉起一个假 SMTP 服务器，不需要真邮箱，也不联网。

> 如果运行环境不允许创建子进程（某些容器 / 沙箱），`node --test` 的 worker 会失败，
> 换成 `npm run test:single`（单进程模式，需要 Node 22+）。

## 代码风格

- 2 空格缩进，单引号，分号结尾
- 提交前请让 `npm run check` 通过
- 注释写「为什么」，不写「是什么」
- 中文注释和中文文案保持现状，不要为了「国际化」把界面翻成英文

## 提交信息

用 [约定式提交](https://www.conventionalcommits.org/zh-hans/)：

```
feat: 支持 Telegram 转发通道
fix: 修复长短信分片导致的重复发信
docs: 补充 Docker 部署说明
refactor: 把重试队列拆成独立模块
test: 增加配置清洗的边界用例
chore: 升级 CI 的 Node 版本
```

## PR 清单

- [ ] `npm test` 全绿
- [ ] `npm run check` 全绿
- [ ] 改了前端就在浏览器里点一遍，手机宽度也看一下
- [ ] 改了配置项就同步更新 `config.example.json` 和 `docs/configuration.md`
- [ ] 没有提交令牌、授权码、真实短信内容

## 目录约定

| 目录 | 放什么 |
| --- | --- |
| `lib/` | 可独立测试的纯逻辑，不依赖 HTTP |
| `public/` | 浏览器端资源，不引外部 CDN |
| `test/` | `*.test.js` 结尾，`test/support/` 放测试辅助 |
| `docs/` | 面向用户的文档，不写实现细节 |
| `deploy/` | 部署相关脚本和配置模板 |

新增依赖前请先想清楚：能不能用 `node:` 内置模块解决。
