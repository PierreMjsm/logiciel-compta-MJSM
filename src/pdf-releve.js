/* Lecture d'un relevé bancaire PDF (processus principal, Node). */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const Logic = require('./logic.js');

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const p = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsPromise = import(pathToFileURL(p).href);
  }
  return pdfjsPromise;
}

const RE_MONTANT = /^-?\d{1,3}(?:[ .  ]\d{3})*,\d{2}$|^-?\d+,\d{2}$/;
const RE_DATE = /^\d{1,2}\/\d{1,2}\/(\d{2}|\d{4})$/;
const RE_DATE_COURTE = /^(\d{1,2})\/(\d{1,2})$/;            // « 29/12 » (La Banque Postale…) : année déduite
const estMontant = s => RE_MONTANT.test(String(s).replace(/[\s\u00a0\u202f]/g, ' ').replace(/^[+-]\s*/, '-').replace(/\s*[€¤]$/, ''));

/** Extrait les morceaux de texte avec leur position, regroupés en lignes. */
async function lignesDuPdf(data) {
  const pdfjs = await loadPdfjs();
  const tache = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: true });
  const doc = await tache.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter(it => it.str && it.str.trim())
      .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width || 0 }));
    // Regroupe par ligne (même hauteur à 2,5 points près)
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lignes = [];
    for (const it of items) {
      const l = lignes.find(l => Math.abs(l.y - it.y) < 2.5);
      if (l) l.items.push(it); else lignes.push({ y: it.y, items: [it] });
    }
    lignes.forEach(l => {
      l.items.sort((a, b) => a.x - b.x);
      // Fusionne les morceaux collés (pdf.js coupe parfois un mot ou un montant)
      const fusion = [];
      for (const it of l.items) {
        const prev = fusion[fusion.length - 1];
        if (prev && it.x - (prev.x + prev.w) < 1.2) { prev.str += it.str; prev.w = it.x + it.w - prev.x; }
        else fusion.push({ ...it });
      }
      l.items = fusion;
    });
    lignes.sort((a, b) => b.y - a.y);
    // Une ligne qui ne contient qu'un montant, à quelques points d'une ligne de texte sans montant,
    // fait partie de la même ligne (ex. « Ancien solde au 26/12/2025 » et son montant légèrement décalé).
    for (let i = 0; i < lignes.length - 1; i++) {
      const a = lignes[i], b = lignes[i + 1];
      if (Math.abs(a.y - b.y) > 7) continue;
      const seulMontant = l => l.items.length > 0 && l.items.every(it => estMontant(it.str));
      const sansMontant = l => !l.items.some(it => estMontant(it.str));
      if ((seulMontant(a) && sansMontant(b)) || (seulMontant(b) && sansMontant(a))) {
        const texte = seulMontant(a) ? b : a;
        texte.items = texte.items.concat(seulMontant(a) ? a.items : b.items).sort((x, y) => x.x - y.x);
        lignes.splice(seulMontant(a) ? i : i + 1, 1);
        i--;
      }
    }
    pages.push(lignes);
  }
  await tache.destroy();
  return pages;
}

/** Trouve la ligne d'en-tête du tableau et la position des colonnes Débit / Crédit. */
function trouverEntete(lignes) {
  for (let i = 0; i < lignes.length; i++) {
    const its = lignes[i].items;
    const deb = its.find(it => /^d[ée]bit/i.test(it.str));
    const cre = its.find(it => /^cr[ée]dit/i.test(it.str));
    if (deb && cre) {
      const ope = its.find(it => /op[ée]ration|libell/i.test(it.str));
      const dat = its.find(it => /^date$/i.test(it.str.trim()));
      return { index: i, dateX: dat ? dat.x : null, debit: deb.x + deb.w / 2, credit: cre.x + cre.w / 2, debitDroite: deb.x + deb.w, creditDroite: cre.x + cre.w, texteX: ope ? ope.x - 5 : null };
    }
  }
  return null;
}

/** Transforme les lignes positionnées en lignes "brutes" pour Logic.rowsToReleve. */
function lignesEnRows(pages) {
  const rows = [];
  let cols = null;
  const brut = [];
  for (const lignes of pages) {
    const ent = trouverEntete(lignes);
    let debut = 0;
    if (ent) { cols = ent; debut = ent.index + 1; }
    for (let i = debut; i < lignes.length; i++) {
      // Marques imprimées dans la marge gauche (CIC : « V », « 0 », « X », codes de tri) : ignorées
      const its = cols && cols.dateX != null ? lignes[i].items.filter(it => it.x >= cols.dateX - 25) : lignes[i].items;
      if (!its.length) continue;
      // Pied de page : le reste de la page n'appartient plus au tableau des opérations
      const texteLigne = Logic.norm(its.map(it => it.str).join(' '));
      if (/<< ?SUITE AU VERSO|INFORMATION SUR LA PROTECTION DES COMPTES|MEDIATEUR DU |RCS PARIS|\bORIAS\b|CAPITAL SOCIAL|AU CAPITAL DE/.test(texteLigne)) break;
      brut.push(its.map(it => it.str).join(' '));
      if (!cols) continue; // avant le premier tableau : en-tête de la banque
      let date = null, dateValeur = null, debit = null, credit = null;
      const textes = [];
      its.forEach((it, k) => {
        const s = it.str;
        const dansColonneDate = cols.texteX == null || it.x < cols.texteX + 2;
        if ((RE_DATE.test(s) || RE_DATE_COURTE.test(s)) && dansColonneDate && (date == null || dateValeur == null) && textes.length === 0) {
          const v = RE_DATE.test(s) ? Logic.parseDate(s) : { courte: s };
          if (!date) date = v; else dateValeur = v;
          return;
        }
        if (RE_MONTANT.test(s.replace(/\s/g, ' '))) {
          // Un montant n'est retenu que s'il est aligné sous la colonne Débit ou Crédit :
          // un montant écrit dans le libellé (« TROP PERÇU 12,50 EUR ») reste du texte.
          const centre = it.x + it.w / 2, droite = it.x + it.w;
          const dDeb = Math.min(Math.abs(centre - cols.debit), Math.abs(droite - cols.debitDroite));
          const dCre = Math.min(Math.abs(centre - cols.credit), Math.abs(droite - cols.creditDroite));
          const largeur = Math.abs(cols.credit - cols.debit) || 70;
          const tolerance = Math.max(25, largeur * 0.6);
          if (Math.min(dDeb, dCre) <= tolerance) {
            const v = Logic.parseMontant(s);
            if (dDeb <= dCre) { if (debit != null) textes.push(s); else debit = v; }
            else { if (credit != null) textes.push(s); else credit = v; }
            return;
          }
        }
        textes.push(s);
      });
      const texte = textes.join(' ');
      // Ligne d'en-tête répétée, pied de page...
      if (/^date\b.*(d[ée]bit|cr[ée]dit)/i.test(texte)) continue;
      if (/^page \d+|^\d+\s*\/\s*\d+$/i.test(texte) && !date) continue;
      // Une ligne de détail (sans date) commence sous la colonne « Opération » ; une ligne qui commence
      // tout à gauche de la page (mentions légales, pied de page) n'appartient pas à une opération.
      const premier = its[0];
      if (!date && cols.texteX != null && premier && premier.x < cols.texteX - 25 && !/SOLDE|TOTAL/i.test(texte) && debit == null && credit == null) continue;
      rows.push({ date, dateValeur, texte, debit, credit });
    }
  }
  return { rows, brut, colonnesTrouvees: !!cols };
}

/**
 * Dates sans année (« 29/12 ») : l'année est déduite de la date la plus récente écrite en entier
 * dans le relevé (« Nouveau solde au 07/01/2026 ») : 02/01 → 2026, 29/12 → 2025.
 */
function completerAnnees(rows, brut) {
  const completes = [];
  for (const l of brut) for (const m of l.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) { const d = Logic.parseDate(m[0]); if (d) completes.push(d); }
  const soldes = brut.filter(l => /solde/i.test(l)).flatMap(l => [...l.matchAll(/\d{1,2}\/\d{1,2}\/\d{4}/g)].map(m => Logic.parseDate(m[0]))).filter(Boolean);
  const ref = (soldes.length ? soldes : completes).sort().pop() || new Date().toISOString().slice(0, 10);
  const limite = new Date(Date.parse(ref) + 10 * 86400000).toISOString().slice(0, 10);
  const resoudre = v => {
    if (!v || typeof v === 'string') return v;
    const [j, m] = v.courte.split('/').map(Number);
    let y = +ref.slice(0, 4);
    let d = Logic.parseDate(`${j}/${m}/${y}`);
    if (d && d > limite) d = Logic.parseDate(`${j}/${m}/${y - 1}`);
    return d;
  };
  for (const r of rows) { r.date = resoudre(r.date); r.dateValeur = resoudre(r.dateValeur); }
}

async function lireReleve(data) {
  const pages = await lignesDuPdf(data);
  const { rows, brut, colonnesTrouvees } = lignesEnRows(pages);
  completerAnnees(rows, brut);
  if (!colonnesTrouvees) {
    return { operations: [], soldes: [], ignorees: [], erreur: "Je n'ai pas trouvé le tableau des opérations (colonnes « Débit » et « Crédit ») dans ce PDF.", brut };
  }
  const releve = Logic.rowsToReleve(rows);
  // Les lignes avant la première opération (hors soldes) sont le plus souvent des en-têtes de pages
  releve.brut = brut;
  return releve;
}

module.exports = { lireReleve, lignesDuPdf, lignesEnRows };
