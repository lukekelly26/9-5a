// api/verify-session.js
// Confirms a Stripe Checkout session was actually paid, server-side.
// This is what makes the unlock trustworthy — the browser can't be trusted
// to say "I paid," so we ask Stripe directly.

const Stripe = require('stripe');

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
      res.status(200).json({ paid: true });
    } else {
      res.status(200).json({ paid: false });
    }
  } catch (err) {
    console.error('verify-session error:', err);
    res.status(500).json({ paid: false, error: 'Could not verify payment' });
  }
};
