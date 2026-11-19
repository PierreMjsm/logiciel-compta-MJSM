/* Construit le classeur d'export pour le comptable (feuilles décrites pour xlsx.js). */
(function (root, factory) {
  const lib = factory(typeof module === 'object' && module.exports ? require('./logic.js') : root.Logic);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.Export = lib;
})(typeof self !== 'undefined' ? self : this, function (Logic) {
  'use strict';

  const COMPTE_ATTENTE = '471';
  const r2 = x => Math.round(x * 100) / 100;
  const H = v => ({ v, s: 1 });
  const M = v => (v ? { v: r2(v), s: 2 } : '');
  const TM = v => ({ v: r2(v || 0), s: 5 });
  const TT = v => ({ v, s: 4 });
  /** Surligne une ligne (opérations N-1) : texte 8, montant 9, date 10. */
  function surligner(ligne) {
    return ligne.map(c => {
      if (c == null || c === '') return { v: '', s: 8 };
      if (typeof c !== 'object') return { v: c, s: 8 };
      if (c.t === 'd') return Object.assign({}, c, { s: 10 });
      if (c.s === 2) return Object.assign({}, c, { s: 9 });
      return Object.assign({}, c, { s: 8 });
    });
  }
  const MOIS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

  /**
   * asso : données de l'association ; options : { du, au, comptes: [ids] }
   */
  function construire(asso, options) {
    const regles = Logic.prepareRegles(asso.regles);
    const cats = new Map((asso.categories || []).map(c => [c.nom, c]));
    const comptes = new Map((asso.comptes || []).map(c => [c.id, c]));
    const ops = (asso.operations || [])
      .filter(o => (!options.du || o.date >= options.du) && (!options.au || o.date <= options.au))
      .filter(o => !options.comptes || !options.comptes.length || options.comptes.includes(o.compte))
      .slice().sort((a, b) => a.date.localeCompare(b.date) || (a.compte || '').localeCompare(b.compte || ''));

    // Une ligne par part (une opération ventilée donne plusieurs lignes)
    const lignes = [];
    for (const o of ops) {
      const banque = comptes.get(o.compte) || {};
      const parts = Logic.partsDe(o, regles);
      parts.forEach((p, i) => {
        const cat = cats.get(p.categorie);
        const numero = (cat && cat.compte) ? String(cat.compte) : '';
        lignes.push({
          o: Object.assign({}, o, { debit: p.debit, credit: p.credit, facture: p.facture || o.facture || '', note: p.note || o.note || '' }),
          origine: o, categorie: p.categorie, numero, banque,
          ventile: parts.length > 1 ? (i + 1) + '/' + parts.length : '',
          n1: Logic.estN1(p.categorie, asso.categories),
        });
      });
    }
    const nbOps = ops.length;

    const titre = `${asso.nom} — du ${Logic.formatDate(options.du) || '…'} au ${Logic.formatDate(options.au) || '…'}`;

    // 1. Opérations
    let totD = 0, totC = 0;
    const n1D = r2(lignes.filter(l => l.n1).reduce((t, l) => t + (l.o.debit || 0), 0));
    const n1C = r2(lignes.filter(l => l.n1).reduce((t, l) => t + (l.o.credit || 0), 0));
    const fOps = {
      nom: 'Opérations', figer: 3, filtre: true, filtreLigne: 3,
      colonnes: [11, 11, 18, 42, 50, 15, 22, 9, 11, 14, 13, 13, 30],
      lignes: [
        [{ v: titre, s: 6 }],
        [],
        ['Date', 'Date valeur', 'Compte bancaire', 'Libellé', 'Détails', 'Moyen', 'Catégorie', 'Exercice', 'N° compte', 'N° facture', 'Débit', 'Crédit', 'Note'].map(H),
        ...lignes.map(({ o, categorie, numero, banque, ventile, n1 }) => {
          totD += o.debit || 0; totC += o.credit || 0;
          const l = [
            { v: o.date, t: 'd' }, o.dateValeur ? { v: o.dateValeur, t: 'd' } : '', banque.nom || o.compte,
            o.libelle + (ventile ? ' (part ' + ventile + ')' : ''), (o.details || []).join(' / '), o.moyen || Logic.detectMoyen(o.libelle),
            categorie, n1 ? 'N-1' : 'N', numero, o.facture || '', M(o.debit), M(o.credit), o.note || '',
          ];
          return n1 ? surligner(l) : l;
        }),
        [TT('Total des mouvements bancaires'), TT(''), TT(''), TT(nbOps + ' opérations' + (lignes.length > nbOps ? ' (' + lignes.length + ' lignes)' : '')), TT(''), TT(''), TT(''), TT(''), TT(''), TT(''), TM(totD), TM(totC), TT('')],
        ...(n1D || n1C ? [
          [TT('dont N-1 (hors résultat de l\'année)'), TT(''), TT(''), TT(''), TT(''), TT(''), TT(''), TT('N-1'), TT(''), TT(''), TM(n1D), TM(n1C), TT('')].map(c => Object.assign({}, c, { s: c.s === 5 ? 9 : 8 })),
          [TT('Dépenses et recettes de l\'année (hors N-1)'), TT(''), TT(''), TT(''), TT(''), TT(''), TT(''), TT('N'), TT(''), TT(''), TM(totD - n1D), TM(totC - n1C), TT('')],
          [],
          [{ v: 'Les lignes en jaune (exercice N-1) ont été payées ou encaissées sur la période mais concernent l\'année précédente : elles ne comptent pas dans le résultat de l\'année.', s: 7 }],
        ] : []),
      ],
    };

    // 2. Journal de banque (écritures en partie double)
    const journal = asso.journal || 'BQ';
    const jl = [];
    let jD = 0, jC = 0;
    for (let i = 0; i < lignes.length;) {
      const groupe = [lignes[i]];
      while (i + groupe.length < lignes.length && lignes[i + groupe.length].origine === lignes[i].origine) groupe.push(lignes[i + groupe.length]);
      i += groupe.length;
      const o = groupe[0].origine, banque = groupe[0].banque;
      const cpteBanque = banque.compteComptable || '512';
      const lib = (o.libelle || '').slice(0, 60);
      const pieces = [...new Set(groupe.map(g => g.o.facture).filter(Boolean))].join(', ');
      // Argent qui sort (débit sur le relevé) : charge au débit, banque au crédit
      const montant = r2((o.credit || 0) - (o.debit || 0));
      if (!montant) continue;
      const entree = montant > 0, m = Math.abs(montant);
      jl.push([{ v: o.date, t: 'd' }, journal, pieces, cpteBanque, banque.nom || 'Banque', lib, entree ? M(m) : '', entree ? '' : M(m)]);
      jD += entree ? m : 0; jC += entree ? 0 : m;
      for (const g of groupe) {
        const pm = r2((g.o.credit || 0) + (g.o.debit || 0));
        if (!pm) continue;
        const contre = g.numero || COMPTE_ATTENTE;
        const intitule = g.numero ? g.categorie : 'Compte d\'attente (' + g.categorie + ')';
        const lj = [{ v: o.date, t: 'd' }, journal, g.o.facture || '', contre, intitule, lib, entree ? '' : M(pm), entree ? M(pm) : ''];
        jl.push(g.n1 ? surligner(lj) : lj);
        jD += entree ? 0 : pm; jC += entree ? pm : 0;
      }
    }
    const fJournal = {
      nom: 'Journal de banque', figer: 3, filtre: true, filtreLigne: 3,
      colonnes: [11, 8, 14, 11, 30, 44, 13, 13],
      lignes: [
        [{ v: 'Journal ' + journal + ' — ' + titre, s: 6 }],
        [],
        ['Date', 'Journal', 'Pièce', 'Compte', 'Intitulé', 'Libellé', 'Débit', 'Crédit'].map(H),
        ...jl,
        [TT('Total'), TT(''), TT(''), TT(''), TT(''), TT(''), TM(jD), TM(jC)],
      ],
    };

    // 3. Récapitulatif par compte comptable
    const parCompte = new Map();
    const parCompteN1 = new Map();
    for (const { o, categorie, numero, n1 } of lignes) {
      const k = numero || COMPTE_ATTENTE;
      if (n1) {
        if (!parCompteN1.has(k)) parCompteN1.set(k, { cats: new Set(), depenses: 0, recettes: 0, n: 0 });
        const e = parCompteN1.get(k); e.cats.add(categorie); e.depenses += o.debit || 0; e.recettes += o.credit || 0; e.n++;
        continue;
      }
      if (!parCompte.has(k)) parCompte.set(k, { cats: new Set(), depenses: 0, recettes: 0, n: 0 });
      const e = parCompte.get(k);
      e.cats.add(categorie); e.depenses += o.debit || 0; e.recettes += o.credit || 0; e.n++;
    }
    const cles = [...parCompte.keys()].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    let rD = 0, rR = 0;
    const fRecap = {
      nom: 'Par compte comptable', figer: 3,
      colonnes: [12, 44, 10, 15, 15, 15],
      lignes: [
        [{ v: 'Récapitulatif par compte — ' + titre, s: 6 }],
        [],
        ['N° compte', 'Catégorie(s)', 'Lignes', 'Dépenses', 'Recettes', 'Net'].map(H),
        ...cles.map(k => {
          const e = parCompte.get(k); rD += e.depenses; rR += e.recettes;
          return [k, [...e.cats].join(', ') + (k === COMPTE_ATTENTE ? ' (sans numéro de compte)' : ''), e.n, M(e.depenses), M(e.recettes), { v: r2(e.recettes - e.depenses), s: 2 }];
        }),
        [TT('Résultat de l\'année' + (parCompteN1.size ? ' (hors N-1)' : '')), TT(''), TT(''), TM(rD), TM(rR), TM(rR - rD)],
        ...(parCompteN1.size ? [[], [{ v: 'Hors résultat de l\'année : exercice N-1', s: 7 }],
          ...[...parCompteN1.entries()].map(([k, e]) => surligner([k, [...e.cats].join(', '), e.n, M(e.depenses), M(e.recettes), { v: r2(e.recettes - e.depenses), s: 2 }]))] : []),
      ],
    };

    // 4. Tableau mensuel par catégorie (dépenses puis recettes)
    const moisSet = [...new Set(lignes.map(l => Logic.moisDe(l.o.date)))].sort();
    const libMois = m => MOIS[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4);
    const bloc = (titreBloc, champ) => {
      const parCat = new Map();
      for (const { o, categorie } of lignes) {
        const v = o[champ] || 0; if (!v) continue;
        if (!parCat.has(categorie)) parCat.set(categorie, new Map());
        const mm = parCat.get(categorie); const k = Logic.moisDe(o.date);
        mm.set(k, (mm.get(k) || 0) + v);
      }
      const estN1 = n => Logic.estN1(n, asso.categories);
      const tous = [...parCat.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
      const noms = tous.filter(n => !estN1(n)), nomsN1 = tous.filter(estN1);
      const totMois = moisSet.map(m => noms.reduce((t, n) => t + (parCat.get(n).get(m) || 0), 0));
      const ligne = n => {
        const mm = parCat.get(n); const c = cats.get(n);
        const vals = moisSet.map(m => mm.get(m) || 0);
        const l = [n, c && c.compte ? String(c.compte) : '', ...vals.map(M), { v: r2(vals.reduce((a, b) => a + b, 0)), s: 2 }];
        return estN1(n) ? surligner(l) : l;
      };
      return [
        [{ v: titreBloc, s: 7 }],
        ['Catégorie', 'N° compte', ...moisSet.map(libMois), 'Total'].map(H),
        ...noms.map(ligne),
        [TT('Total de l\'année' + (nomsN1.length ? ' (hors N-1)' : '')), TT(''), ...totMois.map(TM), TM(totMois.reduce((a, b) => a + b, 0))],
        ...(nomsN1.length ? [[{ v: 'Hors résultat de l\'année :', s: 7 }], ...nomsN1.map(ligne)] : []),
        [],
      ];
    };
    const fMois = {
      nom: 'Par mois',
      colonnes: [24, 10, ...moisSet.map(() => 12), 14],
      lignes: [[{ v: 'Par mois et par catégorie — ' + titre, s: 6 }], [], ...bloc('Dépenses (débits)', 'debit'), ...bloc('Recettes (crédits)', 'credit')],
    };

    // 5. Points à vérifier
    const aVerifier = [];
    // Un même n° de facture sur plusieurs opérations différentes : doublon de paiement ou erreur de saisie ?
    const parFacture = new Map();
    for (const l of lignes) {
      const f = (l.o.facture || '').trim().toUpperCase();
      if (!f) continue;
      if (!parFacture.has(f)) parFacture.set(f, new Set());
      parFacture.get(f).add(l.origine.id);
    }
    for (const { o, categorie, numero, origine } of lignes) {
      const pb = [];
      const f = (o.facture || '').trim().toUpperCase();
      if (f && parFacture.get(f).size > 1) pb.push('N° de facture ' + o.facture + ' utilisé sur ' + parFacture.get(f).size + ' opérations');
      if (Logic.resteVentilation(origine)) pb.push('Ventilation incomplète');
      if (categorie === Logic.A_CLASSER) pb.push('Pas de catégorie');
      else if (!numero) pb.push('Catégorie sans n° de compte');
      if (o.debit && !o.facture) pb.push('Dépense sans n° de facture');
      if (pb.length) aVerifier.push([{ v: o.date, t: 'd' }, o.libelle, categorie, M(o.debit), M(o.credit), pb.join(', ')]);
    }
    const fVerif = {
      nom: 'À vérifier', figer: 3, filtre: true, filtreLigne: 3,
      colonnes: [11, 44, 20, 13, 13, 44],
      lignes: [
        [{ v: aVerifier.length ? aVerifier.length + ' opération(s) à vérifier' : 'Rien à signaler', s: 6 }],
        [],
        ['Date', 'Libellé', 'Catégorie', 'Débit', 'Crédit', 'À vérifier'].map(H),
        ...aVerifier,
      ],
    };

    return {
      feuilles: [fOps, fJournal, fRecap, fMois, fVerif],
      resume: { operations: nbOps, depenses: r2(totD - n1D), recettes: r2(totC - n1C), n1Depenses: n1D, n1Recettes: n1C, aVerifier: aVerifier.length,
        sansCategorie: lignes.filter(l => l.categorie === Logic.A_CLASSER).length,
        sansNumero: lignes.filter(l => l.categorie !== Logic.A_CLASSER && !l.numero).length,
        sansFacture: lignes.filter(l => l.o.debit && !l.o.facture).length },
    };
  }

  return { construire, COMPTE_ATTENTE };
});
