# 常见问题

按「部署 → 邮件 → 手机 → 数据」四类排。没找到答案就提 [issue](https://github.com/KeefenAn/SmsMail/issues)。

## 部署

<details>
<summary>网页打不开、连接被拒绝</summary>

1. 服务真的起来了吗：`systemctl status smsmail` / `docker ps`
2. 端口通不通：`ss -lntp | grep 8787`
3. 云服务器的**安全组**放行了吗（这一步最容易忘）
4. 本机防火墙：`ufw allow 8787`
5. 挂了 Nginx 的话，`nginx -t` 和 `systemctl status nginx` 看一眼
</details>

<details>
<summary>一键脚本报 Node.js 下载失败</summary>

脚本会去 nodejs.org 拉 Node 22 的压缩包。国内机器可能很慢或失败，两个办法：

```bash
# 办法一：先自己装好 Node 20+，脚本检测到就不再下载
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs

# 办法二：用国内镜像手动装完再跑脚本
cd /opt && curl -O https://npmmirror.com/mirrors/node/v22.14.0/node-v22.14.0-linux-x64.tar.xz
mkdir -p /opt/node && tar -xJf node-v22.14.0-linux-x64.tar.xz -C /opt/node --strip-components=1
ln -sf /opt/node/bin/node /usr/local/bin/node
```
</details>

<details>
<summary>Docker 启动后报 EACCES / permission denied</summary>

容器以 `node` 用户（uid 1000）运行，`./data` 目录需要属于它：

```bash
mkdir -p data && sudo chown -R 1000:1000 data && docker compose restart
```
</details>

<details>
<summary>端口 8787 被占用</summary>

改 `config.json` 的 `port`，或者用环境变量覆盖：`PORT=9000 node server.js`。
</details>

## 邮件

<details>
<summary>测试邮件报 535 / 认证失败</summary>

九成是这两个原因：

1. `pass` 填的是邮箱**登录密码**，不是授权码
2. 邮箱后台没开 SMTP 服务

QQ 邮箱：设置 → 账号 → 开启 POP3/SMTP → 生成授权码（16 位）。
163 邮箱：设置 → POP3/SMTP/IMAP → 开启服务 → 获取授权码。
Gmail：必须开两步验证，再生成「应用专用密码」。
</details>

<details>
<summary>邮件状态是「已发送」但收件箱里没有</summary>

1. 翻**垃圾箱 / 广告箱**，第一次发信很容易被判垃圾
2. 把发件地址加入白名单 / 联系人
3. 检查 `smtp.to` 有没有写错（多个收件人用逗号分隔）
4. 自建邮局的话检查 SPF / DKIM；用 QQ、163 这类公共邮箱一般不用管
</details>

<details>
<summary>报 connection timeout / ECONNREFUSED</summary>

1. 端口写错：465 是直连加密，587 是 STARTTLS，25 基本被云厂商封了
2. 服务器出站被封：`nc -vz smtp.qq.com 465` 试探一下
3. 公司 / 校园网拦截 SMTP：换成 587 试试，或者改用企业邮
</details>

<details>
<summary>重试了 6 次还是失败，短信会丢吗</summary>

不会。短信原文在网页收件箱里，状态显示「邮件失败」，修好 SMTP 后点一下「重发邮件」就行。
</details>

<details>
<summary>能发给多个人 / 多个邮箱吗</summary>

能，`smtp.to` 是数组：

```json
"to": ["a@qq.com", "b@163.com"]
```

网页设置里用逗号或换行分隔。
</details>

## 手机端

<details>
<summary>手机端「测试」成功，但真短信不转发</summary>

通道通了、规则没生效，检查：

1. 「短信转发」里那条规则是不是**启用**状态
2. 匹配模式是不是「所有短信」，或者号码没匹配上
3. App 有没有拿到短信权限（部分 ROM 会悄悄回收）
</details>

<details>
<summary>用了几天突然不转了</summary>

几乎都是后台被杀。按 [手机端配置](phone-setup.md#4-保活最重要的一步) 里的品牌表逐项打开：
自启动、后台运行、电池优化白名单、锁定后台。备用机记得一直插电。
</details>

<details>
<summary>同一条短信收到两封邮件</summary>

有些 ROM 会重复广播。把 `dedupeSeconds` 从 30 调到 120 即可。
</details>

<details>
<summary>长短信被拆成两三条</summary>

正常现象，运营商把长短信分片下发，手机会收到多条广播。
服务端按「同号码同内容」去重，但分片内容不同，会各存各的。
</details>

<details>
<summary>双卡怎么区分</summary>

在 SmsForwarder 里开启「附加卡槽信息」，服务端会存进 `slot` 字段，网页上会显示「卡1 / 卡2」徽标。
想分别处理就建两条规则，各自指向不同的 `hookToken`。
</details>

<details>
<summary>手机提示「请求失败」/ 证书错误</summary>

1. 域名证书过期了：`curl -vI https://你的域名/hook/xxx`
2. 用了自签名证书，Android 不认
3. 地址里多了空格或少了 `/hook/`
4. 用 `http://` 但 Android 9+ 默认禁止明文——要么换 HTTPS，要么在 App 里允许明文 HTTP
</details>

<details>
<summary>iPhone 能做吗</summary>

不能。iOS 不允许第三方读短信。替代方案见 [手机端配置](phone-setup.md#关于-iphone)。
</details>

## 数据与安全

<details>
<summary>短信存在哪里？会传给第三方吗</summary>

只存在你自己的机器上：

```
data/messages.json     一行一条，含短信原文
config.json            配置和令牌（权限 600）
```

服务只会连接你配置的 SMTP 服务器，没有任何遥测和回传。
</details>

<details>
<summary>怎么备份 / 迁移</summary>

```bash
tar czf smsmail-backup-$(date +%F).tar.gz -C /opt smsmail
```

新机器解压到同一路径，重装一次 systemd 服务即可。
</details>

<details>
<summary>历史记录太多占空间怎么办</summary>

默认最多保留 5000 条（`maxMessages`），超出自动丢最旧的。
想清空就直接删 `data/messages.json` 再重启。
</details>

<details>
<summary>推送地址泄露了怎么办</summary>

网页设置里点「重新生成令牌」，然后把手机端地址同步改掉。旧的地址立刻失效。
</details>

<details>
<summary>能放到公网上给别人用吗</summary>

不建议。这是单人自用的服务，没有用户体系；别人拿到你的 `adminToken` 就能看到所有短信。
如果确实要给多人用，至少每人一套实例（各用各的配置目录）。
</details>
