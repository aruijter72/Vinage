# Partner-config — kopieer/plak spiekblad

Korte, kopieer-klare waarden voor het aanmaken van het Firestore-document in de
Firebase Console. Volledige uitleg: zie `docs/partner-config.md`.

Firebase Console → project `vinage-85fd8` → Firestore Database.

---

## 1. Collection ID

```
config
```

## 2. Document ID

```
importers
```

## 3. Velden (Field name → Type → Value)

Type is steeds **boolean**.

Field name:

```
sood
```

```
okhuysen
```

Value (kies er één per veld):

```
true
```

```
false
```

---

## Volledige document-inhoud (referentie)

Zo ziet `config/importers` er in JSON uit als beide partners aan staan:

```json
{
  "okhuysen": true,
  "sood": true
}
```

SooD verbergen:

```json
{
  "okhuysen": true,
  "sood": false
}
```

> Let op: de Firestore Console heeft geen "JSON plakken"-knop — voer de velden
> los in (stap 3). Het JSON-blok hierboven is alleen ter referentie / voor
> tooling (bijv. Admin SDK of een import-script).

---

## Spiekregels

| Wil je… | Zet veld | Op waarde |
|---|---|---|
| SooD verbergen | `sood` | `false` |
| SooD tonen | `sood` | `true` (of veld weghalen) |
| Okhuysen verbergen | `okhuysen` | `false` |
| Okhuysen tonen | `okhuysen` | `true` (of veld weghalen) |
| Alles standaard (aan) | — | document niet aanmaken / leeglaten |

Nieuwe partner later: veldnaam = de `id` uit `js/importers.js` (kleine
letters), type boolean.
