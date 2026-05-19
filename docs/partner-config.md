# Partner-importer aan/uit zetten (Firebase Console)

Wijn & Spijs toont suggesties van partner-importers (Okhuysen, SooD, …). Welke
partners zichtbaar zijn, kun je **live aan/uit zetten via de Firebase Console**
zonder code-wijziging of deploy.

**Waar:** Firebase Console → project **`vinage-85fd8`** → **Firestore Database**

## Het document

| | |
|---|---|
| Collectie | `config` |
| Document-ID | `importers` |
| Pad | `config/importers` |

## Eenmalig aanmaken (eerste keer)

1. **Start collection** / **+ Add collection** → Collection ID: **`config`** → Next.
2. Document ID: **`importers`** (exact, kleine letters).
3. Voeg per partner een veld toe:

   | Field | Type | Value |
   |---|---|---|
   | `sood` | **boolean** | `true` of `false` |
   | `okhuysen` | **boolean** | `true` of `false` |

4. **Save**.

## Daarna wijzigen

Open `config/importers`, klik op het veld, wissel de boolean, **Update**.

## Wat de waarden doen

| Situatie | Gedrag |
|---|---|
| Veld = `true` | Partner wordt getoond |
| Veld = `false` | Partner wordt **verborgen** in Wijn & Spijs |
| Veld bestaat niet / document bestaat niet | Fallback naar de standaard in de code (= **aan**) |
| Offline of niet ingelogd | Zelfde fallback: standaard uit de code (= **aan**) |

## Belangrijke punten

- **Veldtype moet `boolean` zijn** (true/false-schakelaar), niet de string `"true"`.
- Document-ID en veldnamen exact: `importers`, en als veldnaam de partner-`id`
  uit `js/importers.js` (kleine letters): `okhuysen`, `sood`.
- Wijziging is **vrijwel direct live** — de app luistert via een Firestore
  snapshot (`Sync.importerConfig` / `Sync.isImporterActive`); uiterlijk
  zichtbaar bij de volgende Wijn & Spijs-zoekopdracht of na herladen. Geen
  deploy nodig.
- Schrijven kan **alleen via de Console** (firestore.rules: `match
  /config/{docId}` → `allow read: if true; allow write: if false;`). Lezen is
  openbaar, maar de inhoud (aan/uit-vlaggen) is niet gevoelig.
- Zolang het document **niet** bestaat, blijft alles zoals in de code
  (alle `active: true` partners zichtbaar). Alleen aanmaken wanneer je iets
  wilt uitschakelen.

## Voorbeeld — SooD tijdelijk verbergen

Zet in `config/importers` het veld `sood` op `false`. Weer tonen: op `true`
zetten of het veld verwijderen (dan geldt de code-default = aan).

## Nieuwe partner later

Komt er een derde partner bij (eigen `id` in `js/importers.js`), voeg dan in
ditzelfde document een veld met dat `id` toe (type boolean).

## Technische verwijzingen (voor onderhoud)

- Partnerdefinities + catalogus: `js/importers.js` (`IMPORTERS`, veld `logo`
  voor het partnerlogo).
- Config inlezen + fallback: `js/sync.js` → `importerConfig`,
  `isImporterActive(id, fallback)`, onSnapshot op `config/importers`.
- Toepassing: `js/app.js` → `_buildImporterSuggestions()`.
- Rules: `firestore.rules` → `match /config/{docId}`.
- Markdown valt onder de hosting-`ignore` in `firebase.json`, dus dit bestand
  wordt niet meegedeployd (interne documentatie).
