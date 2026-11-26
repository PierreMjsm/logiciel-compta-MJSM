/* Modèles de départ des deux associations (utilisés quand le fichier de données n'existe pas encore).
   Les numéros de compte suivent le plan comptable des associations (règlement ANC 2018-06) :
   ce sont des propositions à valider avec le comptable, modifiables dans « Catégories et règles ». */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.Modeles = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES_JSM = [
    // Dépenses
    { nom: 'Alimentation et goûters', compte: '6068', type: 'depense' },
    { nom: "Matériel d'activités", compte: '6063', type: 'depense' },
    { nom: 'Bureautique et fournitures', compte: '6064', type: 'depense' },
    { nom: 'Logiciels et abonnements', compte: '651', type: 'depense' },
    { nom: 'Eau, énergie', compte: '6061', type: 'depense' },
    { nom: 'Loyer et charges locatives', compte: '6132', type: 'depense' },
    { nom: 'Entretien et réparations', compte: '615', type: 'depense' },
    { nom: 'Assurances', compte: '616', type: 'depense' },
    { nom: 'Formations (BAFA, BAFD…)', compte: '6185', type: 'depense' },
    { nom: 'Sorties et intervenants', compte: '611', type: 'depense' },
    { nom: 'Transports et déplacements', compte: '6251', type: 'depense' },
    { nom: 'Honoraires (comptable…)', compte: '6226', type: 'depense' },
    { nom: 'Impressions et communication', compte: '623', type: 'depense' },
    { nom: 'Téléphone, internet, poste', compte: '626', type: 'depense' },
    { nom: 'Frais bancaires', compte: '627', type: 'depense' },
    { nom: 'Cotisations versées', compte: '6281', type: 'depense' },
    { nom: 'Salaires', compte: '641', type: 'depense' },
    { nom: 'Charges sociales', compte: '645', type: 'depense' },
    { nom: 'Impôts et taxes', compte: '631', type: 'depense' },
    { nom: 'Remboursements aux familles', compte: '709', type: 'depense' },
    // Recettes
    { nom: 'Participations des familles', compte: '706', type: 'recette' },
    { nom: 'Adhésions', compte: '756', type: 'recette' },
    { nom: 'CAF (prestations, subventions)', compte: '74', type: 'recette' },
    { nom: "Aide à l'apprentissage", compte: '74', type: 'recette' },
    { nom: "Participation de l'ACEL", compte: '758', type: 'recette' },
    { nom: 'Subventions (Ville, État…)', compte: '74', type: 'recette' },
    { nom: 'Dons', compte: '754', type: 'recette' },
    { nom: 'Produits financiers', compte: '768', type: 'recette' },
    { nom: 'Autres recettes', compte: '758', type: 'recette' },
    // Neutre
    { nom: 'Virement entre comptes', compte: '58', type: 'neutre' },
    // Année précédente : paiement ou encaissement qui concerne l'exercice d'avant
    { nom: 'N-1 (année précédente)', compte: '', type: 'n-1' },
  ];

  const REGLES_JSM = [
    { motcle: 'URSSAF', categorie: 'Charges sociales' },
    { motcle: 'CAISSE D ALLOCATIONS', categorie: 'CAF (prestations, subventions)' },
    { motcle: 'ALLOCATIONS FAMILIALES', categorie: 'CAF (prestations, subventions)' },
    { motcle: 'CAF DE', categorie: 'CAF (prestations, subventions)' },
    { motcle: 'HELLOASSO', categorie: 'Dons' },
    { motcle: 'COMMISSION', categorie: 'Frais bancaires' },
    { motcle: 'FRAIS TENUE', categorie: 'Frais bancaires' },
    { motcle: 'COTIS ', categorie: 'Frais bancaires' },
    { motcle: 'BUREAU VALLEE', categorie: 'Bureautique et fournitures' },
    { motcle: 'OFFICE DEPOT', categorie: 'Bureautique et fournitures' },
    { motcle: 'EDF', categorie: 'Eau, énergie' },
    { motcle: 'ORANGE', categorie: 'Téléphone, internet, poste' },
    { motcle: 'SFR', categorie: 'Téléphone, internet, poste' },
    { motcle: 'MICROSOFT', categorie: 'Logiciels et abonnements' },
    { motcle: 'MAIF', categorie: 'Assurances' },
    { motcle: 'MACIF', categorie: 'Assurances' },
    { motcle: 'REM CHQ', categorie: 'Participations des familles' },
    { motcle: 'VERSEMENT ESPECES', categorie: 'Participations des familles' },
    // Formats La Banque Postale (le détail porte la nature du virement)
    { motcle: 'SALAIRE', categorie: 'Salaires' },
    { motcle: 'KLESIA', categorie: 'Charges sociales' },
    { motcle: 'MALAKOFF', categorie: 'Charges sociales' },
    { motcle: 'AG2R', categorie: 'Charges sociales' },
    { motcle: 'AIDE UNIQUE APPREN', categorie: "Aide à l'apprentissage" },
    { motcle: 'COMMISSION INTERVENTION', categorie: 'Frais bancaires' },
    { motcle: 'COTISATION ADISPO', categorie: 'Frais bancaires' },
  ];

  /** Les trois espaces, complètement séparés : opérations, catégories, règles et export propres à chacun. */
  const ESPACES = [
    { id: 'acel-01', nom: 'ACEL – Compte 01', sous: 'Quotidien', couleur: '#1f4e8c', fichier: 'ACEL Compte 01 - Quotidien.compta.json',
      compte: { id: 'acel-01', nom: 'Compte 01 – Quotidien', compteComptable: '5121' }, titre: 'ACEL Saint-Médard – Compte 01 (quotidien)' },
    { id: 'acel-02', nom: 'ACEL – Compte 02', sous: 'Activités', couleur: '#8a2d5c', fichier: 'ACEL Compte 02 - Activités.compta.json',
      compte: { id: 'acel-02', nom: 'Compte 02 – Activités', compteComptable: '5122' }, titre: 'ACEL Saint-Médard – Compte 02 (activités)' },
    { id: 'jsm', nom: 'Les Jeunes de Saint-Médard', sous: 'Compte courant', couleur: '#2f6b4f', fichier: 'Les Jeunes de Saint-Médard.compta.json',
      compte: { id: 'jsm', nom: 'Compte courant', compteComptable: '512' }, titre: 'Les Jeunes de Saint-Médard' },
  ];
  const N1 = () => ({ nom: 'N-1 (année précédente)', compte: '', type: 'n-1' });
  const sansType = c => { const x = Object.assign({}, c); if (x.type !== 'n-1') delete x.type; return x; };

  function nouvelleAsso(id) {
    const e = ESPACES.find(x => x.id === id) || ESPACES[0];
    return {
      schema: 2, id: e.id, nom: e.titre, journal: 'BQ',
      comptes: [Object.assign({}, e.compte)],
      categories: e.id === 'jsm' ? CATEGORIES_JSM.map(sansType) : [N1()],
      regles: e.id === 'jsm' ? REGLES_JSM.map(r => Object.assign({}, r)) : [],
      operations: [], soldes: [], releves: [], clotures: [], historique: [], versionRegles: 3,
    };
  }

  /**
   * Ancien fichier « ACEL Saint-Médard » (comptes 01 et 02 ensemble) → deux espaces séparés.
   * Le compte 01 garde les catégories et règles existantes ; le compte 02 reçoit ses propres
   * opérations et une copie des catégories qu'il utilisait déjà (aucune règle : à créer pour lui).
   */
  function separerAcel(ancien) {
    const res = {};
    const maintenant = new Date().toISOString();
    for (const id of ['acel-01', 'acel-02']) {
      const d = nouvelleAsso(id);
      const ops = (ancien.operations || []).filter(o => o.compte === id);
      d.operations = ops;
      d.soldes = (ancien.soldes || []).filter(x => x.compte === id);
      d.releves = (ancien.releves || []).filter(x => x.compte === id);
      d.clotures = (ancien.clotures || []).slice();
      d.journal = ancien.journal || 'BQ';
      const ancienCompte = (ancien.comptes || []).find(c => c.id === id);
      if (ancienCompte) d.comptes = [Object.assign({}, ancienCompte)];
      const utilisees = new Set();
      ops.forEach(o => { if (o.categorie) utilisees.add(o.categorie); (o.ventilation || []).forEach(v => v.categorie && utilisees.add(v.categorie)); });
      const cats = (ancien.categories || []).map(sansType);
      d.categories = id === 'acel-01' ? cats : cats.filter(c => c.type === 'n-1' || utilisees.has(c.nom));
      if (!d.categories.some(c => c.type === 'n-1')) d.categories.unshift(N1());
      d.regles = id === 'acel-01' ? (ancien.regles || []).map(r => Object.assign({}, r)) : [];
      d.historique = [{ date: maintenant, par: 'Logiciel', action: `Espace créé en séparant l'ancien fichier ACEL (${ops.length} opération(s) du ${d.comptes[0].nom})` }]
        .concat((ancien.historique || []).slice(0, 300));
      res[id] = d;
    }
    return res;
  }

  /** Ajoute aux Jeunes les règles par défaut arrivées après la création du fichier (une seule fois). */
  const VERSION_REGLES_JSM = 3;
  function completerReglesJsm(data) {
    if (data.id !== 'jsm' || (data.versionRegles || 1) >= VERSION_REGLES_JSM) return false;
    const norm = t => String(t).toUpperCase().replace(/\s+/g, ' ').trim();
    // v3 : catégories des postes du tableau « Comptes » (aide à l'apprentissage, participation de l'ACEL)
    data.categories = data.categories || [];
    for (const c of CATEGORIES_JSM) if (!data.categories.some(x => x.nom === c.nom)) data.categories.push(sansType(c));
    const aide = (data.regles || []).find(r => norm(r.motcle) === 'AIDE UNIQUE APPREN');
    if (aide && aide.categorie === 'Subventions (Ville, État…)') aide.categorie = "Aide à l'apprentissage";
    const cats = new Set((data.categories || []).map(c => c.nom));
    for (const r of REGLES_JSM) {
      if (!cats.has(r.categorie)) continue;
      if (!(data.regles || []).some(x => norm(x.motcle) === norm(r.motcle))) (data.regles = data.regles || []).push(Object.assign({}, r));
    }
    data.versionRegles = VERSION_REGLES_JSM;
    return true;
  }

  const FICHIERS = Object.fromEntries(ESPACES.map(e => [e.id, e.fichier]));
  FICHIERS['acel-budget'] = 'ACEL Prévisionnel.compta.json'; // prévisionnel commun aux comptes 01 et 02
  FICHIERS['jsm-budget'] = 'Les Jeunes de Saint-Médard Budget.compta.json';
  const FICHIER_ANCIEN_ACEL = 'ACEL Saint-Médard.compta.json';

  return { nouvelleAsso, separerAcel, completerReglesJsm, ESPACES, FICHIERS, FICHIER_ANCIEN_ACEL, CATEGORIES_JSM };
});
