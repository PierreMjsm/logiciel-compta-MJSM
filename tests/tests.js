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

  console.log(`\n${ok} tests réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
