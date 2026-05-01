// ===== PAYMENT ROUTES =====
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const store   = require('../data/store');

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(phone) {
  phone = (phone || '').replace(/[\s\-]/g, '');
  if (phone.startsWith('0'))    return '254' + phone.slice(1);
  if (phone.startsWith('+254')) return phone.slice(1);
  if (phone.startsWith('254'))  return phone;
  return phone;
}

function generateRef() {
  return 'SF-' + Math.random().toString(36).toUpperCase().slice(2, 8);
}

// ── POST /api/pay/initiate ────────────────────────────────────────────────────
router.post('/initiate', async (req, res) => {
  const { name, phone } = req.body;

  if (!name || !phone) {
    return res.json({ success: false, message: 'Name and phone number are required.' });
  }

  const normalizedPhone = normalizePhone(phone);
  const amount          = store.settings.price;
  const reference       = generateRef();

  // Already paid — send back existing reference so frontend can redirect immediately
  const existing = store.students.find(
    s => s.phone === normalizedPhone && s.status === 'paid'
  );
  if (existing) {
    return res.json({
      success: false,
      alreadyEnrolled: true,
      reference: existing.reference,
      name: existing.name,
      message: 'This number already has an active enrollment.',
    });
  }

  // Create pending record
  const student = {
    reference,
    name,
    phone: normalizedPhone,
    status: 'pending',
    payheroRef: null,
    createdAt: new Date().toISOString(),
  };
  store.students.push(student);

  const username    = process.env.PAYHERO_USERNAME;
  const password    = process.env.PAYHERO_PASSWORD;
  const channelId   = process.env.PAYHERO_CHANNEL_ID;
  const callbackUrl = process.env.CALLBACK_URL ||
    'https://smartfuture-backend.onrender.com/api/pay/callback';

  // TEST MODE — no credentials set (local development)
  if (!username || !password || !channelId) {
    console.warn('⚠  PayHero credentials not set — TEST MODE: auto-approving in 4 s');
    setTimeout(() => {
      const s = store.students.find(st => st.reference === reference);
      if (s) s.status = 'paid';
    }, 4000);
    return res.json({ success: true, reference, testMode: true });
  }

  const credentials = Buffer.from(`${username}:${password}`).toString('base64');

  try {
    const payheroRes = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      {
        amount,
        phone_number:       normalizedPhone,
        channel_id:         parseInt(channelId),
        provider:           'm-pesa',
        external_reference: reference,
        callback_url:       callbackUrl,
        customer_name:      name,
      },
      {
        headers: {
          Authorization:  `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    if (payheroRes.data && payheroRes.data.reference) {
      student.payheroRef = payheroRes.data.reference;
    }

    console.log(`✅ STK Push sent — ${reference} → ${normalizedPhone} KSh ${amount}`);
    return res.json({ success: true, reference });

  } catch (error) {
    console.error('PayHero error:', error.response?.data || error.message);

    // Remove pending record so student can retry
    const idx = store.students.findIndex(s => s.reference === reference);
    if (idx !== -1) store.students.splice(idx, 1);

    return res.json({
      success: false,
      message:
        error.response?.data?.message ||
        'Failed to send M-Pesa request. Please check your phone number and try again.',
    });
  }
});

// ── GET /api/pay/status?reference=SF-XXXXXX ───────────────────────────────────
// Frontend polls this every 4 seconds.
// The moment status === "paid" the frontend stops polling and redirects
// straight to dashboard.html — no manual step required.
router.get('/status', (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.json({ status: 'not_found' });

  const student = store.students.find(s => s.reference === reference);
  if (!student)   return res.json({ status: 'not_found' });

  return res.json({
    status:    student.status,   // 'pending' | 'paid' | 'failed'
    reference: student.reference,
    name:      student.name,
    phone:     student.phone,
  });
});

// ── POST /api/pay/callback ────────────────────────────────────────────────────
// PayHero hits this URL after the M-Pesa PIN is entered (success or failure).
// We flip the student record to "paid" here.
// The frontend poll sees the change on its very next tick (≤4 s) and
// immediately does: window.location.href = 'dashboard.html?ref=SF-XXXXXX'
router.post('/callback', (req, res) => {
  console.log('📩 PayHero callback body:', JSON.stringify(req.body, null, 2));

  const body        = req.body || {};
  const externalRef = body.external_reference
    || body.ExternalReference
    || body.reference
    || body.Reference;

  const rawStatus = (body.status || body.Status || body.ResultCode || '').toString();
  // PayHero uses "SUCCESS"; MPESA ResultCode 0 = success
  const succeeded = ['SUCCESS', 'COMPLETED', '0', 0].includes(
    isNaN(rawStatus) ? rawStatus.toUpperCase() : Number(rawStatus)
  );

  if (externalRef) {
    const student = store.students.find(s => s.reference === externalRef);
    if (student) {
      student.status = succeeded ? 'paid' : 'failed';
      student.paidAt = succeeded ? new Date().toISOString() : null;
      console.log(`🔄 ${externalRef} status → ${student.status}`);
    } else {
      console.warn(`⚠  Callback for unknown ref: ${externalRef}`);
    }
  } else {
    console.warn('⚠  Callback missing external_reference:', body);
  }

  // Always 200 — prevents PayHero from retrying
  return res.status(200).json({ success: true });
});

// Some PayHero setups fire a GET callback
router.get('/callback', (req, res) => {
  const q          = req.query;
  const extRef     = q.external_reference || q.reference;
  const rawStatus  = (q.status || q.Status || '').toString().toUpperCase();
  const succeeded  = ['SUCCESS', 'COMPLETED', '0'].includes(rawStatus);

  if (extRef) {
    const student = store.students.find(s => s.reference === extRef);
    if (student) {
      student.status = succeeded ? 'paid' : 'failed';
      console.log(`🔄 GET callback: ${extRef} → ${student.status}`);
    }
  }
  return res.status(200).json({ success: true });
});

module.exports = router;
