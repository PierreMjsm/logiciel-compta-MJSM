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

  console.log(`\n${ok} tests réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
