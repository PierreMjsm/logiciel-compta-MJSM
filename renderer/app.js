/* global Logic, Modeles, Export, api */
'use strict';

// ---------------------------------------------------------------- état
const S = {
  config: {},
  assoId: 'acel-01',
  assos: {},
  page: 'operations',
  f: { compte: '', mois: '', categorie: '', recherche: '', sens: 'tout', sansFacture: false },
  selection: new Set(),
  ouverts: new Set(),
  imp: { compte: '', releves: [] },
  synth: { annee: null, mode: 'civile', compte: '', vue: 'debit', affichage: 'mois', anneeA: null, anneeB: null, egal: true },
  exp: { du: '', au: '', comptes: [] },
  regleFiltre: '',
  prev: { annee: null, onglet: 'tableau' },
  treso: { annee: null },
  subv: { annee: null, demande: 0 },
  enregistrement: { etat: 'ok', heure: null, timer: null, enCours: false },
  version: '',
};
// Trois espaces complètement séparés (chacun son fichier, ses catégories, ses règles, sa couleur)
const ASSOS = Modeles.ESPACES;
const espace = () => ASSOS.find(a => a.id === S.assoId) || ASSOS[0];
const PAGES = [
  { id: 'operations', nom: 'Opérations' },
  { id: 'synthese', nom: 'Synthèse et comparaison' },
  { id: 'import', nom: 'Importer un relevé' },
  { id: 'categories', nom: 'Catégories et règles' },
  { id: 'export', nom: 'Export comptable' },
  { id: 'previsionnel', nom: 'Budget et résultat' },
  { id: 'tresorerie', nom: 'Reste disponible' },
  { id: 'subvention', nom: 'Demandes de subvention', acel: true },
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
  data.releves = data.releves || []; data.clotures = data.clotures || [];
  const migre = Logic.migrerN1(data) | Modeles.completerReglesJsm(data);
  const hab = Tresorerie.migrerHabituelles(data);
  if (migre && !neuf) data.historique.unshift({ date: new Date().toISOString(), par: 'Logiciel', action: 'Catégorie « N-1 (année précédente) » ajoutée' });
  S.assos[id] = { data, revision: neuf ? null : (data.revision || 0), chemin: res.chemin, sale: false };
  _version++;
  if (neuf || migre || hab) { S.assos[id].sale = true; await sauver(); }
}

// ---------------------------------------------------------------- prévisionnel ACEL (fichier commun 01 + 02)
// Un budget par association : ACEL (comptes 01 + 02) ou Jeunes de Saint-Médard, selon l'espace choisi
const groupeId = () => Previsionnel.groupeDe(S.assoId);
const groupe = () => Previsionnel.GROUPES[groupeId()];
const budgetId = () => groupe().id;
const B = () => S.assos[budgetId()] && S.assos[budgetId()].data;
async function chargerBudget() {
  const id = budgetId(), g = groupeId();
  const res = await api.chargerAsso(id);
  let data = res.data, neuf = false;
  if (!data) { data = Previsionnel.nouveauBudget(g); neuf = true; }
  data.groupe = data.groupe || g; data.espaces = data.espaces || Previsionnel.GROUPES[g].espaces.slice();
  for (const k of ['budgets', 'budgetsRevises', 'arretes', 'rattachements']) data[k] = data[k] || {};
  data.postes = data.postes || []; data.historique = data.historique || [];
  S.assos[id] = { data, revision: neuf ? null : (data.revision || 0), chemin: res.chemin, sale: neuf, budget: true };
  if (neuf) await sauver();
}
function modifierBudget(action, fn, options = {}) {
  fn(B());
  if (action) {
    B().historique.unshift({ date: new Date().toISOString(), par: S.config.utilisateur || '', action });
    if (B().historique.length > 500) B().historique.length = 500;
  }
  S.assos[budgetId()].sale = true;
  planifierSauvegarde();
  if (options.rendu !== false) rendu();
}

function modifier(action, fn, options = {}) {
  fn(D());
  _version++;
  if (action) {
    D().historique.unshift({ date: new Date().toISOString(), par: S.config.utilisateur || '', action });
    if (D().historique.length > 1000) D().historique.length = 1000;
  }
  A().sale = true;
  planifierSauvegarde();
  if (options.rendu !== false) rendu();
}

function planifierSauvegarde(delai = 600) {
  S.enregistrement.etat = 'attente';
  rendreEtat();
  clearTimeout(S.enregistrement.timer);
  S.enregistrement.timer = setTimeout(sauver, delai);
}

/** Enregistre toutes les associations modifiées (pas seulement celle affichée). */
async function sauver() {
  clearTimeout(S.enregistrement.timer);
  if (S.enregistrement.enCours) { planifierSauvegarde(); return; }
  S.enregistrement.enCours = true;
  let erreur = false;
  try {
    for (const [id, a] of Object.entries(S.assos)) {
      if (!a.sale) continue;
      a.sale = false;
      try {
        const r = await api.sauverAsso(id, a.data, a.revision);
        if (r.conflit) {
          // Rien n'est perdu : notre version est mise de côté dans « Sauvegardes » avant de recharger
          await api.copieConflit(id, a.data).catch(() => {});
          toast(`« ${a.data.nom} » a été modifié depuis un autre ordinateur. J'affiche la dernière version ; la vôtre est gardée dans le dossier Sauvegardes (fichier « conflit »). Refaites votre dernière modification.`, null, null, 15000);
          await chargerAsso(id);
          rendu();
        } else {
          a.revision = r.revision;
          a.data.revision = r.revision;
          S.enregistrement.heure = new Date();
        }
      } catch (e) {
        a.sale = true; erreur = true;
        toast(`Impossible d'enregistrer « ${a.data.nom} » (${e.message}). Nouvel essai dans quelques secondes…`);
      }
    }
  } finally {
    S.enregistrement.enCours = false;
    S.enregistrement.etat = erreur ? 'erreur' : 'ok';
    rendreEtat();
    if (erreur) planifierSauvegarde(5000);
  }
}

async function verifierMiseAJour() {
  if (!S.config.dossier || !A() || A().sale || S.enregistrement.enCours) return;
  try {
    const rev = await api.revisionAsso(S.assoId);
    if (rev != null && A().revision != null && rev !== A().revision) {
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

function nbAClasserDe(data) {
  const r = Logic.prepareRegles(data.regles);
  return data.operations.filter(o => Logic.partsDe(o, r).some(p => p.categorie === Logic.A_CLASSER) || Logic.resteVentilation(o) !== 0).length;
}
function nbAClasser() {
  const r = R();
  return D().operations.filter(o => Logic.partsDe(o, r).some(p => p.categorie === Logic.A_CLASSER) || Logic.resteVentilation(o) !== 0).length;
}

function rendreBarre() {
  // la couleur de l'espace choisi colore toute l'interface : on voit toujours où l'on est
  document.documentElement.style.setProperty('--vert', espace().couleur);
  document.body.dataset.espace = S.assoId;
  $('#assos').innerHTML = ASSOS.map(a => {
    const d = S.assos[a.id];
    const n = d ? nbAClasserDe(d.data) : 0;
    return `<button data-asso="${a.id}" class="${a.id === S.assoId ? 'actif' : ''}" style="--couleur:${a.couleur}">
      <span class="pastille-espace"></span><span class="texte">${h(a.nom)}<small>${h(a.sous)}${n ? ` · ${n} à classer` : ''}</small></span></button>`;
  }).join('');
  const nb = S.config.dossier && A() ? nbAClasser() : 0;
  $('#nav').innerHTML = S.config.dossier ? PAGES.filter(p => !p.acel || S.assoId.startsWith('acel-')).map(p => p.id === 'previsionnel' ? Object.assign({}, p, { nom: groupe().titre }) : p).map(p => `<button data-page="${p.id}" class="${p.id === S.page ? 'actif' : ''}"><span>${p.nom}</span>${p.id === 'operations' && nb ? `<span class="pastille" title="Opérations à classer">${nb}</span>` : ''}</button>`).join('') : '';
  rendreEtat();
}

function rendu() {
  rendreBarre();
  const page = $('#page');
  const haut = page.scrollTop;
  if (!S.config.dossier) { page.innerHTML = pageAccueil(); return; }
  const f = { operations: pageOperations, synthese: pageSynthese, import: pageImport, categories: pageCategories, export: pageExport, parametres: pageParametres, previsionnel: pagePrevisionnel, tresorerie: pageTresorerie, subvention: pageSubvention }[S.page];
  page.innerHTML = ((S.page === 'previsionnel' || S.page === 'subvention') && groupeId() === 'acel'
    ? `<div class="bandeau-espace bandeau-acel"><span class="pastille-espace"></span>${S.page === 'subvention' ? 'Demandes de subvention : <strong>ACEL</strong> · plan de trésorerie du compte 01, versements cherchés sur 01 et 02' : 'Prévisionnel : <strong>ACEL – comptes 01 + 02 réunis</strong> · le seul écran qui additionne les deux comptes'}</div>`
    : `<div class="bandeau-espace"><span class="pastille-espace"></span>Vous êtes dans : <strong>${h(espace().nom)}</strong> · ${h(espace().sous)}</div>`) + f();
  page.scrollTop = haut;
  const apres = { operations: apresOperations, import: apresImport }[S.page];
  if (apres) apres();
}

function optionsCategories(choisie, avecVide) {
  const opt = c => `<option value="${h(c.nom)}"${c.nom === choisie ? ' selected' : ''}>${h(c.nom)}${c.compte ? ' · ' + h(c.compte) : ''}</option>`;
  const n1 = D().categories.filter(c => c.type === 'n-1');
  const autres = D().categories.filter(c => c.type !== 'n-1');
  return (avecVide ? `<option value="">${h(avecVide)}</option>` : '') +
    (n1.length ? `<optgroup label="Année précédente">${n1.map(opt).join('')}</optgroup><optgroup label="Catégories">${autres.map(opt).join('')}</optgroup>` : autres.map(opt).join(''));
}
const estN1 = nom => Logic.estN1(nom, D().categories);
/** Exercice clôturé : les opérations de cette année ne sont plus modifiables. */
const estClos = date => !!date && (D().clotures || []).includes(+String(date).slice(0, 4));
function verrou(ops) {
  const clos = ops.filter(o => estClos(o.date));
  if (clos.length) { toast(`Exercice ${clos[0].date.slice(0, 4)} clôturé : ${clos.length > 1 ? clos.length + ' opérations ne peuvent' : 'cette opération ne peut'} plus être modifiée(s). Rouvrez l'exercice dans Paramètres si nécessaire.`); return true; }
  return false;
}
const catN1 = () => D().categories.find(c => c.type === 'n-1');
const N1_A_CONFIRMER = '__n1?';
/** Opération qui mentionne l'année précédente, pas encore en N-1 et pas écartée : renvoie le texte trouvé. */
function n1APropose(o) {
  if (o.pasN1 || (o.ventilation && o.ventilation.length) || !catN1()) return null;
  if (estN1(o.categorie || Logic.categorieDe(o, R()))) return null;
  return Logic.suggereN1(o);
}
function optionsComptes(choisi, tous) {
  return (tous ? `<option value="">${h(tous)}</option>` : '') + D().comptes.map(c => `<option value="${h(c.id)}"${c.id === choisi ? ' selected' : ''}>${h(c.nom)}</option>`).join('');
}

// ---------------------------------------------------------------- accueil
function pageAccueil() {
  return `<div class="accueil carte">
    <h1>Bienvenue</h1>
    <p>Ce logiciel range les relevés bancaires de trois comptes, chacun dans son propre espace avec ses catégories et ses règles : <strong>ACEL Compte 01</strong> (quotidien), <strong>ACEL Compte 02</strong> (activités) et <strong>Les Jeunes de Saint-Médard</strong>. Il les classe par catégories, garde le numéro de facture de chaque dépense et prépare l'export pour le comptable.</p>
    <p>Pour commencer, choisissez le <strong>dossier où ranger les données</strong>. Prenez un dossier de votre OneDrive partagé : chaque personne qui installe le logiciel choisit le même dossier et voit les mêmes données.</p>
    <label class="champ" style="max-width:280px;margin:14px 0"><span>Votre prénom (pour l'historique des modifications)</span><input type="text" id="prenom" value="${h(S.config.utilisateur || '')}" placeholder="Pierre"></label>
    <button class="btn principal" data-action="choisir-dossier">Choisir le dossier…</button>
    <p class="aide">Si vous avez reçu le fichier « ACEL Compte 01 - Quotidien.compta.json » (reprise de votre classeur Excel), placez-le d'abord dans ce dossier : il sera repris automatiquement.</p>
  </div>`;
}

// ---------------------------------------------------------------- opérations
/** Année proposée par défaut : la plus récente qui a des opérations. */
function anneeDefaut() { const y = D() && D().operations.reduce((m, o) => o.date > m ? o.date : m, ''); return y ? y.slice(0, 4) : ''; }
function filtres(f) {
  const r = Object.assign({ compte: '', annee: undefined, mois: '', categorie: '', recherche: '', sens: 'tout', sansFacture: false, releve: '' }, f);
  if (r.mois) r.annee = r.mois.slice(0, 4);
  if (r.releve) r.annee = '';
  return r; // annee undefined = l'année la plus récente, choisie à l'affichage
}
function resoudreAnnee() { if (S.f.annee === undefined) S.f.annee = anneeDefaut();
}

function opsFiltrees() {
  const f = S.f, r = R();
  const q = Logic.norm(f.recherche);
  const qNum = Logic.parseMontant(f.recherche);
  const liste = D().operations.filter(o => {
    if (f.compte && o.compte !== f.compte) return false;
    if (f.annee && !o.date.startsWith(f.annee)) return false;
    if (f.mois && !o.date.startsWith(f.mois)) return false;
    if (f.releve && o.releve !== f.releve) return false;
    if (f.sens === 'debit' && !o.debit) return false;
    if (f.sens === 'credit' && !o.credit) return false;
    if (f.sansFacture && (!o.debit || o.facture || (o.ventilation && o.ventilation.every(p => p.facture)))) return false;
    if (f.categorie) {
      const parts = Logic.partsDe(o, r);
      if (f.categorie === N1_A_CONFIRMER) {
        if (!n1APropose(o)) return false;
      } else if (f.categorie === Logic.A_CLASSER) {
        if (!parts.some(p => p.categorie === Logic.A_CLASSER) && Logic.resteVentilation(o) === 0) return false;
      } else if (!parts.some(p => p.categorie === f.categorie)) return false;
    }
    if (q) {
      const texte = Logic.norm([o.libelle, (o.details || []).join(' '), o.facture, o.note, (o.ventilation || []).map(p => p.facture + ' ' + p.categorie).join(' ')].join(' '));
      const montantOk = qNum != null && (Math.abs(o.debit - qNum) < 0.005 || Math.abs(o.credit - qNum) < 0.005);
      if (!texte.includes(q) && !montantOk) return false;
    }
    return true;
  });
  // un relevé se lit dans son ordre d'origine (pour comparer au PDF) ; sinon, le plus récent en haut
  if (f.releve) return liste;
  return liste.sort((a, b) => b.date.localeCompare(a.date) || (b.debit + b.credit) - (a.debit + a.credit));
}

function moisDisponibles() {
  return [...new Set(D().operations.filter(o => !S.f.annee || o.date.startsWith(S.f.annee)).map(o => Logic.moisDe(o.date)))].sort().reverse();
}

function pageOperations() {
  resoudreAnnee();
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
      <label class="champ"><span>Année</span><select data-filtre="annee"><option value="">Toutes</option>${anneesDisponibles().map(y => `<option value="${y}"${String(y) === f.annee ? ' selected' : ''}>${y}${D().clotures.includes(y) ? ' 🔒' : ''}</option>`).join('')}</select></label>
      <label class="champ"><span>Mois</span><select data-filtre="mois"><option value="">Tous les mois</option>${mois.map(m => `<option value="${m}"${m === f.mois ? ' selected' : ''}>${libMois(m)}</option>`).join('')}</select></label>
      <label class="champ"><span>Catégorie</span><select data-filtre="categorie"><option value="">Toutes</option><option value="${Logic.A_CLASSER}"${f.categorie === Logic.A_CLASSER ? ' selected' : ''}>⚠ À classer</option><option value="${N1_A_CONFIRMER}"${f.categorie === N1_A_CONFIRMER ? ' selected' : ''}>N-1 ? à confirmer</option>${cats.map(c => `<option value="${h(c.nom)}"${c.nom === f.categorie ? ' selected' : ''}>${h(c.nom)}</option>`).join('')}</select></label>
      <label class="champ"><span>Sens</span><div class="segment">${[['tout', 'Tout'], ['debit', 'Dépenses'], ['credit', 'Recettes']].map(([v, l]) => `<button data-sens="${v}" class="${f.sens === v ? 'actif' : ''}">${l}</button>`).join('')}</div></label>
      <label class="champ"><span>&nbsp;</span><label style="display:flex;gap:6px;align-items:center;padding:6px 0;color:var(--encre)"><input type="checkbox" data-filtre="sansFacture"${f.sansFacture ? ' checked' : ''}> Dépenses sans n° de facture</label></label>
      <label class="champ" style="flex:1;min-width:200px"><span>Rechercher (libellé, facture, montant)</span><input type="search" id="recherche" value="${h(f.recherche)}" placeholder="ex. EDF, F-2026-014, 375"></label>
      ${(f.compte || f.mois || f.categorie || f.recherche || f.sens !== 'tout' || f.sansFacture || f.releve) ? '<button class="btn" data-action="raz-filtres">Effacer les filtres</button>' : ''}
    </div>
    ${f.releve ? bandeauReleve(f.releve) : ''}
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
  let dep = 0, rec = 0, aClasser = 0, sansFact = 0, n1Dep = 0, n1Rec = 0;
  const n1Prop = D().operations.filter(n1APropose).length;
  for (const o of ops) {
    for (const p of Logic.partsDe(o, r)) {
      if (estN1(p.categorie)) { n1Dep += p.debit; n1Rec += p.credit; } else { dep += p.debit; rec += p.credit; }
    }
    if (Logic.partsDe(o, r).some(p => p.categorie === Logic.A_CLASSER) || Logic.resteVentilation(o)) aClasser++;
    if (o.debit && !o.facture && !(o.ventilation && o.ventilation.length && o.ventilation.every(p => p.facture))) sansFact++;
  }
  const ch = $('#chiffres');
  if (ch) ch.innerHTML = `
    <div class="chiffre"><span>Opérations affichées</span><strong>${ops.length}</strong></div>
    <div class="chiffre"><span>Dépenses${n1Dep || n1Rec ? ' (hors N-1)' : ''}</span><strong>${eur(dep)}</strong></div>
    <div class="chiffre"><span>Recettes${n1Dep || n1Rec ? ' (hors N-1)' : ''}</span><strong style="color:var(--credit)">${eur(rec)}</strong></div>
    ${n1Dep || n1Rec ? `<div class="chiffre n1"><span>N-1 · compté dans l'année précédente</span><strong>${eur(n1Dep)}</strong><em>dépensés · ${eur(n1Rec)} encaissés</em></div>` : ''}
    <div class="chiffre ${aClasser ? 'alerte' : ''}" ${aClasser ? 'data-action="voir-aclasser" title="Afficher seulement les opérations à classer"' : ''}><span>À classer</span><strong>${aClasser}</strong></div>
    <div class="chiffre"><span>Dépenses sans n° de facture</span><strong>${sansFact}</strong></div>
    ${n1Prop ? `<div class="chiffre n1 propose" data-action="voir-n1-propose" title="Opérations qui mentionnent l'année précédente"><span>N-1 ? à confirmer</span><strong>${n1Prop}</strong></div>` : ''}`;
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
    cat = `<div class="ventil">${o.ventilation.map(p => `<div>${eur(p.montant)} · ${estN1(p.categorie) ? '<span class="tag n1" style="margin:0">N-1</span> ' : ''}${h(p.categorie || Logic.A_CLASSER)}${p.facture ? ' · n° ' + h(p.facture) : ''}</div>`).join('')}
      ${reste ? `<div class="reste">Reste à ventiler : ${eur(reste)}</div>` : ''}<div><button class="lien" data-action="ventiler" data-id="${o.id}">Modifier la ventilation</button></div></div>`;
  } else {
    const auto = Logic.autoCategorie(o, r);
    const cls = estN1(o.categorie || (auto && auto.categorie)) ? 'n1' + (o.categorie ? '' : ' auto') : o.categorie ? '' : auto ? 'auto' : 'aclasser';
    const libAuto = auto ? 'Auto : ' + auto.categorie : '⚠ À classer';
    cat = `<select class="${cls}" data-op-cat="${o.id}" title="${auto && !o.categorie ? h('Règle : « ' + auto.motcle + ' »') : ''}">
      <option value="">${h(libAuto)}</option>${o.categorie ? optCats.replace(`value="${h(o.categorie)}"`, `value="${h(o.categorie)}" selected`) : optCats}
      <option value="__nouvelle">＋ Nouvelle catégorie…</option></select>`;
    if (o.categorie && !D().categories.some(c => c.nom === o.categorie)) cat = cat.replace('<option value="__nouvelle">', `<option value="${h(o.categorie)}" selected>${h(o.categorie)} (supprimée)</option><option value="__nouvelle">`);
  }
  const facture = (o.ventilation && o.ventilation.length) ? '' :
    `<input type="text" data-op-fact="${o.id}" value="${h(o.facture || '')}" class="${o.debit && !o.facture ? 'manque' : ''}" placeholder="${o.debit ? 'n° facture' : ''}"${estClos(o.date) ? ' disabled' : ''}>`;
  const n1 = Logic.partsDe(o, r).some(p => estN1(p.categorie));
  const clos = estClos(o.date);
  const prop = n1 || clos ? null : n1APropose(o);
  if (clos) {
    cat = cat.replace(/<select /, '<select disabled ').replace(/<button class="lien" data-action="ventiler"[^>]*>[^<]*<\/button>/, '');
  }
  return `<tr class="${S.selection.has(o.id) ? 'choisi' : ''} ${n1 ? 'n1' : ''} ${clos ? 'clos' : ''}">
    <td><input type="checkbox" data-choisir="${o.id}"${S.selection.has(o.id) ? ' checked' : ''}></td>
    <td class="date">${Logic.formatDate(o.date)}<div class="moyen">${D().comptes.length > 1 && !S.f.compte ? h(compteNom(o.compte).replace(/\s*[–-].*$/, '')) + ' · ' : ''}${h(o.moyen || Logic.detectMoyen(o.libelle))}</div></td>
    <td class="lib ${ouvert ? 'ouvert' : ''}"><div class="l1" data-action="ouvrir" data-id="${o.id}" title="Cliquer pour voir tout le détail">${n1 ? '<span class="tag n1" style="margin:0 6px 0 0">N-1</span>' : ''}${h(o.libelle)}</div>
      ${prop ? `<div class="propose-n1">Mentionne « ${h(prop)} » : année précédente ? <button class="btn petit n1" data-action="confirmer-n1" data-id="${o.id}">Passer en N-1</button> <button class="lien" data-action="refuser-n1" data-id="${o.id}">Non</button></div>` : ''}
      ${details ? `<div class="l2">${h(details)}</div>` : ''}
      ${o.note ? `<div class="note">✎ ${h(o.note)}</div>` : ''}
      ${ouvert ? `<div class="aide" style="margin:4px 0 0">${o.dateValeur ? 'Valeur ' + Logic.formatDate(o.dateValeur) + ' · ' : ''}${h(compteNom(o.compte))}${o.source ? ' · ' + h(o.source) : ''}</div>` : ''}</td>
    <td class="num debit">${eur0(o.debit)}</td>
    <td class="num credit">${eur0(o.credit)}</td>
    <td class="cat">${cat}</td>
    <td class="fact">${facture}</td>
    <td class="actions">${clos ? `<span class="tag" title="Exercice ${o.date.slice(0, 4)} clôturé">🔒 clôturé</span>` : `<button class="btn petit" data-action="ventiler" data-id="${o.id}" title="Répartir le montant sur plusieurs catégories">Ventiler</button>
      <button class="btn petit" data-action="note" data-id="${o.id}" title="Ajouter une note">Note</button>`}</td>
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
  if (verrou([op])) { rendreTableOps(); return; }
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
      if (mot && !estN1(valeur) && !/^(Chèque|Remise chèque)$/.test(op.moyen || Logic.detectMoyen(op.libelle))) toast(`Classer automatiquement les prochaines « ${mot} » en ${valeur} ?`, 'Créer une règle', () => dialogueRegle(mot, valeur, op), 9000);
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
      const n = D().operations.filter(o => !o.categorie && !(o.ventilation && o.ventilation.length) && (Logic.contientMot(o.libelle, mot) || Logic.contientMot((o.details || []).join(' '), mot))).length;
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
    <p class="aide">Pour l'espace <strong>${h(espace().nom)}</strong> uniquement. Une catégorie sert aussi bien pour les débits que pour les crédits.</p>
    <div style="display:grid;grid-template-columns:1fr 130px;gap:10px">
      <label class="champ"><span>Nom</span><input type="text" id="c-nom" placeholder="ex. Bureautique"></label>
      <label class="champ"><span>N° de compte</span><input type="text" id="c-num" placeholder="ex. 6064"></label>
    </div>
    <p class="aide">Le n° de compte (plan comptable des associations) sert à l'export pour le comptable. Il peut être ajouté plus tard.</p>
    <div class="pied"><button class="btn" data-fermer>Annuler</button><button class="btn principal" id="c-ok">Créer</button></div>`, (b, fermer) => {
    $('[data-fermer]', b).onclick = () => { fermer(); if (annule) annule(); };
    const valider = () => {
      const nom = $('#c-nom', b).value.trim();
      if (!nom) return;
      if (!D().categories.some(c => Logic.norm(c.nom) === Logic.norm(nom))) {
        modifier(`Catégorie créée : ${nom}`, d => d.categories.push({ nom, compte: $('#c-num', b).value.trim() }), { rendu: false });
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
      const totalParts = Logic.somme(parts.map(p => +p.montant || 0));
      if (Logic.cts(totalParts) > Logic.cts(total)) { toast(`La ventilation (${eur(totalParts)}) dépasse le montant de l'opération (${eur(total)}) : corrigez les montants.`); return; }
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

/** Bouton Par mois / Comparer deux années, en tête des deux vues de la synthèse. */
function choixAffichageSynthese() {
  return `<label class="champ"><span>Affichage</span><div class="segment">${[['mois', 'Par mois'], ['comparer', 'Comparer deux années']].map(([v, l]) => `<button data-synth-aff="${v}" class="${S.synth.affichage === v ? 'actif' : ''}">${l}</button>`).join('')}</div></label>`;
}

/** Totaux par catégorie sur une période : dépenses et recettes, N-1 à part. */
function totauxPeriode(du, au, auRattachement) {
  const r = R(), parCat = new Map();
  let dep = 0, rec = 0, n1Dep = 0, n1Rec = 0, nb = 0;
  // N-1 payés pendant la période suivante : comptent dans cette période (ligne « N-1 payé l'année suivante »)
  const ent = Logic.n1RattachesA(D().operations, r, D().categories, du, auRattachement || au);
  const cleN1 = (catN1() || {}).nom || 'N-1';
  for (const { part } of ent) {
    dep += Logic.cts(part.debit); rec += Logic.cts(part.credit);
    const e = parCat.get(cleN1) || { debit: 0, credit: 0 };
    e.debit += Logic.cts(part.debit); e.credit += Logic.cts(part.credit);
    parCat.set(cleN1, e);
  }
  for (const o of D().operations) {
    if (o.date < du || o.date > au) continue;
    nb++;
    for (const p of Logic.partsDe(o, r)) {
      if (estN1(p.categorie)) { n1Dep += Logic.cts(p.debit); n1Rec += Logic.cts(p.credit); continue; }
      dep += Logic.cts(p.debit); rec += Logic.cts(p.credit);
      const e = parCat.get(p.categorie) || { debit: 0, credit: 0 };
      e.debit += Logic.cts(p.debit); e.credit += Logic.cts(p.credit);
      parCat.set(p.categorie, e);
    }
  }
  const c = x => Logic.deCts(x);
  for (const e of parCat.values()) { e.debit = c(e.debit); e.credit = c(e.credit); }
  return { parCat, dep: c(dep), rec: c(rec), n1Dep: c(n1Dep), n1Rec: c(n1Rec), nb };
}

function pageComparaison() {
  const s = S.synth;
  const annees = anneesDisponibles();
  const choix = s.mode === 'scolaire' ? [...new Set(annees.flatMap(y => [y, y - 1]))].sort((a, b) => b - a) : annees;
  if (!choix.includes(s.anneeA)) s.anneeA = choix[0];
  if (!choix.includes(s.anneeB) || s.anneeB === s.anneeA) s.anneeB = choix.find(y => y < s.anneeA) || choix.find(y => y !== s.anneeA) || s.anneeA;
  const lib = y => s.mode === 'scolaire' ? `${y}-${y + 1}` : String(y);
  const pA = bornesPeriode(s.anneeA, s.mode), pB = bornesPeriode(s.anneeB, s.mode);
  // À période égale : si l'année la plus récente n'est pas finie, on arrête l'autre à la même date
  const derA = D().operations.filter(o => o.date >= pA.du && o.date <= pA.au).reduce((m, o) => o.date > m ? o.date : m, '');
  let auB = pB.au, noteEgal = '';
  const decal = s.anneeA - s.anneeB;
  if (s.egal && derA && derA < pA.au) {
    const d = (+derA.slice(0, 4) - decal) + derA.slice(4);
    auB = d.endsWith('-02-29') ? d.slice(0, 8) + '28' : d;
    noteEgal = `Comparaison à période égale : ${lib(s.anneeA)} est connue jusqu'au ${Logic.formatDate(derA)}, ${lib(s.anneeB)} est donc arrêtée au ${Logic.formatDate(auB)}.`;
  }
  const A = totauxPeriode(pA.du, pA.au), B = totauxPeriode(pB.du, auB, pB.au);
  const moisCouverts = (du, au) => new Set(D().operations.filter(o => o.date >= du && o.date <= au).map(o => o.date.slice(5, 7)));
  const mA = moisCouverts(pA.du, pA.au), mB = moisCouverts(pB.du, auB);
  const manquants = [...mA].filter(m => !mB.has(m)).sort().map(m => MOIS_LONG[+m - 1]);
  const alerteMois = manquants.length ? `${lib(s.anneeB)} n'a pas d'opérations en ${manquants.join(', ')} (${mB.size} mois contre ${mA.size} pour ${lib(s.anneeA)}) : la comparaison n'est pas encore représentative. Importez les relevés manquants.` : '';
  const champ = s.vue;
  const noms = [...new Set([...A.parCat.keys(), ...B.parCat.keys()])].filter(n => (A.parCat.get(n) || {})[champ] || (B.parCat.get(n) || {})[champ]);
  const val = (T, n) => (T.parCat.get(n) || {})[champ] || 0;
  noms.sort((x, y) => Math.max(val(A, y), val(B, y)) - Math.max(val(A, x), val(B, x)));
  const maxEcart = Math.max(1, ...noms.map(n => Math.abs(val(A, n) - val(B, n))));
  const cats = new Map(D().categories.map(c => [c.nom, c]));
  const pct = (a, b) => b ? ((a - b) / b * 100) : null;
  const fmtPct = x => x == null ? 'nouveau' : (x > 0 ? '+' : '') + x.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' %';
  // Pour les dépenses, une hausse est en rouge ; pour les recettes, une hausse est en vert
  const couleur = ecart => !ecart ? 'var(--gris)' : ((ecart > 0) === (champ === 'credit') ? 'var(--credit)' : 'var(--rouge)');
  const ligne = n => {
    const a = val(A, n), b = val(B, n), e = Logic.deCts(Logic.cts(a) - Logic.cts(b));
    const larg = Math.round(Math.abs(e) / maxEcart * 100);
    const n1 = estN1(n);
    return `<tr class="${n1 ? 'n1' : ''}"><td class="nom">${n === Logic.A_CLASSER ? '<span class="tag ocre" style="margin:0">À classer</span>' : n1 ? '<span class="tag n1" style="margin:0 6px 0 0">N-1</span>payé l\'année suivante' : h(n)}</td><td class="cpte">${h((cats.get(n) || {}).compte || '')}</td>
      <td class="num cellule" data-voir-cat="${h(n)}" data-voir-annee="${s.mode === 'civile' ? (n1 ? s.anneeB + 1 : s.anneeB) : ''}">${eur0(b)}</td>
      <td class="num cellule" data-voir-cat="${h(n)}" data-voir-annee="${s.mode === 'civile' ? (n1 ? s.anneeA + 1 : s.anneeA) : ''}"><strong>${eur0(a)}</strong></td>
      <td class="num" style="color:${couleur(e)}">${e ? (e > 0 ? '+' : '') + Logic.formatMontant(e) + ' €' : '='}</td>
      <td class="num" style="color:${couleur(e)}">${e ? fmtPct(pct(a, b)) : ''}</td>
      <td class="barre-ecart"><div class="${e < 0 ? 'neg' : 'pos'}"><span style="width:${larg}%;background:${couleur(e)}"></span></div></td></tr>`;
  };
  const resA = Logic.deCts(Logic.cts(A.rec) - Logic.cts(A.dep)), resB = Logic.deCts(Logic.cts(B.rec) - Logic.cts(B.dep));
  const carte = (titre, a, b, sens, sansPct) => {
    const e = Logic.deCts(Logic.cts(a) - Logic.cts(b));
    if (sansPct) b = b || 0;
    const c = !e ? 'var(--gris)' : ((e > 0) === (sens === 'credit') ? 'var(--credit)' : 'var(--rouge)');
    return `<div class="chiffre"><span>${titre}</span><strong>${eur(a)}</strong><em>${lib(s.anneeB)} : ${eur(b)} · <b style="color:${c}">${e > 0 ? '+' : ''}${Logic.formatMontant(e)} €${b && !sansPct ? ' (' + fmtPct(pct(a, b)) + ')' : ''}</b></em></div>`;
  };
  const totA = noms.reduce((t, n) => t + Logic.cts(val(A, n)), 0), totB = noms.reduce((t, n) => t + Logic.cts(val(B, n)), 0);
  return `<div class="entete"><h1>Comparer deux années<small>${h(D().nom)} · ${lib(s.anneeA)} comparée à ${lib(s.anneeB)}</small></h1><button class="btn principal" data-action="enregistrer-pdf">Enregistrer en PDF</button></div>
    <div class="entete-impression"><div><strong>${h(D().nom)}</strong> — ${s.vue === 'debit' ? 'Dépenses' : 'Recettes'} ${lib(s.anneeA)} comparées à ${lib(s.anneeB)}</div><div>document édité le ${new Date().toLocaleDateString('fr-FR')}</div></div>
    <div class="filtres">
      ${choixAffichageSynthese()}
      <label class="champ"><span>Période</span><div class="segment">${[['civile', 'Année civile'], ['scolaire', 'Année scolaire']].map(([v, l]) => `<button data-synth-mode="${v}" class="${s.mode === v ? 'actif' : ''}">${l}</button>`).join('')}</div></label>
      <label class="champ"><span>Année</span><select data-synth="anneeA">${choix.map(y => `<option value="${y}"${y === s.anneeA ? ' selected' : ''}>${lib(y)}</option>`).join('')}</select></label>
      <label class="champ"><span>comparée à</span><select data-synth="anneeB">${choix.filter(y => y !== s.anneeA).map(y => `<option value="${y}"${y === s.anneeB ? ' selected' : ''}>${lib(y)}</option>`).join('')}</select></label>
      <label class="champ"><span>Afficher</span><div class="segment">${[['debit', 'Dépenses'], ['credit', 'Recettes']].map(([v, l]) => `<button data-synth-vue="${v}" class="${s.vue === v ? 'actif' : ''}">${l}</button>`).join('')}</div></label>
      <label class="champ"><span>&nbsp;</span><label style="display:flex;gap:6px;align-items:center;padding:6px 0;color:var(--encre)"><input type="checkbox" data-synth-egal${s.egal ? ' checked' : ''}> À période égale</label></label>
    </div>
    ${choix.length < 2 ? '<div class="carte vide">Il faut au moins deux années d\'opérations pour comparer. Importez les relevés de l\'année précédente.</div>' : `
    <div class="chiffres">
      ${carte('Dépenses ' + lib(s.anneeA), A.dep, B.dep, 'debit')}
      ${carte('Recettes ' + lib(s.anneeA), A.rec, B.rec, 'credit')}
      ${carte('Résultat ' + lib(s.anneeA), resA, resB, 'credit', true)}
    </div>
    ${alerteMois ? `<div class="controle ko">⚠ ${h(alerteMois)}</div>` : ''}
    ${noteEgal ? `<p class="aide">${h(noteEgal)} <button class="lien" data-synth-egal-off>Comparer les années entières</button></p>` : ''}
    <div class="table-cadre" style="max-height:none"><table class="synthese">
      <thead><tr><th>Catégorie</th><th>N° cpte</th><th class="num">${lib(s.anneeB)}</th><th class="num">${lib(s.anneeA)}</th><th class="num">Écart</th><th class="num">%</th><th style="width:18%"></th></tr></thead>
      <tbody>${noms.map(ligne).join('') || `<tr><td colspan="7" class="vide">Aucune ${champ === 'debit' ? 'dépense' : 'recette'} sur ces périodes.</td></tr>`}
        <tr class="total"><td>Total</td><td></td><td class="num">${eur0(Logic.deCts(totB))}</td><td class="num">${eur0(Logic.deCts(totA))}</td>
          <td class="num">${totA - totB ? (totA > totB ? '+' : '') + Logic.formatMontant(Logic.deCts(totA - totB)) + ' €' : '='}</td><td class="num">${totB ? fmtPct(pct(totA, totB)) : ''}</td><td></td></tr>
        ${A.n1Dep || B.n1Dep || A.n1Rec || B.n1Rec ? `<tr class="n1"><td class="nom" style="font-weight:400"><span class="tag n1" style="margin:0 6px 0 0">N-1</span>payé dans l'année pour l'année d'avant (non compté)</td><td></td><td class="num">${eur0(champ === 'debit' ? B.n1Dep : B.n1Rec)}</td><td class="num">${eur0(champ === 'debit' ? A.n1Dep : A.n1Rec)}</td><td colspan="3"></td></tr>` : ''}
      </tbody></table></div>
    <p class="aide">Écart = ${lib(s.anneeA)} − ${lib(s.anneeB)}. En dépenses, une hausse apparaît en rouge ; en recettes, en vert. Cliquez sur un montant pour voir les opérations. Les catégories étant propres à chaque compte, la comparaison se fait toujours dans le compte choisi à gauche. Les montants N-1 comptent dans l'année qu'ils concernent.</p>`}`;
}

function pageSynthese() {
  if (S.synth.affichage === 'comparer') return pageComparaison();
  const s = S.synth, r = R();
  const annees = anneesDisponibles();
  if (!s.annee || (!annees.includes(s.annee) && !annees.includes(s.annee + 1))) s.annee = annees[0];
  const choixAnnees = s.mode === 'scolaire' ? [...new Set(annees.flatMap(y => [y, y - 1]))].sort((a, b) => b - a) : annees;
  const { du, au, mois } = bornesPeriode(s.annee, s.mode);
  const ops = D().operations.filter(o => o.date >= du && o.date <= au && (!s.compte || o.compte === s.compte));
  // N-1 payés l'année suivante : ils appartiennent à CETTE année
  const entrants = Logic.n1RattachesA(D().operations, r, D().categories, du, au);
  const entDep = Logic.somme(entrants.map(x => x.part.debit)), entRec = Logic.somme(entrants.map(x => x.part.credit));
  const entVue = s.vue === 'debit' ? entDep : entRec;
  const libSuiv = s.mode === 'scolaire' ? `${s.annee + 1}-${s.annee + 2}` : String(s.annee + 1);
  const libCour = s.mode === 'scolaire' ? `${s.annee}-${s.annee + 1}` : String(s.annee);
  const libPrec = s.mode === 'scolaire' ? `${s.annee - 1}-${s.annee}` : String(s.annee - 1);
  const table = new Map();
  let totDep = 0, totRec = 0, aClasser = 0, sansFact = 0, n1Dep = 0, n1Rec = 0;
  for (const o of ops) {
    totDep += o.debit || 0; totRec += o.credit || 0;
    for (const p of Logic.partsDe(o, r)) if (estN1(p.categorie)) { n1Dep += p.debit; n1Rec += p.credit; }
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
    if (estN1(a) !== estN1(b)) return estN1(a) ? -1 : 1;
    const ta = [...table.get(a).values()].reduce((x, y) => x + y, 0), tb = [...table.get(b).values()].reduce((x, y) => x + y, 0);
    return tb - ta;
  });
  const max = Math.max(1, ...noms.filter(n => !estN1(n)).flatMap(n => [...table.get(n).values()]));
  const cats = new Map(D().categories.map(c => [c.nom, c]));
  const totMois = mois.map(m => noms.reduce((t, n) => t + (table.get(n).get(m) || 0), 0));
  const nomsN1 = noms.filter(estN1);
  const totMoisHorsN1 = mois.map(m => noms.filter(n => !estN1(n)).reduce((t, n) => t + (table.get(n).get(m) || 0), 0));
  const ligneSynth = n => {
    const vals = mois.map(m => table.get(n).get(m) || 0);
    const tot = vals.reduce((a, b) => a + b, 0);
    const nbMois = vals.filter(v => v).length || 1;
    const n1 = estN1(n);
    const teinte = n1 ? '214,170,0' : [1, 3, 5].map(i => parseInt(espace().couleur.slice(i, i + 2), 16)).join(',');
    return `<tr class="${n1 ? 'n1' : ''}"><td class="nom">${n === Logic.A_CLASSER ? '<span class="tag ocre" style="margin:0">À classer</span>' : n1 ? `<span class="tag n1" style="margin:0 6px 0 0">N-1</span>${h(n.replace(/^N-1\s*/, '').replace(/^\((.*)\)$/, '$1') || 'Année précédente')}` : h(n)}</td><td class="cpte">${h((cats.get(n) || {}).compte || '')}</td>
      ${vals.map((v, i) => `<td class="num cellule" data-voir-cat="${h(n)}" data-voir-mois="${mois[i]}" style="${v && !n1 ? `background:rgba(${teinte},${(0.05 + 0.32 * v / max).toFixed(3)})` : ''}">${eur0(v)}</td>`).join('')}
      <td class="num cellule" data-voir-cat="${h(n)}" data-voir-mois=""><strong>${eur0(tot)}</strong></td><td class="num" style="color:var(--gris)">${eur0(tot / nbMois)}</td></tr>`;
  };
  const lib = s.mode === 'scolaire' ? `Année scolaire ${s.annee}-${s.annee + 1}` : `Année ${s.annee}`;
  return `<div class="entete"><h1>Synthèse par mois<small>${h(D().nom)} · ${lib}</small></h1><button class="btn principal" data-action="enregistrer-pdf">Enregistrer en PDF</button></div>
    <div class="entete-impression"><div><strong>${h(D().nom)}</strong> — ${s.vue === 'debit' ? 'Dépenses' : 'Recettes'} par mois et par catégorie · ${lib}</div><div>document édité le ${new Date().toLocaleDateString('fr-FR')}</div></div>
    <div class="filtres">
      ${choixAffichageSynthese()}
      <label class="champ"><span>Période</span><div class="segment">${[['civile', 'Année civile'], ['scolaire', 'Année scolaire']].map(([v, l]) => `<button data-synth-mode="${v}" class="${s.mode === v ? 'actif' : ''}">${l}</button>`).join('')}</div></label>
      <label class="champ"><span>Année</span><select data-synth="annee">${choixAnnees.map(y => `<option value="${y}"${y === s.annee ? ' selected' : ''}>${s.mode === 'scolaire' ? y + '-' + (y + 1) : y}</option>`).join('')}</select></label>
      ${D().comptes.length > 1 ? `<label class="champ"><span>Compte</span><select data-synth="compte">${optionsComptes(s.compte, 'Tous les comptes')}</select></label>` : ''}
      <label class="champ"><span>Afficher</span><div class="segment">${[['debit', 'Dépenses'], ['credit', 'Recettes']].map(([v, l]) => `<button data-synth-vue="${v}" class="${s.vue === v ? 'actif' : ''}">${l}</button>`).join('')}</div></label>
    </div>
    <div class="chiffres">
      <div class="chiffre"><span>Dépenses de ${libCour}</span><strong>${eur(totDep - n1Dep + entDep)}</strong>${entDep ? `<em>dont ${eur(entDep)} payés en ${libSuiv} (N-1)</em>` : ''}</div>
      <div class="chiffre"><span>Recettes de ${libCour}</span><strong style="color:var(--credit)">${eur(totRec - n1Rec + entRec)}</strong>${entRec ? `<em>dont ${eur(entRec)} encaissés en ${libSuiv} (N-1)</em>` : ''}</div>
      ${(() => { const res = (totRec - n1Rec + entRec) - (totDep - n1Dep + entDep); return `<div class="chiffre"><span>Résultat de ${libCour}</span><strong style="color:${res >= 0 ? 'var(--credit)' : 'var(--rouge)'}">${eur(res)}</strong><em>N-1 rattachés à leur année</em></div>`; })()}
      ${n1Dep || n1Rec ? `<div class="chiffre n1" data-voir-cat="${h((catN1() || {}).nom || '')}" data-voir-mois="" data-voir-annee="${s.mode === 'civile' ? s.annee : ''}" title="Voir ces opérations"><span>Payé en ${libCour} pour ${libPrec} (N-1)</span><strong>${eur(n1Dep)}</strong><em>dépensés · ${eur(n1Rec)} encaissés · comptés dans ${libPrec}</em></div>` : ''}
      <div class="chiffre ${aClasser ? 'alerte' : ''}" ${aClasser ? 'data-action="voir-aclasser"' : ''}><span>À classer sur la période</span><strong>${aClasser}</strong></div>
      <div class="chiffre"><span>Dépenses sans n° de facture</span><strong>${sansFact}</strong></div>
    </div>
    <div class="table-cadre" style="max-height:none"><table class="synthese">
      <thead><tr><th>Catégorie</th><th>N° cpte</th>${mois.map(m => `<th class="num">${MOIS_COURT[+m.slice(5, 7) - 1]}${s.mode === 'scolaire' ? ' ' + m.slice(2, 4) : ''}</th>`).join('')}<th class="num">Total</th><th class="num">Moy./mois</th></tr></thead>
      <tbody>${noms.length ? noms.filter(n => !estN1(n)).map(n => ligneSynth(n)).join('') : `<tr><td colspan="${mois.length + 4}" class="vide">Aucune ${s.vue === 'debit' ? 'dépense' : 'recette'} sur cette période.</td></tr>`}
      ${entVue ? `<tr class="n1"><td class="nom"><span class="tag n1" style="margin:0 6px 0 0">N-1</span>payé en ${libSuiv} pour ${libCour}</td><td></td><td colspan="${mois.length}" class="aide" style="text-align:center">rattaché à ${libCour}</td>
        <td class="num cellule" data-voir-cat="${h((catN1() || {}).nom || '')}" data-voir-mois="" data-voir-annee="${s.mode === 'civile' ? s.annee + 1 : ''}"><strong>${eur0(entVue)}</strong></td><td></td></tr>` : ''}
      ${noms.length || entVue ? `<tr class="total"><td>Total de ${libCour}</td><td></td>${totMoisHorsN1.map(v => `<td class="num">${eur0(v)}</td>`).join('')}<td class="num">${eur0(totMoisHorsN1.reduce((a, b) => a + b, 0) + entVue)}</td><td></td></tr>` : ''}
      ${nomsN1.length ? `<tr class="separation"><td colspan="${mois.length + 4}">Payé ou encaissé en ${libCour} mais concernant ${libPrec} : <strong>compté dans le résultat de ${libPrec}</strong>, pas dans celui-ci</td></tr>${nomsN1.map(n => ligneSynth(n)).join('')}` : ''}
      </tbody></table></div>
    <p class="aide">Cliquez sur un montant pour voir les opérations correspondantes. Une opération ventilée compte dans chacune de ses catégories. Les lignes <span class="tag n1" style="margin:0">N-1</span> (en jaune) comptent dans l'année qu'elles concernent : une dépense de ${libPrec} payée en ${libCour} s'ajoute au résultat de ${libPrec}, et une dépense de ${libCour} payée en ${libSuiv} s'ajoute à ${libCour}.</p>`;
}

// ---------------------------------------------------------------- prévisionnel ACEL
function espacesAcel() {
  const o = {};
  for (const id of B().espaces) o[id] = S.assos[id] ? S.assos[id].data : { operations: [], categories: [], regles: [] };
  return o;
}
function anneesPrevisionnel() {
  const ys = new Set();
  for (const e of Object.values(espacesAcel())) for (const o of e.operations) ys.add(+o.date.slice(0, 4));
  for (const k of ['budgets', 'budgetsRevises', 'arretes']) Object.keys(B()[k] || {}).forEach(y => ys.add(+y));
  if (!ys.size) ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}

function pagePrevisionnel() {
  const P = S.prev, b = B();
  if (!b) return '<div class="carte vide">Chargement…</div>';
  const annees = anneesPrevisionnel();
  if (!annees.includes(P.annee) && P.annee !== annees[0] + 1) {
    const opsYears = Object.values(espacesAcel()).flatMap(e => e.operations.map(o => +o.date.slice(0, 4)));
    P.annee = opsYears.length ? Math.max(...opsYears) : annees[0];
  }
  const y = P.annee;
  const onglets = `<div class="segment">${[['tableau', 'Budget et réalisé'], ['saisie', `Saisir les budgets ${y}`], ['postes', 'Postes et rattachements']].map(([v, l]) => `<button data-prev-onglet="${v}" class="${P.onglet === v ? 'actif' : ''}">${l}</button>`).join('')}</div>`;
  const entete = `<div class="entete"><h1>${h(groupe().titre)}<small>${h(groupe().sousTitre)} · année ${y}</small></h1>
      ${P.onglet === 'tableau' ? `<button class="btn principal" data-action="enregistrer-pdf">Enregistrer en PDF</button>` : ''}</div>
    <div class="filtres">
      <label class="champ"><span>Année</span><select data-prev-annee>${annees.map(a => `<option value="${a}"${a === y ? ' selected' : ''}>${a}</option>`).join('')}${annees.includes(y) ? `<option value="${annees[0] + 1}">${annees[0] + 1} (préparer)</option>` : `<option value="${y}" selected>${y} (préparer)</option>`}</select></label>
      <label class="champ"><span>Affichage</span>${onglets}</label>
    </div>`;
  if (P.onglet === 'postes') return entete + blocPostes();
  if (P.onglet === 'saisie') return entete + blocSaisieBudget(y);

  const r = Previsionnel.calculer(b, espacesAcel(), y);
  const sansPoste = Previsionnel.categoriesSansPoste(b, espacesAcel()).filter(x => ((b.rattachements || {})[x.espace] || {})[x.categorie] !== Previsionnel.EXCLU);
  const plusieurs = b.espaces.length > 1;
  const lib = { arretes: `Comptes arrêtés ${y} (saisis)`, finie: `Banque : année ${y} complète`, rythme: `Banque au ${Logic.formatDate(r.dateRef)} + reste de l'année au rythme de ${y - 1}`, budget: `Banque au ${Logic.formatDate(r.dateRef)} + reste de l'année selon le budget (${y - 1} pas assez importée en banque pour servir de modèle)`, aucune: 'Aucune opération ni compte arrêté pour cette année' }[r.methode];
  const pct = x => x == null || !isFinite(x) ? '' : (x > 0 ? '+' : '') + (x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
  const m = x => x == null ? '<span class="vide-val">—</span>' : Logic.formatMontant(x);
  const avecBudget = r.aBudget, colRev = avecBudget && r.revise;
  const enCours = r.source === 'banque' && r.methode !== 'finie' && r.methode !== 'aucune';
  const couleurEcart = (e, sens) => !e ? '' : ((e > 0) === (sens === 'produit') ? 'color:var(--credit)' : 'color:var(--rouge)');
  // Évolution : par rapport à l'année précédente (budget s'il y en a un, sinon réalisé)
  const evolDe = (val, prec) => val != null && prec ? (val - prec) / Math.abs(prec) : null;
  // Colonnes affichées
  const cols = [];
  if (avecBudget) cols.push({ t: `Budget ${y}`, v: l => l.budget });
  if (colRev) cols.push({ t: `Réactualisé${r.dateRevise ? '<br><small>' + Logic.formatDate(r.dateRevise) + '</small>' : ''}`, v: l => l.revise });
  cols.push({ t: `Réalisé ${y}<br><small>${r.source === 'arretes' ? 'comptes arrêtés' : r.dateRef ? 'banque au ' + Logic.formatDate(r.dateRef) : ''}</small>`, v: l => l.realise, fort: true });
  if (avecBudget) cols.push({ t: '% du budget', taux: true });
  if (enCours) cols.push({ t: `Estimé<br><small>fin ${y}</small>`, v: l => l.estime });
  if (avecBudget) cols.push({ t: `Écart<br><small>${enCours ? 'estimé' : 'réalisé'} − budget</small>`, ecart: true });
  cols.push({ t: `Évol.<br><small>${avecBudget ? 'budget' : 'réalisé'} / ${y - 1}</small>`, evol: true });
  cols.push({ t: `Réalisé ${y - 1}<br><small>${r.arretePrec ? 'comptes arrêtés' : 'banque'}</small>`, v: l => l.realisePrec });
  const cellule = (c, l, sens, total) => {
    if (c.taux) return total ? '<td></td>' : `<td class="num taux">${l.taux != null ? `<span class="jauge"><span style="width:${Math.min(100, Math.max(0, l.taux * 100))}%"></span></span>${Math.round(l.taux * 100)} %` : ''}</td>`;
    if (c.ecart) { const e = l.estime != null && l.reference != null ? Logic.deCts(Logic.cts(l.estime) - Logic.cts(l.reference)) : null; return `<td class="num" style="${couleurEcart(e, sens)}">${e ? (e > 0 ? '+' : '') + Logic.formatMontant(e) : ''}</td>`; }
    if (c.evol) return `<td class="num">${pct(evolDe(avecBudget ? l.reference : (enCours ? l.estime : l.realise), l.realisePrec))}</td>`;
    const v = c.v(l);
    return `<td class="num">${c.fort && !total ? `<strong>${m(v)}</strong>` : m(v)}</td>`;
  };
  const ligne = l => `<tr${l.poste.manuel ? ' class="manuel"' : ''}><td class="nom">${h(l.poste.nom)}${l.poste.manuel ? ' <span class="aide ecran-seul" style="margin:0">(sans banque)</span>' : ''}</td>${cols.map(c => cellule(c, l, l.poste.sens)).join('')}</tr>`;
  const extra = sens => {
    const out = [];
    const n1 = sens === 'charge' ? r.n1.charges : r.n1.produits;
    const nr = Logic.deCts(r.nonRattache.reduce((t, x) => t + Logic.cts(sens === 'charge' ? x.debit : x.credit), 0));
    const ligneX = (cls, titre, v) => `<tr class="${cls}"><td class="nom">${titre}</td>${cols.map(c => c.fort ? `<td class="num"><strong>${m(v)}</strong></td>` : (c.v && /Estimé/.test(c.t)) ? `<td class="num">${m(v)}</td>` : '<td></td>').join('')}</tr>`;
    if (n1) out.push(ligneX('n1', `<span class="tag n1" style="margin:0 6px 0 0">N-1</span>payé en ${y + 1} pour ${y}`, n1));
    if (nr) out.push(ligneX('alerte-ligne', `⚠ À classer ou sans poste <button class="lien ecran-seul" data-prev-onglet="postes">rattacher</button>`, nr));
    return out.join('');
  };
  const total = (t, libl, sens) => `<tr class="total"><td>${libl}</td>${cols.map(c => cellule(c, t, sens, true)).join('')}</tr>`;
  const res = r.resultat;
  const resLigne = `<tr class="resultat"><td>Résultat (produits − charges)</td>${cols.map(c => c.v ? `<td class="num">${m(c.v(res))}</td>` : '<td></td>').join('')}</tr>`;
  const carte = (t, v, sous) => `<div class="chiffre"><span>${t}</span><strong style="color:${v == null ? 'inherit' : v >= 0 ? 'var(--credit)' : 'var(--rouge)'}">${v == null ? '—' : eur(v)}</strong>${sous ? `<em>${sous}</em>` : ''}</div>`;
  const nbCols = cols.length + 1;
  return entete + `
    <div class="entete-impression"><div><strong>${h(espace().id.startsWith('acel-') ? 'ACEL Saint-Médard' : 'Les Jeunes de Saint-Médard')}</strong> — ${avecBudget ? 'Budget et réalisé' : 'Comptes'} ${y}</div><div>${h(lib)} · document édité le ${new Date().toLocaleDateString('fr-FR')}</div></div>
    <div class="chiffres">
      ${avecBudget ? carte(`Résultat prévu ${y}`, res.reference, colRev ? `budget réactualisé${r.dateRevise ? ' au ' + Logic.formatDate(r.dateRevise) : ''} · voté : ${res.budget == null ? '—' : eur(res.budget)}` : 'budget voté') : ''}
      ${carte(r.source === 'arretes' ? `Résultat ${y} (comptes arrêtés)` : `Résultat réalisé au ${Logic.formatDate(r.dateRef) || '—'}`, res.realise, r.source === 'banque' ? 'd\'après la banque' : '')}
      ${enCours ? carte(`Estimé fin ${y}`, res.estime, 'si la fin d\'année suit la méthode indiquée') : ''}
      ${carte(`Résultat ${y - 1}`, res.realisePrec, r.arretePrec ? 'comptes arrêtés' : 'd\'après la banque')}
    </div>
    <p class="aide ecran-seul"><strong>Réalisé :</strong> ${h(lib)}.${sansPoste.length ? ` <span class="tag rouge">${sansPoste.length} catégorie(s) sans poste</span> <button class="lien" data-prev-onglet="postes">les rattacher</button>` : ''}</p>
    ${!avecBudget ? `<div class="controle info ecran-seul">Pas de budget saisi pour ${y} : le tableau compare le réalisé à ${y - 1}. <button class="lien" data-prev-onglet="saisie">Saisir un budget ${y}</button></div>` : ''}
    <div class="table-cadre" style="max-height:none"><table class="synthese prev">
      <thead><tr><th>Poste</th>${cols.map(c => `<th class="num">${c.t}</th>`).join('')}</tr></thead>
      <tbody>
        <tr class="section"><td colspan="${nbCols}">PRODUITS</td></tr>
        ${r.lignes.filter(l => l.poste.sens === 'produit').map(ligne).join('')}${extra('produit')}
        ${total(r.produits, 'Total produits', 'produit')}
        <tr class="section"><td colspan="${nbCols}">CHARGES</td></tr>
        ${r.lignes.filter(l => l.poste.sens === 'charge').map(ligne).join('')}${extra('charge')}
        ${total(r.charges, 'Total charges', 'charge')}
        ${resLigne}
      </tbody></table></div>
    <p class="aide">Le réalisé vient des opérations bancaires${plusieurs ? ' des comptes 01 et 02' : ''}, regroupées par poste selon le rattachement des catégories ; les comptes arrêtés, s'ils sont saisis pour une année, remplacent les chiffres de la banque (ils comprennent provisions et écritures sans mouvement bancaire). Évolution = (${avecBudget ? 'budget' : 'réalisé'} ${y} − réalisé ${y - 1}) ÷ réalisé ${y - 1}.${avecBudget ? ' Pour une charge, un écart positif (en rouge) est un dépassement ; pour un produit, un écart positif (en vert) est une recette supplémentaire.' : ''}</p>`;
}

function blocSaisieBudget(y) {
  const b = B();
  const champ = (obj, id) => { const v = ((b[obj] || {})[y] || {})[id]; return v == null ? '' : String(v).replace('.', ','); };
  const dateRev = ((b.budgetsRevises || {})[y] || {})._date || '';
  const ligne = p => `<tr><td class="nom">${h(p.nom)}</td>
    ${['budgets', 'budgetsRevises', 'arretes'].map(o => `<td><input type="text" class="montant" data-prev-saisie="${o}" data-poste="${p.id}" value="${champ(o, p.id)}" placeholder="—"></td>`).join('')}</tr>`;
  const somme = (obj, sens) => b.postes.filter(p => p.sens === sens).reduce((t, p) => t + Logic.cts(((b[obj] || {})[y] || {})[p.id] || 0), 0);
  const tot = sens => `<tr class="total"><td>Total ${sens === 'produit' ? 'produits' : 'charges'}</td>${['budgets', 'budgetsRevises', 'arretes'].map(o => `<td class="num">${eur(Logic.deCts(somme(o, sens)))}</td>`).join('')}</tr>`;
  const res = o => Logic.deCts(somme(o, 'produit') - somme(o, 'charge'));
  const precs = [y - 1, y - 2].filter(a => Object.keys((b.budgets || {})[a] || {}).length || Object.keys((b.arretes || {})[a] || {}).length);
  return `<div class="carte">
    <h2>Budgets ${y}</h2>
    <p class="aide">Saisissez les montants annuels par poste. <strong>Budget voté</strong> : le budget de début d'année. <strong>Réactualisé</strong> : la version révisée en cours d'année (facultatif). <strong>Comptes arrêtés</strong> : les chiffres définitifs du comptable, une fois l'année close ; ils remplacent alors les chiffres de la banque dans le tableau.</p>
    ${precs.length ? `<div style="margin-bottom:10px">${precs.map(a => `<button class="btn petit" data-prev-copier="${a}">Partir du ${Object.keys((b.budgetsRevises || {})[a] || {}).length ? 'budget réactualisé' : 'budget'} ${a}</button>`).join(' ')}</div>` : ''}
    <div class="table-cadre" style="max-height:none"><table class="synthese saisie-budget">
      <thead><tr><th>Poste</th><th>Budget voté ${y}</th><th>Réactualisé ${y}<br><input type="date" data-prev-date-rev value="${dateRev}" title="Date de la réactualisation"></th><th>Comptes arrêtés ${y}</th></tr></thead>
      <tbody>
        <tr class="section"><td colspan="4">PRODUITS</td></tr>${b.postes.filter(p => p.sens === 'produit').map(ligne).join('')}${tot('produit')}
        <tr class="section"><td colspan="4">CHARGES</td></tr>${b.postes.filter(p => p.sens === 'charge').map(ligne).join('')}${tot('charge')}
        <tr class="resultat"><td>Résultat</td>${['budgets', 'budgetsRevises', 'arretes'].map(o => `<td class="num">${eur(res(o))}</td>`).join('')}</tr>
      </tbody></table></div></div>`;
}

function blocPostes() {
  const b = B(), esp = espacesAcel();
  const optPostes = (choisi) => `<option value="">— aucun poste —</option><option value="${Previsionnel.EXCLU}"${choisi === Previsionnel.EXCLU ? ' selected' : ''}>Exclu du budget (virements internes…)</option>` + ['produit', 'charge'].map(sens => `<optgroup label="${sens === 'produit' ? 'Produits' : 'Charges'}">${b.postes.filter(p => p.sens === sens && !p.manuel).map(p => `<option value="${p.id}"${p.id === choisi ? ' selected' : ''}>${h(p.nom)}</option>`).join('')}</optgroup>`).join('');
  const colonne = id => {
    const e = esp[id], ratt = (b.rattachements || {})[id] || {};
    const cats = e.categories.filter(c => c.type !== 'n-1');
    const esp0 = ASSOS.find(a => a.id === id);
    return `<div class="carte" style="border-top:5px solid ${esp0.couleur}">
      <h2>${h(esp0.nom)} · ${h(esp0.sous)}</h2>
      ${cats.length ? `<table class="liste"><thead><tr><th>Catégorie</th><th>Poste du budget</th></tr></thead><tbody>
        ${cats.map(c => `<tr class="${ratt[c.nom] ? '' : 'sans-poste'}"><td>${h(c.nom)}</td><td><select data-prev-ratt="${id}" data-cat="${h(c.nom)}">${optPostes(ratt[c.nom])}</select></td></tr>`).join('')}
      </tbody></table>` : '<p class="aide">Aucune catégorie dans ce compte pour l\'instant.</p>'}
    </div>`;
  };
  return `<p class="aide">Chaque catégorie ${B().espaces.length > 1 ? 'de chaque compte ' : ''}est rattachée à un poste du budget : c'est ce qui permet de calculer le réalisé par poste. Une catégorie sans poste apparaît en rouge et son montant dans la ligne « Catégories sans poste ». La catégorie N-1 n'a pas de poste : ses montants comptent dans l'année qu'ils concernent.</p>
    <div class="${B().espaces.length > 1 ? 'grille2' : ''}">${B().espaces.map(colonne).join('')}</div>
    <div class="carte" style="margin-top:18px">
      <h2>Postes du budget</h2>
      <p class="aide">« Sans banque » : poste sans mouvement bancaire (provisions, départ en retraite), saisi seulement dans les budgets et les comptes arrêtés.</p>
      <table class="liste"><thead><tr><th>Poste</th><th>Sens</th><th>Sans banque</th><th></th></tr></thead><tbody>
        ${b.postes.map((p, i) => `<tr><td><input type="text" data-prev-poste-nom="${i}" value="${h(p.nom)}"></td>
          <td><select data-prev-poste-sens="${i}"><option value="produit"${p.sens === 'produit' ? ' selected' : ''}>Produit</option><option value="charge"${p.sens === 'charge' ? ' selected' : ''}>Charge</option></select></td>
          <td><input type="checkbox" data-prev-poste-manuel="${i}"${p.manuel ? ' checked' : ''}></td>
          <td><button class="btn petit danger" data-prev-poste-suppr="${i}" title="Supprimer ce poste">✕</button></td></tr>`).join('')}
      </tbody></table>
      <div style="margin-top:8px"><button class="btn petit" data-action="prev-ajouter-poste">＋ Ajouter un poste</button></div>
    </div>`;
}

// ---------------------------------------------------------------- reste disponible (chaque espace)
function anneesOps(data) {
  const ys = [...new Set(data.operations.map(o => +o.date.slice(0, 4)))].sort((a, b) => b - a);
  return ys.length ? ys : [new Date().getFullYear()];
}
function pageTresorerie() {
  const d = D(), T = S.treso;
  const annees = anneesOps(d);
  if (!annees.includes(T.annee)) T.annee = annees[0];
  const y = T.annee, p = d.tresorerie || { moisReserve: 1, marge: 0 };
  const hab = new Set(d.categories.filter(c => c.habituelle).map(c => c.nom));
  const r = Tresorerie.resteDisponible(d, y, { habituelles: hab, moisReserve: p.moisReserve, marge: p.marge });
  const der = r.lignes[r.lignes.length - 1];
  const m = x => x == null ? '<span class="vide-val">—</span>' : Logic.formatMontant(x);
  const couleur = v => v == null ? '' : v >= 0 ? 'color:var(--credit)' : 'color:var(--rouge)';
  const carte = (t, v, sous, fort) => `<div class="chiffre${fort ? ' fort' : ''}"><span>${t}</span><strong style="${fort ? couleur(v) : ''}">${v == null ? '—' : eur(v)}</strong>${sous ? `<em>${sous}</em>` : ''}</div>`;
  const moisRes = +p.moisReserve || 0;
  const explRes = `${moisRes ? `${String(moisRes).replace('.', ',')} mois de dépenses habituelles` : 'aucun mois gardé'}${+p.marge ? ` + marge de ${eur(+p.marge)}` : ''}`;
  const lignes = r.lignes.map(l => `<tr${l.enCours ? ' class="en-cours"' : ''}>
      <td class="nom">${h(l.libelle)}${l.enCours ? ` <span class="tag">au ${Logic.formatDate(r.derniere)}</span>` : ''}</td>
      <td class="num">${m(l.debut)}</td><td class="num credit">${m(l.recettes)}</td><td class="num">${m(l.habituelles)}</td><td class="num">${m(l.autres)}</td>
      <td class="num"><strong>${m(l.fin)}</strong></td><td class="num">${m(l.reserve)}</td>
      <td class="num disponible" style="${couleur(l.disponible)}"><strong>${m(l.disponible)}</strong></td></tr>`).join('');
  const cats = d.categories.filter(c => c.type !== 'n-1');
  return `<div class="entete"><h1>Reste disponible<small>${h(espace().nom)} · ${h(espace().sous)} · ${y}</small></h1><button class="btn principal" data-action="enregistrer-pdf">Enregistrer en PDF</button></div>
    <div class="filtres">
      <label class="champ"><span>Année</span><select data-treso-annee>${annees.map(a => `<option value="${a}"${a === y ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
      <label class="champ"><span>Mois de dépenses habituelles à garder</span><input type="text" class="montant court" data-treso-param="moisReserve" value="${String(p.moisReserve == null ? 1 : p.moisReserve).replace('.', ',')}"></label>
      <label class="champ"><span>Marge de sécurité en plus (€)</span><input type="text" class="montant" data-treso-param="marge" value="${p.marge ? String(p.marge).replace('.', ',') : ''}" placeholder="0"></label>
    </div>
    <div class="entete-impression"><div><strong>${h(espace().titre || espace().nom)}</strong> — Reste disponible ${y}</div><div>Réserve : ${h(explRes)} · document édité le ${new Date().toLocaleDateString('fr-FR')}</div></div>
    ${!r.soldeConnu ? `<div class="controle ko ecran-seul">Aucun solde bancaire connu : importez un relevé PDF (le solde y est lu) ou saisissez un solde de départ ci-dessous.</div>` : ''}
    ${der ? `<div class="chiffres">
      ${carte(`Solde ${der.enCours ? 'au ' + Logic.formatDate(r.derniere) : 'fin ' + der.libelle}`, der.fin, 'd\'après la banque')}
      ${carte('Dépenses habituelles / mois', der.moyenneHabituelles, 'moyenne des 6 derniers mois')}
      ${carte('Réserve à garder', der.reserve, h(explRes))}
      ${carte('Reste disponible', der.disponible, 'pour le matériel et les autres achats', true)}
    </div>` : '<div class="carte vide">Aucune opération pour cette année.</div>'}
    ${r.lignes.length ? `<div class="table-cadre" style="max-height:none"><table class="synthese treso">
      <thead><tr><th>Mois</th><th class="num">Solde début</th><th class="num">Recettes</th><th class="num">Dépenses habituelles</th><th class="num">Autres dépenses</th><th class="num">Solde fin</th><th class="num">Réserve</th><th class="num">Reste disponible</th></tr></thead>
      <tbody>${lignes}</tbody></table></div>` : ''}
    <p class="aide"><strong>Reste disponible</strong> = solde en fin de mois − réserve. La réserve met de côté ${h(explRes)} (moyenne des 6 derniers mois, pour lisser les dépenses trimestrielles comme le loyer). C'est l'argent qu'on peut utiliser pour du matériel ou d'autres achats sans gêner les salaires, les charges et les autres dépenses habituelles.</p>
    <div class="grille2 ecran-seul">
      <div class="carte"><h2>Dépenses habituelles</h2>
        <p class="aide">Cochez les catégories qui reviennent chaque mois ou chaque trimestre (salaires, charges, loyer…).</p>
        <div class="cases">${cats.map((c, i) => `<label><input type="checkbox" data-treso-hab="${h(c.nom)}"${c.habituelle ? ' checked' : ''}> ${h(c.nom)}</label>`).join('')}</div></div>
      <div class="carte"><h2>Solde de départ</h2>
        <p class="aide">Le solde vient des relevés PDF importés. Sans relevé, indiquez ici le solde du compte à une date (au soir de cette date).</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label class="champ"><span>Date</span><input type="date" data-treso-depart="date" value="${h((d.soldeDepart || {}).date || '')}"></label>
          <label class="champ"><span>Solde (€)</span><input type="text" class="montant" data-treso-depart="montant" value="${(d.soldeDepart || {}).montant != null ? String(d.soldeDepart.montant).replace('.', ',') : ''}"></label>
        </div></div>
    </div>`;
}

// ---------------------------------------------------------------- demandes de subvention (ACEL)
function subvAnnee(y, creer) {
  const b = B();
  if (!b.subventions) { if (!creer) return null; b.subventions = { entete: Object.assign({}, Tresorerie.ENTETE_ACEL), annees: {} }; }
  if (!b.subventions.annees[y] && creer) {
    const prec = b.subventions.annees[y - 1];
    b.subventions.annees[y] = Tresorerie.nouvelleSubvention(y, prec);
  }
  return b.subventions.annees[y] || null;
}
function anneesSubv() {
  const ys = new Set(anneesPrevisionnel());
  if (B().subventions) Object.keys(B().subventions.annees).forEach(y => ys.add(+y));
  ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}
const aujourdhui = () => new Date().toISOString().slice(0, 10);
function dateArreteSubv(sub, i) {
  const c01 = S.assos['acel-01'] ? S.assos['acel-01'].data : { operations: [] };
  const der = c01.operations.reduce((mx, o) => o.date > mx ? o.date : mx, '');
  const dm = sub.demandes[i];
  const voulu = dm.date || aujourdhui();
  return der && voulu > der ? der : voulu;
}
function planSubv(sub, y, i) {
  const c01 = S.assos['acel-01'].data;
  const arrete = dateArreteSubv(sub, i);
  return Tresorerie.planTresorerie(c01, y, { dateArrete: arrete, isolees: new Set(sub.isolees || []), previsions: sub.demandes[i].previsions || [], libelles: sub.demandes[i].libelles || {} });
}
function documentSubv(sub, y, i, plan) {
  const e = B().subventions.entete, dm = sub.demandes[i];
  const texte = dm.lettre != null ? dm.lettre : Tresorerie.texteLettre(sub, y, i, dateArreteSubv(sub, i));
  const para = texte.split(/\n\s*\n/).map(p => `<p>${h(p).replace(/\n/g, '<br>')}</p>`).join('');
  const m = x => x ? Logic.formatMontant(x) : '';
  let prevVue = false;
  const lignes = plan.lignes.map(l => {
    let sep = '';
    if (l.type === 'prevision' && !prevVue) { prevVue = true; sep = `<tr class="sep"><td colspan="4">Prévisions du ${Logic.formatDate(new Date(Date.parse(plan.dateArrete) + 86400000).toISOString().slice(0, 10))} au 31/12/${y}</td></tr>`; }
    return sep + `<tr class="${l.type}"><td>${h(l.libelle)}</td><td class="num">${m(l.recettes)}</td><td class="num">${m(l.depenses)}</td><td class="num">${l.solde == null ? '' : Logic.formatMontant(l.solde)}</td></tr>`;
  }).join('');
  const totR = plan.lignes.reduce((t, l) => t + Logic.cts(l.recettes || 0), 0), totD = plan.lignes.reduce((t, l) => t + Logic.cts(l.depenses || 0), 0);
  return `<div class="document-subv">
    <div class="feuille lettre">
      <div class="en-tete-lettre">
        <div class="expediteur"><strong>${h(e.nom)}</strong><br>${h(e.sous)}<br>${h(e.adresse).replace(/\n/g, '<br>')}<br>${e.tel ? 'Tél. ' + h(e.tel) + '<br>' : ''}${e.mail ? h(e.mail) + '<br>' : ''}${e.site ? h(e.site) + '<br>' : ''}${e.siret ? 'Siret ' + h(e.siret) : ''}</div>
        <div class="destinataire">${h(sub.organisme).replace(/\n/g, '<br>')}</div>
      </div>
      <div class="lieu-date">${h(e.ville || 'Paris')}, le ${h(Tresorerie.dateLongue(dm.date || aujourdhui()))}</div>
      <div class="objet"><strong>Objet :</strong> ${i === 0 ? 'Demande de subvention' : 'Demande du second versement de la subvention'} ${y}${dm.montant ? ' – ' + h(eurCourt(+dm.montant)) : ''}<br><strong>Pièce jointe :</strong> plan de trésorerie ${y}</div>
      <div class="corps">${para}</div>
      <div class="signature">${h(sub.signataire)}<br>${h(sub.qualite)}</div>
      ${sub.copies ? `<div class="copies"><strong>Copie à :</strong><br>${h(sub.copies).replace(/\n/g, '<br>')}</div>` : ''}
    </div>
    <div class="feuille plan">
      <h2>Plan de trésorerie ${y} au ${h(Tresorerie.dateLongue(plan.dateArrete))}</h2>
      <div class="sous-titre">${h(e.nom)} · ${h(compteNomDe('acel-01'))}</div>
      <table><thead><tr><th></th><th class="num">Recettes</th><th class="num">Dépenses</th><th class="num">Solde</th></tr></thead>
      <tbody>${lignes}</tbody>
      <tfoot><tr><td>Total ${y}</td><td class="num">${m(Logic.deCts(totR))}</td><td class="num">${m(Logic.deCts(totD))}</td><td class="num">${Logic.formatMontant(plan.soldeFinal)}</td></tr></tfoot></table>
      <p class="note">Réalisé d'après les relevés bancaires jusqu'au ${Logic.formatDate(plan.dateArrete)}${plan.ecartBanque === 0 ? ' (solde conforme au relevé)' : ''} ; au-delà, prévisions.${plan.lignes.some(l => /^Facturés/.test(l.libelle)) ? ` « Facturés au 31/12/${y - 1} » : sommes payées ou encaissées en ${y} qui concernent ${y - 1}.` : ''}</p>
    </div>
  </div>`;
}
const eurCourt = n => (n % 1 ? Logic.formatMontant(n) : Math.round(n).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')) + ' €';
const compteNomDe = id => (S.assos[id] && S.assos[id].data.comptes[0] || {}).nom || id;

function pageSubvention() {
  const b = B();
  if (!b || !S.assos['acel-01']) return '<div class="carte vide">Chargement…</div>';
  const V = S.subv, annees = anneesSubv();
  if (!annees.includes(V.annee)) V.annee = (b.subventions && Object.keys(b.subventions.annees).length) ? Math.max(...Object.keys(b.subventions.annees).map(Number)) : new Date().getFullYear();
  const y = V.annee, i = V.demande;
  const sub = subvAnnee(y, false);
  const entete = `<div class="entete"><h1>Demandes de subvention<small>ACEL · ${y}</small></h1>${sub ? `<button class="btn principal" data-action="subv-pdf">Enregistrer la demande en PDF</button>` : ''}</div>
    <div class="filtres">
      <label class="champ"><span>Année</span><select data-subv-annee>${annees.map(a => `<option value="${a}"${a === y ? ' selected' : ''}>${a}${b.subventions && b.subventions.annees[a] ? '' : ' (à créer)'}</option>`).join('')}</select></label>
      ${sub ? `<label class="champ"><span>Demande</span><div class="segment">${[0, 1].map(k => `<button data-subv-demande="${k}" class="${k === i ? 'actif' : ''}">${k ? '2e demande' : '1re demande'}${sub.demandes[k].montant ? ' · ' + Logic.formatMontant(+sub.demandes[k].montant) + ' €' : ''}</button>`).join('')}</div></label>` : ''}
    </div>`;
  if (!sub) return entete + `<div class="carte"><h2>Subvention ${y}</h2><p class="aide">Deux fois par an, l'ACEL demande à Avenir Censier une partie de la subvention votée en Assemblée générale : une lettre avec le montant voté et le plan de trésorerie comme justificatif.${b.subventions && b.subventions.annees[y - 1] ? ` Les informations de ${y - 1} (organisme, signataire, copies) seront reprises.` : ''}</p>
    <button class="btn principal" data-action="subv-creer">Préparer la subvention ${y}</button></div>`;
  const dm = sub.demandes[i];
  const e = b.subventions.entete;
  const plan = planSubv(sub, y, i);
  const trouves = Tresorerie.versementsTrouves({ 'acel-01': S.assos['acel-01'].data, 'acel-02': S.assos['acel-02'] ? S.assos['acel-02'].data : { operations: [] } }, y, sub.motcle);
  const recuTotal = trouves.reduce((t, v) => t + Logic.cts(v.op.credit), 0);
  const champ = (lib, k, val, type = 'text', cls = '') => `<label class="champ"><span>${lib}</span><input type="${type}" class="${cls}" data-subv="${k}" value="${h(val == null ? '' : type === 'text' && cls === 'montant' ? String(val).replace('.', ',') : val)}"></label>`;
  const champDm = (lib, k, val, type = 'text', cls = '') => `<label class="champ"><span>${lib}</span><input type="${type}" class="${cls}" data-subv-dm="${k}" value="${h(val == null ? '' : cls === 'montant' ? String(val).replace('.', ',') : val)}"></label>`;
  const zone = (lib, k, val, rows = 3) => `<label class="champ large"><span>${lib}</span><textarea rows="${rows}" data-subv="${k}">${h(val || '')}</textarea></label>`;
  const restant = sub.montantVote ? Logic.deCts(Logic.cts(+sub.montantVote) - Logic.cts(+(sub.demandes[0].montant || 0)) - Logic.cts(+(sub.demandes[1].montant || 0))) : null;
  const cats01 = S.assos['acel-01'].data.categories.filter(c => c.type !== 'n-1');
  const pvLignes = (dm.previsions || []).map((p, k) => ({ p, k })).sort((a, b2) => (a.p.date || '').localeCompare(b2.p.date || ''));
  const avant = pvLignes.filter(x => x.p.date && x.p.date <= plan.dateArrete).length;
  const fmt = v => v ? String(v).replace('.', ',') : '';
  return entete + `
    <div class="grille2 ecran-seul">
      <div class="carte"><h2>Subvention ${y} votée en AG</h2>
        <div class="champs">
          ${champ('Montant voté en AG (€)', 'montantVote', sub.montantVote, 'text', 'montant')}
          ${champ('Date de l\'AG et du CA', 'dateAG', sub.dateAG, 'date')}
          ${zone('Organisme (nom et adresse)', 'organisme', sub.organisme, 3)}
          ${champ('Objet de la subvention', 'objet', sub.objet, 'text', 'large-input')}
        </div>
        <h3>${i ? '2e demande' : '1re demande'}</h3>
        <div class="champs">
          ${champDm('Montant demandé (€)', 'montant', dm.montant, 'text', 'montant')}
          ${champDm('Date de la lettre', 'date', dm.date, 'date')}
          ${champDm('Versement prévu en', 'echeance', dm.echeance)}
        </div>
        ${restant != null && restant !== 0 ? `<div class="controle info">Il reste ${eur(restant)} du montant voté non réparti entre les deux demandes.</div>` : ''}
        <h3>Signature</h3>
        <div class="champs">${champ('Signataire', 'signataire', sub.signataire)}${champ('Qualité', 'qualite', sub.qualite)}${zone('Copie à (une personne par ligne)', 'copies', sub.copies, 3)}</div>
      </div>
      <div>
        <div class="carte"><h2>Versements reçus en banque</h2>
          <p class="aide">Opérations au crédit qui contiennent « ${h(sub.motcle)} » en ${y}. <label style="display:inline">Mot-clé : <input type="text" data-subv="motcle" value="${h(sub.motcle)}" style="width:150px"></label></p>
          ${trouves.length ? `<table class="liste"><thead><tr><th>Date</th><th>Libellé</th><th class="num">Montant</th><th>Catégorie</th></tr></thead><tbody>
            ${trouves.map(v => `<tr><td>${Logic.formatDate(v.op.date)}</td><td>${h(v.op.libelle)}<div class="aide" style="margin:0">${h(compteNomDe(v.espace))}</div></td><td class="num credit">${Logic.formatMontant(v.op.credit)}</td>
              <td>${/SUBV/.test(Logic.norm(v.categorie)) ? h(v.categorie) : `<span class="tag rouge">${h(v.categorie)}</span> <button class="btn petit" data-action="subv-classer" data-espace="${v.espace}" data-id="${v.op.id}">Classer en Subvention</button>`}</td></tr>`).join('')}
          </tbody></table>
          <div class="controle ${sub.montantVote && recuTotal >= Logic.cts(+sub.montantVote) ? 'ok' : 'info'}">Reçu en ${y} : ${eur(Logic.deCts(recuTotal))}${sub.montantVote ? ` sur ${eur(+sub.montantVote)} votés` : ''}.</div>`
          : '<p class="aide">Aucun versement trouvé pour l\'instant.</p>'}
        </div>
        <div class="carte" style="margin-top:18px"><h2>En-tête de la lettre</h2>
          <div class="champs">
            ${['nom', 'sous', 'tel', 'mail', 'site', 'siret', 'ville'].map(k => `<label class="champ"><span>${{ nom: 'Association', sous: 'Sous-titre', tel: 'Téléphone', mail: 'E-mail', site: 'Site', siret: 'Siret', ville: 'Ville (« Paris, le … »)' }[k]}</span><input type="text" data-subv-ent="${k}" value="${h(e[k] || '')}"></label>`).join('')}
            <label class="champ large"><span>Adresse</span><textarea rows="2" data-subv-ent="adresse">${h(e.adresse || '')}</textarea></label>
          </div></div>
      </div>
    </div>
    <div class="carte ecran-seul" style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2>Lettre</h2>${dm.lettre != null ? `<button class="lien" data-action="subv-lettre-auto">Revenir au texte automatique</button>` : '<span class="aide" style="margin:0">Texte automatique : il suit les montants et les dates saisis. Vous pouvez le modifier.</span>'}</div>
      <textarea class="lettre-texte" rows="12" data-subv-lettre>${h(dm.lettre != null ? dm.lettre : Tresorerie.texteLettre(sub, y, i, dateArreteSubv(sub, i)))}</textarea>
    </div>
    <div class="carte ecran-seul" style="margin-top:18px">
      <h2>Plan de trésorerie · ${h(compteNomDe('acel-01'))}</h2>
      <p class="aide">Réalisé lu en banque du 1er janvier au <strong>${Logic.formatDate(plan.dateArrete)}</strong> (date de la lettre, ou dernière opération importée), par trimestre ; les catégories cochées ci-dessous ont chacune leur ligne. Ensuite, les prévisions saisies (les lignes datées avant cette date ne sont pas reprises).</p>
      ${plan.ecartBanque != null && plan.ecartBanque !== 0 ? `<div class="controle ko">Le solde calculé diffère du solde bancaire de ${eur(plan.ecartBanque)} : vérifiez les relevés importés.</div>` : plan.soldeBanque != null ? `<div class="controle ok">Solde au ${Logic.formatDate(plan.dateArrete)} : ${eur(plan.soldeReel)}, conforme à la banque.</div>` : '<div class="controle ko">Solde bancaire inconnu : importez les relevés du compte 01.</div>'}
      <table class="liste previsions reel"><thead><tr><th>Réalisé (d'après la banque)</th><th>Opération</th><th class="num">Recettes</th><th class="num">Dépenses</th><th class="num">Solde</th></tr></thead><tbody>
        ${plan.lignes.filter(l => l.type !== 'prevision').map(l => `<tr><td><input type="text" data-subv-lib="${h(l.cle)}" value="${h(l.libelle)}" placeholder="${h(l.auto)}" title="Texte automatique : ${h(l.auto)}">${l.libelle !== l.auto ? `<button class="lien" data-subv-lib-auto="${h(l.cle)}" title="Revenir à « ${h(l.auto)} »">↺</button>` : ''}</td>
          <td class="aide" style="margin:0">${l.detail ? Logic.formatDate(l.date) + ' · ' + h(l.detail) : ''}</td>
          <td class="num credit">${l.recettes ? Logic.formatMontant(l.recettes) : ''}</td><td class="num">${l.depenses ? Logic.formatMontant(l.depenses) : ''}</td><td class="num">${l.solde == null ? '' : Logic.formatMontant(l.solde)}</td></tr>`).join('')}
      </tbody></table>
      <p class="aide">Les montants du réalisé viennent des relevés : pour les changer, corrigez la catégorie des opérations (page Opérations). Le texte de chaque ligne se modifie ici.</p>
      <div class="cases" style="margin:8px 0">Lignes à part : ${cats01.map(c => `<label><input type="checkbox" data-subv-isolee="${h(c.nom)}"${(sub.isolees || []).includes(c.nom) ? ' checked' : ''}> ${h(c.nom)}</label>`).join('')}</div>
      <table class="liste previsions"><thead><tr><th>Prévision</th><th>Date</th><th class="num">Recettes</th><th class="num">Dépenses</th><th></th></tr></thead><tbody>
        ${pvLignes.map(({ p, k }) => `<tr class="${p.date && p.date <= plan.dateArrete ? 'passee' : ''}"><td><input type="text" data-subv-pv="${k}:libelle" value="${h(p.libelle)}"></td><td><input type="date" data-subv-pv="${k}:date" value="${h(p.date || '')}"></td>
          <td><input type="text" class="montant" data-subv-pv="${k}:recettes" value="${fmt(p.recettes)}"></td><td><input type="text" class="montant" data-subv-pv="${k}:depenses" value="${fmt(p.depenses)}"></td>
          <td><button class="btn petit danger" data-subv-pv-suppr="${k}" title="Supprimer">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="aide">Aucune prévision. « Proposer » remplit le reste de l\'année d\'après la banque.</td></tr>'}
      </tbody></table>
      ${avant ? `<p class="aide">${avant} ligne(s) grisée(s) datée(s) avant le ${Logic.formatDate(plan.dateArrete)} : remplacée(s) par le réalisé.</p>` : ''}
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn" data-action="subv-proposer">Proposer les prévisions jusqu'au 31/12</button><button class="btn petit" data-action="subv-ajouter-pv">＋ Ajouter une ligne</button></div>
    </div>
    <h2 class="ecran-seul" style="margin:22px 0 8px">Aperçu du document à envoyer</h2>
    ${documentSubv(sub, y, i, plan)}`;
}

// ---------------------------------------------------------------- import
function pageImport() {
  const imp = S.imp;
  if (!imp.compte || !D().comptes.some(c => c.id === imp.compte)) imp.compte = D().comptes[0] ? D().comptes[0].id : '';
  const r = R();
  let aImporter = 0;
  // Doublons : comptés par rapport aux opérations déjà présentes ET aux relevés précédents de ce même import
  let base = D().operations.filter(o => o.compte === imp.compte);
  for (const rel of imp.releves) {
    if (rel.erreur) continue;
    rel.operations.forEach(o => { o.compte = imp.compte; });
    Logic.marquerDoublons(rel.operations, base);
    base = base.concat(rel.operations);
  }
  const blocs = imp.releves.map((rel, ri) => {
    if (rel.erreur) return `<div class="carte" style="margin-top:14px"><h2>${h(rel.nom)}</h2><div class="controle ko">${h(rel.erreur)}</div>
      ${rel.brut && rel.brut.length ? `<details><summary class="aide">Voir le texte lu dans le PDF</summary><pre style="font-size:11px;white-space:pre-wrap">${h(rel.brut.slice(0, 80).join('\n'))}</pre></details>` : ''}</div>`;
    const c = Logic.controleSoldes(rel);
    const dates = rel.operations.map(o => o.date).sort();
    rel.operations.forEach(o => {
      o._clos = estClos(o.date);
      if (o._garder == null) o._garder = !o._doublon && !o._clos;
      if (o._clos) o._garder = false;
      if (o._garder) aImporter++;
    });
    const nbD = rel.operations.filter(o => o._doublon === 'exact').length;
    const nbP = rel.operations.filter(o => o._doublon === 'probable').length;
    const nbC = rel.operations.filter(o => o._clos).length;
    return `<div class="carte" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2>${h(rel.nom)}</h2><button class="lien" data-action="retirer-releve" data-i="${ri}">Retirer</button></div>
      <div class="aide" style="margin:0">${rel.operations.length} opérations${dates.length ? ` du ${Logic.formatDate(dates[0])} au ${Logic.formatDate(dates[dates.length - 1])}` : ''}${nbD ? ` · <strong>${nbD} déjà présente(s)</strong>, décochée(s)` : ''}${nbP ? ` · <strong style="color:var(--rouge)">${nbP} doublon(s) probable(s)</strong> (même date et même montant, libellé différent), décoché(s) : à vérifier` : ''}${nbC ? ` · ${nbC} dans un exercice clôturé (non importables)` : ''}</div>
      ${c.messages.length ? c.messages.map(m => `<div class="controle ${c.ok ? 'ok' : 'ko'}">${c.ok ? '✔ ' : '⚠ '}${h(m)}</div>`).join('') : '<div class="controle info">Pas de solde de début et de fin trouvé : vérifiez le nombre d\'opérations.</div>'}
      <div class="table-cadre" style="max-height:420px;margin-top:8px"><table>
        <thead><tr><th><input type="checkbox" data-imp-tout="${ri}" ${rel.operations.every(o => o._garder) ? 'checked' : ''}></th><th>Date</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th><th>Catégorie proposée</th></tr></thead>
        <tbody>${rel.operations.map((o, oi) => {
          const a = Logic.autoCategorie(o, r);
          return `<tr class="${o._doublon || o._clos ? 'doublon' : ''}"><td><input type="checkbox" data-imp="${ri}:${oi}" ${o._garder ? 'checked' : ''} ${o._clos ? 'disabled' : ''}></td>
            <td class="date">${Logic.formatDate(o.date)}</td>
            <td class="lib"><div class="l1">${h(o.libelle)}${o._doublon === 'exact' ? '<span class="tag ocre">déjà importée</span>' : ''}${o._doublon === 'probable' ? '<span class="tag rouge">doublon probable</span>' : ''}${o._clos ? '<span class="tag">exercice clôturé</span>' : ''}${o.anomalie ? `<span class="tag rouge">${h(o.anomalie)}</span>` : ''}</div>${o.details.length ? `<div class="l2">${h(o.details.join(' · '))}</div>` : ''}</td>
            <td class="num debit">${eur0(o.debit)}</td><td class="num credit">${eur0(o.credit)}</td>
            <td>${a ? (estN1(a.categorie) ? '<span class="tag n1" style="margin:0">N-1</span> ' : '') + h(a.categorie) : '<span class="tag ocre" style="margin:0">À classer</span>'}</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
  }).join('');
  return `<div class="entete"><h1>Importer un relevé<small>${h(D().nom)}</small></h1></div>
    <div class="grille2">
      <div class="carte">
        <h2>Relevé PDF de la banque</h2>
        <p class="aide">Les opérations seront importées dans <strong>${h(espace().nom)} · ${h(espace().sous)}</strong>. Vérifiez que le relevé est bien celui de ce compte.</p>
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
      <button class="btn" data-action="vider-import">Annuler</button><button class="btn" style="background:#fff;color:var(--vert);font-weight:600" data-action="importer" ${aImporter ? '' : 'disabled'}>Importer</button></div>` : ''}
    ${imp.releves.length ? '' : blocReleves()}`;
}

/** Contrôle d'un relevé importé : opérations rattachées, totaux, soldes, rapprochement. */
function etatReleve(rel) {
  const d = D();
  const ops = d.operations.filter(o => o.releve === rel.id);
  const debits = Logic.somme(ops.map(o => o.debit)), credits = Logic.somme(ops.map(o => o.credit));
  const rap = Logic.rapprochement(d.releves, d.operations, rel.compte).find(l => l.releve.id === rel.id);
  const pbs = [];
  if (rap && rap.ecart) pbs.push(`écart de ${eur(rap.ecart)} avec le solde de fin`);
  if (rap && rap.rupture) pbs.push(`ne suit pas le relevé précédent (${eur(rap.rupture)})`);
  if (rel.totauxReleve && (Logic.cts(rel.totauxReleve.debit) !== Logic.cts(debits) || Logic.cts(rel.totauxReleve.credit) !== Logic.cts(credits)))
    pbs.push(`totaux du relevé : ${eur(rel.totauxReleve.debit)} / ${eur(rel.totauxReleve.credit)}`);
  const controle = rel.soldeDebut != null && rel.soldeFin != null;
  return { ops, debits, credits, rap, pbs, controle, ok: controle && !pbs.length };
}

function etiquetteControle(e) {
  if (e.pbs.length) return `<span class="tag rouge">⚠ ${h(e.pbs.join(' ; '))}</span>`;
  if (e.controle) return '<span class="tag">✔ soldes concordants</span>';
  return '<span class="tag ocre">non contrôlé (pas de soldes)</span>';
}

/** Bandeau en tête de la liste quand on regarde les opérations d'un seul relevé. */
function bandeauReleve(id) {
  const rel = D().releves.find(r => r.id === id);
  if (!rel) return '';
  const e = etatReleve(rel);
  return `<div class="carte releve-verif">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
      <h2 style="margin:0">Relevé « ${h(rel.nom)} »</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${rel.fichier ? `<button class="btn petit" data-action="ouvrir-pdf" data-releve="${rel.id}">Ouvrir le PDF pour comparer</button>` : ''}
        <button class="btn petit ${rel.verifie ? '' : 'principal'}" data-action="verifier-releve" data-releve="${rel.id}">${rel.verifie ? 'Annuler « vérifié »' : '✔ Marquer comme vérifié'}</button>
        <button class="btn petit danger" data-action="supprimer-releve" data-releve="${rel.id}">Supprimer ce relevé</button>
        <button class="btn petit" data-action="raz-filtres">Fermer</button>
      </div>
    </div>
    <div class="releve-chiffres">
      <div><span>Période</span><strong>${Logic.formatDate(rel.du)} → ${Logic.formatDate(rel.au)}</strong></div>
      <div><span>Opérations</span><strong>${e.ops.length}${rel.nbLu != null && rel.nbLu !== e.ops.length ? ` <small>(${rel.nbLu} lues dans le relevé)</small>` : ''}</strong></div>
      <div><span>Solde de début</span><strong>${rel.soldeDebut != null ? eur(rel.soldeDebut) : '—'}</strong></div>
      <div><span>Débits</span><strong>${eur(e.debits)}</strong></div>
      <div><span>Crédits</span><strong>${eur(e.credits)}</strong></div>
      <div><span>Solde de fin</span><strong>${rel.soldeFin != null ? eur(rel.soldeFin) : '—'}</strong></div>
    </div>
    <div>${etiquetteControle(e)} ${rel.verifie ? `<span class="tag">vérifié par ${h(rel.verifie.par || '?')} le ${new Date(rel.verifie.le).toLocaleDateString('fr-FR')}</span>` : ''}</div>
    <p class="aide" style="margin:8px 0 0">Pour vérifier : ouvrez le PDF et comparez ligne par ligne (date, montant, sens). Les opérations sont ici dans l'ordre du relevé. Le contrôle des soldes garantit déjà que le total est juste ; la comparaison visuelle vérifie chaque ligne.</p>
  </div>`;
}

/** Liste des relevés importés : contrôle, vérification, PDF, suppression. */
function blocReleves() {
  const d = D();
  if (!d.releves.length) return '';
  const sa = Logic.soldeActuel(d.releves, d.operations, d.comptes[0].id);
  const liste = d.releves.slice().sort((a, b) => (b.au || '').localeCompare(a.au || '') || (b.importe || '').localeCompare(a.importe || ''));
  const etats = liste.map(r => [r, etatReleve(r)]);
  const nbPb = etats.filter(([, e]) => e.pbs.length).length;
  const nbVerif = liste.filter(r => r.verifie).length;
  let anneeCourante = null;
  const lignes = etats.map(([r, e]) => {
    const y = (r.au || '').slice(0, 4);
    const titre = y !== anneeCourante ? `<tr class="annee"><td colspan="8">${y}${d.clotures.includes(+y) ? ' 🔒 clôturé' : ''}</td></tr>` : '';
    anneeCourante = y;
    return titre + `<tr>
      <td><button class="lien" data-action="voir-releve" data-releve="${r.id}">${h(r.nom)}</button><div class="aide" style="margin:0">importé le ${r.importe ? new Date(r.importe).toLocaleDateString('fr-FR') : '?'}${r.par ? ' par ' + h(r.par) : ''}</div></td>
      <td class="date">${Logic.formatDate(r.du)} → ${Logic.formatDate(r.au)}</td>
      <td class="num">${e.ops.length}</td>
      <td class="num">${eur(e.debits)}</td><td class="num">${eur(e.credits)}</td>
      <td>${etiquetteControle(e)}</td>
      <td>${r.verifie ? `<span class="tag" title="le ${new Date(r.verifie.le).toLocaleDateString('fr-FR')}">✔ ${h(r.verifie.par || '')}</span>` : '<span class="aide" style="margin:0">à vérifier</span>'}</td>
      <td class="actions-releve"><button class="btn petit" data-action="voir-releve" data-releve="${r.id}">Vérifier</button>${r.fichier ? `<button class="btn petit" data-action="ouvrir-pdf" data-releve="${r.id}">PDF</button>` : ''}<button class="btn petit danger" data-action="supprimer-releve" data-releve="${r.id}" title="Supprimer ce relevé et ses opérations">Supprimer</button></td></tr>`;
  }).join('');
  return `<div class="carte" style="margin-top:18px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
      <h2 style="margin:0">Relevés importés (${liste.length})</h2>
      <div>${sa ? `<span class="tag ${sa.solde < 0 ? 'rouge' : ''}">Solde au ${Logic.formatDate(sa.date)} : ${eur(sa.solde)}</span>` : ''}
        ${nbPb ? `<span class="tag rouge">${nbPb} anomalie(s)</span>` : '<span class="tag">rapprochement : tout concorde</span>'}
        <span class="tag ${nbVerif < liste.length ? 'ocre' : ''}">${nbVerif}/${liste.length} vérifié(s)</span></div>
    </div>
    <p class="aide">Chaque relevé doit retomber exactement sur son solde de fin et reprendre le solde de fin du précédent. Cliquez sur « Vérifier » pour comparer ses opérations au PDF d'origine, puis marquez-le comme vérifié. Un relevé importé par erreur se supprime avec toutes ses opérations.</p>
    <div class="table-cadre" style="max-height:520px"><table>
      <thead><tr><th>Relevé</th><th>Période</th><th class="num">Opér.</th><th class="num">Débits</th><th class="num">Crédits</th><th>Contrôle</th><th>Vérifié</th><th></th></tr></thead>
      <tbody>${lignes}</tbody></table></div></div>`;
}

async function supprimerReleve(id) {
  const rel = D().releves.find(r => r.id === id);
  if (!rel) return;
  const ops = D().operations.filter(o => o.releve === id);
  if (verrou(ops)) return;
  const travail = ops.filter(o => o.categorie || o.facture || o.note || (o.ventilation && o.ventilation.length)).length;
  if (!confirm(`Supprimer le relevé « ${rel.nom} » et ses ${ops.length} opération(s) ?${travail ? `\n\nAttention : ${travail} opération(s) ont déjà été classées à la main, ont un n° de facture, une note ou une ventilation ; ce travail sera perdu (une copie reste dans la corbeille du fichier).` : ''}\n\nVous pourrez ensuite réimporter le bon relevé.`)) return;
  const ids = new Set(ops.map(o => o.id));
  modifier(`Relevé supprimé : ${rel.nom} (${Logic.formatDate(rel.du)} → ${Logic.formatDate(rel.au)}, ${ops.length} opérations, débits ${Logic.formatMontant(Logic.somme(ops.map(o => o.debit)))} €, crédits ${Logic.formatMontant(Logic.somme(ops.map(o => o.credit)))} €)`, d => {
    d.corbeille = (d.corbeille || []).concat(ops.map(o => Object.assign({}, o, { supprimeLe: new Date().toISOString(), supprimePar: S.config.utilisateur || '' }))).slice(-2000);
    d.operations = d.operations.filter(o => !ids.has(o.id));
    d.releves = d.releves.filter(r => r.id !== id);
    // soldes de ce relevé, s'ils ne servent plus à aucun autre relevé
    const autres = d.releves.filter(r => r.compte === rel.compte);
    d.soldes = d.soldes.filter(x => !(x.compte === rel.compte && (x.date === rel.du || x.date === rel.au) && !autres.some(r => r.du === x.date || r.au === x.date)));
  }, { rendu: false });
  if (rel.fichier) api.retirerReleve(rel.fichier).catch(() => {});
  if (S.f.releve === id) S.f = filtres({});
  S.selection.clear();
  rendu();
  toast(`Relevé supprimé (${ops.length} opérations). Vous pouvez réimporter le bon relevé.`);
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

async function importer() {
  const imp = S.imp;
  const maintenant = new Date().toISOString();
  const nouvelles = [];
  const releves = [];
  const soldes = [];
  for (const rel of imp.releves) {
    if (rel.erreur) continue;
    const kept = rel.operations.filter(o => o._garder && !o._clos);
    if (!kept.length) continue;
    // Le relevé est mémorisé avec ses soldes : il sert au rapprochement bancaire (page Importer)
    const sol = (rel.soldes || []).filter(x => x.date);
    const dates = rel.operations.map(o => o.date).sort();
    const releve = {
      id: nouvelId(), compte: imp.compte, nom: rel.nom, importe: maintenant, par: S.config.utilisateur || '',
      du: sol.length >= 2 ? sol[0].date : dates[0], au: sol.length >= 2 ? sol[sol.length - 1].date : dates[dates.length - 1],
      soldeDebut: sol.length >= 2 ? sol[0].montant : null, soldeFin: sol.length >= 2 ? sol[sol.length - 1].montant : null,
      nbLu: rel.operations.length, nbImporte: kept.length,
      totauxReleve: rel.totaux || null,
    };
    // copie du PDF d'origine dans le dossier des données, pour pouvoir le rouvrir et comparer
    if (rel.cheminSource) {
      try { releve.fichier = await api.archiverReleve(rel.cheminSource, espace().nom, (releve.du || '').slice(0, 4), rel.nom); } catch { /* pas bloquant */ }
    }
    releves.push(releve);
    for (const o of kept) {
      nouvelles.push({ id: nouvelId(), compte: imp.compte, date: o.date, dateValeur: o.dateValeur || null, libelle: o.libelle, details: o.details || [],
        debit: o.debit || 0, credit: o.credit || 0, moyen: o.moyen || Logic.detectMoyen(o.libelle), importe: maintenant, source: rel.nom, releve: releve.id });
    }
    for (const x of sol) soldes.push({ compte: imp.compte, date: x.date, montant: x.montant });
  }
  if (!nouvelles.length) return;
  modifier(`Import de ${nouvelles.length} opération(s) dans ${compteNom(imp.compte)} (${releves.map(r => r.nom).join(', ')})`, d => {
    d.operations.push(...nouvelles);
    d.releves.push(...releves);
    for (const x of soldes) if (!d.soldes.some(y => y.compte === x.compte && y.date === x.date)) d.soldes.push(x);
  }, { rendu: false });
  const r = R();
  const aClasser = nouvelles.filter(o => Logic.categorieDe(o, r) === Logic.A_CLASSER).length;
  const moisImp = [...new Set(nouvelles.map(o => Logic.moisDe(o.date)))];
  S.imp.releves = [];
  S.f = filtres({ compte: imp.compte, mois: moisImp.length === 1 ? moisImp[0] : '', categorie: aClasser ? Logic.A_CLASSER : '', recherche: '', sens: 'tout', sansFacture: false, annee: '' });
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
          <thead><tr><th>Nom</th><th>N° compte</th><th class="num">Opérations</th><th></th></tr></thead>
          <tbody>${D().categories.map((c, i) => `<tr class="${c.type === 'n-1' ? 'n1' : ''}">
            <td><input type="text" data-cat-nom="${i}" value="${h(c.nom)}"></td>
            <td><input type="text" class="numero" data-cat-num="${i}" value="${h(c.compte || '')}" placeholder="—"></td>
            <td class="num"><button class="lien" data-voir-cat="${h(c.nom)}" data-voir-mois="">${usage.get(c.nom) || 0}</button></td>
            <td>${c.type === 'n-1' ? '<span class="tag n1" title="Catégorie spéciale : compte dans le résultat de l\'année précédente">N-1</span>' : `<button class="btn petit danger" data-cat-suppr="${i}" title="Supprimer">✕</button>`}</td></tr>`).join('')}</tbody></table></div>
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
  const closUtil = D().operations.filter(o => estClos(o.date) && (o.categorie === nom || (o.ventilation || []).some(p => p.categorie === nom)));
  if (closUtil.length) { toast(`Impossible : « ${nom} » est utilisée par ${closUtil.length} opération(s) d'un exercice clôturé. Vous pouvez la renommer.`); return; }
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
          <div class="chiffre"><span>Dépenses / recettes de l'exercice${res.n1Depenses || res.n1Recettes || res.n1Rattaches ? ' (N-1 rattachés à leur année)' : ''}</span><strong style="font-size:15px">${eur(res.depenses)} / ${eur(res.recettes)}</strong></div>
          ${res.n1Depenses || res.n1Recettes ? `<div class="chiffre n1"><span>Payé sur la période pour l'année précédente (N-1)</span><strong style="font-size:15px">${eur(res.n1Depenses)} / ${eur(res.n1Recettes)}</strong><em>compté dans l'année précédente, en jaune dans le fichier</em></div>` : ''}
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
        <h2>Compte bancaire de cet espace</h2>
        <p class="aide">Le n° de compte comptable (512…) est utilisé dans le journal de banque de l'export.</p>
        <table class="liste"><thead><tr><th>Nom</th><th>N° comptable</th></tr></thead><tbody>
          ${d.comptes.map((c, i) => `<tr><td><input type="text" data-compte-nom="${i}" value="${h(c.nom)}"></td><td><input type="text" class="numero" data-compte-num="${i}" value="${h(c.compteComptable || '')}"></td></tr>`).join('')}
        </tbody></table>
        <label class="champ" style="max-width:160px;margin-top:14px"><span>Code journal de banque</span><input type="text" data-asso-journal value="${h(d.journal || 'BQ')}"></label>
        <h2 style="margin-top:20px">Exercices (clôture)</h2>
        <p class="aide">Une fois les comptes d'une année validés, clôturez-la : ses opérations ne pourront plus être modifiées, supprimées ni réimportées, et un changement de règle ne les reclassera plus.</p>
        <table class="liste"><tbody>${anneesDisponibles().slice().sort().map(y => {
          const clos = d.clotures.includes(y);
          return `<tr><td><strong>${y}</strong></td><td>${clos ? '<span class="tag">🔒 clôturé</span>' : '<span class="aide" style="margin:0">ouvert</span>'}</td>
            <td style="text-align:right">${clos ? `<button class="btn petit" data-action="rouvrir" data-annee="${y}">Rouvrir</button>` : `<button class="btn petit" data-action="cloturer" data-annee="${y}">Clôturer ${y}</button>`}</td></tr>`;
        }).join('')}</tbody></table>
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
    S.f = filtres({ compte: '', mois: '', categorie: '', recherche: '', sens: 'tout', sansFacture: false });
    S.exp = { du: '', au: '', comptes: [] }; S.synth.compte = '';
    api.ecrireConfig({ derniereAsso: S.assoId });
    if (!S.assos[S.assoId]) await chargerAsso(S.assoId);
    if (S.page === 'subvention' && !S.assoId.startsWith('acel-')) S.page = 'operations';
    if (S.page === 'previsionnel' || S.page === 'subvention') {
      try { for (const id of groupe().espaces) if (!S.assos[id]) await chargerAsso(id); if (!B()) await chargerBudget(); }
      catch (e) { S.page = 'operations'; }
    }
    rendu(); verifierMiseAJour(); return;
  }
  if (ds.page) {
    S.page = ds.page; S.selection.clear();
    if (ds.page === 'previsionnel' || ds.page === 'subvention') {
      try {
        for (const id of groupe().espaces) if (!S.assos[id]) await chargerAsso(id);
        if (!B()) await chargerBudget();
      } catch (e) { toast('Impossible de charger le prévisionnel : ' + e.message); S.page = 'operations'; }
    }
    rendu(); $('#page').scrollTop = 0; return;
  }
  if (ds.sens) { S.f.sens = ds.sens; rendu(); return; }
  if (ds.synthMode) {
    S.synth.mode = ds.synthMode; S.synth.anneeA = S.synth.anneeB = null;
    const der = D().operations.reduce((m, o) => o.date > m ? o.date : m, '');
    if (der) { const y = +der.slice(0, 4), mo = +der.slice(5, 7); S.synth.annee = ds.synthMode === 'scolaire' ? (mo >= 9 ? y : y - 1) : y; }
    rendu(); return;
  }
  if (ds.synthVue) { S.synth.vue = ds.synthVue; rendu(); return; }
  if (ds.synthAff) { S.synth.affichage = ds.synthAff; rendu(); return; }
  if (ds.prevOnglet) { S.prev.onglet = ds.prevOnglet; rendu(); return; }
  if (ds.subvLibAuto != null) { const y = S.subv.annee, i = S.subv.demande; modifierBudget(null, d => { const dm = d.subventions.annees[y].demandes[i]; if (dm.libelles) delete dm.libelles[ds.subvLibAuto]; }); return; }
  if (ds.subvDemande != null) { S.subv.demande = +ds.subvDemande; rendu(); return; }
  if (ds.subvPvSuppr != null) { const y = S.subv.annee; modifierBudget('Subvention : prévision supprimée', d => { d.subventions.annees[y].demandes[S.subv.demande].previsions.splice(+ds.subvPvSuppr, 1); }); return; }
  if (ds.prevCopier) {
    const a = ds.prevCopier, y = S.prev.annee, b = B();
    const src = Object.keys((b.budgetsRevises || {})[a] || {}).some(k => !k.startsWith('_')) ? b.budgetsRevises[a] : (b.budgets[a] || {});
    if (Object.keys(b.budgets[y] || {}).length && !confirm(`Remplacer le budget voté ${y} déjà saisi par celui de ${a} ?`)) return;
    modifierBudget(`Budget ${y} repris du budget ${a}`, d => { d.budgets[y] = Object.fromEntries(Object.entries(src).filter(([k]) => !k.startsWith('_'))); });
    return;
  }
  if (ds.prevPosteSuppr) {
    const i = +ds.prevPosteSuppr, p = B().postes[i];
    if (!confirm(`Supprimer le poste « ${p.nom} » ? Les catégories qui y sont rattachées n'auront plus de poste.`)) return;
    modifierBudget(`Poste supprimé : ${p.nom}`, d => {
      d.postes.splice(i, 1);
      for (const id in d.rattachements) for (const c in d.rattachements[id]) if (d.rattachements[id][c] === p.id) delete d.rattachements[id][c];
    });
    return;
  }
  if (ds.synthEgalOff != null) { S.synth.egal = false; rendu(); return; }
  if (ds.voirCat != null) {
    S.f = filtres({ compte: S.page === 'synthese' ? S.synth.compte : '', mois: ds.voirMois || '', categorie: ds.voirCat, recherche: '', sens: S.page === 'synthese' ? S.synth.vue : 'tout', sansFacture: false, annee: ds.voirAnnee != null ? ds.voirAnnee : S.page === 'synthese' && !ds.voirMois ? (S.synth.mode === 'civile' ? String(S.synth.annee) : '') : undefined });
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
    case 'raz-filtres': S.f = filtres({ compte: '', mois: '', categorie: '', recherche: '', sens: 'tout', sansFacture: false }); rendu(); break;
    case 'voir-aclasser': S.f = filtres({ categorie: Logic.A_CLASSER, annee: '' }); S.page = 'operations'; rendu(); break;
    case 'voir-sansfacture': S.f = filtres({ sens: 'debit', sansFacture: true, annee: '' }); S.page = 'operations'; rendu(); break;
    case 'ouvrir': if (S.ouverts.has(op.id)) S.ouverts.delete(op.id); else S.ouverts.add(op.id); rendreTableOps(); break;
    case 'ventiler': if (!verrou([op])) dialogueVentilation(op); break;
    case 'note': if (!verrou([op])) dialogueNote(op); break;
    case 'confirmer-n1': if (verrou([op])) break; modifier(`N-1 : ${op.libelle} (${Logic.formatDate(op.date)})`, () => { op.categorie = catN1().nom; delete op.pasN1; }, { rendu: false }); rendreTableOps(); rendreBarre(); break;
    case 'refuser-n1': modifier(null, () => { op.pasN1 = true; }, { rendu: false }); rendreTableOps(); break;
    case 'voir-n1-propose': S.f = filtres({ categorie: N1_A_CONFIRMER, annee: '' }); S.page = 'operations'; rendu(); break;
    case 'vider-selection': S.selection.clear(); rendreTableOps(); break;
    case 'appliquer-selection': {
      const v = $('#cat-selection').value;
      if (!v) return;
      const ids = [...S.selection];
      if (verrou(D().operations.filter(o => S.selection.has(o.id)))) return;
      modifier(`${ids.length} opération(s) classée(s) en ${v === '__auto' ? 'automatique' : v}`, d => {
        d.operations.forEach(o => { if (S.selection.has(o.id)) { delete o.ventilation; if (v === '__auto') delete o.categorie; else o.categorie = v; } });
      }, { rendu: false });
      S.selection.clear(); rendu(); break;
    }
    case 'supprimer-selection': {
      const n = S.selection.size;
      const aSuppr = D().operations.filter(o => S.selection.has(o.id));
      if (verrou(aSuppr)) return;
      const rattachees = aSuppr.filter(o => o.releve).length;
      if (!confirm(`Supprimer définitivement ${n} opération(s) ?${rattachees ? `\n\nAttention : ${rattachees} proviennent d'un relevé importé ; le rapprochement bancaire signalera un écart.` : ''}`)) return;
      // Traçabilité : le détail de chaque opération supprimée est gardé dans l'historique
      modifier(`${n} opération(s) supprimée(s) : ` + aSuppr.map(o => `${Logic.formatDate(o.date)} ${o.libelle} ${o.debit ? '-' + Logic.formatMontant(o.debit) : '+' + Logic.formatMontant(o.credit)} €`).join(' ; '), d => {
        d.corbeille = (d.corbeille || []).concat(aSuppr.map(o => Object.assign({}, o, { supprimeLe: new Date().toISOString(), supprimePar: S.config.utilisateur || '' }))).slice(-500);
        d.operations = d.operations.filter(o => !S.selection.has(o.id));
      }, { rendu: false });
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
    case 'importer': t.disabled = true; importer(); break;
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
    case 'enregistrer-pdf': {
      const nomAsso = S.assoId.startsWith('acel-') ? (S.page === 'previsionnel' ? 'ACEL' : 'ACEL ' + espace().nom) : 'Les Jeunes de Saint-Médard';
      const titre = S.page === 'previsionnel' ? `${groupe().titre} ${S.prev.annee}` : S.page === 'tresorerie' ? `Reste disponible ${S.treso.annee}`
        : S.synth.affichage === 'comparer' ? `Comparaison ${S.synth.anneeA} - ${S.synth.anneeB}` : `Synthèse ${S.synth.annee}`;
      try {
        const chemin = await api.enregistrerPdf(`${nomAsso} - ${titre}.pdf`.replace(/[\\/:*?"<>|]/g, '-'));
        if (chemin) toast('PDF enregistré.', 'Ouvrir', () => api.ouvrir(chemin), 10000);
      } catch (err) { toast('Le PDF n\'a pas pu être créé : ' + err.message); }
      break;
    }
    case 'subv-creer': { const y = S.subv.annee; modifierBudget(`Subvention ${y} préparée`, () => { subvAnnee(y, true); }); break; }
    case 'subv-lettre-auto': { const y = S.subv.annee, i = S.subv.demande; modifierBudget(null, d => { d.subventions.annees[y].demandes[i].lettre = null; }); break; }
    case 'subv-ajouter-pv': { const y = S.subv.annee; modifierBudget(null, d => { (d.subventions.annees[y].demandes[S.subv.demande].previsions = d.subventions.annees[y].demandes[S.subv.demande].previsions || []).push({ id: nouvelId(), libelle: 'Nouvelle ligne', date: `${y}-12-31`, recettes: 0, depenses: 0 }); }); break; }
    case 'subv-proposer': {
      const y = S.subv.annee, i = S.subv.demande, sub = subvAnnee(y, false);
      const arrete = dateArreteSubv(sub, i);
      const futures = (sub.demandes[i].previsions || []).filter(p => !p.date || p.date > arrete);
      if (futures.length && !confirm(`Remplacer les ${futures.length} prévision(s) après le ${Logic.formatDate(arrete)} par une nouvelle proposition ?`)) break;
      const props = Tresorerie.proposerPrevisions(S.assos['acel-01'].data, y, arrete, sub).map(p => ({ id: nouvelId(), libelle: p.libelle, date: p.date, recettes: p.recettes, depenses: p.depenses }));
      modifierBudget(`Subvention ${y} : prévisions proposées après le ${Logic.formatDate(arrete)}`, d => {
        const dmd = d.subventions.annees[y].demandes[i];
        dmd.previsions = (dmd.previsions || []).filter(p => p.date && p.date <= arrete).concat(props);
      });
      toast(`${props.length} ligne(s) proposée(s) : vérifiez-les et corrigez si besoin.`);
      break;
    }
    case 'subv-classer': {
      const a = S.assos[ds.espace], o = a && a.data.operations.find(x => x.id === ds.id);
      if (!o) break;
      if ((a.data.clotures || []).includes(+o.date.slice(0, 4))) { toast(`Exercice ${o.date.slice(0, 4)} clôturé : rouvrez-le dans Paramètres.`); break; }
      if (!a.data.categories.some(c => c.nom === 'Subvention')) a.data.categories.push({ nom: 'Subvention', compte: '74' });
      o.categorie = 'Subvention'; delete o.ventilation;
      a.data.historique.unshift({ date: new Date().toISOString(), par: S.config.utilisateur || '', action: `Subvention : ${o.libelle} (${Logic.formatDate(o.date)})` });
      a.sale = true; _version++; planifierSauvegarde(); rendu();
      break;
    }
    case 'subv-pdf': {
      const y = S.subv.annee, i = S.subv.demande;
      const style = document.createElement('style');
      style.id = 'style-impression-document';
      style.textContent = '@page { size: A4 portrait; margin: 0; }';
      document.head.appendChild(style);
      document.body.classList.add('impression-document');
      try {
        const chemin = await api.enregistrerPdf(`ACEL - Demande de subvention ${y} - ${i ? '2e' : '1re'} demande.pdf`, { portrait: true });
        if (chemin) toast('PDF enregistré.', 'Ouvrir', () => api.ouvrir(chemin), 10000);
      } catch (err) { toast('Le PDF n\'a pas pu être créé : ' + err.message); }
      finally { document.body.classList.remove('impression-document'); style.remove(); }
      break;
    }
    case 'prev-ajouter-poste': modifierBudget('Poste ajouté', d => d.postes.push({ id: 'p-' + nouvelId().slice(0, 6), nom: 'Nouveau poste', sens: 'charge' })); break;
    case 'voir-releve': S.f = filtres({ releve: ds.releve }); S.page = 'operations'; S.selection.clear(); rendu(); $('#page').scrollTop = 0; break;
    case 'ouvrir-pdf': {
      const rel = D().releves.find(r => r.id === ds.releve);
      if (rel && rel.fichier) api.ouvrirReleve(rel.fichier).then(err => { if (err) toast('PDF introuvable : ' + err); });
      break;
    }
    case 'verifier-releve': {
      const rel = D().releves.find(r => r.id === ds.releve);
      if (!rel) break;
      modifier(rel.verifie ? `Relevé « ${rel.nom} » : vérification annulée` : `Relevé « ${rel.nom} » vérifié`, () => {
        if (rel.verifie) delete rel.verifie; else rel.verifie = { par: S.config.utilisateur || '', le: new Date().toISOString() };
      });
      break;
    }
    case 'supprimer-releve': supprimerReleve(ds.releve); break;
    case 'cloturer': {
      const y = +ds.annee, r = R();
      const ops = D().operations.filter(o => +o.date.slice(0, 4) === y);
      const aClasser = ops.filter(o => Logic.partsDe(o, r).some(p => p.categorie === Logic.A_CLASSER)).length;
      const anomalies = D().comptes.reduce((t, c) => t + Logic.rapprochement(D().releves, D().operations, c.id).filter(l => (l.releve.au || '').startsWith(String(y)) && (l.ecart || l.rupture)).length, 0);
      const avert = [aClasser ? `• ${aClasser} opération(s) encore à classer` : '', anomalies ? `• ${anomalies} anomalie(s) de rapprochement bancaire` : ''].filter(Boolean).join('\n');
      if (!confirm(`Clôturer l'exercice ${y} (${ops.length} opérations) ?\n\nLes catégories actuelles seront figées et plus rien ne pourra être modifié pour ${y}.${avert ? '\n\nAttention :\n' + avert : ''}`)) return;
      modifier(`Exercice ${y} clôturé (${ops.length} opérations${aClasser ? ', dont ' + aClasser + ' à classer' : ''})`, d => {
        for (const o of ops) {
          if (o.categorie || (o.ventilation && o.ventilation.length)) continue;
          const c = Logic.categorieDe(o, r);
          if (c !== Logic.A_CLASSER) o.categorie = c; // figée : un changement de règle ne la modifiera plus
        }
        if (!d.clotures.includes(y)) d.clotures.push(y);
      });
      break;
    }
    case 'rouvrir': {
      const y = +ds.annee;
      if (!confirm(`Rouvrir l'exercice ${y} ? Ses opérations redeviendront modifiables. Cette réouverture est notée dans l'historique.`)) return;
      modifier(`Exercice ${y} rouvert`, d => { d.clotures = d.clotures.filter(x => x !== y); });
      break;
    }
    case 'importer-fichier': {
      try {
        let data = await api.importerFichier(S.assoId);
        if (!data) return;
        if (!confirm(`Remplacer les données actuelles de « ${D().nom} » (${D().operations.length} opérations) par celles du fichier (${data.operations.length} opérations) ?`)) return;
        // Ancien fichier ACEL (comptes 01 et 02 ensemble) : on ne garde que la partie de cet espace
        if ((data.comptes || []).length > 1 && S.assoId.startsWith('acel-')) data = Modeles.separerAcel(data)[S.assoId];
        if ((data.comptes || []).length > 1) { toast('Ce fichier contient plusieurs comptes : il ne correspond pas à cet espace.'); return; }
        data.id = S.assoId;
        data.nom = espace().titre;
        data.comptes = data.comptes && data.comptes.length ? data.comptes : [Object.assign({}, espace().compte)];
        (data.operations || []).forEach(o => { o.compte = data.comptes[0].id; });
        data.releves = data.releves || []; data.clotures = data.clotures || []; data.historique = data.historique || [];
        data.soldes = data.soldes || []; data.categories = data.categories || []; data.regles = data.regles || [];
        Logic.migrerN1(data);
        modifier(`Données reprises depuis un fichier (${data.operations.length} opérations)`, () => { A().data = data; });
        toast('Données importées.');
      } catch (err) { toast(err.message); }
      break;
    }
  }
});

document.addEventListener('change', e => {
  const t = e.target, ds = t.dataset;
  if (ds.filtre) { S.f[ds.filtre] = t.type === 'checkbox' ? t.checked : t.value; if (ds.filtre === 'annee') S.f.mois = ''; S.selection.clear(); rendu(); return; }
  if (ds.opCat) { const op = opParId(ds.opCat); choisirCategorie(op, t.value); return; }
  if (ds.opFact) {
    const op = opParId(ds.opFact); const v = t.value.trim();
    if (verrou([op])) { t.value = op.facture || ''; return; }
    modifier(v ? `Facture ${v} pour ${op.libelle}` : `Facture retirée : ${op.libelle}`, () => { if (v) op.facture = v; else delete op.facture; }, { rendu: false });
    t.classList.toggle('manque', !!(op.debit && !v));
    return;
  }
  if (ds.choisir) {
    if (t.checked) S.selection.add(ds.choisir); else S.selection.delete(ds.choisir);
    t.closest('tr').classList.toggle('choisi', t.checked); rendreSelection(); return;
  }
  if (t.id === 'tout-choisir') { opsFiltrees().slice(0, 600).forEach(o => t.checked ? S.selection.add(o.id) : S.selection.delete(o.id)); rendreTableOps(); return; }
  if (ds.synth) { S.synth[ds.synth] = /^annee/.test(ds.synth) ? +t.value : t.value; rendu(); return; }
  if (ds.synthEgal != null) { S.synth.egal = t.checked; rendu(); return; }
  if (ds.prevAnnee != null) { S.prev.annee = +t.value; rendu(); return; }
  if (ds.tresoAnnee != null) { S.treso.annee = +t.value; rendu(); return; }
  if (ds.tresoParam) {
    const v = t.value.trim() === '' ? 0 : Logic.parseMontant(t.value);
    if (v == null || v < 0) { toast('Nombre non reconnu : ' + t.value); rendu(); return; }
    modifier(null, d => { d.tresorerie = Object.assign({ moisReserve: 1, marge: 0 }, d.tresorerie, { [ds.tresoParam]: v }); });
    return;
  }
  if (ds.tresoHab) { const c = D().categories.find(x => x.nom === ds.tresoHab); modifier(`${c.nom} : ${t.checked ? 'dépense habituelle' : 'dépense ponctuelle'}`, () => { if (t.checked) c.habituelle = true; else delete c.habituelle; }); return; }
  if (ds.tresoDepart) {
    const k = ds.tresoDepart;
    const v = k === 'montant' ? (t.value.trim() === '' ? null : Logic.parseMontant(t.value)) : t.value;
    if (k === 'montant' && t.value.trim() !== '' && v == null) { toast('Montant non reconnu : ' + t.value); return; }
    modifier('Solde de départ modifié', d => { d.soldeDepart = Object.assign({}, d.soldeDepart, { [k]: v }); if (!d.soldeDepart.date && d.soldeDepart.montant == null) delete d.soldeDepart; });
    return;
  }
  if (ds.subvAnnee != null) { S.subv.annee = +t.value; rendu(); return; }
  if (ds.subv || ds.subvDm || ds.subvEnt || ds.subvLettre != null || ds.subvIsolee || ds.subvPv || ds.subvLib) {
    const y = S.subv.annee, i = S.subv.demande;
    const montant = /montant|recettes|depenses/i.test(ds.subv || ds.subvDm || ds.subvPv || '');
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (montant && typeof v === 'string') {
      v = v.trim() === '' ? null : Logic.parseMontant(v);
      if (t.value.trim() !== '' && v == null) { toast('Montant non reconnu : ' + t.value); return; }
    }
    modifierBudget(null, d => {
      const sb = d.subventions.annees[y];
      if (ds.subv) sb[ds.subv] = v;
      else if (ds.subvDm) sb.demandes[i][ds.subvDm] = v;
      else if (ds.subvEnt) d.subventions.entete[ds.subvEnt] = v;
      else if (ds.subvLettre != null) sb.demandes[i].lettre = v.trim() === Tresorerie.texteLettre(sb, y, i, dateArreteSubv(sb, i)).trim() ? null : v;
      else if (ds.subvIsolee) { const set = new Set(sb.isolees || []); if (v) set.add(ds.subvIsolee); else set.delete(ds.subvIsolee); sb.isolees = [...set]; }
      else if (ds.subvLib) { const dm = sb.demandes[i]; dm.libelles = dm.libelles || {}; if (v.trim() && v.trim() !== t.placeholder) dm.libelles[ds.subvLib] = v.trim(); else delete dm.libelles[ds.subvLib]; }
      else if (ds.subvPv) { const [k, champ] = ds.subvPv.split(':'); sb.demandes[i].previsions[+k][champ] = montant ? (v || 0) : v; }
    });
    return;
  }
  if (ds.prevSaisie) {
    const y = S.prev.annee, obj = ds.prevSaisie, id = ds.poste;
    const v = t.value.trim() === '' ? null : Logic.parseMontant(t.value);
    if (t.value.trim() !== '' && v == null) { toast('Montant non reconnu : ' + t.value); return; }
    const libs = { budgets: 'Budget voté', budgetsRevises: 'Budget réactualisé', arretes: 'Comptes arrêtés' };
    const poste = B().postes.find(p => p.id === id);
    modifierBudget(`${libs[obj]} ${y} · ${poste ? poste.nom : id} : ${v == null ? 'effacé' : Logic.formatMontant(v) + ' €'}`, d => {
      d[obj][y] = d[obj][y] || {};
      if (v == null) delete d[obj][y][id]; else d[obj][y][id] = v;
    });
    return;
  }
  if (ds.prevDateRev != null) { const y = S.prev.annee; modifierBudget(null, d => { d.budgetsRevises[y] = d.budgetsRevises[y] || {}; if (t.value) d.budgetsRevises[y]._date = t.value; else delete d.budgetsRevises[y]._date; }); return; }
  if (ds.prevRatt) {
    const id = ds.prevRatt, cat = ds.cat;
    modifierBudget(`${cat} (${(ASSOS.find(a => a.id === id) || {}).nom || id}) → ${t.value === Previsionnel.EXCLU ? 'exclu du budget' : t.value ? (B().postes.find(p => p.id === t.value) || {}).nom : 'aucun poste'}`, d => {
      d.rattachements[id] = d.rattachements[id] || {};
      if (t.value) d.rattachements[id][cat] = t.value; else delete d.rattachements[id][cat];
    });
    return;
  }
  if (ds.prevPosteNom) { const p = B().postes[+ds.prevPosteNom]; const v = t.value.trim(); if (!v) { rendu(); return; } modifierBudget(`Poste renommé : ${p.nom} → ${v}`, () => { p.nom = v; }); return; }
  if (ds.prevPosteSens) { const p = B().postes[+ds.prevPosteSens]; modifierBudget(`Poste ${p.nom} : ${t.value}`, () => { p.sens = t.value; }); return; }
  if (ds.prevPosteManuel) { const p = B().postes[+ds.prevPosteManuel]; modifierBudget(`Poste ${p.nom} : ${t.checked ? 'sans banque' : 'avec banque'}`, () => { if (t.checked) p.manuel = true; else delete p.manuel; }); return; }
  if (ds.impCompte != null) { S.imp.compte = t.value; S.imp.releves.forEach(r => r.operations.forEach(o => { o._garder = null; })); rendu(); return; }
  if (ds.imp) { const [ri, oi] = ds.imp.split(':').map(Number); S.imp.releves[ri].operations[oi]._garder = t.checked; rendu(); return; }
  if (ds.impTout) { S.imp.releves[+ds.impTout].operations.forEach(o => { o._garder = t.checked && !o._clos; }); rendu(); return; }
  if (ds.catNom) { renommerCategorie(+ds.catNom, t.value); return; }
  if (ds.catNum) { const c = D().categories[+ds.catNum]; modifier(`N° de compte ${t.value.trim() || '(vide)'} pour ${c.nom}`, () => { c.compte = t.value.trim(); }, { rendu: false }); return; }
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
    const derniere = S.config.derniereAsso === 'acel' ? 'acel-01' : S.config.derniereAsso;
    if (derniere && ASSOS.some(a => a.id === derniere)) S.assoId = derniere;
    if (S.config.dossier) {
      await chargerAsso(S.assoId);
      for (const a of ASSOS) if (a.id !== S.assoId) chargerAsso(a.id).then(rendreBarre).catch(() => {});
    }
  } catch (err) {
    S.config = Object.assign({}, S.config, { dossier: null });
    toast('Le dossier des données est inaccessible : ' + err.message + ' — choisissez-le à nouveau.', null, null, 12000);
  }
  rendu();
  api.surFocus(() => verifierMiseAJour());
  // À la fermeture de la fenêtre : enregistrer ce qui est en attente, puis fermer
  api.avantFermeture(async () => {
    try { if (Object.values(S.assos).some(a => a.sale) || S.enregistrement.enCours) await sauver(); } finally { api.fermer(); }
  });
})();
