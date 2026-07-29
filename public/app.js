const state = { token: localStorage.getItem('token') || null, user: null, page: 'dashboard' };
const app = document.getElementById('app');

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

function fmt(n) { return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d) { return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }

// ================= AUTH =================
function renderLogin(error) {
  app.innerHTML = `
    <div class="login-screen">
      <div class="login-box">
        <h1>Boutique — Accès</h1>
        <p class="sub">STOCK · VENTES · FINANCE</p>
        <input id="email" type="email" placeholder="Email" value="admin@boutique.local">
        <input id="password" type="password" placeholder="Mot de passe" value="admin123">
        <button id="loginBtn">Se connecter</button>
        ${error ? `<div class="login-error">${error}</div>` : ''}
        <div class="login-hint">Compte admin par défaut :<br>admin@boutique.local / admin123</div>
      </div>
    </div>`;
  document.getElementById('loginBtn').onclick = doLogin;
  [...document.querySelectorAll('input')].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));
}

async function doLogin() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  try {
    const data = await api('POST', '/api/auth/login', { email, password });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    state.page = 'dashboard';
    render();
  } catch (e) {
    renderLogin(e.message);
  }
}

function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('token');
  renderLogin();
}

// ================= NAV =================
const NAV_ITEMS = {
  admin: [['dashboard', 'Dashboard'], ['produits', 'Produits'], ['stock', 'Stock'], ['ventes', 'Ventes'], ['finance', 'Finance'], ['utilisateurs', 'Utilisateurs'], ['journal', 'Journal']],
  manager: [['dashboard', 'Dashboard'], ['produits', 'Produits'], ['stock', 'Stock'], ['ventes', 'Ventes'], ['finance', 'Finance']],
  vendeur: [['dashboard', 'Dashboard'], ['ventes', 'Ventes']],
  comptable: [['dashboard', 'Dashboard'], ['finance', 'Finance']],
};

function renderShell(contentHtml) {
  const items = NAV_ITEMS[state.user.role] || [];
  app.innerHTML = `
    <div class="shell">
      <div class="sidebar">
        <div class="brand"><div class="tag">Boutique</div><h2>Registre</h2></div>
        <nav>${items.map(([key, label]) => `<a data-page="${key}" class="${state.page === key ? 'active' : ''}">${label}</a>`).join('')}</nav>
        <div class="userbox">
          <b>${state.user.nom}</b>
          <span class="role-tag">${state.user.role}</span>
          <button class="logout">Déconnexion</button>
        </div>
      </div>
      <div class="main">${contentHtml}</div>
    </div>`;
  app.querySelectorAll('nav a').forEach(a => a.onclick = () => { state.page = a.dataset.page; render(); });
  app.querySelector('.logout').onclick = logout;
}

// ================= PAGES =================
async function pageDashboard() {
  const d = await api('GET', '/api/dashboard');
  const cards = [
    `<div class="card"><div class="label">Stock restant (unités)</div><div class="value">${d.stock_restant}</div></div>`,
    `<div class="card"><div class="label">Ventes aujourd'hui</div><div class="value">${d.ventes_aujourdhui.nb}</div></div>`,
    `<div class="card"><div class="label">CA du jour</div><div class="value amber">${fmt(d.ventes_aujourdhui.total)} €</div></div>`,
  ];
  if (d.solde !== undefined) cards.push(`<div class="card"><div class="label">Solde financier</div><div class="value ${d.solde >= 0 ? 'positive' : 'negative'}">${fmt(d.solde)} €</div></div>`);
  const alertes = d.alertes_stock.length
    ? `<table><thead><tr><th>Produit</th><th>Taille</th><th>Restant</th></tr></thead><tbody>
        ${d.alertes_stock.map(a => `<tr><td>${a.nom}</td><td>${a.taille}</td><td class="num"><span class="badge low">${a.restant}</span></td></tr>`).join('')}
      </tbody></table>`
    : `<div class="empty">Aucune alerte de stock faible</div>`;

  renderShell(`
    <div class="page-title">Dashboard</div>
    <div class="page-sub">Vue d'ensemble</div>
    <div class="grid cols-4">${cards.join('')}</div>
    <div class="section"><h3>Alertes stock faible (≤ 3 unités)</h3>${alertes}</div>
  `);
}

async function pageProduits() {
  const produits = await api('GET', '/api/produits');
  const canEdit = ['admin', 'manager'].includes(state.user.role);
  const rows = produits.map(p => `
    <tr>
      <td>${p.nom} <span style="color:#999;font-family:var(--mono);font-size:11px">(${p.reference})</span></td>
      <td>${p.categorie || '—'}</td>
      <td class="num">${fmt(p.prix_vente)} €</td>
      ${canEdit ? `<td class="num">${p.prix_achat != null ? fmt(p.prix_achat) + ' €' : '—'}</td>` : ''}
      <td>${p.tailles.map(t => `<span class="badge ${t.quantite_restante <= 3 ? 'low' : 'normale'}">${t.taille}: ${t.quantite_restante}</span>`).join(' ')}</td>
      ${canEdit ? `<td><button class="btn ghost" data-add-taille="${p.id}" style="padding:5px 10px;font-size:11px">+ taille</button></td>` : ''}
    </tr>`).join('');

  renderShell(`
    <div class="page-title">Produits</div>
    <div class="page-sub">${produits.length} produit(s)</div>
    ${canEdit ? `
    <div class="section">
      <h3>Nouveau produit</h3>
      <div id="msgProduit"></div>
      <div class="form-row">
        <div class="field"><label>Nom</label><input id="p_nom"></div>
        <div class="field"><label>Référence</label><input id="p_ref"></div>
        <div class="field"><label>Prix d'achat</label><input id="p_achat" type="number" step="0.01"></div>
        <div class="field"><label>Prix de vente</label><input id="p_vente" type="number" step="0.01"></div>
      </div>
      <button class="btn" id="addProduitBtn">Ajouter le produit</button>
    </div>` : ''}
    <table>
      <thead><tr><th>Produit</th><th>Catégorie</th><th>Prix vente</th>${canEdit ? '<th>Prix achat</th>' : ''}<th>Tailles / stock restant</th>${canEdit ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">Aucun produit</td></tr>`}</tbody>
    </table>
  `);

  if (canEdit) {
    document.getElementById('addProduitBtn').onclick = async () => {
      try {
        await api('POST', '/api/produits', {
          nom: document.getElementById('p_nom').value,
          reference: document.getElementById('p_ref').value,
          prix_achat: parseFloat(document.getElementById('p_achat').value) || 0,
          prix_vente: parseFloat(document.getElementById('p_vente').value),
        });
        pageProduits();
      } catch (e) { document.getElementById('msgProduit').innerHTML = `<div class="msg error">${e.message}</div>`; }
    };
    app.querySelectorAll('[data-add-taille]').forEach(btn => btn.onclick = async () => {
      const taille = prompt('Nom de la taille (ex: M, 42...)');
      if (!taille) return;
      const qte = prompt('Quantité initiale', '0');
      try {
        await api('POST', `/api/produits/${btn.dataset.addTaille}/tailles`, { taille, quantite_initiale: parseInt(qte) || 0 });
        pageProduits();
      } catch (e) { alert(e.message); }
    });
  }
}

async function pageStock() {
  const canWrite = state.user.role !== 'vendeur';
  const mvts = await api('GET', '/api/stock/mouvements');
  let tailles = [];
  if (canWrite) {
    const produits = await api('GET', '/api/produits');
    tailles = produits.flatMap(p => p.tailles.map(t => ({ ...t, produit_nom: p.nom })));
  }
  const rows = mvts.map(m => `
    <tr>
      <td>${fmtDate(m.date)}</td>
      <td>${m.produit_nom} (${m.taille})</td>
      <td><span class="badge ${m.type === 'sortie' ? 'sortie' : 'entree'}">${m.type}</span></td>
      <td class="num">${m.quantite > 0 ? '+' : ''}${m.quantite}</td>
      <td>${m.motif || '—'}</td>
      <td>${m.utilisateur_nom || '—'}</td>
    </tr>`).join('');

  renderShell(`
    <div class="page-title">Stock</div>
    <div class="page-sub">Historique des mouvements</div>
    ${canWrite ? `
    <div class="section">
      <h3>Ajustement manuel</h3>
      <div id="msgStock"></div>
      <div class="form-row">
        <div class="field"><label>Taille</label>
          <select id="s_taille">${tailles.map(t => `<option value="${t.id}">${t.produit_nom} — ${t.taille} (restant: ${t.quantite_initiale - t.quantite_vendue})</option>`).join('')}</select>
        </div>
        <div class="field"><label>Quantité (+ réassort / - perte)</label><input id="s_qte" type="number"></div>
        <div class="field"><label>Motif</label><input id="s_motif" placeholder="ex: réassort fournisseur, casse..."></div>
      </div>
      <button class="btn" id="ajustBtn">Enregistrer l'ajustement</button>
    </div>` : ''}
    <table>
      <thead><tr><th>Date</th><th>Produit</th><th>Type</th><th>Qté</th><th>Motif</th><th>Par</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">Aucun mouvement</td></tr>`}</tbody>
    </table>
  `);

  if (canWrite) {
    document.getElementById('ajustBtn').onclick = async () => {
      try {
        await api('POST', '/api/stock/ajustement', {
          taille_id: document.getElementById('s_taille').value,
          quantite: parseInt(document.getElementById('s_qte').value),
          motif: document.getElementById('s_motif').value,
        });
        pageStock();
      } catch (e) { document.getElementById('msgStock').innerHTML = `<div class="msg error">${e.message}</div>`; }
    };
  }
}

async function pageVentes() {
  const ventes = await api('GET', '/api/ventes');
  const produits = await api('GET', '/api/produits');
  const tailles = produits.flatMap(p => p.tailles.map(t => ({ ...t, produit_nom: p.nom, prix_vente: p.prix_vente })));

  const rows = ventes.map(v => `
    <tr>
      <td>${fmtDate(v.date)}</td>
      <td>${v.produit_nom} (${v.taille})</td>
      <td class="num">${v.quantite}</td>
      <td class="num">${fmt(v.prix_unitaire)} €</td>
      <td><span class="badge ${v.type}">${v.type}</span></td>
      <td>${v.utilisateur_nom}</td>
    </tr>`).join('');

  renderShell(`
    <div class="page-title">Ventes</div>
    <div class="page-sub">${state.user.role === 'vendeur' ? 'Vos ventes' : 'Toutes les ventes'}</div>
    <div class="section">
      <h3>Nouvelle vente</h3>
      <div id="msgVente"></div>
      <div class="form-row">
        <div class="field"><label>Produit / Taille</label>
          <select id="v_taille">${tailles.map(t => `<option value="${t.id}" data-prix="${t.prix_vente}">${t.produit_nom} — ${t.taille} (restant: ${t.quantite_initiale - t.quantite_vendue})</option>`).join('')}</select>
        </div>
        <div class="field"><label>Quantité</label><input id="v_qte" type="number" value="1" min="1"></div>
        <div class="field"><label>Prix unitaire</label><input id="v_prix" type="number" step="0.01"></div>
        <div class="field"><label>Type</label>
          <select id="v_type"><option value="normale">Normale</option><option value="liquidation">Liquidation</option></select>
        </div>
      </div>
      <button class="btn amber" id="venteBtn">Enregistrer la vente</button>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Produit</th><th>Qté</th><th>Prix</th><th>Type</th><th>Vendeur</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">Aucune vente</td></tr>`}</tbody>
    </table>
  `);

  const tailleSelect = document.getElementById('v_taille');
  const prixInput = document.getElementById('v_prix');
  function syncPrix() { prixInput.value = tailleSelect.selectedOptions[0]?.dataset.prix || ''; }
  tailleSelect.onchange = syncPrix;
  syncPrix();

  document.getElementById('venteBtn').onclick = async () => {
    try {
      await api('POST', '/api/ventes', {
        taille_id: tailleSelect.value,
        quantite: parseInt(document.getElementById('v_qte').value),
        prix_unitaire: parseFloat(prixInput.value),
        type: document.getElementById('v_type').value,
      });
      pageVentes();
    } catch (e) { document.getElementById('msgVente').innerHTML = `<div class="msg error">${e.message}</div>`; }
  };
}

async function pageFinance() {
  const [mvts, solde] = await Promise.all([api('GET', '/api/finance/mouvements'), api('GET', '/api/finance/solde')]);
  const canWrite = ['admin', 'manager'].includes(state.user.role);
  const rows = mvts.map(m => `
    <tr>
      <td>${fmtDate(m.date)}</td>
      <td><span class="badge ${m.type}">${m.type}</span></td>
      <td>${m.categorie}</td>
      <td>${m.description || '—'}</td>
      <td class="num">${m.type === 'sortie' ? '-' : '+'}${fmt(m.montant)} €</td>
      <td>${m.utilisateur_nom || '—'}</td>
    </tr>`).join('');

  renderShell(`
    <div class="page-title">Finance</div>
    <div class="page-sub">Entrées / sorties</div>
    <div class="grid cols-3">
      <div class="card"><div class="label">Total entrées</div><div class="value positive">${fmt(solde.entrees)} €</div></div>
      <div class="card"><div class="label">Total sorties</div><div class="value negative">${fmt(solde.sorties)} €</div></div>
      <div class="card"><div class="label">Solde</div><div class="value ${solde.solde >= 0 ? 'positive' : 'negative'}">${fmt(solde.solde)} €</div></div>
    </div>
    ${canWrite ? `
    <div class="section">
      <h3>Nouveau mouvement manuel</h3>
      <div id="msgFinance"></div>
      <div class="form-row">
        <div class="field"><label>Type</label><select id="f_type"><option value="sortie">Sortie</option><option value="entree">Entrée</option></select></div>
        <div class="field"><label>Catégorie</label><select id="f_cat"><option value="achat_stock">Achat stock</option><option value="charge">Charge</option><option value="autre">Autre</option></select></div>
        <div class="field"><label>Montant</label><input id="f_montant" type="number" step="0.01"></div>
        <div class="field"><label>Description</label><input id="f_desc"></div>
      </div>
      <button class="btn" id="financeBtn">Enregistrer</button>
    </div>` : ''}
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Catégorie</th><th>Description</th><th>Montant</th><th>Par</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">Aucun mouvement</td></tr>`}</tbody>
    </table>
  `);

  if (canWrite) {
    document.getElementById('financeBtn').onclick = async () => {
      try {
        await api('POST', '/api/finance/mouvements', {
          type: document.getElementById('f_type').value,
          categorie: document.getElementById('f_cat').value,
          montant: parseFloat(document.getElementById('f_montant').value),
          description: document.getElementById('f_desc').value,
        });
        pageFinance();
      } catch (e) { document.getElementById('msgFinance').innerHTML = `<div class="msg error">${e.message}</div>`; }
    };
  }
}

async function pageUtilisateurs() {
  const users = await api('GET', '/api/utilisateurs');
  const rows = users.map(u => `
    <tr>
      <td>${u.nom}</td><td>${u.email}</td>
      <td><span class="badge normale">${u.role}</span></td>
      <td>${u.actif ? 'Actif' : 'Désactivé'}</td>
      <td>${u.actif ? `<button class="btn ghost" data-deact="${u.id}" style="padding:5px 10px;font-size:11px">Désactiver</button>` : '—'}</td>
    </tr>`).join('');

  renderShell(`
    <div class="page-title">Utilisateurs</div>
    <div class="page-sub">${users.length} compte(s)</div>
    <div class="section">
      <h3>Nouvel utilisateur</h3>
      <div id="msgUser"></div>
      <div class="form-row">
        <div class="field"><label>Nom</label><input id="u_nom"></div>
        <div class="field"><label>Email</label><input id="u_email" type="email"></div>
        <div class="field"><label>Mot de passe</label><input id="u_pass" type="password"></div>
        <div class="field"><label>Rôle</label>
          <select id="u_role"><option value="admin">Admin</option><option value="manager">Manager</option><option value="vendeur">Vendeur</option><option value="comptable">Comptable</option></select>
        </div>
      </div>
      <button class="btn" id="addUserBtn">Créer le compte</button>
    </div>
    <table>
      <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);

  document.getElementById('addUserBtn').onclick = async () => {
    try {
      await api('POST', '/api/utilisateurs', {
        nom: document.getElementById('u_nom').value,
        email: document.getElementById('u_email').value,
        password: document.getElementById('u_pass').value,
        role: document.getElementById('u_role').value,
      });
      pageUtilisateurs();
    } catch (e) { document.getElementById('msgUser').innerHTML = `<div class="msg error">${e.message}</div>`; }
  };
  app.querySelectorAll('[data-deact]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Désactiver ce compte ?')) return;
    await api('POST', `/api/utilisateurs/${btn.dataset.deact}/desactiver`);
    pageUtilisateurs();
  });
}

async function pageJournal() {
  const journal = await api('GET', '/api/journal');
  const rows = journal.map(j => `
    <tr><td>${fmtDate(j.date)}</td><td>${j.utilisateur_nom || '—'}</td><td>${j.action}</td><td>${j.table_concernee || '—'}</td></tr>
  `).join('');
  renderShell(`
    <div class="page-title">Journal d'activité</div>
    <div class="page-sub">Traçabilité des actions</div>
    <table>
      <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Table</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="empty">Aucune activité</td></tr>`}</tbody>
    </table>
  `);
}

// ================= ROUTER =================
const PAGES = { dashboard: pageDashboard, produits: pageProduits, stock: pageStock, ventes: pageVentes, finance: pageFinance, utilisateurs: pageUtilisateurs, journal: pageJournal };

async function render() {
  if (!state.token) return renderLogin();
  if (!state.user) {
    try {
      const data = await api('GET', '/api/auth/me');
      state.user = data.user;
    } catch (e) {
      state.token = null; localStorage.removeItem('token');
      return renderLogin();
    }
  }
  const pageFn = PAGES[state.page] || pageDashboard;
  try {
    await pageFn();
  } catch (e) {
    renderShell(`<div class="msg error">Erreur de chargement : ${e.message}</div>`);
  }
}

render();
