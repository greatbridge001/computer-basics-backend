// ===== SMARTFUTURE BACKEND — server.js =====
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const payRoutes    = require('./routes/pay');
const accessRoutes = require('./routes/access');
const adminRoutes  = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── CORS ──────────────────────────────────────────────────────────────────────
// Allow requests from your Vercel frontend (set FRONTEND_URL in .env / Render env vars)
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow Postman / curl (no origin) and any listed origin
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    // Also allow any *.vercel.app subdomain for convenience
    if (/\.vercel\.app$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods:      ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static uploads ────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/pay',    payRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/admin',  adminRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    message: 'Smartfuture backend is running.',
    time:    new Date().toISOString(),
  });
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Smartfuture backend running on port ${PORT}`);
  console.log(`    Health: http://localhost:${PORT}/api/health\n`);
});
