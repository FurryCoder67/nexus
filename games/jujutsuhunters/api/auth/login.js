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

  try {
    const userKey = `user:${username.toLowerCase()}`;
    const user = await kv.get(userKey);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    if (user.passwordHash !== hash(password)) return res.status(401).json({ error: 'Invalid username or password' });

    if (user.token) await kv.del(`token:${user.token}`);
    const token = makeToken();
    user.token = token;
    await kv.set(userKey, user);
    await kv.set(`token:${token}`, username.toLowerCase());

    return res.status(200).json({ token, username: user.username });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: 'Server error — try again later' });
  }
};
