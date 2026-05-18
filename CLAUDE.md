# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run locally** (no build step needed):
```bash
python3 -m http.server 8080   # open http://localhost:8080/app.html
# or
npx serve .
```
Camera scanning requires HTTPS; localhost is the only plain-HTTP exception that works.

**Deploy to Firebase Hosting** (requires `firebase` CLI, run from Mac terminal):
```bash
./deploy.sh               # hosting only — bumps ?v= cache-bust + SW_VERSION, then deploys
./deploy.sh functions     # hosting + Cloud Functions
```
The script uses `sed -i ''` (macOS syntax). Never run it inside the Linux sandbox — use the Mac terminal.

**Firebase emulators** (optional local testing):
```bash
firebase emulators:start
```

## Architecture

No build step, no bundler, no Node modules in the browser. Plain HTML + CSS + JS loaded via `<script>` tags in `app.html`.

### JS modules and their responsibilities

| File | Role |
|------|------|
| `js/db.js` | **localStorage data layer** — all reads/writes, fully synchronous. Source of truth for offline use. |
| `js/sync.js` | **Firebase write-through wrapper** — mirrors the `DB.*` write API; every mutation goes to localStorage immediately, then async to Firestore. `onSnapshot` listeners push remote changes back. Always call `Sync.*` for mutations (not `DB.*` directly). |
| `js/app.js` | **Everything UI** — views, routing, event delegation, camera, modals, cellar rack rendering (~3 500 lines). Single `App` object with `view` state. |
| `js/api.js` | Claude + OpenAI API calls for wine label scanning and food pairing. Keys stay on-device; a Firebase proxy function is used when the user is signed in. |
| `js/imagedb.js` | IndexedDB store for full-resolution wine photos (localStorage has a ~5 MB limit). |
| `js/i18n.js` | EN/NL translation strings; accessed via `App.t('key')`. |
| `js/importers.js` | Import helpers (e.g. Vivino JSON). |
| `wijnrek_3d.html` | Three.js r128 3D rack, loaded as an `<iframe>`. Communicates with `app.js` via `postMessage` — it never touches `localStorage` directly. |

### Data layer

`DB` keys in `localStorage`: `vinage_wines`, `vinage_cellars`, `vinage_settings`, `vinage_wishlist`, `vinage_consumption`.

**Wine object** key fields: `id`, `name`, `producer`, `vintage`, `type` (`red|white|rosé|sparkling|dessert|fortified`), `quantity`, `rating`, `thumbnail` (80×120 b64, stored in localStorage), `imageUrl` (Firebase Storage URL), `tags[]`, `pairings[]`.

**Cellar slot keys** by type:
- `grid` / `diamond` → `"r-c"` (0-indexed row from top, 0-indexed col from left)
- `case` (12 bottles) → `"0"` – `"11"`
- `case6` (6 bottles) → `"h0"` – `"h5"`
- `shelf` → no `slots` object; uses `cellar.wines[]` array (duplicates = multiple bottles)

### App routing

`App.view` holds the active tab (`scan|cellar|collection|wishlist|pairing|settings`). `App.navigate(view)` resets sub-state; `App.renderView()` re-renders the current view without resetting sub-state. `App.cellarDetailId` tracks which cellar is open; `null` means show the list.

All click/change events bubble up to two global listeners that call `_delegateClick` / `_delegateChange`. Actions are encoded in HTML as `data-action="action-name"` with additional `data-*` args.

### 3D wine rack iframe protocol

`wijnrek_3d.html` is embedded via `<iframe id="rack3d-iframe">`. Communication is entirely via `postMessage`:

| Direction | `type` | Payload |
|-----------|--------|---------|
| iframe → parent | `vinage-ready` | *(empty)* — iframe signals it loaded; parent responds with slot data |
| parent → iframe | `vinage-slots` | `{ slots: {"ix,iz": wineType}, cellarId, nx, nz }` |
| parent → iframe | `vinage-zoom` | `{ factor: 0.4–6.0 }` |
| iframe → parent | `vinage-slot-click` | `{ slot: "r-c", cellarId }` — user tapped a bottle |

**Coordinate conversion** (`app.js → _onRack3DLoad`): `ix = col`, `iz = (rows - 1) - r`. Row 0 (top of 2D rack) maps to the highest `iz` in 3D.

**Wine type normalisation** before sending to iframe: `rosé → rose`, `dessert → fortified`. Accepted values: `red`, `white`, `rose`, `sparkling`, `fortified`.

### Image storage

- `wine.thumbnail` (80×120 JPEG b64) — stored directly in localStorage and Firestore wine doc
- Full image — stored in IndexedDB via `ImageDB`; never in localStorage
- `wine.imageUrl` — Firebase Storage download URL set after upload; used to display image on other devices

### Sync and subscriptions

`Sync` wraps all `DB` mutations. It is safe to call `DB.get*()` directly for reads; always call `Sync.*` for writes so Firestore stays in sync.

Subscription plans (`free`, `liefhebber`, `verzamelaar`, `jaarlijks`) gate `bottleLimit` and `aiLimit`. Plan is stored in `settings.plan` (localStorage) and in the Firestore `users/{uid}` document. Stripe webhooks write plan changes to Firestore; `Sync._startUserDocListener` picks them up in real time.

### Firebase backend structure

```
Firestore:
  users/{uid}                    — profile, plan, householdId
  households/{hid}/wines/{id}    — wine docs (no full image)
  households/{hid}/cellars/{id}  — cellar + slot assignments
  households/{hid}/consumption/{id}

Storage:
  households/{hid}/wines/{wineId}.jpg   — full label photos
  users/{uid}/wines/{wineId}.jpg        — pre-household fallback

Functions (functions/):
  Stripe webhook — writes plan to users/{uid}
  Proxy vision endpoint — lets signed-in users scan without a personal API key
```

### Internationalisation

`App.lang` is `'nl'` or `'en'` (auto-detected from browser, overridable in settings). Use `App.t('i18n.key')` for translated strings. All user-visible strings should have both EN and NL entries in `js/i18n.js`.

## Key conventions

- **No mutations through `DB.*` directly** — always go through `Sync.*` so changes reach Firestore.
- **`DB.getWineById` and `DB.getCellars()` are synchronous** — no `await` needed.
- When adding a new cellar type, initialise its `slots` map in `DB.addCellar` and add a corresponding render branch in `App.buildCellarDetail`.
- `wijnrek_3d.html` uses Three.js r128 loaded from the local `three.min.js` file — do not change the CDN/version without testing all geometry code.
- Cache-bust query strings (`?v=timestamp`) on CSS/JS assets in `app.html` are updated automatically by `deploy.sh` — do not edit them by hand.
