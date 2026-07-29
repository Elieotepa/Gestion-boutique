const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');
const db = require('./db/database');
const { initDb } = require('./db/init');
const { verifyPassword, createSession, getUserFromToken, logActivity } = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// --- Permissions par rôle ---
const PERMISSIONS = {
  admin: ['produits', 'stock', 'ventes', 'finance', 'utilisateurs', 'rapports'],
  manager: ['produits', 'stock', 'ventes', 'finance', 'rapports'],
  vendeur: ['ventes', 'stock:lecture'],
  comptable: ['finance', 'rapports'],
};

function hasAccess(role, module) {
  if (!PERMISSIONS[role]) return false;
  return PERMISSIONS[role].includes(module);
}

async function authenticate(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  return await getUserFromToken(token);
}

// --- Handlers ---
const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const parts = r.pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    if (parts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = pathParts[i];
      else if (parts[i] !== pathParts[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

// ===== AUTH =====
route('POST', '/api/auth/login', async (req, res) => {
  const { email, password } = await readBody(req);
  if (!email || !password) return sendJSON(res, 400, { error: 'Email et mot de passe requis' });
  const user = await db.prepare(`
    SELECT u.*, r.nom as role FROM utilisateurs u JOIN roles r ON u.role_id = r.id WHERE email = ?
  `).get(email);
  if (!user || !user.actif) return sendJSON(res, 401, { error: 'Identifiants invalides' });
  const valid = verifyPassword(password, user.mot_de_passe_salt, user.mot_de_passe_hash);
  if (!valid) return sendJSON(res, 401, { error: 'Identifiants invalides' });
  const token = await createSession(user.id);
  await logActivity(user.id, 'connexion');
  sendJSON(res, 200, { token, user: { id: user.id, nom: user.nom, email: user.email, role: user.role } });
});

route('GET', '/api/auth/me', async (req, res) => {
  const user = await authenticate(req);
  if (!user) return sendJSON(res, 401, { error: 'Non authentifié' });
  sendJSON(res, 200, { user });
});

// ===== PRODUITS =====
route('GET', '/api/produits', async (req, res) => {
  const user = await authenticate(req);
  if (!user) return sendJSON(res, 401, { error: 'Non authentifié' });
  const canSeePrixAchat = ['admin', 'manager'].includes(user.role);
  const produits = await db.prepare(`
    SELECT p.*, c.nom as categorie_nom FROM produits p LEFT JOIN categories c ON p.categorie_id = c.id
  `).all();
  const tailles = await db.prepare('SELECT *, (quantite_initiale - quantite_vendue) as quantite_restante FROM tailles').all();
  const result = produits.map((p) => {
    const t = tailles.filter((tt) => tt.produit_id === p.id);
    const obj = {
      id: p.id, nom: p.nom, reference: p.reference, categorie: p.categorie_nom,
      prix_vente: p.prix_vente, tailles: t,
    };
    if (canSeePrixAchat) obj.prix_achat = p.prix_achat;
    return obj;
  });
  sendJSON(res, 200, result);
});

route('POST', '/api/produits', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'produits')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const { nom, reference, categorie_id, prix_achat, prix_vente } = await readBody(req);
  if (!nom || !reference || prix_vente == null) return sendJSON(res, 400, { error: 'Champs requis manquants' });
  const info = await db.prepare(`INSERT INTO produits (nom, reference, categorie_id, prix_achat, prix_vente)
    VALUES (?, ?, ?, ?, ?)`).run(nom, reference, categorie_id || null, prix_achat || 0, prix_vente);
  await logActivity(user.id, 'création produit', 'produits', info.lastInsertRowid);
  sendJSON(res, 201, { id: info.lastInsertRowid });
});

route('POST', '/api/produits/:id/tailles', async (req, res, params) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'produits')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const { taille, quantite_initiale } = await readBody(req);
  if (!taille) return sendJSON(res, 400, { error: 'Taille requise' });
  const info = await db.prepare(`INSERT INTO tailles (produit_id, taille, quantite_initiale) VALUES (?, ?, ?)`)
    .run(params.id, taille, quantite_initiale || 0);
  await logActivity(user.id, 'ajout taille', 'tailles', info.lastInsertRowid);
  sendJSON(res, 201, { id: info.lastInsertRowid });
});

// ===== STOCK =====
route('GET', '/api/stock/mouvements', async (req, res) => {
  const user = await authenticate(req);
  if (!user || (!hasAccess(user.role, 'stock') && !hasAccess(user.role, 'stock:lecture')))
    return sendJSON(res, 403, { error: 'Accès refusé' });
  const mvts = await db.prepare(`
    SELECT m.*, t.taille, p.nom as produit_nom, u.nom as utilisateur_nom
    FROM mouvements_stock m
    JOIN tailles t ON m.taille_id = t.id
    JOIN produits p ON t.produit_id = p.id
    LEFT JOIN utilisateurs u ON m.utilisateur_id = u.id
    ORDER BY m.date DESC LIMIT 200
  `).all();
  sendJSON(res, 200, mvts);
});

route('POST', '/api/stock/ajustement', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'stock')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const { taille_id, quantite, motif } = await readBody(req);
  if (!taille_id || quantite == null || !motif)
    return sendJSON(res, 400, { error: 'taille_id, quantite et motif sont requis' });
  const taille = await db.prepare('SELECT * FROM tailles WHERE id = ?').get(taille_id);
  if (!taille) return sendJSON(res, 404, { error: 'Taille introuvable' });
  if (quantite >= 0) {
    await db.prepare('UPDATE tailles SET quantite_initiale = quantite_initiale + ? WHERE id = ?').run(quantite, taille_id);
  } else {
    await db.prepare('UPDATE tailles SET quantite_vendue = quantite_vendue + ? WHERE id = ?').run(-quantite, taille_id);
  }
  const info = await db.prepare(`INSERT INTO mouvements_stock (taille_id, type, quantite, motif, utilisateur_id)
    VALUES (?, 'ajustement', ?, ?, ?)`).run(taille_id, quantite, motif, user.id);
  await logActivity(user.id, 'ajustement stock', 'tailles', taille_id);
  sendJSON(res, 201, { id: info.lastInsertRowid });
});

// ===== VENTES =====
route('GET', '/api/ventes', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'ventes')) return sendJSON(res, 403, { error: 'Accès refusé' });
  let query = `
    SELECT v.*, p.nom as produit_nom, t.taille, u.nom as utilisateur_nom
    FROM ventes v
    JOIN produits p ON v.produit_id = p.id
    JOIN tailles t ON v.taille_id = t.id
    JOIN utilisateurs u ON v.utilisateur_id = u.id
  `;
  const args = [];
  if (user.role === 'vendeur') {
    query += ' WHERE v.utilisateur_id = ?';
    args.push(user.id);
  }
  query += ' ORDER BY v.date DESC LIMIT 200';
  sendJSON(res, 200, await db.prepare(query).all(...args));
});

route('POST', '/api/ventes', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'ventes')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const { taille_id, quantite, prix_unitaire, type } = await readBody(req);
  if (!taille_id || !quantite || prix_unitaire == null)
    return sendJSON(res, 400, { error: 'taille_id, quantite et prix_unitaire sont requis' });

  const taille = await db.prepare('SELECT * FROM tailles WHERE id = ?').get(taille_id);
  if (!taille) return sendJSON(res, 404, { error: 'Taille introuvable' });
  const restant = taille.quantite_initiale - taille.quantite_vendue;
  if (quantite > restant) return sendJSON(res, 400, { error: `Stock insuffisant (restant: ${restant})` });

  const produit = await db.prepare('SELECT * FROM produits WHERE id = ?').get(taille.produit_id);
  const venteType = type === 'liquidation' ? 'liquidation' : 'normale';

  const infoVente = await db.prepare(`
    INSERT INTO ventes (produit_id, taille_id, quantite, prix_unitaire, prix_normal, type, utilisateur_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(produit.id, taille_id, quantite, prix_unitaire, produit.prix_vente, venteType, user.id);
  const venteId = infoVente.lastInsertRowid;

  await db.prepare('UPDATE tailles SET quantite_vendue = quantite_vendue + ? WHERE id = ?').run(quantite, taille_id);
  await db.prepare(`INSERT INTO mouvements_stock (taille_id, type, quantite, motif, utilisateur_id)
    VALUES (?, 'sortie', ?, ?, ?)`).run(taille_id, quantite, `Vente #${venteId}`, user.id);

  const montantTotal = quantite * prix_unitaire;
  await db.prepare(`INSERT INTO mouvements_finance (type, categorie, montant, vente_id, description, utilisateur_id)
    VALUES ('entree', 'vente', ?, ?, ?, ?)`)
    .run(montantTotal, venteId, `Vente ${produit.nom} (${taille.taille}) x${quantite}`, user.id);

  await logActivity(user.id, 'création vente', 'ventes', venteId);
  sendJSON(res, 201, { id: venteId });
});

// ===== FINANCE =====
route('GET', '/api/finance/mouvements', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'finance')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const mvts = await db.prepare(`
    SELECT f.*, u.nom as utilisateur_nom FROM mouvements_finance f
    LEFT JOIN utilisateurs u ON f.utilisateur_id = u.id
    ORDER BY f.date DESC LIMIT 200
  `).all();
  sendJSON(res, 200, mvts);
});

route('POST', '/api/finance/mouvements', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'finance')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const { type, categorie, montant, description } = await readBody(req);
  if (!['entree', 'sortie'].includes(type) || !montant)
    return sendJSON(res, 400, { error: 'type (entree/sortie) et montant requis' });
  const info = await db.prepare(`INSERT INTO mouvements_finance (type, categorie, montant, description, utilisateur_id)
    VALUES (?, ?, ?, ?, ?)`).run(type, categorie || 'autre', montant, description || '', user.id);
  await logActivity(user.id, 'mouvement finance manuel', 'mouvements_finance', info.lastInsertRowid);
  sendJSON(res, 201, { id: info.lastInsertRowid });
});

route('GET', '/api/finance/solde', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'finance')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const entrees = (await db.prepare(`SELECT COALESCE(SUM(montant),0) as total FROM mouvements_finance WHERE type='entree'`).get()).total;
  const sorties = (await db.prepare(`SELECT COALESCE(SUM(montant),0) as total FROM mouvements_finance WHERE type='sortie'`).get()).total;
  sendJSON(res, 200, { entrees, sorties, solde: entrees - sorties });
});

// ===== DASHBOARD / RAPPORTS =====
route('GET', '/api/dashboard', async (req, res) => {
  const user = await authenticate(req);
  if (!user) return sendJSON(res, 401, { error: 'Non authentifié' });
  const stockRestant = (await db.prepare(`SELECT COALESCE(SUM(quantite_initiale - quantite_vendue),0) as total FROM tailles`).get()).total;
  const ventesAujourdhui = await db.prepare(`
    SELECT COUNT(*) as nb, COALESCE(SUM(quantite * prix_unitaire),0) as total
    FROM ventes WHERE date(date) = date('now')
  `).get();
  const alertesStock = await db.prepare(`
    SELECT p.nom, t.taille, (t.quantite_initiale - t.quantite_vendue) as restant
    FROM tailles t JOIN produits p ON t.produit_id = p.id
    WHERE (t.quantite_initiale - t.quantite_vendue) <= 3
  `).all();
  const result = { stock_restant: stockRestant, ventes_aujourdhui: ventesAujourdhui, alertes_stock: alertesStock };
  if (hasAccess(user.role, 'finance')) {
    const entrees = (await db.prepare(`SELECT COALESCE(SUM(montant),0) as total FROM mouvements_finance WHERE type='entree'`).get()).total;
    const sorties = (await db.prepare(`SELECT COALESCE(SUM(montant),0) as total FROM mouvements_finance WHERE type='sortie'`).get()).total;
    result.solde = entrees - sorties;
  }
  sendJSON(res, 200, result);
});

route('GET', '/api/rapports/liquidations', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'ventes')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const liquidations = await db.prepare(`
    SELECT v.*, p.nom as produit_nom, t.taille,
      (v.prix_normal - v.prix_unitaire) * v.quantite as manque_a_gagner
    FROM ventes v
    JOIN produits p ON v.produit_id = p.id
    JOIN tailles t ON v.taille_id = t.id
    WHERE v.type = 'liquidation'
    ORDER BY v.date DESC
  `).all();
  sendJSON(res, 200, liquidations);
});

// ===== UTILISATEURS (admin) =====
route('GET', '/api/utilisateurs', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'utilisateurs')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const users = await db.prepare(`
    SELECT u.id, u.nom, u.email, u.actif, r.nom as role
    FROM utilisateurs u JOIN roles r ON u.role_id = r.id
  `).all();
  sendJSON(res, 200, users);
});

route('POST', '/api/utilisateurs', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'utilisateurs')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const { nom, email, password, role } = await readBody(req);
  if (!nom || !email || !password || !role) return sendJSON(res, 400, { error: 'Tous les champs sont requis' });
  const roleRow = await db.prepare('SELECT id FROM roles WHERE nom = ?').get(role);
  if (!roleRow) return sendJSON(res, 400, { error: 'Rôle invalide' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    const info = await db.prepare(`INSERT INTO utilisateurs (nom, email, mot_de_passe_hash, mot_de_passe_salt, role_id)
      VALUES (?, ?, ?, ?, ?)`).run(nom, email, hash, salt, roleRow.id);
    await logActivity(user.id, 'création utilisateur', 'utilisateurs', info.lastInsertRowid);
    sendJSON(res, 201, { id: info.lastInsertRowid });
  } catch (e) {
    sendJSON(res, 400, { error: 'Email déjà utilisé' });
  }
});

route('POST', '/api/utilisateurs/:id/desactiver', async (req, res, params) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'utilisateurs')) return sendJSON(res, 403, { error: 'Accès refusé' });
  await db.prepare('UPDATE utilisateurs SET actif = 0 WHERE id = ?').run(params.id);
  await logActivity(user.id, 'désactivation utilisateur', 'utilisateurs', params.id);
  sendJSON(res, 200, { success: true });
});

route('GET', '/api/journal', async (req, res) => {
  const user = await authenticate(req);
  if (!user || !hasAccess(user.role, 'utilisateurs')) return sendJSON(res, 403, { error: 'Accès refusé' });
  const journal = await db.prepare(`
    SELECT j.*, u.nom as utilisateur_nom FROM journal_activite j
    LEFT JOIN utilisateurs u ON j.utilisateur_id = u.id
    ORDER BY j.date DESC LIMIT 200
  `).all();
  sendJSON(res, 200, journal);
});

// ===== STATIC FILES =====
function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: 'Interdit' });
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, data2) => {
        if (err2) return sendJSON(res, 404, { error: 'Non trouvé' });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    const match = matchRoute(req.method, pathname);
    if (!match) return sendJSON(res, 404, { error: 'Route inconnue' });
    try {
      await match.handler(req, res, match.params);
    } catch (e) {
      console.error(e);
      sendJSON(res, 500, { error: 'Erreur serveur', detail: e.message });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Serveur démarré sur http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Erreur d\'initialisation de la base de données:', err);
    process.exit(1);
  });
