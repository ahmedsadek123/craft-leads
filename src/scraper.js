const { chromium } = require('playwright');

async function scrapeGoogleMaps({ category, city, maxResults = 50 }, onProgress) {
  const query = `${category} في ${city}`;
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'ar-EG' });
  const leads = [];
  const seenPhones = new Set();

  try {
    onProgress?.({ type: 'status', message: `جاري البحث: ${query}` });

    // ── Step 1: Collect all place URLs from search results ────
    const searchPage = await context.newPage();
    await searchPage.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });

    // Accept consent if shown
    for (const txt of ['Accept all', 'قبول الكل', 'Agree']) {
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
      // Extract all place hrefs currently visible
      const newUrls = await searchPage.evaluate(() => {
        const anchors = document.querySelectorAll('.Nv2PK a[href*="/maps/place/"]');
        return [...anchors].map(a => a.href);
      });
      newUrls.forEach(u => placeUrls.add(u));

      onProgress?.({ type: 'status', message: `جمع الروابط: ${placeUrls.size}` });

      // Scroll feed to load more
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

      const ended = await searchPage.locator('text=لقد وصلت إلى نهاية القائمة').isVisible({ timeout: 500 }).catch(() => false);
      if (ended) break;
    }

    await searchPage.close();

    const urlList = [...placeUrls].slice(0, maxResults * 2); // collect extra — many will have websites
    onProgress?.({ type: 'status', message: `بدأ فحص ${urlList.length} مكان...` });

    // ── Step 2: Visit each place and extract data ─────────────
    const placePage = await context.newPage();

    for (const url of urlList) {
      if (leads.length >= maxResults) break;

      try {
        await placePage.goto(url, { waitUntil: 'load', timeout: 60000 });
        await placePage.waitForTimeout(1500);

        // Business name — on direct place URL, h1.DUwDvf has the name
        const name = (await placePage.locator('h1.DUwDvf, h1').first().textContent({ timeout: 5000 }).catch(() => '')).trim();
        if (!name || name.length < 2) continue;

        // Website check — skip if they already have one
        const hasWebsite = await placePage.locator('a[data-item-id="authority"]').isVisible({ timeout: 2000 }).catch(() => false);
        if (hasWebsite) continue;

        // Phone
        const phoneEl = placePage.locator('[data-item-id*="phone"]').first();
        const phoneLabel = await phoneEl.getAttribute('aria-label', { timeout: 3000 }).catch(() => null)
          || await phoneEl.textContent({ timeout: 3000 }).catch(() => null);

        if (!phoneLabel) continue;
        const digits = phoneLabel.replace(/\s/g, '').match(/(\d{10,11})/);
        if (!digits) continue;

        let phone = digits[1];
        if (phone.startsWith('0') && phone.length === 11) phone = '20' + phone.slice(1);
        if (!phone.startsWith('+')) phone = '+' + phone;
        if (phone.length < 12) continue;
        if (seenPhones.has(phone)) continue;

        // Category
        const typeEl = placePage.locator('button.DkEaL, [jsaction*="category"]').first();
        const type = (await typeEl.textContent({ timeout: 2000 }).catch(() => category)).trim() || category;

        // Address
        const addrEl = placePage.locator('[data-item-id="address"]').first();
        const addrLabel = await addrEl.getAttribute('aria-label', { timeout: 2000 }).catch(() => '');
        const address = addrLabel.replace(/^العنوان:\s*/i, '').trim();

        seenPhones.add(phone);
        const lead = { name, phone, type, address, mapsUrl: url };
        leads.push(lead);
        onProgress?.({ type: 'lead', message: `✅ ${name} | ${phone}`, count: leads.length });

      } catch (_) {
        // Skip this place
      }
    }

    await placePage.close();

  } finally {
    await browser.close();
  }

  onProgress?.({ type: 'done', message: `اكتمل: ${leads.length} عميل بدون موقع`, count: leads.length });
  return leads;
}

module.exports = { scrapeGoogleMaps };
