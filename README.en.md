<div align="center">

# SmsMail

**Forward SMS from a spare Android phone to your email — automatically.**

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

[中文文档](README.md)

</div>

![Inbox](docs/preview.png)

## What it does

An old Android phone with a SIM card sits at home. When an SMS arrives,
[SmsForwarder](https://github.com/pppscn/SmsForwarder) posts it to this service over HTTPS.
The service emails it to you, keeps a permanent copy in a web inbox, and retries
delivery for up to 6 times if your mail server is down.

- 🔍 **Verification codes in the subject line** — no need to open the email
- 🔁 **Nothing gets lost** — retries with exponential backoff, full archive in the web UI
- 🖥 **Real-time inbox** — SSE updates, search, copy, resend, delete
- ⚙️ **Configure in the browser** — SMTP, recipients and filters without SSH
- 🪶 **Zero dependencies** — plain Node.js built-ins, no `npm install`, no supply chain risk
- 🔐 **Two tokens + optional HMAC signature**

## Quick start

```bash
# Docker
mkdir -p smsmail && cd smsmail
curl -O https://raw.githubusercontent.com/KeefenAn/SmsMail/main/docker-compose.yml
docker compose up -d && docker compose logs -f
```

Or on a Debian/Ubuntu VPS:

```bash
cd sms-mailer && sudo bash deploy/install.sh
```

Then configure SMTP in `data/config.json` (Docker) or `/opt/smsmail/config.json` (script).

## Phone setup

1. Install [SmsForwarder](https://github.com/pppscn/SmsForwarder/releases)
2. Add a **Webhook** channel: URL `https://your-domain/hook/<hookToken>`, method `POST`,
   leave `webParams` empty
3. Add an SMS forwarding rule matching **all messages**, pointing at that channel

Don't skip the battery-optimization whitelist — Chinese ROMs kill background apps aggressively.

## Docs

The detailed documentation is written in Chinese:

- [Deployment](docs/deploy.md) · [Phone setup](docs/phone-setup.md) ·
  [Configuration](docs/configuration.md) · [HTTP API](docs/api.md) ·
  [FAQ](docs/faq.md) · [Architecture](docs/architecture.md)

## Development

```bash
npm test        # 79 tests, unit + end-to-end with a fake SMTP server
npm run check   # syntax check
```

No dependencies are used, so there is nothing to install.

## License

[MIT](LICENSE)
