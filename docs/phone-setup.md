# 手机端配置

服务端只接受「有人把短信推过来」，真正的读取动作在手机上完成。
推荐用开源免费的 [SmsForwarder](https://github.com/pppscn/SmsForwarder)。

## 0. 前提

- 备用机是 **Android**（iPhone 不行，原因见文末）
- 手机能上网（家里 WiFi 最省事，蜂窝网络也行）
- 已经拿到服务端的推送地址：`https://你的域名/hook/<hookToken>`

## 1. 安装并授权

1. 打开 <https://github.com/pppscn/SmsForwarder/releases>，下载最新的 `SmsForwarder-x.x.x.apk`
2. 安装后打开，按提示给 **短信** 和 **通知** 权限
3. 部分系统会要求「允许后台弹出界面」，一并给上

## 2. 添加发送通道

底部导航选 **发送通道** → 右上角 `+` → 类型选 **Webhook**：

| 配置项 | 填什么 |
| --- | --- |
| 通道名称 | 随便，建议 `家里服务器` |
| WebServer | `https://你的域名/hook/<hookToken>` |
| 请求方式 | `POST` |
| webParams | **留空** |
| secret | 留空（想加签名校验再看下面） |

留空 `webParams` 时，App 会自动以表单形式提交四个字段，服务端正好认这四个：

```
from=10690001
content=【某银行】您的验证码是 483920
timestamp=1792591123635
sign=（设置了 secret 才有）
```

填完点「测试」按钮，网页收件箱里应该立刻多出一条测试短信。

### 想自定义报文

`webParams` 填 JSON 就行，服务端会自动识别字段别名：

```json
{"from":"[from]","text":"[msg]","slot":"[card_slot]","device":"[device_mark]"}
```

可用的占位符：`[from]` `[content]` `[msg]` `[org_content]` `[timestamp]` `[sign]`
`[device_mark]` `[app_version]` `[card_slot]` `[title]` `[receive_time]`

服务端认识的字段名：

- 号码：`from` / `phone` / `sender` / `number` / `mobile`
- 内容：`content` / `text` / `msg` / `body` / `message` / `org_content`
- 卡槽：`card_slot` / `slot`
- 设备：`device_mark` / `device`

### 加签名校验（可选）

在 App 里填一个 `secret`，同时把服务端 `config.json` 的 `hookSecret` 填成同样的值：

```json
{ "hookSecret": "一段随机字符串", "strictSign": true }
```

签名算法是钉钉那套：`base64(HMAC-SHA256(timestamp + "\n" + secret))`，再做 urlEncode。
开启后，别人即使拿到了推送地址，没有 secret 也伪造不了请求。

> 建议先设 `strictSign: false` 跑一天，观察日志里有没有签名失败；确认没问题再打开严格模式。
> 手机时间和服务器时间差太多也会导致校验失败。

## 3. 添加转发规则

底部导航选 **短信转发** → `+`：

| 配置项 | 填什么 |
| --- | --- |
| 规则名称 | `全部短信` |
| 匹配模式 | **所有短信**（或指定号码） |
| 使用通道 | 选上一步建的那个 Webhook |
| 备注 | 可留空 |

保存后规则默认启用。

### 双卡分开处理

想区分卡 1 / 卡 2：

- 建两条规则，分别限定「卡槽 1」「卡槽 2」，各自用不同的通道（后端可以用不同的 hookToken）
- 或者只建一条规则，但开启「附加卡槽信息」，服务端会存进 `slot` 字段并在网页里显示

## 4. 保活（最重要的一步）

国产 ROM 默认会杀掉后台应用，配置完不管它，两三天后就不转了。

| 品牌 | 要做的操作 |
| --- | --- |
| 小米 / Redmi | 设置 → 应用设置 → 应用管理 → SmsForwarder → **省电策略：无限制**；打开「自启动」和「后台弹出界面」；最近任务里把它**锁定** |
| 华为 / 荣耀 | 应用启动管理 → 改成**手动管理**，三个开关全开；电池 → 更多电池设置 → 关闭「休眠时保持网络连接」的限制 |
| OPPO / 一加 / realme | 应用管理 → 耗电管理 → 允许**后台运行**、允许**自启动**、允许**关联启动** |
| vivo / iQOO | 后台高耗电 → 允许；自启动 → 允许；后台弹窗 → 允许 |
| 三星 | 电池 → 后台使用限制 → 把 SmsForwarder 加入「永不休眠的应用」 |

另外：

- **一直插着充电**（很多 ROM 在低电量时会限制后台）
- 尽量**连 WiFi**，并在 WiFi 设置里关闭「休眠时断开」
- 别手动「一键清理」内存

## 5. 验证

1. 让朋友给你发一条短信
2. 30 秒内邮箱应该收到
3. 网页收件箱同步弹出（不用刷新）

没收到就按这条链排查：手机有没有收到短信 → App 里通道「测试」能不能点通 →
服务器 `journalctl -u smsmail -f` 有没有日志 → 邮件状态是 `sent` 还是 `failed`。

详见 [常见问题](faq.md)。

## 关于 iPhone

iOS 不允许第三方 App 读取短信，也没有对外的短信接口，所以：

- iCloud 的「短信转发」只能转发到**同 Apple ID 的 Mac / iPad**，到不了邮箱
- 越狱插件可以做到，但不建议

替代方案：

1. 换一台闲置安卓机当备用机（最省事，几十块的旧机也行）
2. 用 USB 短信猫 / GSM 模块（如 SIM800、EC20 系列）接在服务器上，配 `gammu` 或 `sms-tools`，
   再把收到的短信用 `curl` 推给本服务的 `/hook/`
3. 部分运营商的「短信转移」业务可以把短信转到另一个号码，但转不到邮箱
