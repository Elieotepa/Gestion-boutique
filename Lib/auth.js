const crypto = require('node:crypto');
const db = require('../db/database');

const SESSION_DURATION_MS = 1000 * 60 * 60 * 12; // 12h

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, hash) {
  const computed = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiration = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await db.prepare('INSERT INTO sessions (token, utilisateur_id, date_expiration) VALUES (?, ?, ?)')
    .run(token, userId, expiration);
  return token;
}

async function getUserFromToken(token) {
  if (!token) return null;
  const session = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.date_expiration) < new Date()) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = await db.prepare(`
    SELECT u.id, u.nom, u.email, u.actif, r.nom as role
    FROM utilisateurs u JOIN roles r ON u.role_id = r.id
    WHERE u.id = ?
  `).get(session.utilisateur_id);
  if (!user || !user.actif) return null;
  return user;
}

async function logActivity(userId, action, table = null, recordId = null) {
  await db.prepare(`INSERT INTO journal_activite (utilisateur_id, action, table_concernee, enregistrement_id)
              VALUES (?, ?, ?, ?)`).run(userId, action, table, recordId);
}

module.exports = { hashPassword, verifyPassword, createSession, getUserFromToken, logActivity };
