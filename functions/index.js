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

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions }              = require('firebase-functions/v2');
const admin                             = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'europe-west1' }); // EU hosting for GDPR

// ── Stripe price ID → plan name mapping ──────────────────────────────────────
// Fill in your Price IDs in functions/.env (STRIPE_PRICE_*)
const PRICE_TO_PLAN = () => ({
  [process.env.STRIPE_PRICE_LIEFHEBBER]:  'liefhebber',
  [process.env.STRIPE_PRICE_VERZAMELAAR]: 'verzamelaar',
  [process.env.STRIPE_PRICE_JAARLIJKS]:   'jaarlijks',
});

// ── Hard cap (server-side safety net — real plan limits live on the client) ──
const MONTHLY_HARD_CAP = 500; // calls per user per calendar month

// ── Main proxy callable ───────────────────────────────────────────────────────
exports.aiProxy = onCall(
  {
    cors:           true,
    invoker:        'public',   // Allow Firebase SDK to call; auth checked inside
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

    console.log(`[aiProxy] uid=${uid} model=${model} hasImage=${!!base64image} promptLen=${prompt?.length}`);

    if (!prompt) {
      throw new HttpsError('invalid-argument', 'prompt is required.');
    }

    // 2. Server-side monthly abuse cap — non-fatal if Firestore fails
    let count = 0;
    let usageRef = null;
    let monthKey = null;
    try {
      const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
      monthKey    = 'calls_' + month.replace('-', '_');
      usageRef    = admin.firestore().doc(`aiUsage/${uid}`);
      const usageDoc = await usageRef.get();
      count = usageDoc.exists ? (usageDoc.data()[monthKey] || 0) : 0;
      console.log(`[aiProxy] usage count=${count}`);
      if (count >= MONTHLY_HARD_CAP) {
        throw new HttpsError(
          'resource-exhausted',
          `Monthly hard cap of ${MONTHLY_HARD_CAP} AI calls reached.`
        );
      }
    } catch (e) {
      if (e instanceof HttpsError) throw e; // re-throw quota errors
      console.warn('[aiProxy] Firestore usage check failed (non-fatal):', e.message);
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
    console.log(`[aiProxy] apiKey present=${!!apiKey} model=${chosenModel}`);
    if (!apiKey) {
      throw new HttpsError('internal', 'AI service not configured. Contact support.');
    }

    let anthropicRes;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
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
    } catch (fetchErr) {
      console.error('[aiProxy] fetch to Anthropic failed:', fetchErr.message);
      throw new HttpsError('internal', 'Failed to reach AI service: ' + fetchErr.message);
    }

    const anthropicData = await anthropicRes.json();
    console.log(`[aiProxy] Anthropic status=${anthropicRes.status}`);

    if (!anthropicRes.ok) {
      const msg = anthropicData.error?.message || `Anthropic error ${anthropicRes.status}`;
      console.error('[aiProxy] Anthropic error:', msg);
      throw new HttpsError('internal', msg);
    }

    // 5. Increment usage counter (fire-and-forget)
    if (usageRef && monthKey) {
      usageRef.set({ [monthKey]: count + 1, uid }, { merge: true }).catch(() => {});
    }

    // 6. Return result
    const text = anthropicData.content?.[0]?.text;
    if (!text) {
      console.error('[aiProxy] Unexpected Anthropic response shape:', JSON.stringify(anthropicData).slice(0, 200));
      throw new HttpsError('internal', 'Unexpected response from AI service.');
    }

    console.log(`[aiProxy] success, responseLen=${text.length}`);
    return { text };
  }
);

// ── Stripe Webhook ─────────────────────────────────────────────────────────
// Receives events from Stripe and activates the user's subscription plan.
//
// Setup (one-time, after deploying):
//   1. Go to https://dashboard.stripe.com/webhooks
//   2. Add endpoint: https://europe-west1-vinage-85fd8.cloudfunctions.net/stripeWebhook
//   3. Select event: checkout.session.completed
//   4. Copy the signing secret → paste as STRIPE_WEBHOOK_SECRET in functions/.env
//   5. Re-deploy: firebase deploy --only functions
//
exports.stripeWebhook = onRequest(
  {
    cors:           false,  // Stripe posts directly — no CORS needed
    timeoutSeconds: 30,
    memory:         '256MiB',
    invoker:        'public', // Stripe must reach this endpoint without auth
  },
  async (req, res) => {
    const stripeSecret  = process.env.STRIPE_SECRET;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeSecret || !webhookSecret ||
        stripeSecret.startsWith('sk_test_REPLACE') ||
        webhookSecret.startsWith('whsec_REPLACE')) {
      console.error('[stripeWebhook] Stripe keys not configured in .env');
      res.status(500).send('Stripe not configured');
      return;
    }

    // Verify signature — protects against spoofed requests
    const Stripe    = require('stripe');
    const stripe    = Stripe(stripeSecret);
    const sig       = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
      console.warn('[stripeWebhook] Signature verification failed:', err.message);
      res.status(400).send('Webhook signature invalid');
      return;
    }

    console.log(`[stripeWebhook] event=${event.type}`);

    // We only care about successful checkouts
    if (event.type !== 'checkout.session.completed') {
      res.status(200).send('Ignored');
      return;
    }

    const session = event.data.object;
    const uid     = session.client_reference_id;

    if (!uid) {
      console.warn('[stripeWebhook] No client_reference_id in session — payment not linked to user');
      res.status(200).send('No UID');
      return;
    }

    // Determine plan from the price ID on the line item
    // For Payment Links we read the first line item's price ID
    let planId = null;
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
      const priceId   = lineItems.data[0]?.price?.id;
      planId = PRICE_TO_PLAN()[priceId] || null;
      console.log(`[stripeWebhook] priceId=${priceId} → plan=${planId}`);
    } catch (e) {
      console.error('[stripeWebhook] Failed to fetch line items:', e.message);
    }

    if (!planId) {
      console.warn('[stripeWebhook] Could not map price to a plan — check STRIPE_PRICE_* in .env');
      res.status(200).send('Plan not mapped');
      return;
    }

    // Write plan to Firestore — the app picks it up via its live listener
    try {
      await admin.firestore().doc(`users/${uid}`).set(
        {
          plan:          planId,
          planActivated: Date.now(),
          stripeSession: session.id,
        },
        { merge: true }
      );
      console.log(`[stripeWebhook] Plan "${planId}" activated for uid=${uid}`);
    } catch (e) {
      console.error('[stripeWebhook] Firestore write failed:', e.message);
      res.status(500).send('Firestore write failed');
      return;
    }

    res.status(200).send('OK');
  }
);
