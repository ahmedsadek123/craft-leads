const { chromium } = require('playwright');

async function scrapeGoogleMaps({ category, city, maxResults = 50 }, onProgress) {
  // Universal connector — works on Google Maps regardless of locale
  const query = `${category} in ${city}`;
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-plugins',
      '--blink-settings=imagesEnabled=false',
      // --no-zygote needed on Linux/Docker; skip on Windows (causes crash)
      ...(process.platform !== 'win32' ? ['--no-zygote'] : []),
    ],
  });
  // en-US locale + real browser user agent to avoid Google blocking
  const context = await browser.newContext({
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const leads = [];
  const seenPhones = new Set();

  try {
    onProgress?.({ type: 'status', message: `Searching: ${query}` });

    // ── Step 1: Collect all place URLs from search results ────
    const searchPage = await context.newPage();
    await searchPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await searchPage.waitForTimeout(2000);

    // Accept consent if shown (handles Arabic, English, EU dialogs)
    for (const txt of ['Accept all', 'قبول الكل', 'Agree', 'I agree', 'موافقة']) {
      const btn = searchPage.getByRole('button', { name: txt, exact: false });
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        await searchPage.waitForTimeout(1000);
        break;
      }
    }

    await searchPage.waitForSelector('.Nv2PK', { timeout: 20000 });

    const placeUrls = new Set();
    let scrollRounds = 0;
    const maxScrolls = Math.ceil(maxResults / 5) + 8;

    while (placeUrls.size < maxResults && scrollRounds < maxScrolls) {
      const newUrls = await searchPage.evaluate(() => {
        const anchors = document.querySelectorAll('.Nv2PK a[href*="/maps/place/"]');
        return [...anchors].map(a => a.href);
      });
      newUrls.forEach(u => placeUrls.add(u));

      onProgress?.({ type: 'status', message: `Collecting links: ${placeUrls.size}` });

      const scrolled = await searchPage.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (!feed) return false;
        const prev = feed.scrollTop;
        feed.scrollBy(0, 1400);
        return feed.scrollTop !== prev;
      });
      if (!scrolled) break;

      await searchPage.waitForTimeout(2000);
      scrollRounds++;

      // Check end of list in both English and Arabic
      const ended = await searchPage.evaluate(() => {
        const t = document.body.innerText;
        return t.includes("You've reached the end of the list") ||
               t.includes('لقد وصلت إلى نهاية القائمة'); // Arabic end-of-list text
      });
      if (ended) break;
    }

    await searchPage.close();

    const urlList = [...placeUrls].slice(0, maxResults * 2);
    onProgress?.({ type: 'status', message: `Checking ${urlList.length} places...` });

    // ── Step 2: Visit each place and extract data ─────────────
    const placePage = await context.newPage();
    let skippedWebsite = 0, skippedNoPhone = 0, skippedNoName = 0;

    for (const url of urlList) {
      if (leads.length >= maxResults) break;

      try {
        await placePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await placePage.waitForTimeout(2000);

        // Business name — try multiple selectors
        let name = '';
        for (const sel of ['h1.DUwDvf', 'h1.fontHeadlineLarge', 'h1']) {
          name = (await placePage.locator(sel).first().textContent({ timeout: 3000 }).catch(() => '')).trim();
          if (name && name.length >= 2) break;
        }
        if (!name || name.length < 2) { skippedNoName++; continue; }

        // Skip only if they have a REAL website (not Facebook/Instagram/TikTok)
        // Try multiple selectors Google Maps uses for website links
        let hasRealWebsite = false;
        const websiteSelectors = [
          'a[data-item-id="authority"]',
          'a[aria-label*="website" i]',
          'a[aria-label*="موقع" i]',
          '[data-item-id="authority"] a',
        ];
        for (const sel of websiteSelectors) {
          const el = placePage.locator(sel).first();
          const visible = await el.isVisible({ timeout: 1500 }).catch(() => false);
          if (visible) {
            const href = (await el.getAttribute('href', { timeout: 1000 }).catch(() => '')) || '';
            const isSocial = /facebook\.com|instagram\.com|fb\.com|tiktok\.com|twitter\.com|x\.com/i.test(href);
            if (!isSocial && href.startsWith('http')) { hasRealWebsite = true; break; }
          }
        }
        if (hasRealWebsite) { skippedWebsite++; continue; }

        // Phone — try multiple selectors and fallbacks
        let phoneLabel = null;

        // 1. data-item-id containing "phone"
        const phoneByDataId = placePage.locator('[data-item-id*="phone"]').first();
        phoneLabel = await phoneByDataId.getAttribute('aria-label', { timeout: 3000 }).catch(() => null)
          || await phoneByDataId.textContent({ timeout: 3000 }).catch(() => null);

        // 2. aria-label containing phone/هاتف
        if (!phoneLabel) {
          const phoneByAriaPhone = placePage.locator('[aria-label*="Phone" i], [aria-label*="هاتف"], [aria-label*="phone" i]').first();
          phoneLabel = await phoneByAriaPhone.getAttribute('aria-label', { timeout: 2000 }).catch(() => null)
            || await phoneByAriaPhone.textContent({ timeout: 2000 }).catch(() => null);
        }

        // 3. Scan page text for Egyptian/international phone pattern
        if (!phoneLabel) {
          phoneLabel = await placePage.evaluate(() => {
            const text = document.body.innerText;
            const match = text.match(/(\+?2?01[0-9]{9}|\+?[0-9]{7,15})/);
            return match ? match[0] : null;
          }).catch(() => null);
        }

        if (!phoneLabel) { skippedNoPhone++; onProgress?.({ type: 'status', message: `⚠️ ${name} — no phone` }); continue; }

        // Extract digits + keep leading + for international format
        const digitsRaw = (phoneLabel + '').replace(/[^\d+]/g, '');
        const digitOnly = digitsRaw.replace('+', '');
        if (digitOnly.length < 7) { skippedNoPhone++; continue; }

        const phone = digitsRaw.startsWith('+') ? digitsRaw : '+' + digitsRaw;
        if (seenPhones.has(phone)) continue;

        // Category
        const typeEl = placePage.locator('button.DkEaL, [jsaction*="category"], .fontBodyMedium button').first();
        const type = (await typeEl.textContent({ timeout: 2000 }).catch(() => category)).trim() || category;

        // Address
        const addrEl = placePage.locator('[data-item-id="address"], [aria-label*="Address" i], [aria-label*="العنوان"]').first();
        const addrLabel = await addrEl.getAttribute('aria-label', { timeout: 2000 }).catch(() => '')
          || await addrEl.textContent({ timeout: 2000 }).catch(() => '');
        const address = (addrLabel + '').replace(/^(العنوان|Address):\s*/i, '').trim();

        seenPhones.add(phone);
        leads.push({ name, phone, type, address, mapsUrl: url });
        onProgress?.({ type: 'lead', message: `✅ ${name} | ${phone}`, count: leads.length });

      } catch (err) {
        onProgress?.({ type: 'status', message: `⚠️ Error: ${err.message?.slice(0, 60)}` });
      }
    }

    onProgress?.({ type: 'status', message: `Summary: ${leads.length} found ✅ | ${skippedWebsite} have website | ${skippedNoPhone} no phone | ${skippedNoName} no name` });

    await placePage.close();

  } finally {
    await browser.close();
  }

  onProgress?.({ type: 'done', message: `Done: ${leads.length} leads without a website`, count: leads.length });
  return leads;
}

module.exports = { scrapeGoogleMaps };
