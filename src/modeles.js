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
  ];

  function nouvelleAsso(id) {
    if (id === 'jsm') {
      return {
        schema: 1, id: 'jsm', nom: 'Les Jeunes de Saint-Médard', journal: 'BQ',
        comptes: [{ id: 'jsm', nom: 'Compte courant', compteComptable: '512' }],
        categories: CATEGORIES_JSM.map(c => Object.assign({}, c)),
        regles: REGLES_JSM.map(r => Object.assign({}, r)),
        operations: [], soldes: [], historique: [],
      };
    }
    return {
      schema: 1, id: 'acel', nom: 'ACEL Saint-Médard', journal: 'BQ',
      comptes: [
        { id: 'acel-01', nom: 'Compte 01 – Quotidien', compteComptable: '5121' },
        { id: 'acel-02', nom: 'Compte 02 – Activités', compteComptable: '5122' },
      ],
      categories: [{ nom: 'N-1 (année précédente)', compte: '', type: 'n-1' }], regles: [], operations: [], soldes: [], historique: [],
    };
  }

  const FICHIERS = { acel: 'ACEL Saint-Médard.compta.json', jsm: 'Les Jeunes de Saint-Médard.compta.json' };

  return { nouvelleAsso, FICHIERS, CATEGORIES_JSM };
});
