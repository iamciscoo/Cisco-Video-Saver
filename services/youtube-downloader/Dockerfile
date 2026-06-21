FROM node:22-alpine

RUN apk add --no-cache \
      ffmpeg \
      python3 \
      py3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp

WORKDIR /app

COPY server.js ./

ENV YT_DLP_PYTHON=python3
ENV YT_DLP_NODE=node
ENV YT_DLP_FFMPEG_LOCATION=/usr/bin
ENV YT_DLP_WEB_HOST=0.0.0.0
ENV YT_DLP_WEB_PORT=8787

EXPOSE 8787

CMD ["node", "server.js"]
