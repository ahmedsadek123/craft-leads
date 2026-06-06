FROM node:20-bookworm

# Install system dependencies required by Chromium / Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto \
    ca-certificates \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer (used by whatsapp-web.js) → use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Playwright (used by scraper) → install its own browser using system deps above
RUN npx playwright install chromium

COPY . .

RUN mkdir -p /app/data

EXPOSE 3737
CMD ["node", "server.js"]
