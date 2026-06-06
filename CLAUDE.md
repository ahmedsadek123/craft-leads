# Craft Leads — CLAUDE.md

Lead scraper + WhatsApp outreach tool for Craft Site agency.
Scrapes businesses **without websites** from Google Maps, then sends them a WhatsApp pitch.

## Start / Stop

```bash
cd "C:\Users\COMPUMARTS\Desktop\craft-leads"
node server.js          # or double-click start.bat
```

Dashboard: http://localhost:3737  
Port set via `process.env.PORT || 3737`

## File Map

```
craft-leads/
├── server.js              # Express API + SSE broadcaster
├── src/
│   ├── scraper.js         # Google Maps → leads (Playwright)
│   ├── sender.js          # WhatsApp client (whatsapp-web.js)
│   ├── db.js              # Read/write data/leads.json
│   └── templates.js       # Arabic message templates + typeMap
├── public/
│   └── index.html         # Full Arabic RTL dashboard (Tailwind CDN)
├── data/
│   ├── leads.json         # Lead database (flat JSON array)
│   └── whatsapp-session/  # WA session — delete to force re-login
└── start.bat
```

## Lead Schema

```json
{
  "id": "uuid",
  "name": "اسم العميل",
  "phone": "+201012345678",
  "type": "مطعم",
  "address": "العنوان",
  "mapsUrl": "https://maps.google.com/...",
  "status": "pending",
  "addedAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-01T00:00:00Z"
}
```

**Status values:** `pending` | `sent` | `failed` | `replied` | `not_on_whatsapp`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/leads` | All leads array |
| GET | `/api/stats` | `{total, pending, sent, failed, replied}` |
| PATCH | `/api/leads/:id` | `{ status }` — update status |
| DELETE | `/api/leads/:id` | Delete one lead |
| DELETE | `/api/leads` | Clear all leads |
| POST | `/api/scrape` | `{ category, city, maxResults }` |
| POST | `/api/whatsapp/connect` | Init WA client + emit QR |
| POST | `/api/whatsapp/disconnect` | Destroy WA client |
| GET | `/api/whatsapp/status` | `{ status, qr }` |
| GET | `/api/whatsapp/qr-image` | QR as PNG image |
| POST | `/api/whatsapp/send` | `{ minDelay, maxDelay, messageTemplate }` |
| GET | `/api/events` | SSE stream (channels: whatsapp, scraper, sender, refresh) |

## Scraper Logic (src/scraper.js)

- Uses Playwright (Chromium headless)
- Searches Google Maps for `{category} في {city}`
- **Skips** businesses that already have a website (`a[data-item-id="authority"]`)
- Extracts: name, phone, category, address, mapsUrl
- Phone normalized to `+20XXXXXXXXX` format
- Deduplicates by phone number

## WhatsApp Sender (src/sender.js)

- `whatsapp-web.js` with `LocalAuth` (session saved to `data/whatsapp-session/`)
- Checks `isRegisteredUser` before sending — marks `not_on_whatsapp` if false
- Random delay between `minDelaySec` and `maxDelaySec` between messages
- Default delay: 35–65 seconds

## Message Template (src/templates.js)

Current template (line 51):
```js
`السلام عليكم معاك ليث من Craftsite.it.com احنا بنعمل ويبسايت احترافيه وباسعار ااقل من السوق شوف شغلنا في المواقع بتاعنا ولو عجبك اتواصل معانا`
```

To change the message: edit the string in `templates` array at line 51.
To add business types: add to `typeMap` object (key = Arabic business type word).

## Frontend (public/index.html)

- Single HTML file, RTL Arabic, Tailwind CDN
- Cairo font from Google Fonts
- Real-time updates via SSE (`/api/events`)
- Stats auto-refresh every 10 seconds
- Filter leads by status via dropdown

## Common Changes

**Change message text** → `src/templates.js` line 51  
**Add new business type words** → `src/templates.js` typeMap  
**Change port** → `server.js` last line or set `PORT` env var  
**Reset WA session** → delete `data/whatsapp-session/` folder, reconnect  
**Edit dashboard UI** → `public/index.html`  
**Scraper selectors break** → `src/scraper.js` (Google Maps CSS classes change occasionally)
