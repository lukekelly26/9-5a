// api/send-report.js
// Vercel serverless function: receives the quiz's report content + an email
// address, builds a branded PDF, and sends it via Resend.
//
// Required environment variable (set in Vercel project settings):
//   RESEND_API_KEY   - from https://resend.com

const { Resend } = require('resend');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const INK = rgb(0.165, 0.145, 0.1);       // dark brown-black, matches --ink
const GOLD = rgb(0.62, 0.435, 0.09);       // matches --gold accent (darker for print contrast)
const STAMP = rgb(0.53, 0.13, 0.06);        // matches --stamp red accent
const GREY = rgb(0.35, 0.33, 0.27);

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const {
      email,
      title, tag,
      verdict, why = [], blueprint = [], roadmap = [],
      expect, mistakes = [], makeItHappen = [],
      runnerTitle, runnerTag
    } = req.body || {};

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailPattern.test(email)) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }
    if (!title) {
      res.status(400).json({ error: 'Report content is missing' });
      return;
    }

    // ---------- Build the PDF ----------
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    const ensureSpace = (needed) => {
      if (y - needed < MARGIN) {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
    };

    const drawWrapped = (text, { size = 11, lineHeight = 15, color = INK, useFont = font, gapAfter = 10 } = {}) => {
      const lines = wrapText(text, useFont, size, CONTENT_W);
      for (const line of lines) {
        ensureSpace(lineHeight);
        page.drawText(line, { x: MARGIN, y, size, font: useFont, color });
        y -= lineHeight;
      }
      y -= gapAfter;
    };

    const drawHeading = (text) => {
      ensureSpace(30);
      page.drawText(text.toUpperCase(), { x: MARGIN, y, size: 11, font: bold, color: STAMP });
      y -= 6;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: rgb(0.85, 0.85, 0.8) });
      y -= 16;
    };

    // Title block
    page.drawText('CONFIDENTIAL — EXIT CLEARED', { x: MARGIN, y, size: 9, font: bold, color: STAMP });
    y -= 26;
    drawWrapped(title, { size: 24, lineHeight: 28, useFont: bold, color: INK, gapAfter: 4 });
    drawWrapped(tag, { size: 12, lineHeight: 16, useFont: italic, color: GREY, gapAfter: 20 });

    if (verdict) {
      drawHeading('The Verdict');
      drawWrapped(verdict, { gapAfter: 18 });
    }

    if (why.length) {
      drawHeading('Why This Fits You');
      why.forEach((w) => drawWrapped(`–  ${w}`, { gapAfter: 8 }));
      y -= 10;
    }

    if (blueprint.length) {
      drawHeading('Your Blueprint');
      blueprint.forEach((step, i) => drawWrapped(`${i + 1}. ${step}`, { gapAfter: 8 }));
      y -= 10;
    }

    if (roadmap.length) {
      drawHeading('Your Roadmap');
      roadmap.forEach((s) => {
        ensureSpace(20);
        page.drawText(`${s.stage} — ${s.focus}`, { x: MARGIN, y, size: 11, font: bold, color: GOLD });
        y -= 15;
        drawWrapped(s.action, { gapAfter: 4 });
        drawWrapped(`Best case: ${s.best}`, { size: 10, lineHeight: 13, gapAfter: 2, color: GREY });
        drawWrapped(`Typical: ${s.typical}`, { size: 10, lineHeight: 13, gapAfter: 2, color: GREY });
        drawWrapped(`If it's slow: ${s.slow}`, { size: 10, lineHeight: 13, gapAfter: 12, color: GREY });
      });
    }

    if (expect) {
      drawHeading('What To Expect');
      drawWrapped(expect, { gapAfter: 18 });
    }

    if (mistakes.length) {
      drawHeading('Mistakes To Avoid');
      mistakes.forEach((m) => drawWrapped(`–  ${m}`, { gapAfter: 8 }));
      y -= 10;
    }

    if (makeItHappen.length) {
      drawHeading('How To Make This Happen');
      makeItHappen.forEach((a) => drawWrapped(`${a.when.toUpperCase()}: ${a.text}`, { gapAfter: 8 }));
      y -= 10;
    }

    if (runnerTitle) {
      drawHeading(`Your Backup Route: ${runnerTitle}`);
      drawWrapped(runnerTag || '', { gapAfter: 10 });
    }

    const pdfBytes = await pdfDoc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    // ---------- Send the email ----------
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
      to: email,
      subject: `Your Escape Route: ${title}`,
      html: `<p>Here's your full escape plan — attached as a PDF.</p><p>${tag || ''}</p>`,
      attachments: [
        {
          filename: 'your-escape-route.pdf',
          content: pdfBase64
        }
      ]
    });

    if (error) {
      console.error('Resend error:', error);
      res.status(502).json({ error: 'Email failed to send' });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-report error:', err);
    res.status(500).json({ error: 'Something went wrong generating or sending the report' });
  }
};
