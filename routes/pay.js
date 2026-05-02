// ===== PAYMENT ROUTES =====
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const store = require('../data/store');

// Normalize phone number to 254XXXXXXXXX format
function normalizePhone(phone) {
  phone = phone.replace(/\s/g, '');
  if (phone.startsWith('0')) return '254' + phone.slice(1);
  if (phone.startsWith('+254')) return phone.slice(1);
  if (phone.startsWith('254')) return phone;
  return phone;
}

// Generate a short readable reference code
function generateRef() {
  return 'SF-' + Math.random().toString(36).toUpperCase().slice(2, 8);
}

// ===== INITIATE PAYMENT =====
// POST /api/pay/initiate
router.post('/initiate', async (req, res) => {
  const { name, phone } = req.body;

  if (!name || !phone) {
    return res.json({ success: false, message: 'Name and phone number are required.' });
  }

  const normalizedPhone = normalizePhone(phone);
  const reference = generateRef();
  const amount = store.settings.price;

  // Check if already paid
  const existing = store.students.find(
    s => s.phone === normalizedPhone && s.status === 'paid'
  );

  if (existing) {
    return res.json({
      success: false,
      message: 'This number already has an active enrollment.',
      reference: existing.reference
    });
  }

  // Create pending student
  const student = {
    reference,
    name,
    phone: normalizedPhone,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  store.students.push(student);

  const payheroUsername = process.env.PAYHERO_USERNAME;
  const payheroPassword = process.env.PAYHERO_PASSWORD;
  const channelId = process.env.PAYHERO_CHANNEL_ID;

  const callbackUrl =
    process.env.CALLBACK_URL ||
    `https://digital-skills-backend.onrender.com/api/pay/callback`;

  const credentials = Buffer.from(`${payheroUsername}:${payheroPassword}`).toString('base64');

  try {
    const payheroRes = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      {
        amount: amount,
        phone_number: normalizedPhone,
        channel_id: parseInt(channelId),
        provider: 'm-pesa',
        external_reference: reference,
        callback_url: callbackUrl,
        customer_name: name
      },
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Save transaction reference
    if (payheroRes.data && payheroRes.data.reference) {
      store.transactions[reference] = payheroRes.data.reference;
    }

    return res.json({
      success: true,
      reference,
      message: 'M-Pesa STK Push sent. Check your phone.'
    });

  } catch (error) {
    console.error('PayHero error:', error.response?.data || error.message);

    // Remove pending student
    const idx = store.students.findIndex(s => s.reference === reference);
    if (idx !== -1) store.students.splice(idx, 1);

    return res.json({
      success: false,
      message: 'Failed to initiate payment.'
    });
  }
});

// ===== PAYMENT STATUS CHECK =====
// GET /api/pay/status?reference=SF-XXXXXX
router.get('/status', (req, res) => {
  const { reference } = req.query;

  if (!reference) return res.json({ status: 'not_found' });

  const student = store.students.find(s => s.reference === reference);

  if (!student) return res.json({ status: 'not_found' });

  return res.json({
    status: student.status,
    name: student.name,
    reference: student.reference
  });
});

// ===== PAYHERO CALLBACK =====
// POST /api/pay/callback
router.post('/callback', (req, res) => {
  console.log('PayHero callback received:', JSON.stringify(req.body));

  // 🔥 IMPORTANT: Respond immediately (prevents timeout)
  res.status(200).json({ success: true });

  const data = req.body;

  try {
    if (data.status && data.response) {
      const reference = data.response.ExternalReference;
      const resultCode = data.response.ResultCode;

      const student = store.students.find(s => s.reference === reference);

      if (student) {
        if (resultCode === 0) {
          student.status = 'paid';
        } else {
          student.status = 'failed';
        }

        console.log(`✅ Payment ${reference} updated to ${student.status}`);
      } else {
        console.log('⚠️ Student not found for reference:', reference);
      }
    } else {
      console.log('⚠️ Invalid callback structure:', data);
    }
  } catch (err) {
    console.error('Callback processing error:', err.message);
  }
});

module.exports = router;