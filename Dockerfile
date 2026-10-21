# syntax=docker/dockerfile:1

FROM node:22-alpine

LABEL org.opencontainers.image.title="sms-mailer" \
      org.opencontainers.image.description="备用安卓机的短信自动转发到邮箱" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# 项目零第三方依赖，不需要 npm install
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY config.example.json ./

ENV NODE_ENV=production \
    PORT=8787 \
    SMSMAIL_CONFIG=/data/config.json \
    SMSMAIL_DATA=/data

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
