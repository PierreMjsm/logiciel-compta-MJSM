/* Tests automatiques (lancés par GitHub avant de fabriquer le .exe). Données fictives uniquement. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../src/logic.js');
const E = require('../src/export.js');
const X = require('../src/xlsx.js');
const M = require('../src/modeles.js');
const { lireReleve, numeroCompte } = require('../src/pdf-releve.js');
const P = require('../src/previsionnel.js');
const T = require('../src/tresorerie.js');

let ok = 0;
const test = async (nom, fn) => { await fn(); ok++; console.log('✔', nom); };

(async () => {
  await test('montants et dates', () => {
    assert.strictEqual(L.parseMontant('51.112,32'), 51112.32);
    assert.strictEqual(L.parseMontant('616,8'), 616.8);
    assert.strictEqual(L.parseMontant('616.80'), 616.8);
    assert.strictEqual(L.parseMontant('²'), null);
    assert.strictEqual(L.parseDate('05/01/26'), '2026-01-05');
  });

  await test('moyens de paiement', () => {
    assert.strictEqual(L.detectMoyen('PRLV SEPA EDF'), 'Prélèvement');
    assert.strictEqual(L.detectMoyen('VIR INST ASSOCIATION'), 'Virement');
    assert.strictEqual(L.detectMoyen('REM CHQ REF1'), 'Remise chèque');
    assert.strictEqual(L.detectMoyen('CHEQUE 3211171'), 'Chèque');
    assert.strictEqual(L.detectMoyen('PAIEMENT CB 0411 PARIS'), 'Carte bancaire');
  });

  await test('règles : la plus longue gagne, puis le détail', () => {
    const R = L.prepareRegles([{ motcle: 'RUE', categorie: 'Copro' }, { motcle: 'PRLV SEPA OVH', categorie: 'Fonctionnement' }, { motcle: 'AIME', categorie: 'Association' }]);
    assert.strictEqual(L.categorieDe({ libelle: 'PRLV SEPA OVH SAS', details: ['59100 RUE KELLERMANN'] }, R), 'Fonctionnement');
    assert.strictEqual(L.categorieDe({ libelle: 'VIR INST X', details: ['ASSOCIATION AIME'] }, R), 'Association');
    assert.strictEqual(L.categorieDe({ libelle: 'VIR INST X', details: [], categorie: 'Famille' }, R), 'Famille');
    assert.strictEqual(L.categorieDe({ libelle: 'INCONNU', details: [] }, R), L.A_CLASSER);
    // le mot-clé doit commencer un mot : « SFR » ne trouve pas « BOUSFR », « SCOUT » trouve « SCOUTS »
    const R2 = L.prepareRegles([{ motcle: 'SFR', categorie: 'Télécom' }, { motcle: 'SCOUT', categorie: 'Scout' }]);
    assert.strictEqual(L.categorieDe({ libelle: 'REPRISE SUR CHEQUE', details: ['N° 7282118 BOUSFR'] }, R2), L.A_CLASSER);
    assert.strictEqual(L.categorieDe({ libelle: 'PRLV SFR', details: [] }, R2), 'Télécom');
    assert.strictEqual(L.categorieDe({ libelle: 'VIR SCOUTS ET GUIDES', details: [] }, R2), 'Scout');
  });

  await test('copier-coller depuis Excel', () => {
    const txt = ['Date\tDate valeur\tOpération\tDébit EUROS\tCrédit EUROS',
      '\t\tSOLDE CREDITEUR AU 31/12/2025\t\t1.000,00',
      '01/01/2026\t01/01/2026\tVIR INST ECOLE\t\t600,00',
      '\t\tECOLE EXEMPLE\t\t',
      '02/01/2026\t02/01/2026\tPRLV SEPA EDF\t100,00\t',
      '\t\tSOLDE CREDITEUR AU 31/01/2026\t\t1500,00'].join('\n');
    const r = L.parseCollage(txt);
    assert.strictEqual(r.operations.length, 2);
    assert.deepStrictEqual(r.operations[0].details, ['ECOLE EXEMPLE']);
    assert.strictEqual(L.controleSoldes(r).ok, true);
  });

  await test('lecture d\'un relevé PDF', async () => {
    const r = await lireReleve(fs.readFileSync(path.join(__dirname, 'releve-exemple.pdf')));
    assert.ok(!r.erreur, r.erreur);
    assert.strictEqual(r.operations.length, 5);
    assert.strictEqual(r.operations[1].credit, 1250);
    assert.strictEqual(r.operations[0].debit, 84.2);
    assert.deepStrictEqual(r.operations[0].details, ['EDF SA', 'FACTURE 123456']);
    const c = L.controleSoldes(r);
    assert.strictEqual(c.ok, true, c.messages.join(' / '));
  });

  await test('ventilation et export comptable équilibré', () => {
    const a = M.nouvelleAsso('jsm');
    a.operations = [
      { id: '1', compte: 'jsm', date: '2026-11-03', libelle: 'PRLV SEPA EDF', details: [], debit: 84.2, credit: 0, facture: 'F1' },
      { id: '2', compte: 'jsm', date: '2026-11-06', libelle: 'REM CHQ REF00001', details: [], debit: 0, credit: 420,
        ventilation: [{ montant: 400, categorie: 'Participations des familles' }, { montant: 20, categorie: 'Adhésions' }] },
      { id: '3', compte: 'jsm', date: '2026-11-07', libelle: 'ACHAT MYSTERE', details: [], debit: 10, credit: 0 },
    ];
    const { feuilles, resume } = E.construire(a, { du: '2026-01-01', au: '2026-12-31' });
    assert.strictEqual(resume.operations, 3);
    assert.strictEqual(resume.sansCategorie, 1);
    const journal = feuilles.find(f => f.nom === 'Journal de banque').lignes;
    const total = journal[journal.length - 1];
    assert.strictEqual(total[6].v, total[7].v);
    const comptes = journal.slice(3, -1).map(l => l[3]);
    assert.ok(comptes.includes('6061') && comptes.includes('706') && comptes.includes('756') && comptes.includes('471'));
    const buf = X.classeur(feuilles);
    assert.strictEqual(buf.slice(0, 2).toString(), 'PK');
  });

  await test('catégorie N-1 : création, reprise de « 2025 », export surligné', () => {
    const a = { categories: [{ nom: '2025', compte: '' }, { nom: 'Loyer', compte: '' }], regles: [{ motcle: 'X', categorie: '2025' }],
      comptes: [{ id: 'c', nom: 'Compte' }], nom: 'Test',
      operations: [{ id: '1', compte: 'c', date: '2026-01-10', libelle: 'PRLV EDF', details: [], debit: 50, credit: 0, categorie: '2025' },
        { id: '2', compte: 'c', date: '2026-01-12', libelle: 'VIR LOYER', details: [], debit: 100, credit: 0, categorie: 'Loyer' }] };
    assert.strictEqual(L.migrerN1(a), true);
    assert.ok(!a.categories.some(c => c.nom === '2025'));
    assert.strictEqual(a.operations[0].categorie, L.N1_NOM);
    assert.strictEqual(a.regles[0].categorie, L.N1_NOM);
    assert.strictEqual(L.estN1(L.N1_NOM, a.categories), true);
    assert.strictEqual(L.migrerN1(a), false);
    const ops = E.construire(a, {}).feuilles[0].lignes;
    const l1 = ops.find(l => l[3] && (l[3].v || l[3]) === 'PRLV EDF');
    assert.strictEqual(l1[7].v, 'N-1');
    assert.strictEqual(l1[0].s, 10);
    const res = E.construire(a, {}).resume;
    assert.strictEqual(res.depenses, 100);
    assert.strictEqual(res.n1Depenses, 50);
    assert.ok(M.nouvelleAsso('jsm').categories.some(c => c.type === 'n-1'));
    assert.ok(M.nouvelleAsso('acel-01').categories.some(c => c.type === 'n-1'));
    assert.ok(M.nouvelleAsso('acel-02').categories.some(c => c.type === 'n-1'));
  });

  await test('suggestion N-1 d\'après le libellé', () => {
    const s = (libelle, details, date) => L.suggereN1({ libelle, details, date: date || '2026-01-20' });
    assert.strictEqual(s('PRLV SEPA MALAKOFF', ['RETRAITE - 202512M - SIRET']), '202512');
    assert.strictEqual(s('VIR LOYER 4ETRI 2025', []), '2025');
    assert.strictEqual(s('VIR X', ['LOCATION NOV DEC 2025']), 'DEC 2025');
    assert.strictEqual(s('VIR X', ['REF 120252025123']), null);
    assert.strictEqual(s('VIR LOYER 4ETRI 2025', [], '2026-09-01'), null);
    assert.strictEqual(s('VIR LOYER 1ER TRI 2026', []), null);
  });

  // ---------------- Tests ajoutés après l'audit
  await test('audit : montants avec séparateurs mixtes, dates impossibles', () => {
    assert.strictEqual(L.parseMontant('1,234.56'), 1234.56);
    assert.strictEqual(L.parseMontant('1 234,56'), 1234.56);
    assert.strictEqual(L.parseMontant('1,2,3'), null);
    assert.strictEqual(L.parseDate('31/02/2026'), null);
    assert.strictEqual(L.parseDate('29/02/2028'), '2028-02-29');
    assert.strictEqual(L.somme(Array(10000).fill(0.1)), 1000);
  });

  await test('audit : ventilation incomplète ou trop forte → journal toujours équilibré', () => {
    const a = M.nouvelleAsso('jsm');
    a.operations = [
      { id: '1', compte: 'jsm', date: '2026-03-01', libelle: 'REM CHQ', details: [], debit: 0, credit: 420, ventilation: [{ montant: 300, categorie: 'Adhésions' }] },
      { id: '2', compte: 'jsm', date: '2026-03-02', libelle: 'ACHAT', details: [], debit: 100, credit: 0, ventilation: [{ montant: 80, categorie: 'Bureautique et fournitures' }, { montant: 40, categorie: 'Alimentation et goûters' }] },
    ];
    const parts = L.partsDe(a.operations[0], []);
    assert.strictEqual(parts.length, 2);
    assert.strictEqual(parts[1].categorie, L.A_CLASSER);
    assert.strictEqual(parts[1].credit, 120);
    const { feuilles } = E.construire(a, {});
    const j = feuilles[1].lignes, t = j[j.length - 1];
    assert.strictEqual(t[6].v, t[7].v);
    const v = feuilles.find(f => f.nom === 'À vérifier').lignes.slice(3);
    assert.ok(v.some(l => /Ventilation incomplète/.test(l[5])));
  });

  await test('audit : doublons comptés (2 achats identiques le même jour) et doublons probables', () => {
    const ex = [{ compte: 'c', date: '2026-03-02', libelle: 'CB BOULANGERIE', debit: 2.4, credit: 0 }];
    const n = [{ compte: 'c', date: '2026-03-02', libelle: 'CB BOULANGERIE', debit: 2.4, credit: 0 },
      { compte: 'c', date: '2026-03-02', libelle: 'CB BOULANGERIE', debit: 2.4, credit: 0 }];
    L.marquerDoublons(n, ex);
    assert.deepStrictEqual(n.map(o => o._doublon), ['exact', null]);
    const n2 = [{ compte: 'c', date: '2026-03-02', libelle: 'CB BOULANGERIE CARTE 7135', debit: 2.4, credit: 0 }];
    L.marquerDoublons(n2, ex);
    assert.strictEqual(n2[0]._doublon, 'probable');
    const n3 = [{ compte: 'autre', date: '2026-03-02', libelle: 'CB BOULANGERIE', debit: 2.4, credit: 0 }];
    L.marquerDoublons(n3, ex);
    assert.strictEqual(n3[0]._doublon, null);
  });

  await test('audit : PDF piégé (montant dans le libellé, ligne de conversion, pied de page)', async () => {
    const r = await lireReleve(fs.readFileSync(path.join(__dirname, 'releve-piege.pdf')));
    assert.strictEqual(r.operations.length, 2);
    assert.deepStrictEqual([r.operations[0].debit, r.operations[0].credit], [0, 12.5]);
    assert.ok(/12,50/.test(r.operations[0].libelle));
    assert.strictEqual(r.operations[1].debit, 20);
    assert.strictEqual(L.controleSoldes(r).ok, true);
  });

  await test('audit : rapprochement bancaire (suppression, doublon, relevé manquant)', () => {
    const releves = [
      { id: 'r1', compte: 'c', du: '2026-01-01', au: '2026-01-31', soldeDebut: 100, soldeFin: 150 },
      { id: 'r2', compte: 'c', du: '2026-02-01', au: '2026-02-28', soldeDebut: 150, soldeFin: 120 },
      { id: 'r4', compte: 'c', du: '2026-04-01', au: '2026-04-30', soldeDebut: 200, soldeFin: 200 },
    ];
    const ops = [{ releve: 'r1', debit: 0, credit: 50 }, { releve: 'r2', debit: 30, credit: 0 }];
    let res = L.rapprochement(releves, ops, 'c');
    assert.deepStrictEqual(res.map(x => [x.ecart, x.rupture]), [[0, 0], [0, 0], [0, 80]]);
    res = L.rapprochement(releves, ops.slice(1), 'c');
    assert.strictEqual(res[0].ecart, -50);
    assert.strictEqual(L.soldeActuel(releves, ops, 'c').solde, 200);
  });

  await test('trois espaces séparés : l\'ancien fichier ACEL est coupé en compte 01 et compte 02', () => {
    assert.deepStrictEqual(M.ESPACES.map(e => e.id), ['acel-01', 'acel-02', 'jsm']);
    assert.strictEqual(new Set(M.ESPACES.map(e => e.couleur)).size, 3);
    const ancien = {
      comptes: [{ id: 'acel-01', nom: 'Compte 01', compteComptable: '5121' }, { id: 'acel-02', nom: 'Compte 02', compteComptable: '5122' }],
      categories: [{ nom: 'Loyer', type: 'depense' }, { nom: 'Sorties' }, { nom: 'N-1 (année précédente)', type: 'n-1' }],
      regles: [{ motcle: 'SCI', categorie: 'Loyer' }],
      operations: [{ id: 'a', compte: 'acel-01', date: '2026-01-02', libelle: 'SCI', debit: 10, credit: 0 },
        { id: 'b', compte: 'acel-02', date: '2026-01-03', libelle: 'CAR', debit: 5, credit: 0, categorie: 'Sorties' }],
      releves: [{ id: 'r', compte: 'acel-02' }], soldes: [],
    };
    const r = M.separerAcel(ancien);
    assert.deepStrictEqual(r['acel-01'].operations.map(o => o.id), ['a']);
    assert.deepStrictEqual(r['acel-02'].operations.map(o => o.id), ['b']);
    assert.strictEqual(r['acel-01'].regles.length, 1);
    assert.strictEqual(r['acel-02'].regles.length, 0);
    assert.deepStrictEqual(r['acel-02'].categories.map(c => c.nom).sort(), ['N-1 (année précédente)', 'Sorties']);
    assert.strictEqual(r['acel-02'].releves.length, 1);
    assert.ok(!r['acel-01'].categories.some(c => c.type === 'depense'));
    assert.strictEqual(r['acel-01'].comptes.length, 1);
  });

  await test('relevé au format La Banque Postale (dates sans année, solde sur deux lignes, pied de page)', async () => {
    const r = await lireReleve(fs.readFileSync(path.join(__dirname, 'releve-format-lbp.pdf')));
    assert.ok(!r.erreur, r.erreur);
    assert.deepStrictEqual(r.operations.map(o => o.date), ['2025-12-29', '2025-12-30', '2025-12-30', '2026-01-02']);
    assert.strictEqual(r.operations[0].libelle, 'VIREMENT POUR DUPONT JEAN');
    assert.strictEqual(r.operations[3].credit, 1519.4);
    assert.ok(!r.operations[3].details.some(d => /Capital|S\.A\./.test(d)));
    assert.deepStrictEqual(r.soldes.map(x => x.montant), [1000, 1123.4]);
    assert.strictEqual(r.totaux.debit, 1396);
    const c = L.controleSoldes(r);
    assert.strictEqual(c.ok, true, c.messages.join(' / '));
    // deux reprises de chèque identiques le même jour : toutes deux importées
    L.marquerDoublons(r.operations.map(o => Object.assign(o, { compte: 'jsm' })), []);
    assert.ok(r.operations.every(o => !o._doublon));
  });

  await test('relevé au format CIC (marques dans la marge, pied de page « Suite au verso »)', async () => {
    const r = await lireReleve(fs.readFileSync(path.join(__dirname, 'releve-format-cic.pdf')));
    assert.ok(!r.erreur, r.erreur);
    assert.strictEqual(r.operations.length, 5);
    assert.deepStrictEqual(r.operations.map(o => o.debit || o.credit), [372, 1092, 36, 161.2, 168.3]);
    assert.ok(!r.operations.some(o => o.details.some(d => /Suite au verso|Médiateur|Information|KV\./.test(d))));
    assert.deepStrictEqual(r.operations[3].details, ['ASSOCIATION EXEMPLE', 'ASSOCIATION EXEMPLE SUITE']);
    const c = L.controleSoldes(r);
    assert.strictEqual(c.ok, true, c.messages.join(' / '));
  });

  await test('N-1 rattaché à l\'année qu\'il concerne (résultat 2025 = dépenses 2025 + N-1 payés en 2026)', () => {
    const a = M.nouvelleAsso('acel-01');
    a.categories.push({ nom: 'Loyer', compte: '6132' });
    a.operations = [
      { id: '1', compte: 'acel-01', date: '2025-03-10', libelle: 'LOYER MARS', details: [], debit: 100, credit: 0, categorie: 'Loyer' },
      { id: '2', compte: 'acel-01', date: '2026-01-15', libelle: 'LOYER 4E TRI 2025', details: [], debit: 50, credit: 0, categorie: L.N1_NOM },
      { id: '3', compte: 'acel-01', date: '2026-02-10', libelle: 'LOYER FEVRIER', details: [], debit: 30, credit: 0, categorie: 'Loyer' },
    ];
    const ent = L.n1RattachesA(a.operations, L.prepareRegles(a.regles), a.categories, '2025-01-01', '2025-12-31');
    assert.deepStrictEqual(ent.map(x => x.op.id), ['2']);
    assert.strictEqual(E.construire(a, { du: '2025-01-01', au: '2025-12-31' }).resume.depenses, 150);
    assert.strictEqual(E.construire(a, { du: '2026-01-01', au: '2026-12-31' }).resume.depenses, 30);
    const f = E.construire(a, { du: '2025-01-01', au: '2025-12-31' }).feuilles.find(x => x.nom === 'Par compte comptable').lignes;
    const res = f.find(l => l[0] && l[0].v === 'Résultat de l\'exercice');
    assert.strictEqual(res[3].v, 150);
    assert.strictEqual(L.decalerAn('2024-02-29', 1), '2025-02-28');
  });

  await test('prévisionnel ACEL : réalisé par poste (comptes 01 + 02), comptes arrêtés, estimé de fin d\'année', () => {
    const b = P.nouveauBudget();
    b.rattachements['acel-01'] = { Loyer: 'loyer', Copro: 'recettes' };
    b.rattachements['acel-02'] = { Sorties: 'camps-c' };
    b.budgets['2026'] = { loyer: 1200, recettes: 2400, 'camps-c': 600 };
    b.arretes['2025'] = { loyer: 1100, recettes: 2000, 'camps-c': 500 };
    const esp = {
      'acel-01': { categories: [{ nom: 'Loyer' }, { nom: 'Copro' }, { nom: 'N-1 (année précédente)', type: 'n-1' }], regles: [], operations: [
        { date: '2026-01-10', libelle: 'LOYER', debit: 300, credit: 0, categorie: 'Loyer' },
        { date: '2026-01-12', libelle: 'LOYER T4 2025', debit: 290, credit: 0, categorie: 'N-1 (année précédente)' },
        { date: '2026-03-01', libelle: 'VIR COPRO', debit: 0, credit: 600, categorie: 'Copro' },
        { date: '2026-03-02', libelle: 'INCONNU', debit: 10, credit: 0 }] },
      'acel-02': { categories: [{ nom: 'Sorties' }], regles: [], operations: [{ date: '2026-02-01', libelle: 'CAR', debit: 150, credit: 0, categorie: 'Sorties' }] },
    };
    const r = P.calculer(b, esp, 2026, '2026-06-30');
    const l = id => r.lignes.find(x => x.poste.id === id);
    assert.strictEqual(l('loyer').realise, 300);              // le N-1 (290) n'est pas dans 2026
    assert.strictEqual(l('camps-c').realise, 150);            // le compte 02 est bien additionné
    assert.strictEqual(l('recettes').realise, 600);
    assert.strictEqual(l('loyer').realisePrec, 1100);         // comptes arrêtés 2025
    assert.strictEqual(r.methode, 'budget');                  // 2025 non importée : reste de l'année selon le budget
    assert.strictEqual(l('loyer').estime, 1299.45);           // 300 réalisés au 02/03 + 1200 × 304/365 restants
    assert.strictEqual(r.nonRattache.length, 1);              // l'opération à classer reste visible
    assert.strictEqual(r.charges.realise, 460);               // 300 + 150 + 10 sans poste
    const r25 = P.calculer(b, esp, 2025, '2026-06-30');
    assert.strictEqual(r25.source, 'arretes');
    assert.strictEqual(r25.resultat.realise, 400);            // 2000 − (1100 + 500)
  });

  await test('budget et résultat des Jeunes : postes du tableau « Comptes », exclusion des virements internes', () => {
    const b = P.nouveauBudget('jsm');
    assert.deepStrictEqual(b.espaces, ['jsm']);
    assert.ok(b.postes.some(p => p.nom === 'Redevance ACEL'));
    const j = M.nouvelleAsso('jsm');
    j.operations = [
      { date: '2026-01-05', libelle: 'REM CHQ', details: [], debit: 0, credit: 500, categorie: 'Participations des familles' },
      { date: '2026-01-06', libelle: 'VIR VERS LIVRET', details: [], debit: 1000, credit: 0, categorie: 'Virement entre comptes' },
      { date: '2026-01-07', libelle: 'VIR ACEL REDEVANCE', details: [], debit: 300, credit: 0, categorie: 'Loyer et charges locatives' },
      { date: '2026-01-08', libelle: 'AIDE UNIQUE APPRENTISSAGE', details: [], debit: 0, credit: 250 },
    ];
    const r = P.calculer(b, { jsm: j }, 2026, '2026-02-01');
    const l = id => r.lignes.find(x => x.poste.id === id).realise;
    assert.strictEqual(l('familles'), 500);
    assert.strictEqual(l('redevance'), 300);
    assert.strictEqual(l('apprentissage'), 250);          // règle AIDE UNIQUE APPREN → Aide à l'apprentissage
    assert.strictEqual(r.nonRattache.length, 0);           // le virement interne est exclu, pas « sans poste »
    assert.strictEqual(r.charges.realise, 300);
    assert.strictEqual(r.aBudget, false);
    // ancien fichier Jeunes (règles v2) : la migration ajoute les catégories et corrige la règle
    const ancien = { id: 'jsm', categories: [{ nom: 'Subventions (Ville, État…)' }], regles: [{ motcle: 'AIDE UNIQUE APPREN', categorie: 'Subventions (Ville, État…)' }], versionRegles: 2 };
    assert.strictEqual(M.completerReglesJsm(ancien), true);
    assert.ok(ancien.categories.some(c => c.nom === "Participation de l'ACEL"));
    assert.strictEqual(ancien.regles[0].categorie, "Aide à l'apprentissage");
  });

  await test('trésorerie : solde à une date et reste disponible par mois', () => {
    const d = M.nouvelleAsso('jsm');
    assert.strictEqual(T.migrerHabituelles(d), true);
    assert.ok(d.categories.find(c => c.nom === 'Salaires').habituelle);
    assert.ok(!d.categories.find(c => c.nom === "Matériel d'activités").habituelle);
    assert.strictEqual(T.migrerHabituelles(d), false);                 // une seule fois
    d.soldeDepart = { date: '2025-12-31', montant: 10000 };
    d.operations = [
      { date: '2026-01-05', libelle: 'VIR CAF', details: [], debit: 0, credit: 3000 },
      { date: '2026-01-28', libelle: 'SALAIRE JANVIER', details: [], debit: 4000, credit: 0 },
      { date: '2026-01-30', libelle: 'ACHAT JEUX', details: [], debit: 500, credit: 0, categorie: "Matériel d'activités" },
      { date: '2026-02-27', libelle: 'SALAIRE FEVRIER', details: [], debit: 2000, credit: 0 },
    ];
    assert.strictEqual(T.soldeAu(d, '2026-01-31'), 8500);
    assert.strictEqual(T.soldeAu(d, '2025-12-15'), 10000);
    const hab = new Set(d.categories.filter(c => c.habituelle).map(c => c.nom));
    const r = T.resteDisponible(d, 2026, { habituelles: hab, moisReserve: 1, marge: 1000 });
    assert.strictEqual(r.lignes.length, 2);
    const [jan, fev] = r.lignes;
    assert.deepStrictEqual([jan.debut, jan.recettes, jan.habituelles, jan.autres, jan.fin], [10000, 3000, 4000, 500, 8500]);
    assert.strictEqual(jan.reserve, 5000);                                // 4000 de salaires + 1000 de marge
    assert.strictEqual(jan.disponible, 3500);
    assert.strictEqual(fev.moyenneHabituelles, 3000);                     // moyenne (4000 + 2000) / 2
    assert.strictEqual(fev.disponible, 6500 - 4000);
    // le solde lu sur un relevé importé est prioritaire sur le calcul
    d.releves = [{ du: '2026-02-01', au: '2026-02-28', soldeDebut: 8600, soldeFin: 6600 }];
    assert.strictEqual(T.soldeAu(d, '2026-02-28'), 6600);
  });

  await test('demande de subvention : plan de trésorerie, lettre, montant en lettres', () => {
    assert.strictEqual(T.enLettres(60000), 'soixante mille');
    assert.strictEqual(T.enLettres(30000), 'trente mille');
    assert.strictEqual(T.enLettres(71), 'soixante-et-onze');
    assert.strictEqual(T.enLettres(80), 'quatre-vingts');
    assert.strictEqual(T.enLettres(1981), 'mille neuf cent quatre-vingt-un');
    assert.strictEqual(T.enLettres(280000), 'deux cent quatre-vingt mille');
    assert.strictEqual(T.enLettres(2500000), 'deux millions cinq cent mille');
    const d = M.nouvelleAsso('acel-01');
    d.releves = [{ du: '2025-12-31', au: '2026-06-30', soldeDebut: 80000, soldeFin: 41000 }];
    d.categories.push({ nom: 'Loyer' }, { nom: 'Subvention' }, { nom: 'Activités' });
    d.operations = [
      { date: '2026-01-10', libelle: 'FACTURE DECEMBRE 2025', details: [], debit: 1000, credit: 0, categorie: 'N-1 (année précédente)' },
      { date: '2026-02-10', libelle: 'COTISATIONS', details: [], debit: 0, credit: 20000, categorie: 'Activités' },
      { date: '2026-03-10', libelle: 'ACHATS', details: [], debit: 8000, credit: 0, categorie: 'Activités' },
      { date: '2026-04-05', libelle: 'VIR LOYER 1ER TRI', details: [], debit: 30000, credit: 0, categorie: 'Loyer' },
      { date: '2026-05-10', libelle: 'VIR SUBV 1 2026 AVENIR CENSIER', details: [], debit: 0, credit: 30000, categorie: 'Association' },
      { date: '2026-06-10', libelle: 'ACHATS', details: [], debit: 50000, credit: 0, categorie: 'Activités' },
    ];
    const p = T.planTresorerie(d, 2026, { dateArrete: '2026-06-30', isolees: new Set(['Loyer']), previsions: [{ libelle: 'Avant', date: '2026-06-01', recettes: 999 }, { libelle: 'Fin d\'année', date: '2026-12-31', recettes: 5000, depenses: 2000 }] });
    const lib = p.lignes.map(l => l.libelle);
    assert.deepStrictEqual(lib, ['Trésorerie au 31/12/2025', 'Facturés au 31/12/2025', 'janvier à mars 2026', 'avril à juin 2026', 'Loyer 1er trimestre 2026', "Fin d'année"]);
    assert.strictEqual(p.soldeReel, 41000);
    assert.strictEqual(p.ecartBanque, 0);                                  // réalisé = solde bancaire
    assert.strictEqual(p.soldeFinal, 44000);                               // + prévision ; celle datée avant l'arrêté est ignorée
    // versement trouvé en banque même mal classé ; la demande déjà reçue n'est plus en prévision
    const sub = T.nouvelleSubvention(2026);
    sub.montantVote = 60000; sub.dateAG = '2026-06-03';
    sub.demandes[0].montant = 30000; sub.demandes[1].montant = 30000;
    const v = T.versementsTrouves({ 'acel-01': d }, 2026, sub.motcle);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].categorie, 'Association');
    const props = T.proposerPrevisions(d, 2026, '2026-06-30', sub);
    assert.strictEqual(props.filter(x => /Subvention/.test(x.libelle)).length, 1);
    assert.ok(props.some(x => x.libelle === 'Loyer 2e trimestre 2026' && x.depenses === 30000 && x.date === '2026-07-05'));
    assert.strictEqual(T.libelleIsole('Loyer', { libelle: 'VIR LOYER 4ETRI 2025', date: '2026-01-05' }, 2026), 'Loyer 4e trimestre 2025');
    assert.strictEqual(T.libelleIsole('Loyer', { libelle: 'PRLV TRIBUNAL', date: '2026-01-05' }, 2026), 'Loyer janvier 2026');
    // texte d'une ligne du réalisé modifié à la main
    const p2 = T.planTresorerie(d, 2026, { dateArrete: '2026-06-30', isolees: new Set(['Loyer']), libelles: { T1: '1er trimestre' } });
    assert.strictEqual(p2.lignes.find(l => l.cle === 'T1').libelle, '1er trimestre');
    assert.strictEqual(p2.lignes.find(l => l.cle === 'T1').auto, 'janvier à mars 2026');
    assert.ok(props.every(x => x.date > '2026-06-30' && x.date <= '2026-12-31'));
    const lettre = T.texteLettre(sub, 2026, 0, '2026-06-12');
    assert.ok(/mercredi 3 juin 2026/.test(lettre) && /60 000 € \(soixante mille euros\)/.test(lettre) && /arrêté au 12 juin 2026/.test(lettre));
    assert.ok(/second versement/.test(T.texteLettre(sub, 2026, 1, '2026-11-02')));
  });

  await test('numéro du compte lu sur le relevé (pour refuser un relevé importé dans le mauvais espace)', () => {
    const page = (...t) => [t.map((x, y) => ({ y, items: [{ str: x }] }))];
    assert.strictEqual(numeroCompte(page('RELEVE', '€ COMPTE  COURANT ASSOCIATION N° 00020010302 en euros (GD)')), '00020010302');
    assert.strictEqual(numeroCompte(page('IBAN : FR35 2004 1000 0112 4563 7J02 045 | BIC : PSSTFRPPPAR')), '1245637J020');
    assert.strictEqual(numeroCompte(page('IBAN : FR76 3006 6105 5100 0200 1030 273')), '00020010302');
    assert.strictEqual(numeroCompte(page('Aucun numéro ici')), null);
  });

  await test('doublons entre l\'historique Excel et un relevé PDF importé ensuite : détection et fusion', () => {
    const d = { operations: [
      { id: 'x1', compte: 'c', date: '2026-10-05', libelle: 'PRLV EDF', debit: 50, credit: 0, categorie: 'Énergie', facture: 'F12', source: 'Excel' },
      { id: 'x2', compte: 'c', date: '2026-10-06', libelle: 'VIR ASS FORMATION CADRES ANI', debit: 0, credit: 100, source: 'Excel' },
      { id: 'x3', compte: 'c', date: '2026-09-20', libelle: 'AVANT LE RELEVE', debit: 10, credit: 0 },
      { id: 'p1', compte: 'c', date: '2026-10-05', libelle: 'PRLV EDF', debit: 50, credit: 0, releve: 'r' },
      { id: 'p2', compte: 'c', date: '2026-10-06', libelle: 'VIR ASS FORMATION CADRES ANIMATION', debit: 0, credit: 100, releve: 'r' },
      { id: 'p3', compte: 'c', date: '2026-10-07', libelle: 'NOUVELLE', debit: 5, credit: 0, releve: 'r' },
    ], releves: [{ id: 'r', compte: 'c', du: '2026-09-30', au: '2026-10-31' }] };
    const p = L.doublonsHistorique(d);
    assert.deepStrictEqual(p.map(x => x.retirer.id).sort(), ['x1', 'x2']);
    assert.strictEqual(L.fusionnerDoublons(d, p), 2);
    assert.deepStrictEqual(d.operations.map(o => o.id), ['x3', 'p1', 'p2', 'p3']);
    assert.strictEqual(d.operations[1].categorie, 'Énergie');
    assert.strictEqual(d.operations[1].facture, 'F12');
    assert.strictEqual(L.doublonsHistorique(d).length, 0);
  });

  console.log(`\n${ok} tests réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
