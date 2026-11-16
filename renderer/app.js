/* global Logic, Modeles, Export, api */
'use strict';

// ---------------------------------------------------------------- état
const S = {
  config: {},
  assoId: 'acel',
  assos: {},
  page: 'operations',
  f: { compte: '', mois: '', categorie: '', recherche: '', sens: 'tout', sansFacture: false },
  selection: new Set(),
  ouverts: new Set(),
  imp: { compte: '', releves: [] },
  synth: { annee: null, mode: 'civile', compte: '', vue: 'debit' },
  exp: { du: '', au: '', comptes: [] },
  regleFiltre: '',
  enregistrement: { etat: 'ok', heure: null, timer: null, enCours: false },
  version: '',
};
const ASSOS = [
  { id: 'acel', nom: 'ACEL Saint-Médard', court: 'ACEL' },
  { id: 'jsm', nom: 'Les Jeunes de Saint-Médard', court: 'Jeunes de St-Médard' },
];
const PAGES = [
  { id: 'operations', nom: 'Opérations' },
  { id: 'synthese', nom: 'Synthèse par mois' },
  { id: 'import', nom: 'Importer un relevé' },
  { id: 'categories', nom: 'Catégories et règles' },
  { id: 'export', nom: 'Export comptable' },
  { id: 'parametres', nom: 'Paramètres' },
];
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const $ = (sel, el = document) => el.querySelector(sel);
const h = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const eur = n => Logic.formatMontant(n) + ' €';
const eur0 = n => (n ? Logic.formatMontant(n) : '');
const nouvelId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
const libMois = m => m ? MOIS_LONG[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4) : '';
const A = () => S.assos[S.assoId];
const D = () => A().data;

let _regles = { src: null, n: -1, prep: [] };
let _version = 0;
function R() {
  if (_regles.src !== D().regles || _regles.n !== _version) _regles = { src: D().regles, n: _version, prep: Logic.prepareRegles(D().regles) };
  return _regles.prep;
}
const compteNom = id => (D().comptes.find(c => c.id === id) || {}).nom || id;

// ---------------------------------------------------------------- données
async function chargerAsso(id) {
  const res = await api.chargerAsso(id);
  let data = res.data;
  let neuf = false;
  if (!data) { data = Modeles.nouvelleAsso(id); neuf = true; }
  data.categories = data.categories || []; data.regles = data.regles || []; data.operations = data.operations || [];
  data.soldes = data.soldes || []; data.historique = data.historique || []; data.comptes = data.comptes || [];
  S.assos[id] = { data, mtime: res.mtime, chemin: res.chemin };
  _version++;
  if (neuf) { const r = await api.sauverAsso(id, data, null); if (r.ok) S.assos[id].mtime = r.mtime; }
}

function modifier(action, fn, options = {}) {
  fn(D());
  _version++;
  if (action) {
    D().historique.unshift({ date: new Date().toISOString(), par: S.config.utilisateur || '', action });
    if (D().historique.length > 400) D().historique.length = 400;
  }
  planifierSauvegarde();
  if (options.rendu !== false) rendu();
}

function planifierSauvegarde() {
  S.enregistrement.etat = 'attente';
  rendreEtat();
  clearTimeout(S.enregistrement.timer);
  S.enregistrement.timer = setTimeout(sauver, 600);
}

async function sauver() {
  const id = S.assoId, a = S.assos[id];
  if (S.enregistrement.enCours) { planifierSauvegarde(); return; }
  S.enregistrement.enCours = true;
  try {
    const r = await api.sauverAsso(id, a.data, a.mtime);
    if (r.conflit) {
      toast('Les données ont été modifiées depuis un autre ordinateur. Je recharge la dernière version : refaites votre dernière modification.');
      await chargerAsso(id);
      rendu();
    } else {
      a.mtime = r.mtime;
      S.enregistrement.heure = new Date();
    }
    S.enregistrement.etat = 'ok';
  } catch (e) {
    S.enregistrement.etat = 'erreur';
    toast("Impossible d'enregistrer : " + e.message);
  } finally {
    S.enregistrement.enCours = false;
    rendreEtat();
  }
}

async function verifierMiseAJour() {
  if (!S.config.dossier || !A() || S.enregistrement.etat !== 'ok') return;
  try {
    const m = await api.mtimeAsso(S.assoId);
    if (m && A().mtime && Math.abs(m - A().mtime) > 1) {
      await chargerAsso(S.assoId);
      rendu();
      toast('Données mises à jour (modifiées depuis un autre ordinateur).');
    }
  } catch { /* dossier momentanément indisponible */ }
}

// ---------------------------------------------------------------- interface commune
function toast(msg, bouton, action, duree = 6000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div>${h(msg)}</div>`;
  if (bouton) {
    const b = document.createElement('button');
    b.className = 'btn petit'; b.textContent = bouton;
    b.onclick = () => { el.remove(); action(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), duree);
}

function modale(html, onMount) {
  const m = $('#modale');
  m.innerHTML = `<div class="boite" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  const fermer = () => { m.hidden = true; m.innerHTML = ''; };
  m.onclick = e => { if (e.target === m) fermer(); };
  m.onkeydown = e => { if (e.key === 'Escape') fermer(); };
  if (onMount) onMount(m.firstElementChild, fermer);
  const premier = m.querySelector('input, select, textarea');
  if (premier) premier.focus();
  return fermer;
}

function rendreEtat() {
  const e = S.enregistrement;
  const txt = e.etat === 'attente' ? 'Enregistrement…' : e.etat === 'erreur' ? 'Erreur d\'enregistrement'
    : e.heure ? 'Enregistré à ' + e.heure.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'À jour';
  $('#etat').innerHTML = S.config.dossier
    ? `<div><span class="point ${e.etat === 'attente' ? 'attente' : e.etat === 'erreur' ? 'erreur' : ''}"></span>${h(txt)}</div>
       <div title="${h(S.config.dossier)}">${h(dernierDossier(S.config.dossier))}</div>
       ${S.config.utilisateur ? `<div>Utilisateur : ${h(S.config.utilisateur)}</div>` : ''}
       <div>Version ${h(S.version)}</div>`
    : '';
}
const dernierDossier = p => (p || '').split(/[\\/]/).filter(Boolean).slice(-2).join(' › ');

function nbAClasser() {
  const r = R();
  return D().operations.filter(o => Logic.partsDe(o, r).some(p => p.categorie === Logic.A_CLASSER) || Logic.resteVentilation(o) !== 0).length;
}

function rendreBarre() {
  $('#assos').innerHTML = ASSOS.map(a => {
    const d = S.assos[a.id];
    const n = d ? d.data.comptes.length : 0;
    return `<button data-asso="${a.id}" class="${a.id === S.assoId ? 'actif' : ''}">${h(a.nom)}<small>${n} compte${n > 1 ? 's' : ''}</small></button>`;
  }).join('');
  const nb = S.config.dossier && A() ? nbAClasser() : 0;
  $('#nav').innerHTML = S.config.dossier ? PAGES.map(p => `<button data-page="${p.id}" class="${p.id === S.page ? 'actif' : ''}"><span>${p.nom}</span>${p.id === 'operations' && nb ? `<span class="pastille" title="Opérations à classer">${nb}</span>` : ''}</button>`).join('') : '';
  rendreEtat();
}

function rendu() {
  rendreBarre();
  const page = $('#page');
  const haut = page.scrollTop;
  if (!S.config.dossier) { page.innerHTML = pageAccueil(); return; }
  const f = { operations: pageOperations, synthese: pageSynthese, import: pageImport, categories: pageCategories, export: pageExport, parametres: pageParametres }[S.page];
  page.innerHTML = f();
  page.scrollTop = haut;
  const apres = { operations: apresOperations, import: apresImport }[S.page];
  if (apres) apres();
}

function optionsCategories(choisie, avecVide) {
  return (avecVide ? `<option value="">${h(avecVide)}</option>` : '') +
    D().categories.map(c => `<option value="${h(c.nom)}"${c.nom === choisie ? ' selected' : ''}>${h(c.nom)}${c.compte ? ' · ' + h(c.compte) : ''}</option>`).join('');
}
function optionsComptes(choisi, tous) {
  return (tous ? `<option value="">${h(tous)}</option>` : '') + D().comptes.map(c => `<option value="${h(c.id)}"${c.id === choisi ? ' selected' : ''}>${h(c.nom)}</option>`).join('');
}

// ---------------------------------------------------------------- accueil
function pageAccueil() {
  return `<div class="accueil carte">
    <h1>Bienvenue</h1>
    <p>Ce logiciel range les relevés bancaires de <strong>l'ACEL Saint-Médard</strong> (comptes 01 et 02) et des <strong>Jeunes de Saint-Médard</strong>, les classe par catégories, garde le numéro de facture de chaque dépense et prépare l'export pour le comptable.</p>
    <p>Pour commencer, choisissez le <strong>dossier où ranger les données</strong>. Prenez un dossier de votre OneDrive partagé : chaque personne qui installe le logiciel choisit le même dossier et voit les mêmes données.</p>
    <label class="champ" style="max-width:280px;margin:14px 0"><span>Votre prénom (pour l'historique des modifications)</span><input type="text" id="prenom" value="${h(S.config.utilisateur || '')}" placeholder="Pierre"></label>
    <button class="btn principal" data-action="choisir-dossier">Choisir le dossier…</button>
    <p class="aide">Si vous avez reçu le fichier « ACEL Saint-Médard.compta.json » (reprise de votre classeur Excel), placez-le d'abord dans ce dossier : il sera repris automatiquement.</p>
  </div>`;
}

// ---------------------------------------------------------------- opérations
function opsFiltrees() {
  const f = S.f, r = R();
  const q = Logic.norm(f.recherche);
  const qNum = Logic.parseMontant(f.recherche);
  return D().operations.filter(o => {
    if (f.compte && o.compte !== f.compte) return false;
    if (f.mois && !o.date.startsWith(f.mois)) return false;
    if (f.sens === 'debit' && !o.debit) return false;
    if (f.sens === 'credit' && !o.credit) return false;
    if (f.sansFacture && (!o.debit || o.facture || (o.ventilation && o.ventilation.every(p => p.facture)))) return false;
    if (f.categorie) {
      const parts = Logic.partsDe(o, r);
      if (f.categorie === Logic.A_CLASSER) {
        if (!parts.some(p => p.categorie === Logic.A_CLASSER) && Logic.resteVentilation(o) === 0) return false;
      } else if (!parts.some(p => p.categorie === f.categorie)) return false;
    }
    if (q) {
      const texte = Logic.norm([o.libelle, (o.details || []).join(' '), o.facture, o.note, (o.ventilation || []).map(p => p.facture + ' ' + p.categorie).join(' ')].join(' '));
      const montantOk = qNum != null && (Math.abs(o.debit - qNum) < 0.005 || Math.abs(o.credit - qNum) < 0.005);
      if (!texte.includes(q) && !montantOk) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.debit + b.credit) - (a.debit + a.credit));
}

function moisDisponibles() {
  return [...new Set(D().operations.map(o => Logic.moisDe(o.date)))].sort().reverse();
}

function pageOperations() {
  const f = S.f;
  const mois = moisDisponibles();
  const cats = D().categories;
  if (!D().operations.length) {
    return `<div class="entete"><h1>Opérations<small>${h(D().nom)}</small></h1></div>
      <div class="carte vide">Aucune opération pour l'instant.<br><br><button class="btn principal" data-page="import">Importer un premier relevé</button></div>`;
  }
  return `<div class="entete"><h1>Opérations<small>${h(D().nom)}</small></h1>
      <div style="display:flex;gap:8px"><button class="btn" data-page="import">Importer un relevé</button></div></div>
    <div class="filtres">
      ${D().comptes.length > 1 ? `<label class="champ"><span>Compte</span><select data-filtre="compte">${optionsComptes(f.compte, 'Tous les comptes')}</select></label>` : ''}
      <label class="champ"><span>Mois</span><select data-filtre="mois"><option value="">Tous les mois</option>${mois.map(m => `<option value="${m}"${m === f.mois ? ' selected' : ''}>${libMois(m)}</option>`).join('')}</select></label>
      <label class="champ"><span>Catégorie</span><select data-filtre="categorie"><option value="">Toutes</option><option value="${Logic.A_CLASSER}"${f.categorie === Logic.A_CLASSER ? ' selected' : ''}>⚠ À classer</option>${cats.map(c => `<option value="${h(c.nom)}"${c.nom === f.categorie ? ' selected' : ''}>${h(c.nom)}</option>`).join('')}</select></label>
      <label class="champ"><span>Sens</span><div class="segment">${[['tout', 'Tout'], ['debit', 'Dépenses'], ['credit', 'Recettes']].map(([v, l]) => `<button data-sens="${v}" class="${f.sens === v ? 'actif' : ''}">${l}</button>`).join('')}</div></label>
      <label class="champ"><span>&nbsp;</span><label style="display:flex;gap:6px;align-items:center;padding:6px 0;color:var(--encre)"><input type="checkbox" data-filtre="sansFacture"${f.sansFacture ? ' checked' : ''}> Dépenses sans n° de facture</label></label>
      <label class="champ" style="flex:1;min-width:200px"><span>Rechercher (libellé, facture, montant)</span><input type="search" id="recherche" value="${h(f.recherche)}" placeholder="ex. EDF, F-2026-014, 375"></label>
      ${(f.compte || f.mois || f.categorie || f.recherche || f.sens !== 'tout' || f.sansFacture) ? '<button class="btn" data-action="raz-filtres">Effacer les filtres</button>' : ''}
    </div>
    <div class="chiffres" id="chiffres"></div>
    <div class="table-cadre"><table>
      <thead><tr><th style="width:28px"><input type="checkbox" id="tout-choisir" title="Tout sélectionner"></th><th>Date</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th><th>Catégorie</th><th>N° facture</th><th></th></tr></thead>
      <tbody id="corps"></tbody>
    </table></div>
    <div id="barre-selection"></div>`;
}

function apresOperations() { rendreTableOps(); }

function rendreTableOps() {
  const ops = opsFiltrees();
  const r = R();
  let dep = 0, rec = 0, aClasser = 0, sansFact = 0;
  for (const o of ops) {
    dep += o.debit || 0; rec += o.credit || 0;
    if (Logic.partsDe(o, r).some(p => p.categorie === Logic.A_CLASSER) || Logic.resteVentilation(o)) aClasser++;
    if (o.debit && !o.facture && !(o.ventilation && o.ventilation.length && o.ventilation.every(p => p.facture))) sansFact++;
  }
  const ch = $('#chiffres');
  if (ch) ch.innerHTML = `
    <div class="chiffre"><span>Opérations affichées</span><strong>${ops.length}</strong></div>
    <div class="chiffre"><span>Dépenses</span><strong>${eur(dep)}</strong></div>
    <div class="chiffre"><span>Recettes</span><strong style="color:var(--credit)">${eur(rec)}</strong></div>
    <div class="chiffre ${aClasser ? 'alerte' : ''}" ${aClasser ? 'data-action="voir-aclasser" title="Afficher seulement les opérations à classer"' : ''}><span>À classer</span><strong>${aClasser}</strong></div>
    <div class="chiffre"><span>Dépenses sans n° de facture</span><strong>${sansFact}</strong></div>`;
  const corps = $('#corps');
  if (!corps) return;
  if (!ops.length) { corps.innerHTML = '<tr><td colspan="8" class="vide">Aucune opération ne correspond aux filtres.</td></tr>'; rendreSelection(); return; }
  const max = 600;
  const optCats = optionsCategories(null);
  corps.innerHTML = ops.slice(0, max).map(o => ligneOp(o, r, optCats)).join('') +
    (ops.length > max ? `<tr><td colspan="8" class="vide">${ops.length - max} opérations de plus : affinez les filtres (mois, catégorie…).</td></tr>` : '');
  $('#tout-choisir').checked = ops.length > 0 && ops.slice(0, max).every(o => S.selection.has(o.id));
  rendreSelection();
}

function ligneOp(o, r, optCats) {
  const ouvert = S.ouverts.has(o.id);
  const details = (o.details || []).join(' · ');
  let cat;
  if (o.ventilation && o.ventilation.length) {
    const reste = Logic.resteVentilation(o);
    cat = `<div class="ventil">${o.ventilation.map(p => `<div>${eur(p.montant)} · ${h(p.categorie || Logic.A_CLASSER)}${p.facture ? ' · n° ' + h(p.facture) : ''}</div>`).join('')}
      ${reste ? `<div class="reste">Reste à ventiler : ${eur(reste)}</div>` : ''}<div><button class="lien" data-action="ventiler" data-id="${o.id}">Modifier la ventilation</button></div></div>`;
  } else {
    const auto = Logic.autoCategorie(o, r);
    const cls = o.categorie ? '' : auto ? 'auto' : 'aclasser';
    const libAuto = auto ? 'Auto : ' + auto.categorie : '⚠ À classer';
    cat = `<select class="${cls}" data-op-cat="${o.id}" title="${auto && !o.categorie ? h('Règle : « ' + auto.motcle + ' »') : ''}">
      <option value="">${h(libAuto)}</option>${o.categorie ? optCats.replace(`value="${h(o.categorie)}"`, `value="${h(o.categorie)}" selected`) : optCats}
      <option value="__nouvelle">＋ Nouvelle catégorie…</option></select>`;
    if (o.categorie && !D().categories.some(c => c.nom === o.categorie)) cat = cat.replace('<option value="__nouvelle">', `<option value="${h(o.categorie)}" selected>${h(o.categorie)} (supprimée)</option><option value="__nouvelle">`);
  }
  const facture = (o.ventilation && o.ventilation.length) ? '' :
    `<input type="text" data-op-fact="${o.id}" value="${h(o.facture || '')}" class="${o.debit && !o.facture ? 'manque' : ''}" placeholder="${o.debit ? 'n° facture' : ''}">`;
  return `<tr class="${S.selection.has(o.id) ? 'choisi' : ''}">
    <td><input type="checkbox" data-choisir="${o.id}"${S.selection.has(o.id) ? ' checked' : ''}></td>
    <td class="date">${Logic.formatDate(o.date)}<div class="moyen">${D().comptes.length > 1 && !S.f.compte ? h(compteNom(o.compte).replace(/\s*[–-].*$/, '')) + ' · ' : ''}${h(o.moyen || Logic.detectMoyen(o.libelle))}</div></td>
    <td class="lib ${ouvert ? 'ouvert' : ''}"><div class="l1" data-action="ouvrir" data-id="${o.id}" title="Cliquer pour voir tout le détail">${h(o.libelle)}</div>
      ${details ? `<div class="l2">${h(details)}</div>` : ''}
      ${o.note ? `<div class="note">✎ ${h(o.note)}</div>` : ''}
      ${ouvert ? `<div class="aide" style="margin:4px 0 0">${o.dateValeur ? 'Valeur ' + Logic.formatDate(o.dateValeur) + ' · ' : ''}${h(compteNom(o.compte))}${o.source ? ' · ' + h(o.source) : ''}</div>` : ''}</td>
    <td class="num debit">${eur0(o.debit)}</td>
    <td class="num credit">${eur0(o.credit)}</td>
    <td class="cat">${cat}</td>
    <td class="fact">${facture}</td>
    <td class="actions"><button class="btn petit" data-action="ventiler" data-id="${o.id}" title="Répartir le montant sur plusieurs catégories">Ventiler</button>
      <button class="btn petit" data-action="note" data-id="${o.id}" title="Ajouter une note">Note</button></td>
  </tr>`;
}

function rendreSelection() {
  const el = $('#barre-selection');
  if (!el) return;
  const n = S.selection.size;
  el.innerHTML = n ? `<div class="selection"><strong>${n} sélectionnée${n > 1 ? 's' : ''}</strong>
    <span>Classer en</span><select id="cat-selection"><option value="">— choisir —</option>${optionsCategories(null)}<option value="__auto">Revenir au classement automatique</option></select>
    <button class="btn petit" data-action="appliquer-selection">Appliquer</button>
    <button class="btn petit" data-action="vider-selection">Désélectionner</button>
    <span style="flex:1"></span>
    <button class="btn petit danger" data-action="supprimer-selection">Supprimer</button></div>` : '';
}

function opParId(id) { return D().operations.find(o => o.id === id); }

function choisirCategorie(op, valeur) {
  if (valeur === '__nouvelle') {
    nouvelleCategorie(nom => choisirCategorie(op, nom), () => rendreTableOps());
    return;
  }
  const avant = op.categorie;
  modifier(valeur ? `Catégorie « ${valeur} » pour ${op.libelle} (${Logic.formatDate(op.date)})` : `Classement automatique pour ${op.libelle}`, () => {
    if (valeur) op.categorie = valeur; else delete op.categorie;
  }, { rendu: false });
  rendreTableOps(); rendreBarre();
  if (valeur && valeur !== avant) {
    const auto = Logic.autoCategorie(op, R());
    if (!auto || auto.categorie !== valeur) {
      const mot = Logic.suggestMotcle(op.libelle);
      if (mot && !/^(Chèque|Remise chèque)$/.test(op.moyen || Logic.detectMoyen(op.libelle))) toast(`Classer automatiquement les prochaines « ${mot} » en ${valeur} ?`, 'Créer une règle', () => dialogueRegle(mot, valeur, op), 9000);
    }
  }
}

function dialogueRegle(motcle, categorie, op) {
  modale(`<h2>Nouvelle règle de classement</h2>
    <p class="aide">Toute opération dont le libellé (ou le détail) contient ce mot-clé sera classée dans la catégorie choisie. Raccourcissez le mot-clé pour qu'il marche aussi les mois suivants (enlevez les dates, numéros…).</p>
    ${op ? `<p class="aide">Libellé : <strong>${h(op.libelle)}</strong></p>` : ''}
    <div style="display:grid;grid-template-columns:1fr 240px;gap:10px">
      <label class="champ"><span>Le libellé contient</span><input type="text" id="r-mot" value="${h(motcle)}"></label>
      <label class="champ"><span>Catégorie</span><select id="r-cat">${optionsCategories(categorie)}</select></label>
    </div>
    <div class="aide" id="r-apercu"></div>
    <div class="pied"><button class="btn" data-fermer>Annuler</button><button class="btn principal" id="r-ok">Créer la règle</button></div>`, (b, fermer) => {
    const apercu = () => {
      const mot = Logic.norm($('#r-mot', b).value);
      if (!mot) { $('#r-apercu', b).textContent = ''; return; }
      const n = D().operations.filter(o => !o.categorie && !(o.ventilation && o.ventilation.length) && (Logic.norm(o.libelle).includes(mot) || Logic.norm((o.details || []).join(' ')).includes(mot))).length;
      $('#r-apercu', b).textContent = `${n} opération(s) sans catégorie manuelle contiennent ce mot-clé.`;
    };
    $('#r-mot', b).oninput = apercu; apercu();
    $('[data-fermer]', b).onclick = fermer;
    $('#r-ok', b).onclick = () => {
      const mot = $('#r-mot', b).value.trim(), cat = $('#r-cat', b).value;
      if (!mot || !cat) return;
      const avant = nbAClasser();
      modifier(`Règle « ${mot} » → ${cat}`, d => {
        const ex = d.regles.find(r => Logic.norm(r.motcle) === Logic.norm(mot));
        if (ex) ex.categorie = cat; else d.regles.push({ motcle: mot, categorie: cat });
        // l'opération d'origine passe en automatique si la règle la classe pareil
        if (op && op.categorie === cat) {
          const prep = Logic.prepareRegles(d.regles), a = Logic.autoCategorie(op, prep);
          if (a && a.categorie === cat) delete op.categorie;
        }
      });
      fermer();
      const gagne = avant - nbAClasser();
      toast(gagne > 0 ? `Règle créée : ${gagne} autre(s) opération(s) classée(s).` : 'Règle créée.');
    };
  });
}

function nouvelleCategorie(ok, annule) {
  modale(`<h2>Nouvelle catégorie</h2>
    <div style="display:grid;grid-template-columns:1fr 130px 150px;gap:10px">
      <label class="champ"><span>Nom</span><input type="text" id="c-nom" placeholder="ex. Bureautique"></label>
      <label class="champ"><span>N° de compte</span><input type="text" id="c-num" placeholder="ex. 6064"></label>
      <label class="champ"><span>Type</span><select id="c-type"><option value="depense">Dépense</option><option value="recette">Recette</option><option value="neutre">Neutre</option></select></label>
    </div>
    <p class="aide">Le n° de compte (plan comptable des associations) sert à l'export pour le comptable. Il peut être ajouté plus tard.</p>
    <div class="pied"><button class="btn" data-fermer>Annuler</button><button class="btn principal" id="c-ok">Créer</button></div>`, (b, fermer) => {
    $('[data-fermer]', b).onclick = () => { fermer(); if (annule) annule(); };
    const valider = () => {
      const nom = $('#c-nom', b).value.trim();
      if (!nom) return;
      if (!D().categories.some(c => Logic.norm(c.nom) === Logic.norm(nom))) {
        modifier(`Catégorie créée : ${nom}`, d => d.categories.push({ nom, compte: $('#c-num', b).value.trim(), type: $('#c-type', b).value }), { rendu: false });
      }
      fermer();
      ok(D().categories.find(c => Logic.norm(c.nom) === Logic.norm(nom)).nom);
    };
    $('#c-ok', b).onclick = valider;
    $('#c-nom', b).onkeydown = e => { if (e.key === 'Enter') valider(); };
  });
}

function dialogueVentilation(op) {
  const total = Math.abs(op.credit - op.debit);
  let parts = (op.ventilation && op.ventilation.length) ? op.ventilation.map(p => Object.assign({}, p))
    : [{ montant: total, categorie: op.categorie || '', facture: op.facture || '' }, { montant: 0, categorie: '', facture: '' }];
  const dessiner = b => {
    const somme = parts.reduce((t, p) => t + (+p.montant || 0), 0);
    const reste = Math.round((total - somme) * 100) / 100;
    $('#v-lignes', b).innerHTML = parts.map((p, i) => `<tr>
      <td><input type="text" data-v="montant" data-i="${i}" value="${p.montant ? Logic.formatMontant(p.montant).replace(/\s/g, '') : ''}" style="width:110px;text-align:right"></td>
      <td><select data-v="categorie" data-i="${i}">${optionsCategories(p.categorie, '— catégorie —')}</select></td>
      <td><input type="text" data-v="facture" data-i="${i}" value="${h(p.facture || '')}" style="width:110px" placeholder="n° facture"></td>
      <td><button class="btn petit" data-suppr="${i}" title="Retirer cette ligne">✕</button></td></tr>`).join('');
    $('#v-reste', b).innerHTML = reste ? `<span class="tag rouge">Reste à répartir : ${eur(reste)}</span>` : '<span class="tag">Montant entièrement réparti</span>';
  };
  modale(`<h2>Ventiler l'opération</h2>
    <p class="aide"><strong>${h(op.libelle)}</strong> du ${Logic.formatDate(op.date)} · ${eur(total)} ${op.debit ? 'de dépense' : 'de recette'}<br>
    Répartissez le montant sur plusieurs catégories (par exemple une remise de chèques qui mélange familles et associations).</p>
    <table><thead><tr><th>Montant</th><th>Catégorie</th><th>N° facture</th><th></th></tr></thead><tbody id="v-lignes"></tbody></table>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px"><button class="btn petit" id="v-ajout">＋ Ajouter une ligne</button><div id="v-reste"></div></div>
    <div class="pied">${op.ventilation && op.ventilation.length ? '<button class="btn danger" id="v-annuler" style="margin-right:auto">Supprimer la ventilation</button>' : ''}<button class="btn" data-fermer>Fermer sans enregistrer</button><button class="btn principal" id="v-ok">Enregistrer</button></div>`, (b, fermer) => {
    dessiner(b);
    b.addEventListener('input', e => {
      const t = e.target; if (!t.dataset.v) return;
      const i = +t.dataset.i;
      parts[i][t.dataset.v] = t.dataset.v === 'montant' ? (Logic.parseMontant(t.value) || 0) : t.value;
      if (t.dataset.v === 'montant') {
        const somme = parts.reduce((s, p) => s + (+p.montant || 0), 0);
        const reste = Math.round((total - somme) * 100) / 100;
        $('#v-reste', b).innerHTML = reste ? `<span class="tag rouge">Reste à répartir : ${eur(reste)}</span>` : '<span class="tag">Montant entièrement réparti</span>';
      }
    });
    b.addEventListener('change', e => { const t = e.target; if (t.tagName === 'SELECT' && t.dataset.v) parts[+t.dataset.i].categorie = t.value; });
    b.addEventListener('click', e => {
      const s = e.target.closest('[data-suppr]');
      if (s) { parts.splice(+s.dataset.suppr, 1); dessiner(b); }
    });
    $('#v-ajout', b).onclick = () => {
      const somme = parts.reduce((s, p) => s + (+p.montant || 0), 0);
      parts.push({ montant: Math.max(0, Math.round((total - somme) * 100) / 100), categorie: '', facture: '' }); dessiner(b);
    };
    $('[data-fermer]', b).onclick = fermer;
    if ($('#v-annuler', b)) $('#v-annuler', b).onclick = () => { modifier(`Ventilation supprimée : ${op.libelle}`, () => { delete op.ventilation; }); fermer(); };
    $('#v-ok', b).onclick = () => {
      const propres = parts.filter(p => +p.montant > 0).map(p => ({ montant: Math.round(p.montant * 100) / 100, categorie: p.categorie, facture: (p.facture || '').trim() }));
      if (propres.length <= 1) {
        modifier(`Catégorie de ${op.libelle}`, () => { delete op.ventilation; if (propres[0]) { if (propres[0].categorie) op.categorie = propres[0].categorie; if (propres[0].facture) op.facture = propres[0].facture; } });
      } else {
        modifier(`Ventilation de ${op.libelle} (${Logic.formatDate(op.date)})`, () => { op.ventilation = propres; delete op.categorie; });
      }
      fermer();
      const reste = Logic.resteVentilation(op);
      if (reste) toast(`Attention : il reste ${eur(reste)} à répartir sur cette opération.`);
    };
  });
}

function dialogueNote(op) {
  modale(`<h2>Note</h2><p class="aide">${h(op.libelle)} · ${Logic.formatDate(op.date)}</p>
    <textarea id="n-txt" style="width:100%;min-height:90px">${h(op.note || '')}</textarea>
    <div class="pied"><button class="btn" data-fermer>Annuler</button><button class="btn principal" id="n-ok">Enregistrer</button></div>`, (b, fermer) => {
    $('[data-fermer]', b).onclick = fermer;
    $('#n-ok', b).onclick = () => { const t = $('#n-txt', b).value.trim(); modifier(`Note sur ${op.libelle}`, () => { if (t) op.note = t; else delete op.note; }); fermer(); };
  });
}

// ---------------------------------------------------------------- synthèse
function bornesPeriode(annee, mode) {
  if (mode === 'scolaire') return { du: `${annee}-09-01`, au: `${annee + 1}-08-31`, mois: [...Array(12)].map((_, i) => { const m = (8 + i) % 12; const y = annee + (i >= 4 ? 1 : 0); return `${y}-${String(m + 1).padStart(2, '0')}`; }) };
  return { du: `${annee}-01-01`, au: `${annee}-12-31`, mois: [...Array(12)].map((_, i) => `${annee}-${String(i + 1).padStart(2, '0')}`) };
}
function anneesDisponibles() {
  const ys = [...new Set(D().operations.map(o => +o.date.slice(0, 4)))];
  if (!ys.length) ys.push(new Date().getFullYear());
  return ys.sort((a, b) => b - a);
}

function pageSynthese() {
  const s = S.synth, r = R();
  const annees = anneesDisponibles();
  if (!s.annee || (!annees.includes(s.annee) && !annees.includes(s.annee + 1))) s.annee = annees[0];
  const choixAnnees = s.mode === 'scolaire' ? [...new Set(annees.flatMap(y => [y, y - 1]))].sort((a, b) => b - a) : annees;
  const { du, au, mois } = bornesPeriode(s.annee, s.mode);
  const ops = D().operations.filter(o => o.date >= du && o.date <= au && (!s.compte || o.compte === s.compte));
  const table = new Map();
  let totDep = 0, totRec = 0, aClasser = 0, sansFact = 0;
  for (const o of ops) {
    totDep += o.debit || 0; totRec += o.credit || 0;
    if (o.debit && !o.facture && !(o.ventilation && o.ventilation.every(p => p.facture))) sansFact++;
    const parts = Logic.partsDe(o, r);
    if (parts.some(p => p.categorie === Logic.A_CLASSER)) aClasser++;
    for (const p of parts) {
      const v = s.vue === 'debit' ? p.debit : p.credit;
      if (!v) continue;
      if (!table.has(p.categorie)) table.set(p.categorie, new Map());
      const m = table.get(p.categorie), k = Logic.moisDe(o.date);
      m.set(k, (m.get(k) || 0) + v);
    }
  }
  const noms = [...table.keys()].sort((a, b) => {
    const ta = [...table.get(a).values()].reduce((x, y) => x + y, 0), tb = [...table.get(b).values()].reduce((x, y) => x + y, 0);
    return tb - ta;
  });
  const max = Math.max(1, ...noms.flatMap(n => [...table.get(n).values()]));
  const cats = new Map(D().categories.map(c => [c.nom, c]));
  const totMois = mois.map(m => noms.reduce((t, n) => t + (table.get(n).get(m) || 0), 0));
  const lib = s.mode === 'scolaire' ? `Année scolaire ${s.annee}-${s.annee + 1}` : `Année ${s.annee}`;
  return `<div class="entete"><h1>Synthèse par mois<small>${h(D().nom)} · ${lib}</small></h1></div>
    <div class="filtres">
      <label class="champ"><span>Période</span><div class="segment">${[['civile', 'Année civile'], ['scolaire', 'Année scolaire']].map(([v, l]) => `<button data-synth-mode="${v}" class="${s.mode === v ? 'actif' : ''}">${l}</button>`).join('')}</div></label>
      <label class="champ"><span>Année</span><select data-synth="annee">${choixAnnees.map(y => `<option value="${y}"${y === s.annee ? ' selected' : ''}>${s.mode === 'scolaire' ? y + '-' + (y + 1) : y}</option>`).join('')}</select></label>
      ${D().comptes.length > 1 ? `<label class="champ"><span>Compte</span><select data-synth="compte">${optionsComptes(s.compte, 'Tous les comptes')}</select></label>` : ''}
      <label class="champ"><span>Afficher</span><div class="segment">${[['debit', 'Dépenses'], ['credit', 'Recettes']].map(([v, l]) => `<button data-synth-vue="${v}" class="${s.vue === v ? 'actif' : ''}">${l}</button>`).join('')}</div></label>
    </div>
    <div class="chiffres">
      <div class="chiffre"><span>Dépenses</span><strong>${eur(totDep)}</strong></div>
      <div class="chiffre"><span>Recettes</span><strong style="color:var(--credit)">${eur(totRec)}</strong></div>
      <div class="chiffre"><span>Recettes − dépenses</span><strong style="color:${totRec - totDep >= 0 ? 'var(--credit)' : 'var(--rouge)'}">${eur(totRec - totDep)}</strong></div>
      <div class="chiffre ${aClasser ? 'alerte' : ''}" ${aClasser ? 'data-action="voir-aclasser"' : ''}><span>À classer sur la période</span><strong>${aClasser}</strong></div>
      <div class="chiffre"><span>Dépenses sans n° de facture</span><strong>${sansFact}</strong></div>
    </div>
    <div class="table-cadre" style="max-height:none"><table class="synthese">
      <thead><tr><th>Catégorie</th><th>N° cpte</th>${mois.map(m => `<th class="num">${MOIS_COURT[+m.slice(5, 7) - 1]}${s.mode === 'scolaire' ? ' ' + m.slice(2, 4) : ''}</th>`).join('')}<th class="num">Total</th><th class="num">Moy./mois</th></tr></thead>
      <tbody>${noms.length ? noms.map(n => {
        const vals = mois.map(m => table.get(n).get(m) || 0);
        const tot = vals.reduce((a, b) => a + b, 0);
        const nbMois = vals.filter(v => v).length || 1;
        return `<tr><td class="nom">${n === Logic.A_CLASSER ? '<span class="tag ocre" style="margin:0">À classer</span>' : h(n)}</td><td class="cpte">${h((cats.get(n) || {}).compte || '')}</td>
          ${vals.map((v, i) => `<td class="num cellule" data-voir-cat="${h(n)}" data-voir-mois="${mois[i]}" style="${v ? `background:rgba(47,93,80,${(0.05 + 0.32 * v / max).toFixed(3)})` : ''}">${eur0(v)}</td>`).join('')}
          <td class="num cellule" data-voir-cat="${h(n)}" data-voir-mois=""><strong>${eur0(tot)}</strong></td><td class="num" style="color:var(--gris)">${eur0(tot / nbMois)}</td></tr>`;
      }).join('') : `<tr><td colspan="${mois.length + 4}" class="vide">Aucune ${s.vue === 'debit' ? 'dépense' : 'recette'} sur cette période.</td></tr>`}
      ${noms.length ? `<tr class="total"><td>Total</td><td></td>${totMois.map(v => `<td class="num">${eur0(v)}</td>`).join('')}<td class="num">${eur0(totMois.reduce((a, b) => a + b, 0))}</td><td></td></tr>` : ''}
      </tbody></table></div>
    <p class="aide">Cliquez sur un montant pour voir les opérations correspondantes. Une opération ventilée compte dans chacune de ses catégories.</p>`;
}

// ---------------------------------------------------------------- import
function pageImport() {
  const imp = S.imp;
  if (!imp.compte || !D().comptes.some(c => c.id === imp.compte)) imp.compte = D().comptes[0] ? D().comptes[0].id : '';
  const existants = new Set(D().operations.map(Logic.opKey));
  const r = R();
  let aImporter = 0;
  const blocs = imp.releves.map((rel, ri) => {
    if (rel.erreur) return `<div class="carte" style="margin-top:14px"><h2>${h(rel.nom)}</h2><div class="controle ko">${h(rel.erreur)}</div>
      ${rel.brut && rel.brut.length ? `<details><summary class="aide">Voir le texte lu dans le PDF</summary><pre style="font-size:11px;white-space:pre-wrap">${h(rel.brut.slice(0, 80).join('\n'))}</pre></details>` : ''}</div>`;
    const c = Logic.controleSoldes(rel);
    const dates = rel.operations.map(o => o.date).sort();
    rel.operations.forEach(o => {
      o.compte = imp.compte;
      o._doublon = existants.has(Logic.opKey(o));
      if (o._garder == null) o._garder = !o._doublon;
      if (o._garder) aImporter++;
    });
    const nbD = rel.operations.filter(o => o._doublon).length;
    return `<div class="carte" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2>${h(rel.nom)}</h2><button class="lien" data-action="retirer-releve" data-i="${ri}">Retirer</button></div>
      <div class="aide" style="margin:0">${rel.operations.length} opérations${dates.length ? ` du ${Logic.formatDate(dates[0])} au ${Logic.formatDate(dates[dates.length - 1])}` : ''}${nbD ? ` · <strong>${nbD} déjà présente(s)</strong>, décochée(s)` : ''}</div>
      ${c.messages.length ? c.messages.map(m => `<div class="controle ${c.ok ? 'ok' : 'ko'}">${c.ok ? '✔ ' : '⚠ '}${h(m)}</div>`).join('') : '<div class="controle info">Pas de solde de début et de fin trouvé : vérifiez le nombre d\'opérations.</div>'}
      <div class="table-cadre" style="max-height:420px;margin-top:8px"><table>
        <thead><tr><th><input type="checkbox" data-imp-tout="${ri}" ${rel.operations.every(o => o._garder) ? 'checked' : ''}></th><th>Date</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th><th>Catégorie proposée</th></tr></thead>
        <tbody>${rel.operations.map((o, oi) => {
          const a = Logic.autoCategorie(o, r);
          return `<tr class="${o._doublon ? 'doublon' : ''}"><td><input type="checkbox" data-imp="${ri}:${oi}" ${o._garder ? 'checked' : ''}></td>
            <td class="date">${Logic.formatDate(o.date)}</td>
            <td class="lib"><div class="l1">${h(o.libelle)}${o._doublon ? '<span class="tag ocre">déjà importée</span>' : ''}</div>${o.details.length ? `<div class="l2">${h(o.details.join(' · '))}</div>` : ''}</td>
            <td class="num debit">${eur0(o.debit)}</td><td class="num credit">${eur0(o.credit)}</td>
            <td>${a ? h(a.categorie) : '<span class="tag ocre" style="margin:0">À classer</span>'}</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
  }).join('');
  return `<div class="entete"><h1>Importer un relevé<small>${h(D().nom)}</small></h1></div>
    <div class="grille2">
      <div class="carte">
        <h2>1. Compte concerné</h2>
        <select data-imp-compte style="min-width:260px">${optionsComptes(imp.compte)}</select>
        <h2 style="margin-top:18px">2. Relevé PDF de la banque</h2>
        <div class="depot" id="depot">Glissez ici un ou plusieurs relevés PDF<br><span class="aide">ou</span><br><button class="btn principal" data-action="choisir-pdf">Choisir des fichiers PDF…</button></div>
      </div>
      <div class="carte">
        <h2>Ou : copier-coller depuis Excel</h2>
        <p class="aide">Sélectionnez dans Excel les lignes du relevé (avec la ligne de titres Date / Opération / Débit / Crédit si possible), copiez avec <kbd>Ctrl</kbd>+<kbd>C</kbd> et collez ici.</p>
        <textarea class="collage" id="collage" placeholder="Collez ici…"></textarea>
        <div style="margin-top:8px"><button class="btn" data-action="lire-collage">Lire le collage</button></div>
      </div>
    </div>
    ${blocs}
    ${imp.releves.length ? `<div class="selection" style="margin-top:14px"><strong>${aImporter} opération(s) à importer dans « ${h(compteNom(imp.compte))} »</strong><span style="flex:1"></span>
      <button class="btn" data-action="vider-import">Annuler</button><button class="btn" style="background:#fff;color:var(--vert);font-weight:600" data-action="importer" ${aImporter ? '' : 'disabled'}>Importer</button></div>` : ''}`;
}

function apresImport() {
  const z = $('#depot');
  if (!z) return;
  z.ondragover = e => { e.preventDefault(); z.classList.add('survol'); };
  z.ondragleave = () => z.classList.remove('survol');
  z.ondrop = async e => {
    e.preventDefault(); z.classList.remove('survol');
    const fichiers = [...e.dataTransfer.files].filter(f => /\.pdf$/i.test(f.name));
    if (!fichiers.length) { toast('Déposez des fichiers PDF.'); return; }
    z.innerHTML = 'Lecture en cours…';
    for (const f of fichiers) S.imp.releves.push(await api.lirePdfFichier(f));
    rendu();
  };
}

function importer() {
  const imp = S.imp;
  const existants = new Set(D().operations.map(Logic.opKey));
  const maintenant = new Date().toISOString();
  const nouvelles = [];
  const soldes = [];
  for (const rel of imp.releves) {
    if (rel.erreur) continue;
    for (const o of rel.operations) {
      if (!o._garder) continue;
      const op = { id: nouvelId(), compte: imp.compte, date: o.date, dateValeur: o.dateValeur || null, libelle: o.libelle, details: o.details || [], debit: o.debit || 0, credit: o.credit || 0, moyen: o.moyen || Logic.detectMoyen(o.libelle), importe: maintenant, source: rel.nom };
      const k = Logic.opKey(op);
      if (existants.has(k) && o._doublon) continue;
      existants.add(k);
      nouvelles.push(op);
    }
    for (const s of rel.soldes || []) if (s.date) soldes.push({ compte: imp.compte, date: s.date, montant: s.montant });
  }
  if (!nouvelles.length) return;
  modifier(`Import de ${nouvelles.length} opération(s) dans ${compteNom(imp.compte)} (${imp.releves.map(r => r.nom).join(', ')})`, d => {
    d.operations.push(...nouvelles);
    for (const s of soldes) if (!d.soldes.some(x => x.compte === s.compte && x.date === s.date)) d.soldes.push(s);
  }, { rendu: false });
  const r = R();
  const aClasser = nouvelles.filter(o => Logic.categorieDe(o, r) === Logic.A_CLASSER).length;
  const moisImp = [...new Set(nouvelles.map(o => Logic.moisDe(o.date)))];
  S.imp.releves = [];
  S.f = { compte: imp.compte, mois: moisImp.length === 1 ? moisImp[0] : '', categorie: aClasser ? Logic.A_CLASSER : '', recherche: '', sens: 'tout', sansFacture: false };
  S.page = 'operations';
  rendu();
  toast(`${nouvelles.length} opération(s) importée(s). ${aClasser ? aClasser + ' à classer : elles sont affichées.' : 'Toutes ont été classées automatiquement.'}`);
}

// ---------------------------------------------------------------- catégories et règles
function pageCategories() {
  const r = R();
  const usage = new Map(), parRegle = new Map();
  for (const o of D().operations) {
    for (const p of Logic.partsDe(o, r)) usage.set(p.categorie, (usage.get(p.categorie) || 0) + 1);
    if (!o.categorie && !(o.ventilation && o.ventilation.length)) {
      const a = Logic.autoCategorie(o, r);
      if (a) parRegle.set(a.src, (parRegle.get(a.src) || 0) + 1);
    }
  }
  for (const rg of D().regles) usage.set('§' + rg.categorie, (usage.get('§' + rg.categorie) || 0) + 1);
  const q = Logic.norm(S.regleFiltre);
  const regles = D().regles.map((rg, i) => ({ rg, i })).filter(({ rg }) => !q || Logic.norm(rg.motcle).includes(q) || Logic.norm(rg.categorie).includes(q))
    .sort((a, b) => a.rg.categorie.localeCompare(b.rg.categorie, 'fr') || a.rg.motcle.localeCompare(b.rg.motcle, 'fr'));
  const sansNum = D().categories.filter(c => !c.compte).length;
  return `<div class="entete"><h1>Catégories et règles<small>${h(D().nom)}</small></h1></div>
    <div class="grille2">
      <div class="carte">
        <h2>Catégories (${D().categories.length})</h2>
        <p class="aide">Le <strong>n° de compte</strong> du plan comptable des associations sert à l'export pour le comptable (ex. 6064 fournitures administratives, 706 participations des familles). ${sansNum ? `<span class="tag ocre">${sansNum} sans n° de compte</span>` : ''}</p>
        <div style="display:flex;gap:8px;margin-bottom:10px"><button class="btn principal" data-action="nouvelle-categorie">＋ Nouvelle catégorie</button></div>
        <div class="table-cadre liste" style="max-height:calc(100vh - 290px)"><table>
          <thead><tr><th>Nom</th><th>N° compte</th><th>Type</th><th class="num">Opérations</th><th></th></tr></thead>
          <tbody>${D().categories.map((c, i) => `<tr>
            <td><input type="text" data-cat-nom="${i}" value="${h(c.nom)}"></td>
            <td><input type="text" class="numero" data-cat-num="${i}" value="${h(c.compte || '')}" placeholder="—"></td>
            <td><select data-cat-type="${i}"><option value="">—</option>${[['depense', 'Dépense'], ['recette', 'Recette'], ['neutre', 'Neutre']].map(([v, l]) => `<option value="${v}"${c.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
            <td class="num"><button class="lien" data-voir-cat="${h(c.nom)}" data-voir-mois="">${usage.get(c.nom) || 0}</button></td>
            <td><button class="btn petit danger" data-cat-suppr="${i}" title="Supprimer">✕</button></td></tr>`).join('')}</tbody></table></div>
      </div>
      <div class="carte">
        <h2>Règles de classement automatique (${D().regles.length})</h2>
        <p class="aide">Si le libellé de l'opération (ou son détail) contient le mot-clé, elle est classée dans la catégorie. Quand plusieurs mots-clés correspondent, <strong>le plus long l'emporte</strong>. Une catégorie choisie à la main passe toujours avant les règles.</p>
        <div style="display:grid;grid-template-columns:1fr 200px auto;gap:8px;margin-bottom:10px">
          <input type="text" id="nr-mot" placeholder="Mot-clé, ex. EAU DE PARIS">
          <select id="nr-cat">${optionsCategories(null, '— catégorie —')}</select>
          <button class="btn principal" data-action="ajouter-regle">Ajouter</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <input type="search" id="regle-filtre" placeholder="Filtrer les règles…" value="${h(S.regleFiltre)}">
          <input type="text" id="test-libelle" placeholder="Tester un libellé…">
        </div>
        <div id="test-resultat" class="aide"></div>
        <div class="table-cadre liste" style="max-height:calc(100vh - 380px)"><table>
          <thead><tr><th>Le libellé contient</th><th>Catégorie</th><th class="num" title="Opérations classées par cette règle">Utilisée</th><th></th></tr></thead>
          <tbody>${regles.map(({ rg, i }) => `<tr>
            <td><input type="text" data-regle-mot="${i}" value="${h(rg.motcle)}"></td>
            <td><select data-regle-cat="${i}">${optionsCategories(rg.categorie)}${D().categories.some(c => c.nom === rg.categorie) ? '' : `<option selected>${h(rg.categorie)}</option>`}</select></td>
            <td class="num">${parRegle.get(rg) || 0}</td>
            <td><button class="btn petit danger" data-regle-suppr="${i}" title="Supprimer">✕</button></td></tr>`).join('') || '<tr><td colspan="4" class="vide">Aucune règle.</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
}

function renommerCategorie(i, nouveau) {
  const ancien = D().categories[i].nom;
  nouveau = nouveau.trim();
  if (!nouveau || nouveau === ancien) { rendu(); return; }
  if (D().categories.some((c, j) => j !== i && Logic.norm(c.nom) === Logic.norm(nouveau))) { toast('Cette catégorie existe déjà.'); rendu(); return; }
  modifier(`Catégorie renommée : ${ancien} → ${nouveau}`, d => {
    d.categories[i].nom = nouveau;
    d.regles.forEach(r => { if (r.categorie === ancien) r.categorie = nouveau; });
    d.operations.forEach(o => {
      if (o.categorie === ancien) o.categorie = nouveau;
      (o.ventilation || []).forEach(p => { if (p.categorie === ancien) p.categorie = nouveau; });
    });
  });
}

function supprimerCategorie(i) {
  const nom = D().categories[i].nom;
  const nOps = D().operations.filter(o => o.categorie === nom || (o.ventilation || []).some(p => p.categorie === nom)).length;
  const nRegles = D().regles.filter(r => r.categorie === nom).length;
  if ((nOps || nRegles) && !confirm(`La catégorie « ${nom} » est utilisée par ${nOps} opération(s) classée(s) à la main et ${nRegles} règle(s).\n\nLes règles seront supprimées et les opérations repasseront en classement automatique. Continuer ?`)) return;
  modifier(`Catégorie supprimée : ${nom}`, d => {
    d.categories.splice(i, 1);
    d.regles = d.regles.filter(r => r.categorie !== nom);
    d.operations.forEach(o => {
      if (o.categorie === nom) delete o.categorie;
      (o.ventilation || []).forEach(p => { if (p.categorie === nom) p.categorie = ''; });
    });
  });
}

// ---------------------------------------------------------------- export comptable
function pageExport() {
  const e = S.exp;
  const annees = anneesDisponibles();
  if (!e.du) { const y = annees[0]; e.du = `${y}-01-01`; e.au = `${y}-12-31`; }
  if (!e.comptes.length || !e.comptes.every(id => D().comptes.some(c => c.id === id))) e.comptes = D().comptes.map(c => c.id);
  const res = Export.construire(D(), { du: e.du, au: e.au, comptes: e.comptes }).resume;
  const sansNum = D().categories.filter(c => !c.compte);
  const presets = [];
  for (const y of annees.slice(0, 3)) presets.push([`${y}-01-01`, `${y}-12-31`, `Année ${y}`]);
  for (const y of annees.slice(0, 2)) presets.push([`${y - 1}-09-01`, `${y}-08-31`, `Année scolaire ${y - 1}-${y}`]);
  return `<div class="entete"><h1>Export pour le comptable<small>${h(D().nom)}</small></h1></div>
    <div class="grille2">
      <div class="carte">
        <h2>Période et comptes</h2>
        <div class="filtres">
          <label class="champ"><span>Du</span><input type="date" data-exp="du" value="${e.du}"></label>
          <label class="champ"><span>Au</span><input type="date" data-exp="au" value="${e.au}"></label>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${presets.map(([du, au, l]) => `<button class="btn petit" data-exp-preset="${du}|${au}">${l}</button>`).join('')}</div>
        ${D().comptes.length > 1 ? `<div style="display:grid;gap:6px;margin-bottom:14px">${D().comptes.map(c => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-exp-compte="${h(c.id)}"${e.comptes.includes(c.id) ? ' checked' : ''}> ${h(c.nom)} <span class="aide" style="margin:0">(compte ${h(c.compteComptable || '512')})</span></label>`).join('')}</div>` : ''}
        <button class="btn principal" data-action="exporter" ${res.operations ? '' : 'disabled'}>Créer le fichier Excel…</button>
        <p class="aide" style="margin-top:14px">Le fichier contient 5 onglets : <strong>Opérations</strong> (avec catégorie, n° de compte et n° de facture), <strong>Journal de banque</strong> (écritures prêtes à saisir : banque 512 d'un côté, compte de la catégorie de l'autre), <strong>Par compte comptable</strong>, <strong>Par mois</strong> et <strong>À vérifier</strong>. Les opérations dont la catégorie n'a pas de n° de compte partent au compte d'attente 471.</p>
      </div>
      <div class="carte">
        <h2>Avant d'exporter</h2>
        <div class="chiffres" style="grid-template-columns:1fr 1fr">
          <div class="chiffre"><span>Opérations</span><strong>${res.operations}</strong></div>
          <div class="chiffre"><span>Dépenses / recettes</span><strong style="font-size:15px">${eur(res.depenses)} / ${eur(res.recettes)}</strong></div>
          <div class="chiffre ${res.sansCategorie ? 'alerte' : ''}" ${res.sansCategorie ? 'data-action="voir-aclasser"' : ''}><span>Sans catégorie</span><strong>${res.sansCategorie}</strong></div>
          <div class="chiffre ${res.sansNumero ? 'alerte' : ''}" ${res.sansNumero ? 'data-page="categories"' : ''}><span>Lignes dont la catégorie n'a pas de n° de compte</span><strong>${res.sansNumero}</strong></div>
          <div class="chiffre ${res.sansFacture ? 'alerte' : ''}" ${res.sansFacture ? 'data-action="voir-sansfacture"' : ''}><span>Dépenses sans n° de facture</span><strong>${res.sansFacture}</strong></div>
        </div>
        ${sansNum.length ? `<p class="aide">Catégories sans n° de compte : ${sansNum.map(c => h(c.nom)).join(', ')}. <button class="lien" data-page="categories">Les compléter</button></p>` : '<p class="aide">Toutes les catégories ont un n° de compte.</p>'}
      </div>
    </div>`;
}

async function exporter() {
  const e = S.exp;
  const { feuilles, resume } = Export.construire(D(), { du: e.du, au: e.au, comptes: e.comptes });
  const nom = `${D().nom} - export comptable ${Logic.formatDate(e.du).replace(/\//g, '-')} au ${Logic.formatDate(e.au).replace(/\//g, '-')}.xlsx`;
  try {
    const chemin = await api.exporterExcel(feuilles, nom);
    if (chemin) {
      modifier(`Export comptable du ${Logic.formatDate(e.du)} au ${Logic.formatDate(e.au)} (${resume.operations} opérations)`, () => {}, { rendu: false });
      toast('Fichier Excel créé.', 'Ouvrir', () => api.ouvrir(chemin), 10000);
    }
  } catch (err) { toast("L'export a échoué : " + err.message); }
}

// ---------------------------------------------------------------- paramètres
function pageParametres() {
  const d = D();
  return `<div class="entete"><h1>Paramètres<small>${h(d.nom)}</small></h1></div>
    <div class="grille2">
      <div class="carte">
        <h2>Dossier des données</h2>
        <p class="aide">Les données de chaque association sont dans un fichier de ce dossier, avec une copie de sauvegarde par jour dans le sous-dossier « Sauvegardes ».</p>
        <div style="font-family:Consolas,monospace;font-size:12px;background:#f0eee7;padding:8px;border-radius:6px;word-break:break-all">${h(A().chemin || S.config.dossier)}</div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" data-action="ouvrir-dossier">Ouvrir le dossier</button><button class="btn" data-action="choisir-dossier">Changer de dossier…</button></div>
        <h2 style="margin-top:20px">Utilisateur</h2>
        <label class="champ" style="max-width:260px"><span>Votre prénom (noté dans l'historique)</span><input type="text" data-param="utilisateur" value="${h(S.config.utilisateur || '')}"></label>
        <h2 style="margin-top:20px">Reprendre des données</h2>
        <p class="aide">Remplace toutes les données de « ${h(d.nom)} » par celles d'un fichier .json (par exemple la reprise de votre classeur Excel).</p>
        <button class="btn" data-action="importer-fichier">Importer un fichier de données…</button>
      </div>
      <div class="carte">
        <h2>Comptes bancaires</h2>
        <p class="aide">Le n° de compte comptable (512…) est utilisé dans le journal de banque de l'export.</p>
        <table class="liste"><thead><tr><th>Nom</th><th>N° comptable</th></tr></thead><tbody>
          ${d.comptes.map((c, i) => `<tr><td><input type="text" data-compte-nom="${i}" value="${h(c.nom)}"></td><td><input type="text" class="numero" data-compte-num="${i}" value="${h(c.compteComptable || '')}"></td></tr>`).join('')}
        </tbody></table>
        <div style="margin-top:8px"><button class="btn petit" data-action="ajouter-compte">＋ Ajouter un compte</button></div>
        <label class="champ" style="max-width:160px;margin-top:14px"><span>Code journal de banque</span><input type="text" data-asso-journal value="${h(d.journal || 'BQ')}"></label>
        <h2 style="margin-top:20px">Dernières modifications</h2>
        <div style="max-height:260px;overflow:auto;font-size:12.5px">${(d.historique || []).slice(0, 40).map(x => `<div style="padding:4px 0;border-bottom:1px solid var(--trait)"><span class="aide" style="margin:0">${new Date(x.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${x.par ? ' · ' + h(x.par) : ''}</span><br>${h(x.action)}</div>`).join('') || '<div class="aide">Rien pour l\'instant.</div>'}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- événements
document.addEventListener('click', async e => {
  const t = e.target.closest('button, [data-action], [data-voir-cat], td.cellule, .chiffre[data-page]');
  if (!t) return;
  const ds = t.dataset;
  if (ds.asso) {
    S.assoId = ds.asso; S.selection.clear(); S.imp.releves = [];
    S.f = { compte: '', mois: '', categorie: '', recherche: '', sens: 'tout', sansFacture: false };
    S.exp = { du: '', au: '', comptes: [] }; S.synth.compte = '';
    api.ecrireConfig({ derniereAsso: S.assoId });
    if (!S.assos[S.assoId]) await chargerAsso(S.assoId);
    rendu(); return;
  }
  if (ds.page) { S.page = ds.page; S.selection.clear(); rendu(); $('#page').scrollTop = 0; return; }
  if (ds.sens) { S.f.sens = ds.sens; rendu(); return; }
  if (ds.synthMode) {
    S.synth.mode = ds.synthMode;
    const der = D().operations.reduce((m, o) => o.date > m ? o.date : m, '');
    if (der) { const y = +der.slice(0, 4), mo = +der.slice(5, 7); S.synth.annee = ds.synthMode === 'scolaire' ? (mo >= 9 ? y : y - 1) : y; }
    rendu(); return;
  }
  if (ds.synthVue) { S.synth.vue = ds.synthVue; rendu(); return; }
  if (ds.voirCat != null) {
    S.f = { compte: S.page === 'synthese' ? S.synth.compte : '', mois: ds.voirMois || '', categorie: ds.voirCat, recherche: '', sens: S.page === 'synthese' ? S.synth.vue : 'tout', sansFacture: false };
    S.page = 'operations'; rendu(); return;
  }
  if (ds.expPreset) { const [du, au] = ds.expPreset.split('|'); S.exp.du = du; S.exp.au = au; rendu(); return; }
  if (ds.catSuppr) { supprimerCategorie(+ds.catSuppr); return; }
  if (ds.regleSuppr) { const rg = D().regles[+ds.regleSuppr]; modifier(`Règle supprimée : ${rg.motcle}`, d => d.regles.splice(+ds.regleSuppr, 1)); return; }
  if (ds.action === 'retirer-releve') { S.imp.releves.splice(+ds.i, 1); rendu(); return; }
  const op = ds.id ? opParId(ds.id) : null;
  switch (ds.action) {
    case 'choisir-dossier': {
      const prenom = $('#prenom'); if (prenom && prenom.value.trim()) S.config = await api.ecrireConfig({ utilisateur: prenom.value.trim() });
      const c = await api.choisirDossier();
      if (c) { S.config = c; S.assos = {}; await chargerAsso(S.assoId); rendu(); }
      break;
    }
    case 'ouvrir-dossier': api.ouvrir(S.config.dossier); break;
    case 'raz-filtres': S.f = { compte: '', mois: '', categorie: '', recherche: '', sens: 'tout', sansFacture: false }; rendu(); break;
    case 'voir-aclasser': S.f = { compte: '', mois: '', categorie: Logic.A_CLASSER, recherche: '', sens: 'tout', sansFacture: false }; S.page = 'operations'; rendu(); break;
    case 'voir-sansfacture': S.f = { compte: '', mois: '', categorie: '', recherche: '', sens: 'debit', sansFacture: true }; S.page = 'operations'; rendu(); break;
    case 'ouvrir': if (S.ouverts.has(op.id)) S.ouverts.delete(op.id); else S.ouverts.add(op.id); rendreTableOps(); break;
    case 'ventiler': dialogueVentilation(op); break;
    case 'note': dialogueNote(op); break;
    case 'vider-selection': S.selection.clear(); rendreTableOps(); break;
    case 'appliquer-selection': {
      const v = $('#cat-selection').value;
      if (!v) return;
      const ids = [...S.selection];
      modifier(`${ids.length} opération(s) classée(s) en ${v === '__auto' ? 'automatique' : v}`, d => {
        d.operations.forEach(o => { if (S.selection.has(o.id)) { delete o.ventilation; if (v === '__auto') delete o.categorie; else o.categorie = v; } });
      }, { rendu: false });
      S.selection.clear(); rendu(); break;
    }
    case 'supprimer-selection': {
      const n = S.selection.size;
      if (!confirm(`Supprimer définitivement ${n} opération(s) ?`)) return;
      modifier(`${n} opération(s) supprimée(s)`, d => { d.operations = d.operations.filter(o => !S.selection.has(o.id)); }, { rendu: false });
      S.selection.clear(); rendu(); break;
    }
    case 'choisir-pdf': {
      t.disabled = true; t.textContent = 'Lecture en cours…';
      const res = await api.ouvrirPdf();
      S.imp.releves.push(...res);
      rendu(); break;
    }
    case 'lire-collage': {
      const txt = $('#collage').value;
      if (!txt.trim()) { toast('Collez d\'abord des lignes copiées depuis Excel.'); return; }
      const rel = Logic.parseCollage(txt);
      rel.nom = 'Collage du ' + new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      if (!rel.operations.length) rel.erreur = "Aucune opération reconnue. Vérifiez que les colonnes Date, Opération, Débit et Crédit sont bien copiées.";
      S.imp.releves.push(rel); rendu(); break;
    }
    case 'vider-import': S.imp.releves = []; rendu(); break;
    case 'importer': importer(); break;
    case 'nouvelle-categorie': nouvelleCategorie(() => rendu()); break;
    case 'ajouter-regle': {
      const mot = $('#nr-mot').value.trim(), cat = $('#nr-cat').value;
      if (!mot || !cat) { toast('Indiquez un mot-clé et une catégorie.'); return; }
      if (D().regles.some(r => Logic.norm(r.motcle) === Logic.norm(mot))) { toast('Ce mot-clé existe déjà.'); return; }
      const avant = nbAClasser();
      modifier(`Règle « ${mot} » → ${cat}`, d => d.regles.push({ motcle: mot, categorie: cat }));
      const gagne = avant - nbAClasser();
      if (gagne > 0) toast(`${gagne} opération(s) classée(s) grâce à cette règle.`);
      break;
    }
    case 'exporter': exporter(); break;
    case 'ajouter-compte': modifier('Compte ajouté', d => d.comptes.push({ id: d.id + '-' + nouvelId().slice(0, 4), nom: 'Nouveau compte', compteComptable: '512' })); break;
    case 'importer-fichier': {
      try {
        const data = await api.importerFichier(S.assoId);
        if (!data) return;
        if (!confirm(`Remplacer les données actuelles de « ${D().nom} » (${D().operations.length} opérations) par celles du fichier (${data.operations.length} opérations) ?`)) return;
        data.id = S.assoId;
        modifier(`Données reprises depuis un fichier (${data.operations.length} opérations)`, () => { A().data = data; });
        toast('Données importées.');
      } catch (err) { toast(err.message); }
      break;
    }
  }
});

document.addEventListener('change', e => {
  const t = e.target, ds = t.dataset;
  if (ds.filtre) { S.f[ds.filtre] = t.type === 'checkbox' ? t.checked : t.value; S.selection.clear(); rendu(); return; }
  if (ds.opCat) { const op = opParId(ds.opCat); choisirCategorie(op, t.value); return; }
  if (ds.opFact) {
    const op = opParId(ds.opFact); const v = t.value.trim();
    modifier(v ? `Facture ${v} pour ${op.libelle}` : `Facture retirée : ${op.libelle}`, () => { if (v) op.facture = v; else delete op.facture; }, { rendu: false });
    t.classList.toggle('manque', !!(op.debit && !v));
    return;
  }
  if (ds.choisir) {
    if (t.checked) S.selection.add(ds.choisir); else S.selection.delete(ds.choisir);
    t.closest('tr').classList.toggle('choisi', t.checked); rendreSelection(); return;
  }
  if (t.id === 'tout-choisir') { opsFiltrees().slice(0, 600).forEach(o => t.checked ? S.selection.add(o.id) : S.selection.delete(o.id)); rendreTableOps(); return; }
  if (ds.synth) { S.synth[ds.synth] = ds.synth === 'annee' ? +t.value : t.value; rendu(); return; }
  if (ds.impCompte != null) { S.imp.compte = t.value; S.imp.releves.forEach(r => r.operations.forEach(o => { o._garder = null; })); rendu(); return; }
  if (ds.imp) { const [ri, oi] = ds.imp.split(':').map(Number); S.imp.releves[ri].operations[oi]._garder = t.checked; rendu(); return; }
  if (ds.impTout) { S.imp.releves[+ds.impTout].operations.forEach(o => { o._garder = t.checked; }); rendu(); return; }
  if (ds.catNom) { renommerCategorie(+ds.catNom, t.value); return; }
  if (ds.catNum) { const c = D().categories[+ds.catNum]; modifier(`N° de compte ${t.value.trim() || '(vide)'} pour ${c.nom}`, () => { c.compte = t.value.trim(); }, { rendu: false }); return; }
  if (ds.catType) { const c = D().categories[+ds.catType]; modifier(null, () => { c.type = t.value; }, { rendu: false }); return; }
  if (ds.regleMot) { const rg = D().regles[+ds.regleMot]; const v = t.value.trim(); if (!v) { rendu(); return; } modifier(`Règle modifiée : ${rg.motcle} → ${v}`, () => { rg.motcle = v; }); return; }
  if (ds.regleCat) { const rg = D().regles[+ds.regleCat]; modifier(`Règle « ${rg.motcle} » → ${t.value}`, () => { rg.categorie = t.value; }); return; }
  if (ds.exp) { S.exp[ds.exp] = t.value; rendu(); return; }
  if (ds.expCompte) { const id = ds.expCompte; S.exp.comptes = t.checked ? [...new Set([...S.exp.comptes, id])] : S.exp.comptes.filter(x => x !== id); if (!S.exp.comptes.length) S.exp.comptes = [id]; rendu(); return; }
  if (ds.param) { api.ecrireConfig({ [ds.param]: t.value.trim() }).then(c => { S.config = c; rendreEtat(); }); return; }
  if (ds.compteNom) { const c = D().comptes[+ds.compteNom]; modifier(`Compte renommé : ${t.value}`, () => { c.nom = t.value.trim() || c.nom; }); return; }
  if (ds.compteNum) { const c = D().comptes[+ds.compteNum]; modifier(null, () => { c.compteComptable = t.value.trim(); }, { rendu: false }); return; }
  if (ds.assoJournal != null) { modifier(null, d => { d.journal = t.value.trim() || 'BQ'; }, { rendu: false }); return; }
});

let minuteur = null;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'recherche') { clearTimeout(minuteur); minuteur = setTimeout(() => { S.f.recherche = t.value; S.selection.clear(); rendreTableOps(); }, 200); }
  if (t.id === 'regle-filtre') {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => { S.regleFiltre = t.value; const pos = t.selectionStart; rendu(); const n = $('#regle-filtre'); n.focus(); n.setSelectionRange(pos, pos); }, 250);
  }
  if (t.id === 'test-libelle') {
    const v = t.value.trim();
    const a = v ? Logic.autoCategorie({ libelle: v, details: [] }, R()) : null;
    $('#test-resultat').innerHTML = !v ? '' : a ? `→ <strong>${h(a.categorie)}</strong> (mot-clé « ${h(a.motcle)} »)` : '→ <span class="tag ocre" style="margin:0">À classer</span> aucune règle ne correspond';
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'nr-mot') $('[data-action="ajouter-regle"]').click();
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.opFact) {
    // passer à la facture suivante
    const champs = [...document.querySelectorAll('[data-op-fact]')];
    const i = champs.indexOf(e.target);
    e.target.blur();
    if (champs[i + 1]) champs[i + 1].focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && S.page === 'operations') { e.preventDefault(); const r = $('#recherche'); if (r) { r.focus(); r.select(); } }
});

// ---------------------------------------------------------------- démarrage
(async function demarrer() {
  try {
    S.version = await api.version();
    S.config = await api.lireConfig();
    if (S.config.derniereAsso && ASSOS.some(a => a.id === S.config.derniereAsso)) S.assoId = S.config.derniereAsso;
    if (S.config.dossier) {
      await chargerAsso(S.assoId);
      const autre = ASSOS.find(a => a.id !== S.assoId).id;
      chargerAsso(autre).then(rendreBarre).catch(() => {});
    }
  } catch (err) {
    S.config = Object.assign({}, S.config, { dossier: null });
    toast('Le dossier des données est inaccessible : ' + err.message + ' — choisissez-le à nouveau.', null, null, 12000);
  }
  rendu();
  api.surFocus(() => verifierMiseAJour());
})();
