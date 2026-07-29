# Gestion Boutique — Stock, Ventes & Finance

Application de gestion complète : produits/tailles, mouvements de stock, ventes (normales et liquidations), finance (entrées/sorties), utilisateurs à rôles, journal d'activité.

**Stack** : Node.js + Turso (base de données SQLite hébergée, gratuite et persistante) + HTML/CSS/JS vanilla.

## Installation

```bash
npm install
```

## Lancement en local (test sur votre PC, base de données locale)

```bash
node server.js
```

Puis ouvrez votre navigateur sur : **http://localhost:3000**
(Sans configuration Turso, l'app utilise un fichier local `local.db` pour tester.)

## Déploiement en ligne (accès depuis un téléphone Android, gratuit)

### 1. Créer la base de données Turso (gratuite)
1. Allez sur **turso.tech** → créez un compte gratuit
2. Créez une nouvelle base de données
3. Récupérez : l'**URL de la base** et un **auth token** (depuis le tableau de bord Turso)

### 2. Déployer sur Render (gratuit)
1. Mettez ce projet sur GitHub
2. Sur **render.com** → "New Web Service" → connectez le dépôt GitHub
3. Render détecte Node.js automatiquement
4. Dans **"Environment Variables"** de Render, ajoutez :
   - `TURSO_DATABASE_URL` = l'URL récupérée sur Turso
   - `TURSO_AUTH_TOKEN` = le token récupéré sur Turso
5. Déployez — vous obtenez une URL du type `https://votre-boutique.onrender.com`

Vos données seront désormais **permanentes**, même si le service se met en veille ou redémarre.

## Compte par défaut

- Email : `admin@boutique.local`
- Mot de passe : `admin123`

Connectez-vous avec ce compte pour créer les autres utilisateurs (Manager, Vendeur, Comptable) depuis l'écran "Utilisateurs".

## Rôles

| Rôle | Accès |
|---|---|
| **Admin** | Tout, y compris gestion des utilisateurs |
| **Manager** | Produits, stock, ventes, finance, rapports |
| **Vendeur** | Ventes (les siennes) + consultation du stock (quantités, sans prix d'achat) |
| **Comptable** | Finance + rapports uniquement |

## Notes techniques

- La base de données SQLite est créée automatiquement au premier lancement dans `db/stock.db`.
- Une vente en "liquidation" impacte le CA et le stock comme une vente normale — seul le prix appliqué diffère.
- Chaque vente génère automatiquement un mouvement financier "entrée" (pas de double saisie).
- Le filtrage des données sensibles (prix d'achat, marges) par rôle est appliqué côté serveur, pas seulement dans l'interface.

## Pour héberger l'application (accès depuis un autre appareil / en ligne)

Le serveur écoute sur toutes les interfaces (`0.0.0.0:3000`). Pour un accès permanent, vous pouvez le déployer sur un service comme Render, Railway, ou un VPS, en veillant à ce que Node.js 22+ soit disponible.
