// api/create-checkout-session.js
// Creates a real Stripe Checkout session for the £9.99 report unlock.
// No Stripe Dashboard product setup needed — the price is defined inline below.
//
// Required environment variable (set in Vercel project settings):
//   STRIPE_SECRET_KEY   - from https://dashboard.stripe.com/apikeys

const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Figure out the site's own base URL so success/cancel redirects come back here.
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            unit_amount: 999, // £9.99, in pence
            product_data: {
              name: 'Your Full Escape Route Report'
            }
          },
          quantity: 1
        }
      ],
      success_url: `${baseUrl}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?canceled=true`
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: 'Could not start checkout' });
  }
};
