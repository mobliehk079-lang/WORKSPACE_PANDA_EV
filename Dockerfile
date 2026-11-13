# PANDA EV WORKSPACE — Railway uses this automatically when it is present.
# ffmpeg converts iPhone HEVC/H.265 videos to MP4/H.264 so every browser can play them.
FROM node:24-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
