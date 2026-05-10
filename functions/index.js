// Vinage — Firebase Cloud Function: AI Proxy
// Forwards AI requests to Anthropic (Claude) on behalf of authenticated users.
// The Anthropic API key never leaves the server.
//
// Deployment:
//   1. Create functions/.env with: ANTHROPIC_KEY=sk-ant-api03-...
//   2. firebase deploy --only functions
//
// Environment:
//   ANTHROPIC_KEY — stored in functions/.env (loaded automatically by Firebase)

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions }   = require('firebase-functions/v2');
const admin                  = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'europe-west1' }); // EU hosting for GDPR

// ── Hard cap (server-side safety net — real plan limits live on the client) ──
const MONTHLY_HARD_CAP = 500; // calls per user per calendar month

// ── Main proxy callable ───────────────────────────────────────────────────────
exports.aiProxy = onCall(
  {
    cors:           true,
    timeoutSeconds: 60,
    memory:         '256MiB',
  },
  async (request) => {

    // 1. Require authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to use AI features.');
    }

    const uid  = request.auth.uid;
    const data = request.data || {};
    const { prompt, model, base64image } = data;

    if (!prompt) {
      throw new HttpsError('invalid-argument', 'prompt is required.');
    }

    // 2. Server-side monthly abuse cap (independent of client plan logic)
    const month    = new Date().toISOString().slice(0, 7);          // 'YYYY-MM'
    const monthKey = 'calls_' + month.replace('-', '_');
    const usageRef = admin.firestore().doc(`aiUsage/${uid}`);
    const usageDoc = await usageRef.get();
    const count    = usageDoc.exists ? (usageDoc.data()[monthKey] || 0) : 0;

    if (count >= MONTHLY_HARD_CAP) {
      throw new HttpsError(
        'resource-exhausted',
        `Monthly hard cap of ${MONTHLY_HARD_CAP} AI calls reached.`
      );
    }

    // 3. Build the Anthropic request payload
    const chosenModel = model || 'claude-haiku-4-5-20251001';

    let messageContent;
    if (base64image) {
      // Vision call (wine label scan)
      messageContent = [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64image } },
        { type: 'text', text: prompt }
      ];
    } else {
      // Text-only call
      messageContent = prompt;
    }

    // 4. Call Anthropic
    const apiKey = process.env.ANTHROPIC_KEY;
    if (!apiKey) {
      throw new HttpsError('internal', 'AI service not configured. Contact support.');
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      chosenModel,
        max_tokens: 1024,
        messages:   [{ role: 'user', content: messageContent }],
      }),
    });

    const anthropicData = await anthropicRes.json();

    if (!anthropicRes.ok) {
      throw new HttpsError(
        'internal',
        anthropicData.error?.message || `Anthropic error ${anthropicRes.status}`
      );
    }

    // 5. Increment usage counter (fire-and-forget — don't block the response)
    usageRef.set({ [monthKey]: count + 1, uid }, { merge: true }).catch(() => {});

    // 6. Return result
    return { text: anthropicData.content[0].text };
  }
);
