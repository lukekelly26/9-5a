// api/verify-session.js
// Confirms a Stripe Checkout session was actually paid, server-side.
// This is what makes the unlock trustworthy — the browser can't be trusted
// to say "I paid," so we ask Stripe directly.
//
// It also reports a genuine "Purchase" event to Meta's Conversions API at
// this exact moment — i.e. only when a real payment has been confirmed by
// Stripe, never just because someone clicked a button. This is what lets
// Meta's ad algorithm learn from real buyers instead of window-shoppers.
//
// Required environment variables (set in Vercel project settings):
//   STRIPE_SECRET_KEY        - from https://dashboard.stripe.com/apikeys
//   META_PIXEL_ID             - your Meta Pixel/Dataset ID
//   META_CAPI_ACCESS_TOKEN    - your Conversions API access token

const Stripe = require('stripe');
const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

async function reportPurchaseToMeta({ session, req }) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

  // If the Pixel isn't configured yet, just skip — this should never block
  // or break the actual payment verification. But log it clearly, so a
  // missing/misnamed environment variable is obvious in Runtime Logs
  // rather than looking identical to a successful, silent send.
  if (!pixelId || !accessToken) {
    console.log('Meta reporting skipped: META_PIXEL_ID or META_CAPI_ACCESS_TOKEN is not set.');
    return;
  }

  try {
    const email = session.customer_details && session.customer_details.email;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const eventSourceUrl = `${proto}://${host}/`;

    const userData = {
      client_user_agent: req.headers['user-agent'] || undefined
    };
    if (email) {
      userData.em = [sha256(email)];
    }
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      userData.client_ip_address = forwardedFor.split(',')[0].trim();
    }

    const payload = {
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          event_id: session.id, // lets Meta de-duplicate against any browser-side Pixel event for the same purchase
          event_source_url: eventSourceUrl,
          action_source: 'website',
          user_data: userData,
          custom_data: {
            currency: (session.currency || 'gbp').toUpperCase(),
            value: (session.amount_total || 0) / 100
          }
        }
      ]
    };

    const url = `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${accessToken}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error('Meta Conversions API error:', errBody);
    } else {
      console.log('Meta Purchase event sent successfully for session', session.id);
    }
  } catch (err) {
    // Never let a Meta reporting failure affect the actual payment verification.
    console.error('reportPurchaseToMeta failed:', err);
  }
}

module.exports = async (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId) {
    res.status(400).json({ error: 'Missing session_id' });
    return;
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      // Await this: in a serverless environment, the function can freeze
      // the moment a response is sent, which would silently kill an
      // un-awaited background call before it ever finishes (or even starts).
      await reportPurchaseToMeta({ session, req });
      res.status(200).json({ paid: true });
    } else {
      res.status(200).json({ paid: false });
    }
  } catch (err) {
    console.error('verify-session error:', err);
    res.status(500).json({ paid: false, error: 'Could not verify payment' });
  }
};
