# 发布到 GitHub

仓库已经按开源项目的结构整理好了，只差「推到 GitHub」这几步。整个流程大约 5 分钟。

## 1. 先把占位符换成你的名字

项目里有两处 `your-name`（以及 README 里的仓库链接），改成你的 GitHub 用户名：

```bash
# 看看都有哪些地方
grep -rn "your-name" --include="*.md" --include="*.json" --include="*.yml" --include="*.yml" .

# 批量替换（macOS 用 sed -i ''）
grep -rl "your-name" . | xargs sed -i 's/your-name/你的用户名/g'
```

涉及文件：

- `package.json`（homepage / repository / bugs）
- `README.md`、`README.en.md`
- `docs/*.md`
- `.github/ISSUE_TEMPLATE/config.yml`

## 2. 初始化仓库并推上去

```bash
cd sms-mailer
git init -b main
git add -A

# 确认没有把密钥提交进去（应该只列出 config.example.json）
git status --short | grep -E "config\.json|data/|dev/" && echo "有敏感文件，停止！" || echo "干净"

git commit -m "feat: 短信邮差 v1.0.0 —— 安卓备用机短信转发到邮箱"

# 在 GitHub 上先建一个空仓库（不要勾选 README / .gitignore）
git remote add origin git@github.com:你的用户名/sms-mailer.git
git push -u origin main
```

> 如果本机还没配 SSH key，用 HTTPS 也行：`git remote add origin https://github.com/你的用户名/sms-mailer.git`。

## 3. 仓库设置

- **About**：Description 填 `备用安卓机的短信自动转发到邮箱 · Webhook + SMTP + 网页收件箱`，
  Website 留空即可
- **Topics**：`sms` `sms-forwarder` `email` `smtp` `self-hosted` `android` `webhook` `nodejs`
- **Actions**：`.github/workflows/ci.yml` 已经在仓库里，推送后自动跑，
  第一次跑完可以在 README 顶部加 CI 徽章：

  ```markdown
  [![CI](https://github.com/你的用户名/sms-mailer/actions/workflows/ci.yml/badge.svg)](https://github.com/你的用户名/sms-mailer/actions/workflows/ci.yml)
  ```

- **Discussions**：建议打开，issue 模板里已经有指向讨论区的入口
- **Security**：开启「Private vulnerability reporting」，和 `SECURITY.md` 呼应

## 4. 截图

`docs/preview.png` 是网页收件箱的截图。想换的话：

1. 本地跑起来：`node server.js`（默认 8787）
2. 浏览器打开 `http://127.0.0.1:8787/?token=<你的adminToken>`
3. 截图时把浏览器地址栏裁掉，只留应用界面
4. 存成 `docs/preview.png`（建议宽 1400~1800px，PNG）

README 里已经引用了这个路径，换文件即可。

## 5. 发版

```bash
git tag -a v1.0.0 -m "首个版本"
git push origin v1.0.0
```

到 GitHub 的 Releases 页面基于 tag 建一个 release，标题写 `v1.0.0`，
正文可以直接复制 `CHANGELOG.md` 里对应那一段。附件可以传打包好的 zip：

```bash
zip -r sms-mailer-v1.0.0.zip . -x "*.git*" -x "dev/*" -x "data/*" -x "node_modules/*"
```

## 6. 发布前自查

- [ ] `npm test` 全绿
- [ ] `npm run check` 全绿
- [ ] 仓库里没有 `config.json`、`data/`、`dev/`（`.gitignore` 已覆盖）
- [ ] 所有 `your-name` 都替换掉了
- [ ] README 里的图片路径能正常显示
- [ ] LICENSE 里的年份和署名符合你的预期
- [ ] `docs/preview.png` 里没有暴露真实手机号、邮箱或令牌
