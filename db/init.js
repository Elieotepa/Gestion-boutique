const crypto = require('node:crypto');
const db = require('./database');

async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS utilisateurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      mot_de_passe_hash TEXT NOT NULL,
      mot_de_passe_salt TEXT NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      actif INTEGER DEFAULT 1,
      date_creation TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
      date_creation TEXT DEFAULT CURRENT_TIMESTAMP,
      date_expiration TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS produits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      reference TEXT UNIQUE NOT NULL,
      categorie_id INTEGER REFERENCES categories(id),
      prix_achat REAL NOT NULL,
      prix_vente REAL NOT NULL,
      date_creation TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tailles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
      taille TEXT NOT NULL,
      quantite_initiale INTEGER NOT NULL DEFAULT 0,
      quantite_vendue INTEGER NOT NULL DEFAULT 0,
      UNIQUE(produit_id, taille)
    );

    CREATE TABLE IF NOT EXISTS mouvements_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taille_id INTEGER NOT NULL REFERENCES tailles(id),
      type TEXT NOT NULL,
      quantite INTEGER NOT NULL,
      motif TEXT,
      utilisateur_id INTEGER REFERENCES utilisateurs(id),
      date TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ventes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produit_id INTEGER NOT NULL REFERENCES produits(id),
      taille_id INTEGER NOT NULL REFERENCES tailles(id),
      quantite INTEGER NOT NULL,
      prix_unitaire REAL NOT NULL,
      prix_normal REAL NOT NULL,
      type TEXT NOT NULL DEFAULT 'normale',
      utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
      date TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mouvements_finance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      categorie TEXT NOT NULL,
      montant REAL NOT NULL,
      vente_id INTEGER REFERENCES ventes(id),
      description TEXT,
      utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
      date TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_activite (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
      action TEXT NOT NULL,
      table_concernee TEXT,
      enregistrement_id INTEGER,
      date TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const roles = ['admin', 'manager', 'vendeur', 'comptable'];
  for (const r of roles) {
    await db.prepare('INSERT OR IGNORE INTO roles (nom) VALUES (?)').run(r);
  }

  const countUsers = await db.prepare('SELECT COUNT(*) as c FROM utilisateurs').get();
  if (countUsers.c === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
    const adminRole = await db.prepare('SELECT id FROM roles WHERE nom = ?').get('admin');
    await db
      .prepare(
        `INSERT INTO utilisateurs (nom, email, mot_de_passe_hash, mot_de_passe_salt, role_id) VALUES (?, ?, ?, ?, ?)`
      )
      .run('Admin', 'admin@boutique.local', hash, salt, adminRole.id);
    console.log('Utilisateur admin créé -> email: admin@boutique.local / mot de passe: admin123');
  }
}

module.exports = { initDb };
