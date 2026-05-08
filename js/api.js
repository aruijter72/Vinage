// Vinage — API Layer (Claude + OpenAI)
//
// ── GDPR / AVG Training opt-out notice ────────────────────────────────────────
// Anthropic: API usage is NOT used for model training by default per Anthropic's
//   API usage policy (https://www.anthropic.com/policies/api-usage-policy).
//   No additional header is required; this is the default for all API customers.
//
// OpenAI: API usage is NOT used for model training by default per OpenAI's
//   API data usage policy (https://openai.com/policies/api-data-usage-policies).
//   We additionally pass a `user` field in each request for GDPR accountability
//   (pseudonymised — no personal data transmitted).
//
// Scan images are processed in-memory only; they are never stored by Vinage.
// ──────────────────────────────────────────────────────────────────────────────

const API = {

  // ── Wine label identification ─────────────────────────────────────────────
  async identifyWine(base64jpeg, settings, lang = 'en') {
    const langNote = lang === 'nl'
      ? 'Write the "notes" and all "pairings" values in Dutch. Also write the "country" field in Dutch (e.g. "Nederland", "Frankrijk", "Duitsland", "Italië", "Spanje").'
      : 'Write the "notes" and all "pairings" values in English. Write the "country" field in English.';
    const prompt = `You are an expert sommelier and wine identifier.
Examine this wine bottle label image and extract all visible information.
Return ONLY a valid JSON object — no explanation, no markdown — with exactly these fields
(use null for anything not visible or unknown):
{
  "name": "full wine name as on label",
  "producer": "winery or producer name",
  "vintage": 2019,
  "region": "wine region or appellation",
  "country": "country of origin",
  "type": "red|white|rosé|sparkling|dessert|fortified",
  "grapes": ["Grape1", "Grape2"],
  "pairings": ["food1", "food2", "food3"],
  "notes": "brief tasting note or description if visible on label",
  "drinkFrom": 2024,
  "drinkUntil": 2032,
  "estimatedPrice": 24.99,
  "confidence": "high|medium|low"
}
For drinkFrom/drinkUntil: use your sommelier knowledge to estimate the ideal drinking window based on the wine's type, region, producer, and vintage — even if not printed on the label. Return null only if you truly cannot make any estimate.
For estimatedPrice: provide a realistic estimated retail price in EUR based on the producer, region, vintage, and wine type. Use your knowledge of current market prices. Return null only if you truly cannot estimate.
${langNote}
If this is clearly NOT a wine bottle, return: {"error":"not_a_wine"}`;

    const provider = settings.apiProvider || 'anthropic';
    const key = provider === 'anthropic' ? settings.anthropicKey : settings.openaiKey;
    if (!key) throw new Error('no_api_key');

    try {
      const raw = provider === 'anthropic'
        ? await this._claudeVision(base64jpeg, prompt, key)
        : await this._openaiVision(base64jpeg, prompt, key);
      return this._parseJSON(raw);
    } catch (e) {
      if (e.message === 'no_api_key') throw e;
      throw new Error('api_error: ' + e.message);
    }
  },

  // ── Meal → wine pairing ───────────────────────────────────────────────────
  async suggestPairings(dish, wines, settings, lang, city) {
    const listItems = wines.map((w, i) =>
      `${i}: ${w.name}${w.vintage ? ' ' + w.vintage : ''} — ${w.type}${w.region ? ', ' + w.region : ''}${w.grapes?.length ? ' (' + w.grapes.join(', ') + ')' : ''}`
    ).join('\n');

    const langNote = lang === 'nl'
      ? 'Respond entirely in Dutch. Keep reasons concise (1 sentence each).'
      : 'Respond entirely in English. Keep reasons concise (1 sentence each).';

    const locationNote = city
      ? (lang === 'nl'
          ? `De gebruiker is gevestigd in of nabij ${city}. Geef bij availability hints over waar dit type wijn normaal verkrijgbaar is (supermarkt, slijterij, wijnhandel).`
          : `The user is based in or near ${city}. For availability, give a brief hint on where this type of wine is typically found (supermarket, wine shop, specialist).`)
      : '';

    const prompt = `You are an expert sommelier. The user is preparing: "${dish}"

Their cellar (index: wine):
${listItems}

${langNote}
${locationNote}

Return ONLY valid JSON — no markdown — exactly matching this structure:
{
  "matches": [
    {"index": 0, "reason": "one sentence why this pairs well"}
  ],
  "generalSuggestion": "1–2 sentences on what wine style suits this dish best",
  "externalSuggestions": [
    {
      "name": "Pouilly-Fumé",
      "producer": "Didier Dagueneau",
      "vintage": "2022",
      "type": "white",
      "region": "Loire Valley, France",
      "reason": "one sentence why this pairs well with the dish",
      "priceRange": "€28–40",
      "availability": "Available at wine specialists and online"
    }
  ]
}

Rules:
- matches: rank up to 3 wines from the cellar list above. If none match well, use an empty array.
- externalSuggestions: exactly 3 specific real bottles the user could buy, not in their cellar. Include realistic EUR price ranges and brief availability note.
- All text fields must be in the response language.`;

    const provider = settings.apiProvider || 'anthropic';
    const key = provider === 'anthropic' ? settings.anthropicKey : settings.openaiKey;
    if (!key) throw new Error('no_api_key');

    try {
      const raw = provider === 'anthropic'
        ? await this._claudeText(prompt, key, 'claude-haiku-4-5-20251001')
        : await this._openaiText(prompt, key, 'gpt-4o-mini');
      return this._parseJSON(raw);
    } catch (e) {
      if (e.message === 'no_api_key') throw e;
      throw new Error('api_error: ' + e.message);
    }
  },

  // ── Wine enrichment from barcode metadata ────────────────────────────────
  // Takes partial wine info (name, producer, type, country) from Open Food Facts
  // and asks the AI to fill in region, grapes, drinkFrom/Until, price, notes.
  async enrichWineData(partial, settings, lang = 'en') {
    const langNote = lang === 'nl'
      ? 'Write "notes" and "pairings" in Dutch. Write "country" in Dutch.'
      : 'Write "notes" and "pairings" in English. Write "country" in English.';

    const prompt = `You are an expert sommelier. Based on the following wine information, fill in the missing details.

Known information:
- Name: ${partial.name || 'unknown'}
- Producer: ${partial.producer || 'unknown'}
- Type: ${partial.type || 'unknown'}
- Country: ${partial.country || 'unknown'}
- Vintage: ${partial.vintage || 'unknown'}

Return ONLY a valid JSON object with exactly these fields (use null for anything you cannot determine with reasonable confidence):
{
  "name": "full wine name",
  "producer": "winery or producer name",
  "vintage": 2019,
  "region": "wine region or appellation",
  "country": "country of origin",
  "type": "red|white|rosé|sparkling|dessert|fortified",
  "grapes": ["Grape1", "Grape2"],
  "pairings": ["food1", "food2", "food3"],
  "notes": "brief tasting note or style description",
  "drinkFrom": 2024,
  "drinkUntil": 2032,
  "estimatedPrice": 24.99,
  "confidence": "high|medium|low"
}

${langNote}
If you cannot identify this wine at all, return: {"error":"unknown_wine"}`;

    const provider = settings.apiProvider || 'anthropic';
    const key = provider === 'anthropic' ? settings.anthropicKey : settings.openaiKey;
    if (!key) throw new Error('no_api_key');

    try {
      const raw = provider === 'anthropic'
        ? await this._claudeText(prompt, key, 'claude-haiku-4-5-20251001')
        : await this._openaiText(prompt, key, 'gpt-4o-mini');
      return this._parseJSON(raw);
    } catch (e) {
      if (e.message === 'no_api_key') throw e;
      throw new Error('api_error: ' + e.message);
    }
  },

  // ── Wine search by free-text query ───────────────────────────────────────
  async searchWines(query, settings, lang = 'en') {
    const langNote = lang === 'nl'
      ? 'Write "notes" and all "pairings" values in Dutch. Write "country" in Dutch (e.g. "Frankrijk", "Italië", "Spanje", "Duitsland").'
      : 'Write "notes" and all "pairings" values in English. Write "country" in English.';

    const prompt = `You are an expert sommelier and wine encyclopaedia.
The user is searching for: "${query}"

Return ONLY a valid JSON array of up to 5 real, specific wines that best match this query.
Each item must follow this exact structure (use null for unknown fields):
{
  "name": "full wine name",
  "producer": "winery or producer name",
  "vintage": 2019,
  "region": "wine region or appellation",
  "country": "country of origin",
  "type": "red|white|rosé|sparkling|dessert|fortified",
  "grapes": ["Grape1", "Grape2"],
  "pairings": ["food1", "food2", "food3"],
  "notes": "2–3 sentence tasting description and why this wine matches the query",
  "drinkFrom": 2024,
  "drinkUntil": 2032,
  "estimatedPrice": 24.99,
  "confidence": "high|medium|low"
}

Rules:
- Return ONLY the JSON array, no markdown, no explanation.
- Recommend real, purchasable wines — be specific with producer and name.
- Vary the results (different producers, regions, price points) unless the query is very specific.
- If the query names a specific wine/vintage, put the best match first and include alternatives.
${langNote}
If no wines can be meaningfully matched, return: []`;

    const provider = settings.apiProvider || 'anthropic';
    const key = provider === 'anthropic' ? settings.anthropicKey : settings.openaiKey;
    if (!key) throw new Error('no_api_key');

    try {
      const raw = provider === 'anthropic'
        ? await this._claudeText(prompt, key, 'claude-haiku-4-5-20251001')
        : await this._openaiText(prompt, key, 'gpt-4o-mini');
      // Parse array response
      const clean = raw.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
      const match = clean.match(/\[[\s\S]*\]/);
      if (!match) return [];
      return JSON.parse(match[0]);
    } catch (e) {
      if (e.message === 'no_api_key') throw e;
      throw new Error('api_error: ' + e.message);
    }
  },

  // ── Rule-based fallback pairing (no API key needed) ───────────────────────
  ruleBasedPairing(dish, wines) {
    const d = dish.toLowerCase();
    const score = (wine) => {
      let s = 0;
      const t = wine.type;
      // Simple keyword rules
      if (/salmon|trout|sea bass|sole|halibut|shellfish|oyster|crab|shrimp|prawn/.test(d)) {
        if (t === 'white' || t === 'sparkling') s += 3;
        if (t === 'rosé') s += 2;
      }
      if (/tuna|swordfish|grilled fish/.test(d)) {
        if (t === 'white') s += 3; if (t === 'rosé' || t === 'red') s += 1;
      }
      if (/beef|steak|lamb|venison|duck|game|stew|ragù|ragu/.test(d)) {
        if (t === 'red') s += 3;
      }
      if (/chicken|turkey|pork|veal/.test(d)) {
        if (t === 'white' || t === 'rosé') s += 2; if (t === 'red') s += 1;
      }
      if (/pasta|pizza|risotto|tomato/.test(d)) {
        if (t === 'red') s += 2; if (t === 'white') s += 1;
      }
      if (/cheese|charcuterie|antipasto/.test(d)) {
        if (t === 'red' || t === 'white' || t === 'sparkling') s += 2;
        if (t === 'fortified') s += 3;
      }
      if (/dessert|chocolate|cake|pudding|tart/.test(d)) {
        if (t === 'dessert' || t === 'sparkling') s += 3;
      }
      if (/salad|vegetarian|vegetable|mushroom|asparagus/.test(d)) {
        if (t === 'white' || t === 'rosé') s += 2;
      }
      if (/spicy|thai|indian|curry|asian/.test(d)) {
        if (t === 'white' || t === 'rosé' || t === 'sparkling') s += 3;
      }
      if (wine.rating) s += wine.rating * 0.2;
      return s;
    };

    const scored = wines
      .map(w => ({ wine: w, score: score(w) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      matches: scored.map(x => ({ index: wines.indexOf(x.wine), reason: null })),
      generalSuggestion: null,
      rulesBased: true
    };
  },

  // ── Internal: Claude ──────────────────────────────────────────────────────
  async _claudeVision(base64jpeg, prompt, key) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64jpeg } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data.content[0].text;
  },

  async _claudeText(prompt, key, model = 'claude-haiku-4-5-20251001') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data.content[0].text;
  },

  // ── Internal: OpenAI ──────────────────────────────────────────────────────
  async _openaiVision(base64jpeg, prompt, key) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1024,
        user: 'vinage_user', // GDPR accountability — pseudonymised, no personal data
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64jpeg}` } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data.choices[0].message.content;
  },

  async _openaiText(prompt, key, model = 'gpt-4o-mini') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        user: 'vinage_user', // GDPR accountability — pseudonymised, no personal data
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data.choices[0].message.content;
  },

  // ── Helpers ───────────────────────────────────────────────────────────────
  _parseJSON(text) {
    // Strip markdown code fences if present
    const clean = text.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
    // Find first {...} block
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    return JSON.parse(match[0]);
  }
};
