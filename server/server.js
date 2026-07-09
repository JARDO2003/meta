const express = require('express');
const fetch = require('node-fetch');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.use(helmet());
app.use(express.json());

// Basic rate limiter
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

// Example: proxy an action that requires a third-party API key stored server-side
app.post('/api/thirdparty/do-action', async (req, res) => {
  try {
    // Validate incoming payload here
    const payload = req.body;
    const apiKey = process.env.THIRD_PARTY_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Server misconfigured' });

    const resp = await fetch('https://api.thirdparty.example/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    // Only forward required fields to the client
    res.json({ success: true, data });
  } catch (err) {
    console.error('thirdparty error', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Placeholder: Firebase Admin example (enable and configure if needed)
// const admin = require('firebase-admin');
// const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT);
// admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
// app.post('/api/firebase/some-admin-action', async (req, res) => { ... });

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on ${port}`));
