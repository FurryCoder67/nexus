const { createClient } = require('@vercel/kv');
const crypto = require('crypto');
const cors = require('../_cors');

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function hash(password) {
  const salt = process.env.PASSWORD_SALT || 'hunters_default_salt';
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores' });

  try {
    const userKey = `user:${username.toLowerCase()}`;
    const existing = await kv.get(userKey);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const token = makeToken();
    const user = { username, passwordHash: hash(password), token, createdAt: Date.now() };

    await kv.set(userKey, user);
    await kv.set(`token:${token}`, username.toLowerCase());

    return res.status(200).json({ token, username });
  } catch (e) {
    console.error('register error:', e);
    return res.status(500).json({ error: 'Server error — try again later' });
  }
};
