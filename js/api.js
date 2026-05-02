// Vinage — API Layer (Claude + OpenAI)
const API = {

  // ── Wine label identification ─────────────────────────────────────────────
  async identifyWine(base64jpeg, settings, lang = 'en') {
    const langNote = lang === 'nl'
      ? 'Write the "notes" and all "pairings" values in Dutch.'
      : 'Write the "notes" and all "pairings" values in English.';
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
  "confidence": "high|medium|low"
}
For drinkFrom/drinkUntil: use your sommelier knowledge to estimate the ideal drinking window based on the wine's type, region, producer, and vintage — even if not printed on the label. Return null only if you truly cannot make any estimate.
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
  async suggestPairings(dish, wines, settings, lang) {
    const listItems = wines.map((w, i) =>
      `${i}: ${w.name}${w.vintage ? ' ' + w.vintage : ''} — ${w.type}${w.region ? ', ' + w.region : ''}${w.grapes?.length ? ' (' + w.grapes.join(', ') + ')' : ''}`
    ).join('\n');

    const langNote = lang === 'nl'
      ? 'Respond in Dutch. Keep reasons concise (max 1 sentence each).'
      : 'Respond in English. Keep reasons concise (max 1 sentence each).';

    const prompt = `You are a top sommelier. The user is cooking: "${dish}"

Their cellar contains (index: wine):
${listItems}

${langNote}

Return ONLY valid JSON — no markdown — with this structure:
{
  "matches": [
    {"index": 0, "reason": "why it pairs well"},
    {"index": 3, "reason": "why it pairs well"}
  ],
  "generalSuggestion": "one short paragraph on what wine style suits this dish best, even if not in the cellar"
}

Rank at most 3 wines. If none suit the dish at all, return an empty matches array.`;

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
