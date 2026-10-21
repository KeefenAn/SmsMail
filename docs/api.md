# HTTP 接口

服务同时扮演两个角色：**接收手机推送的 Webhook** 和 **网页收件箱的后端 API**。

- 手机侧：`/hook/<hookToken>`
- 网页侧：`/api/*`，需要 `adminToken`
- 健康检查：`/healthz`

所有响应都是 UTF-8 JSON（`/hook` 的 GET 帮助页是 HTML）。

---

## 推送接口

### `POST /hook/<hookToken>`

也可以写成 `POST /hook?token=<hookToken>`，便于用一些只能填完整 URL 的工具。

**请求体**支持两种格式：

```http
Content-Type: application/x-www-form-urlencoded
```

```
from=10690001&content=【某银行】您的验证码是 483920&timestamp=1792591123635&card_slot=卡1
```

```http
Content-Type: application/json
```

```json
{
  "from": "10690001",
  "content": "【某银行】您的验证码是 483920",
  "card_slot": "卡1",
  "device_mark": "备用机"
}
```

**字段**

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `from` | 否 | 来源号码或 App 包名，缺省为 `未知号码` |
| `content` | **是** | 短信正文。别名：`text` / `msg` / `body` / `message` / `org_content` |
| `timestamp` | 否 | 毫秒时间戳，开启签名校验时必填 |
| `sign` | 否 | HMAC-SHA256 签名，配置了 `hookSecret` 时校验 |
| `card_slot` | 否 | 卡槽，别名 `slot` |
| `device_mark` | 否 | 设备备注，别名 `device` |

**响应**

| 状态码 | 响应体 | 含义 |
| --- | --- | --- |
| 200 | `{"ok":true,"id":"...","code":"483920"}` | 已入库并开始发邮件 |
| 200 | `{"ok":true,"duplicate":true,"id":"..."}` | 命中 `dedupeSeconds` 去重，忽略 |
| 200 | `{"ok":true,"dropped":"内容命中丢弃关键词「退订」"}` | 被过滤规则丢弃 |
| 400 | `{"ok":false,"error":"content 为空..."}` | 请求体没有正文 |
| 401 | `{"ok":false,"error":"hook token 无效"}` | 令牌不对 |
| 429 | `{"ok":false,"error":"请求过于频繁"}` | 单 IP 超过 180 次/分钟 |

> 被去重、被过滤都返回 200，是为了让手机端认为「送达成功」，避免 App 反复重试。

**示例**

```bash
curl -X POST 'https://sms.example.com/hook/4c9e8f...' \
  -d 'from=10086' \
  -d 'content=您本月话费 38.00 元'
```

### `GET /hook/<hookToken>`

不带 `content` 参数时返回一个说明页，方便你在浏览器里确认地址是通的。
带参数时行为和 POST 一致（方便用 `curl`、浏览器书签或只支持 GET 的自动化工具）。

---

## 网页 API

鉴权方式（任选其一）：

```http
X-Auth-Token: <adminToken>
Authorization: Bearer <adminToken>
```

或者查询参数 `?token=<adminToken>`（浏览器的 `EventSource` 无法自定义请求头，SSE 走这个）。

### `POST /api/login`

```json
{ "token": "<adminToken>" }
```

成功返回 `{"ok":true,"config":{...}}` 并下发 `HttpOnly` Cookie；失败返回 401（故意延迟 400ms，降低爆破速度）。

返回的配置里**不包含**邮箱授权码，只有一个 `passSet: true/false`。

### `GET /api/messages`

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `q` | 空 | 搜索号码、正文、验证码 |
| `limit` | 100 | 1 ~ 500 |
| `offset` | 0 | 分页偏移 |

```json
{
  "ok": true,
  "total": 128,
  "items": [ /* 见 docs/architecture.md 数据模型 */ ],
  "stats": { "total": 128, "today": 6, "lastAt": 1792591123635, "failed": 1 }
}
```

### `GET /api/messages/<id>`

单条详情。不存在返回 404。

### `DELETE /api/messages/<id>`

删除一条记录（不影响已经发出去的邮件）。

### `POST /api/messages/<id>/resend`

把这条短信重新排进发信队列，立即返回 202，结果通过 SSE 推送。

### `GET /api/config`

返回脱敏后的配置 + 当前推送地址。

### `PUT /api/config`

局部更新，只接受白名单字段，未知字段会被忽略：

```json
{
  "subject": "【短信】[from][code]",
  "smtp": {
    "host": "smtp.qq.com",
    "port": 465,
    "secure": true,
    "user": "you@qq.com",
    "pass": "授权码（留空表示不修改）",
    "fromName": "短信邮差",
    "fromAddress": "you@qq.com",
    "to": ["me@qq.com"]
  },
  "filters": {
    "dropKeywords": ["退订"],
    "allowSenders": [],
    "denySenders": []
  }
}
```

`pass` 传空字符串或纯空格时会被忽略，避免前端把已保存的授权码清掉。

### `POST /api/tokens`

```json
{ "which": "hook" }     // 或 "admin"
```

重新生成对应令牌并立即生效。

### `POST /api/test`

用当前 SMTP 配置给自己发一封测试邮件，返回发送结果或错误原因。

### `GET /api/events`

SSE 长连接，事件格式：

```
data: {"type":"hello","stats":{...}}

data: {"type":"new","message":{...}}

data: {"type":"update","message":{...}}

data: {"type":"delete","id":"..."}
```

心跳是注释行 `: ping`，每 25 秒一次。断线后浏览器会自动重连（3 秒）。

### `GET /healthz`

不鉴权，给监控和容器健康检查用：

```json
{ "ok": true, "uptime": 3600 }
```

---

## 对接其它工具

只要能把内容 POST 过来，用什么都行。

**MacroDroid**：动作 → 「HTTP 请求」→ POST → 地址填 `/hook/<token>`，
表单参数 `from` = 触发短信的电话号码，`content` = 短信内容。

**Tasker**：`HTTP Request` 动作，方法 POST，Body 填
`from=%SMSRN&content=%SMSRB`，Content-Type 选 `application/x-www-form-urlencoded`。

**命令行 / 硬件短信猫**：

```bash
curl -s -X POST "http://127.0.0.1:8787/hook/$HOOK_TOKEN" \
  --data-urlencode "from=$SENDER" \
  --data-urlencode "content=$TEXT"
```
