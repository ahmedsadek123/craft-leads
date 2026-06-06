FROM node:20-bookworm

# Install system dependencies for both Playwright and Puppeteer Chrome
RUN apt-get update && apt-get install -y \
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
    libxss1 \
    libxtst6 \
    xdg-utils \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./

# Let puppeteer download its own Chrome (more compatible with whatsapp-web.js)
# Let Playwright download its own Chromium (scraper)
RUN npm ci --omit=dev
RUN npx playwright install chromium

COPY . .

RUN mkdir -p /app/data

EXPOSE 3737
CMD ["node", "server.js"]
