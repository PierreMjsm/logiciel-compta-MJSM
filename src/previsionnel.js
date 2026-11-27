/* Prévisionnel ACEL : budget par poste, réalisé calculé depuis les comptes 01 et 02, estimé de fin d'année. */
(function (root, factory) {
  const lib = factory(typeof module === 'object' && module.exports ? require('./logic.js') : root.Logic);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.Previsionnel = lib;
})(typeof self !== 'undefined' ? self : this, function (Logic) {
  'use strict';

  const ESPACES_ACEL = ['acel-01', 'acel-02'];
  /** Valeur de rattachement « exclu du budget » (virements entre comptes…). */
  const EXCLU = '__exclu';

  /** Postes des tableaux « Budget / Atterrissage ». manuel = sans mouvement bancaire (saisi à la main). */
  const POSTES_ACEL = [
    { id: 'recettes', nom: 'Recettes ACEL (mises à disposition)', sens: 'produit' },
    { id: 'subventions', nom: 'Subvention Avenir Censier', sens: 'produit' },
    { id: 'frais-gestion', nom: 'Remboursement frais de gestion', sens: 'produit' },
    { id: 'camps-p', nom: 'Camps et ateliers', sens: 'produit' },
    { id: 'notre-dame', nom: 'Subvention camp Fondation Notre-Dame', sens: 'produit' },
    { id: 'cotisations', nom: 'Cotisations', sens: 'produit' },
    { id: 'financier', nom: 'Produit financier', sens: 'produit' },
    { id: 'provisions', nom: 'Provisions', sens: 'produit', manuel: true },
    { id: 'salaires', nom: 'Salaires et charges', sens: 'charge' },
    { id: 'fonctionnement', nom: 'Charges de fonctionnement', sens: 'charge' },
    { id: 'camps-c', nom: 'Camps et ateliers', sens: 'charge' },
    { id: 'loyer', nom: 'Loyer', sens: 'charge' },
    { id: 'retraite', nom: 'Départ en retraite', sens: 'charge', manuel: true },
  ];

  /** Postes du tableau « Comptes 2025 » des Jeunes de Saint-Médard. */
  const POSTES_JSM = [
    { id: 'familles', nom: 'Participation des familles', sens: 'produit' },
    { id: 'subventions', nom: 'Subventions CAF et autres', sens: 'produit' },
    { id: 'apprentissage', nom: "Aide à l'apprentissage", sens: 'produit' },
    { id: 'autres', nom: 'Autres produits', sens: 'produit' },
    { id: 'acel', nom: "Participation de l'ACEL", sens: 'produit' },
    { id: 'dons', nom: 'Dons', sens: 'produit' },
    { id: 'provisions', nom: 'Provisions', sens: 'produit', manuel: true },
    { id: 'salaires', nom: 'Salaires et charges', sens: 'charge' },
    { id: 'fonctionnement', nom: 'Charges de fonctionnement', sens: 'charge' },
    { id: 'formation', nom: 'Formation professionnelle', sens: 'charge' },
    { id: 'dotation', nom: "Dotation aux provisions d'exploitation", sens: 'charge', manuel: true },
    { id: 'diverses', nom: 'Charges diverses', sens: 'charge' },
    { id: 'redevance', nom: 'Redevance ACEL', sens: 'charge' },
  ];
  const PROPOSITION_JSM = {
    jsm: {
      'Participations des familles': 'familles', 'Adhésions': 'familles', 'Remboursements aux familles': 'familles',
      'CAF (prestations, subventions)': 'subventions', 'Subventions (Ville, État…)': 'subventions',
      "Aide à l'apprentissage": 'apprentissage',
      'Autres recettes': 'autres', 'Produits financiers': 'autres',
      "Participation de l'ACEL": 'acel',
      'Dons': 'dons',
      'Salaires': 'salaires', 'Charges sociales': 'salaires', 'Impôts et taxes': 'salaires',
      'Alimentation et goûters': 'fonctionnement', "Matériel d'activités": 'fonctionnement', 'Bureautique et fournitures': 'fonctionnement',
      'Logiciels et abonnements': 'fonctionnement', 'Eau, énergie': 'fonctionnement', 'Entretien et réparations': 'fonctionnement',
      'Assurances': 'fonctionnement', 'Sorties et intervenants': 'fonctionnement', 'Transports et déplacements': 'fonctionnement',
      'Honoraires (comptable…)': 'fonctionnement', 'Impressions et communication': 'fonctionnement', 'Téléphone, internet, poste': 'fonctionnement',
      'Frais bancaires': 'fonctionnement', 'Cotisations versées': 'fonctionnement',
      'Formations (BAFA, BAFD…)': 'formation',
      'Loyer et charges locatives': 'redevance',
      'Virement entre comptes': EXCLU,
    },
  };

  /** Premier rattachement proposé (catégorie → poste), à corriger dans l'écran si besoin. */
  const PROPOSITION = {
    'acel-01': {
      Afocal: 'recettes', Association: 'recettes', Copro: 'recettes', Famille: 'recettes', Scout: 'recettes', UFCV: 'recettes', Global: 'recettes', Autres: 'recettes',
      Subvention: 'subventions', 'Service Civique': 'subventions',
      'JSM/ACEL': 'frais-gestion',
      Salaire: 'salaires', Charge: 'salaires', 'Charge sociale': 'salaires',
      Fonctionnement: 'fonctionnement', BANQUE: 'fonctionnement',
      Loyer: 'loyer', SCI: 'loyer',
    },
    'acel-02': {},
  };

  /** Un budget par association : ACEL (comptes 01 + 02 réunis) et Jeunes de Saint-Médard. */
  const GROUPES = {
    acel: { id: 'acel-budget', nom: 'ACEL – Prévisionnel (comptes 01 + 02)', titre: 'Prévisionnel ACEL', sousTitre: 'Comptes 01 + 02 réunis', espaces: ESPACES_ACEL, postes: () => POSTES_ACEL, proposition: () => PROPOSITION },
    jsm: { id: 'jsm-budget', nom: 'Les Jeunes de Saint-Médard – Budget et résultat', titre: 'Budget et résultat', sousTitre: 'Les Jeunes de Saint-Médard', espaces: ['jsm'], postes: () => POSTES_JSM, proposition: () => PROPOSITION_JSM },
  };
  const groupeDe = espaceId => String(espaceId).startsWith('acel-') ? 'acel' : 'jsm';

  function nouveauBudget(groupe) {
    const g = GROUPES[groupe || 'acel'];
    return {
      schema: 1, id: g.id, groupe: groupe || 'acel', espaces: g.espaces.slice(), nom: g.nom,
      postes: g.postes().map(p => Object.assign({}, p)),
      rattachements: JSON.parse(JSON.stringify(g.proposition())),
      budgets: {},         // budget voté : { "2025": { posteId: montant } }
      budgetsRevises: {},  // budget réactualisé : { "2025": { posteId: montant, _date: "2025-09-30" } }
      arretes: {},         // comptes arrêtés (chiffres du comptable) : { "2024": { posteId: montant } }
      historique: [],
    };
  }

  const cts = Logic.cts, deCts = Logic.deCts;
  const fin = y => `${y}-12-31`, debut = y => `${y}-01-01`;

  /**
   * Réalisé d'une année (civile) jusqu'à une date : par poste, en centimes, au sens du poste
   * (charges = débits − crédits, produits = crédits − débits). Les parts N-1 comptent dans l'année
   * qu'elles concernent (payées l'année suivante → ligne à part « N-1 »).
   */
  function realise(budget, espaces, annee, jusquAu) {
    const parPoste = {}, nonRattache = new Map();
    let n1Charges = 0, n1Produits = 0, nbOps = 0;
    const mois = new Set();
    const du = debut(annee), au = jusquAu && jusquAu < fin(annee) ? jusquAu : fin(annee);
    const postes = new Map(budget.postes.map(p => [p.id, p]));
    for (const id of (budget.espaces || ESPACES_ACEL)) {
      const e = espaces[id];
      if (!e) continue;
      const R = Logic.prepareRegles(e.regles);
      const ratt = (budget.rattachements || {})[id] || {};
      for (const o of e.operations) {
        if (o.date < du || o.date > au) continue;
        nbOps++; mois.add(o.date.slice(5, 7));
        for (const p of Logic.partsDe(o, R)) {
          if (Logic.estN1(p.categorie, e.categories)) continue; // compte dans l'année précédente
          if (ratt[p.categorie] === EXCLU) continue;
          const poste = postes.get(ratt[p.categorie]);
          if (poste && !poste.manuel) {
            parPoste[poste.id] = (parPoste[poste.id] || 0) + (poste.sens === 'charge' ? cts(p.debit) - cts(p.credit) : cts(p.credit) - cts(p.debit));
          } else {
            const k = id + '|' + p.categorie;
            const x = nonRattache.get(k) || { espace: id, categorie: p.categorie, debit: 0, credit: 0 };
            x.debit += cts(p.debit); x.credit += cts(p.credit);
            nonRattache.set(k, x);
          }
        }
      }
      // N-1 payés l'année suivante : appartiennent à cette année
      for (const { op, part } of Logic.n1RattachesA(e.operations, R, e.categories, du, fin(annee))) {
        if (jusquAu && jusquAu < fin(annee)) continue; // en cours d'année : pas encore connus
        n1Charges += cts(part.debit) - 0; n1Produits += cts(part.credit);
      }
    }
    return { parPoste, nonRattache: [...nonRattache.values()], n1Charges, n1Produits, nbOps, nbMois: mois.size };
  }

  function derniereDate(espaces, annee, liste) {
    let d = '';
    for (const id of (liste || ESPACES_ACEL)) for (const o of (espaces[id] ? espaces[id].operations : [])) if (o.date.startsWith(String(annee)) && o.date > d) d = o.date;
    return d;
  }

  /**
   * Tableau complet pour une année : budget voté et réactualisé, réalisé (comptes arrêtés s'ils sont saisis,
   * sinon banque à date), estimé de fin d'année, réalisé de l'année précédente.
   * Estimé : réalisé à date + ce qui a été fait l'an dernier sur le reste de l'année (rythme de l'année
   * précédente : mois chargés, loyers trimestriels…). Si l'année précédente n'est pas assez connue en
   * banque (moins de 10 mois importés) : réalisé à date + reste de l'année selon le budget.
   */
  function calculer(budget, espaces, annee, aujourdhui) {
    const y = +annee, prec = y - 1;
    const auj = aujourdhui || new Date().toISOString().slice(0, 10);
    const dRef = derniereDate(espaces, y, budget.espaces);
    const R = realise(budget, espaces, y);
    const Rprec = realise(budget, espaces, prec);
    const precConnue = Rprec.nbMois >= 10;
    const RprecADate = dRef ? realise(budget, espaces, prec, Logic.decalerAn(dRef, -1)) : null;
    const anneeFinie = auj > fin(y) && dRef >= `${y}-12-01`;
    const jours = dRef ? (Date.parse(dRef) - Date.parse(debut(y))) / 86400000 + 1 : 0;
    const joursAn = (Date.parse(fin(y)) - Date.parse(debut(y))) / 86400000 + 1;
    const get = (obj, an) => ((budget[obj] || {})[an]) || {};
    const bY = get('budgets', y), rY = get('budgetsRevises', y), aY = get('arretes', y), aP = get('arretes', prec);
    const arreteY = Object.keys(aY).some(k => !k.startsWith('_')), arreteP = Object.keys(aP).some(k => !k.startsWith('_'));
    const revise = Object.keys(rY).some(k => !k.startsWith('_'));
    const source = arreteY ? 'arretes' : R.nbOps ? 'banque' : 'aucune';
    const methode = source === 'arretes' ? 'arretes' : !dRef ? 'aucune' : anneeFinie ? 'finie' : precConnue ? 'rythme' : 'budget';
    const v = x => x == null ? null : deCts(x);

    const lignes = budget.postes.map(p => {
      const budgetC = bY[p.id] != null ? cts(bY[p.id]) : null;
      const reviseC = rY[p.id] != null ? cts(rY[p.id]) : null;
      const reference = reviseC != null ? reviseC : budgetC;
      let realC = null, estC = null;
      if (arreteY) { realC = aY[p.id] != null ? cts(aY[p.id]) : 0; estC = realC; }
      else if (p.manuel) { realC = null; estC = reference; }
      else if (R.nbOps) {
        realC = R.parPoste[p.id] || 0;
        if (methode === 'finie') estC = realC;
        else if (methode === 'rythme') estC = realC + ((Rprec.parPoste[p.id] || 0) - (RprecADate.parPoste[p.id] || 0));
        else if (reference != null) estC = realC + Math.round(reference * Math.max(0, 1 - jours / joursAn)); // reste de l'année selon le budget
        else estC = Math.round(realC * joursAn / jours);
      }
      const precC = arreteP ? (aP[p.id] != null ? cts(aP[p.id]) : 0) : (!p.manuel && precConnue ? (Rprec.parPoste[p.id] || 0) : null); // banque : seulement si l'année précédente est assez complète
      return {
        poste: p, budget: v(budgetC), revise: v(reviseC), reference: v(reference), realise: v(realC), estime: v(estC), realisePrec: v(precC),
        ecart: estC != null && reference != null ? v(estC - reference) : null,
        evol: reference != null && precC ? (reference - precC) / Math.abs(precC) : null,
        taux: realC != null && reference ? realC / reference : null,
      };
    });

    // Lignes techniques en banque : N-1 payés l'année suivante, catégories sans poste
    const nonR = { charge: 0, produit: 0 };
    if (source === 'banque') for (const x of R.nonRattache) { nonR.charge += x.debit; nonR.produit += x.credit; }
    const tot = sens => {
      const L = lignes.filter(l => l.poste.sens === sens);
      const s = k => L.some(l => l[k] != null) ? L.reduce((t, l) => t + cts(l[k] || 0), 0) : null;
      const extra = source === 'banque' ? (sens === 'charge' ? R.n1Charges : R.n1Produits) + nonR[sens] : 0;
      const r = { budget: s('budget'), revise: s('revise'), reference: s('reference'), realisePrec: s('realisePrec') };
      r.realise = s('realise') == null ? null : s('realise') + extra;
      r.estime = s('estime') == null ? null : s('estime') + extra;
      for (const k in r) r[k] = v(r[k]);
      return r;
    };
    const produits = tot('produit'), charges = tot('charge');
    const diff = (a, b) => a == null || b == null ? null : deCts(cts(a) - cts(b));
    const resultat = {};
    for (const k of ['budget', 'revise', 'reference', 'realise', 'estime', 'realisePrec']) resultat[k] = diff(produits[k], charges[k]);
    return {
      annee: y, dateRef: dRef, source, methode, precConnue, revise, dateRevise: rY._date || null, arretePrec: arreteP,
      aBudget: Object.keys(bY).some(k => !k.startsWith('_')) || revise,
      lignes, produits, charges, resultat,
      n1: source === 'banque' ? { charges: deCts(R.n1Charges), produits: deCts(R.n1Produits) } : { charges: 0, produits: 0 },
      nonRattache: source === 'banque' ? R.nonRattache.map(x => ({ espace: x.espace, categorie: x.categorie, debit: deCts(x.debit), credit: deCts(x.credit) }))
        .sort((a, b) => (b.debit + b.credit) - (a.debit + a.credit)) : [],
    };
  }

  /** Catégories des deux comptes sans poste (pour l'écran des rattachements). */
  function categoriesSansPoste(budget, espaces) {
    const res = [];
    for (const id of (budget.espaces || ESPACES_ACEL)) {
      const e = espaces[id];
      if (!e) continue;
      const ratt = (budget.rattachements || {})[id] || {};
      for (const c of e.categories) if (c.type !== 'n-1' && !ratt[c.nom]) res.push({ espace: id, categorie: c.nom });
    }
    return res;
  }

  return { ESPACES_ACEL, EXCLU, GROUPES, groupeDe, POSTES: POSTES_ACEL, POSTES_JSM, nouveauBudget, calculer, realise, categoriesSansPoste };
});
