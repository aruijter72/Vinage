# 🍷 Vinage

**Your personal wine cellar — in your browser.**

Vinage is a mobile-first, no-backend wine app. It runs entirely in the browser, stores all data locally on your device, and uses the Claude or OpenAI API (key stays on your device) for wine label scanning and smart meal pairing.

Available in **English and Dutch** — auto-detected from your browser language.

---

## Features

| Feature | What it does |
|---|---|
| 📷 **Scan** | Point your phone camera at a wine label — AI identifies the wine and pre-fills name, producer, vintage, region, grapes, and food pairings |
| 🏰 **Cellar** | Create virtual cellar locations: grid racks, diamond racks, 12-bottle cases, or free shelves — tap any slot to place or remove a bottle |
| 🍷 **Collection** | Browse, search, sort, and filter all your wines; edit details or add wines manually |
| 🍽️ **Pairing** | Type a dish — AI ranks the best matches from your actual cellar and gives general sommelier advice |
| ⚙️ **Settings** | Switch language, enter your API key (stored only on your device), export/import your data as JSON |

---

## Running the app on your mobile phone

The camera requires **HTTPS** (or localhost). There are three easy ways to get there:

### Option 1 — GitHub Pages + custom subdomain `vinage.arnoldruijterit.nl` (recommended)

This gives you `https://vinage.arnoldruijterit.nl` — on your own domain, free HTTPS, never visible on your main site unless you link it.

#### Step 1 — Push to GitHub

```bash
# In the Vinage folder:
git init
git add .
git commit -m "Initial Vinage app"
git branch -M main
git remote add origin https://github.com/aruijter72/vinage.git
git push -u origin main
```

#### Step 2 — Enable GitHub Pages

1. Go to the repo on GitHub → **Settings → Pages**
2. Source: **Deploy from a branch** → Branch: `main` / `/ (root)` → Save
3. Under *Custom domain*, type `vinage.arnoldruijterit.nl` and click Save
4. Tick **Enforce HTTPS** once it appears (may take a few minutes)

#### Step 3 — Add a DNS record at your domain registrar

Log in to wherever arnoldruijterit.nl is registered (TransIP, Hostnet, Cloudflare, etc.) and add:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| `CNAME` | `vinage` | `aruijter72.github.io` | 3600 |

That's it. Within 15–30 minutes (sometimes faster) `https://vinage.arnoldruijterit.nl` is live.

> The `CNAME` file in this repo already contains `vinage.arnoldruijterit.nl` — GitHub Pages reads it automatically to know which domain to serve.

#### Add to iPhone/Android home screen

Open `https://vinage.arnoldruijterit.nl` in Safari or Chrome on your phone:
- **iPhone**: tap the Share icon → *Add to Home Screen*
- **Android**: tap the three-dot menu → *Add to Home Screen* or *Install app*

The app icon appears like a native app and opens without the browser chrome.

### Option 2 — Netlify Drop (no account needed, 30 seconds)

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the entire `Vinage` folder onto the page
3. You get an instant `https://random-name.netlify.app` URL — open it on your phone

You can claim a custom subdomain and it stays live for free.

### Option 3 — Local network (phone and computer on the same Wi-Fi)

If you want to test locally without publishing:

```bash
# Option A — Python (macOS/Linux, built in)
cd /path/to/Vinage
python3 -m http.server 8080

# Option B — Node (if you have Node installed)
npx serve .
```

Then find your computer's local IP address (System Settings → Wi-Fi → Details, or run `ipconfig` / `ifconfig`) and open `http://192.168.x.x:8080` on your phone.

> ⚠️ Camera scanning won't work over plain `http://` on most mobile browsers (only HTTPS or localhost). Use GitHub Pages or Netlify for full functionality.

---

## Setting up AI features

Scanning and smart meal pairing require an API key from one of these providers:

| Provider | Model used | Where to get a key |
|---|---|---|
| **Anthropic (Claude)** | claude-opus-4-6 for scanning, haiku for pairing | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI** | gpt-4o for scanning, gpt-4o-mini for pairing | [platform.openai.com](https://platform.openai.com/api-keys) |

1. Open Vinage → **Settings** (⚙️ tab)
2. Paste your key into the matching field
3. Tap **Save Settings**

Your key is stored only in your browser's local storage — it is never sent anywhere except directly to the API provider when you scan.

**No API key?** The app still works fully for manual wine entry, cellar management, and rule-based food pairing.

---

## Data & privacy

- All wine and cellar data is stored in your browser's `localStorage` — no server, no account, no cloud
- Your API key lives only on your device
- Export your full library at any time: **Settings → Export Data (JSON)**
- Import it on another device: **Settings → Import Data**

---

## GitHub Pages: updating the app

After the initial deploy, pushing new changes is:

```bash
git add .
git commit -m "Update"
git push
```

GitHub Pages rebuilds automatically within about a minute.

---

## File structure

```
vinage/
├── index.html          Entry point + PWA meta tags
├── manifest.json       Makes the app installable on home screen
├── css/
│   └── style.css       Mobile-first styles (responsive up to desktop)
└── js/
    ├── i18n.js         English & Dutch translations
    ├── db.js           localStorage data layer
    ├── api.js          Claude + OpenAI API integration
    └── app.js          All views, routing, camera, modals
```

No build step, no dependencies, no Node modules — plain HTML, CSS, and JavaScript.

---

## Scanning tips

- **Good light** makes a huge difference — natural light or a bright lamp pointed at the label works best
- Hold the phone **steady and close** — the label should fill most of the camera frame
- If the image appears rotated, tap the **↺ rotate button** that appears after the camera starts — each tap rotates 90°
- If the label is partially obscured by a foil capsule, tilt the bottle slightly so the label text is fully visible
- For older or hand-written labels, manual entry may be more reliable

---

## Roadmap ideas

- [ ] Wine history / drinking log
- [ ] Barcode scanning (UPC → wine database lookup)
- [ ] Multiple cellars per user
- [ ] Photo gallery per wine
- [ ] Shared cellar (with a lightweight backend)
- [ ] Winery / region map view

---

## License

MIT — use it, fork it, adapt it freely.
