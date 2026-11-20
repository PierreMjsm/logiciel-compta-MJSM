/* Tests automatiques (lancés par GitHub avant de fabriquer le .exe). Données fictives uniquement. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../src/logic.js');
const E = require('../src/export.js');
const X = require('../src/xlsx.js');
const M = require('../src/modeles.js');
const { lireReleve } = require('../src/pdf-releve.js');
const P = require('../src/previsionnel.js');

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

  console.log(`\n${ok} tests réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
