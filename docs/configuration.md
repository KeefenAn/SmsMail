# 配置说明

配置有两份写法，二选一即可：

- **网页里改**（推荐）：点右上角 ⚙，改完点保存，立刻生效
- **改文件**：编辑 `config.json`，然后 `systemctl restart smsmail` 或 `docker compose restart`

<details>
<summary>为什么不能两边同时改</summary>

网页保存时会读取当前文件、合并、再整体写回。如果你在网页开着的时候手改了文件，
点保存会把你的手改覆盖掉。改文件前先刷新网页，或干脆只用一种方式。
</details>

## 完整字段

```json
{
  "port": 8787,
  "host": "0.0.0.0",
  "publicUrl": "https://sms.example.com",

  "adminToken": "网页登录令牌",
  "hookToken": "手机推送令牌",
  "hookSecret": "",
  "strictSign": false,

  "dedupeSeconds": 30,
  "retryMax": 6,
  "maxMessages": 5000,
  "timezone": "Asia/Shanghai",

  "subject": "【短信】[from][code]",

  "smtp": {
    "host": "smtp.qq.com",
    "port": 465,
    "secure": true,
    "starttls": "auto",
    "user": "you@qq.com",
    "pass": "授权码",
    "fromName": "短信邮差",
    "fromAddress": "you@qq.com",
    "to": ["me@qq.com"]
  },

  "filters": {
    "dropKeywords": ["退订", "回复TD"],
    "allowSenders": [],
    "denySenders": []
  }
}
```

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `port` | number | `8787` | 监听端口，`PORT` 环境变量优先级更高 |
| `host` | string | `0.0.0.0` | 监听地址。挂了 Nginx 之后建议改 `127.0.0.1` |
| `publicUrl` | string | `""` | 对外访问地址，用于在网页里显示完整的推送链接。留空则按请求的 Host 推断 |
| `adminToken` | string | 自动生成 | 网页登录令牌，至少 32 位随机串 |
| `hookToken` | string | 自动生成 | 手机推送令牌，会出现在 URL 里 |
| `hookSecret` | string | `""` | 填了之后会校验 SmsForwarder 的 `sign`；留空则不校验 |
| `strictSign` | boolean | `false` | `true` 时签名不对直接拒收；`false` 时只记日志仍然入库 |
| `dedupeSeconds` | number | `30` | 多少秒内的「同号码 + 同内容」只收一条，`0` 关闭 |
| `retryMax` | number | `6` | 邮件最多发几次，超过后标记 failed，需要手动重发 |
| `maxMessages` | number | `5000` | 最多保留多少条短信，超出丢弃最旧的 |
| `timezone` | string | `Asia/Shanghai` | 邮件和网页里显示时间用的时区 |
| `subject` | string | `【短信】[from][code]` | 邮件主题模板 |
| `smtp.host` | string | — | SMTP 服务器，留空时只存不发改 |
| `smtp.port` | number | `465` | 465 直连加密，587 走 STARTTLS |
| `smtp.secure` | boolean | `true` | 端口 465 时为 `true`；587 / 25 用 `false` + 自动 STARTTLS |
| `smtp.starttls` | string/boolean | `"auto"` | `auto` 看服务器支持；`true` 强制；`false` 禁止 |
| `smtp.user` | string | — | 登录账号，通常是完整邮箱 |
| `smtp.pass` | string | — | **授权码**，不是邮箱登录密码 |
| `smtp.fromName` | string | `短信邮差` | 发件人显示名，支持中文 |
| `smtp.fromAddress` | string | 同 `user` | 发件地址，一般必须和登录账号一致 |
| `smtp.to` | array | `[]` | 收件人，可以填多个 |
| `filters.dropKeywords` | array | `[]` | 内容包含任一词就丢弃（推广短信的好去处） |
| `filters.allowSenders` | array | `[]` | 非空时只转发这些号码（子串匹配） |
| `filters.denySenders` | array | `[]` | 命中就丢弃，优先级高于白名单 |

### 主题模板占位符

| 占位符 | 替换成 |
| --- | --- |
| `[from]` | 来源号码（或 App 包名） |
| `[code]` | 验证码，没识别到时为空，整个片段一并消失 |
| `[time]` | 接收时间 |
| `[device]` | 设备备注 |

例如 `subject` 设为 `验证码 [code]`，没验证码的短信主题就会变成 `验证码 `，建议保留 `[from]`。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `PORT` | 覆盖监听端口（容器平台常用） |
| `HOST` | 覆盖监听地址 |
| `SMSMAIL_CONFIG` | 配置文件路径，默认 `./config.json` |
| `SMSMAIL_DATA` | 数据目录，默认 `./data` |

## 邮箱 SMTP 速查

| 邮箱 | 服务器 | 端口 | `secure` | 备注 |
| --- | --- | --- | --- | --- |
| QQ 邮箱 | `smtp.qq.com` | 465 | `true` | 需要授权码 |
| 163 邮箱 | `smtp.163.com` | 465 | `true` | 设置里开启 SMTP |
| 126 邮箱 | `smtp.126.com` | 465 | `true` | 同上 |
| Gmail | `smtp.gmail.com` | 465 / 587 | `true` / `false` | 需开两步验证 + 应用专用密码 |
| Outlook | `smtp.office365.com` | 587 | `false` | STARTTLS |
| 腾讯企业邮 | `smtp.exmail.qq.com` | 465 | `true` | 客户端专用密码 |
| 阿里企业邮 | `smtp.qiye.aliyun.com` | 465 | `true` | — |

**QQ 邮箱授权码怎么拿：** 网页版邮箱 → 设置 → 账号 → POP3/IMAP/SMTP 服务 → 开启 POP3/SMTP →
按提示发短信 → 得到 16 位授权码。

**别用 25 端口**：阿里云、腾讯云等默认封禁 25 端口出站，465 / 587 不受影响。

## 令牌轮换

网页设置里有两个「重新生成」：

- **推送令牌**：生成后手机端地址会失效，记得同步改 App
- **登录令牌**：生成后当前页面自动用新令牌继续登录，其他设备需要重新输入

手改文件也行，改完重启服务。
