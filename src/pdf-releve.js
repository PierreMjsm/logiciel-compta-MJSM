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
      return { index: i, debit: deb.x + deb.w / 2, credit: cre.x + cre.w / 2, debitDroite: deb.x + deb.w, creditDroite: cre.x + cre.w, texteX: ope ? ope.x - 5 : null };
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
      const its = lignes[i].items;
      brut.push(its.map(it => it.str).join(' '));
      if (!cols) continue; // avant le premier tableau : en-tête de la banque
      let date = null, dateValeur = null, debit = null, credit = null;
      const textes = [];
      its.forEach((it, k) => {
        const s = it.str;
        if (RE_DATE.test(s) && (cols.texteX == null || it.x < cols.texteX + 2) && (date == null || dateValeur == null) && textes.length === 0) {
          if (!date) date = Logic.parseDate(s); else dateValeur = Logic.parseDate(s);
          return;
        }
        if (RE_MONTANT.test(s.replace(/\s/g, ' ')) && it.x > ((cols.texteX || 0) + 60)) {
          const centre = it.x + it.w / 2, droite = it.x + it.w;
          const dDeb = Math.min(Math.abs(centre - cols.debit), Math.abs(droite - cols.debitDroite));
          const dCre = Math.min(Math.abs(centre - cols.credit), Math.abs(droite - cols.creditDroite));
          const v = Logic.parseMontant(s);
          if (dDeb <= dCre) debit = v; else credit = v;
          return;
        }
        textes.push(s);
      });
      const texte = textes.join(' ');
      // Ligne d'en-tête répétée, pied de page...
      if (/^date\b.*(d[ée]bit|cr[ée]dit)/i.test(texte)) continue;
      if (/^page \d+|^\d+\s*\/\s*\d+$/i.test(texte) && !date) continue;
      rows.push({ date, dateValeur, texte, debit, credit });
    }
  }
  return { rows, brut, colonnesTrouvees: !!cols };
}

async function lireReleve(data) {
  const pages = await lignesDuPdf(data);
  const { rows, brut, colonnesTrouvees } = lignesEnRows(pages);
  if (!colonnesTrouvees) {
    return { operations: [], soldes: [], ignorees: [], erreur: "Je n'ai pas trouvé le tableau des opérations (colonnes « Débit » et « Crédit ») dans ce PDF.", brut };
  }
  const releve = Logic.rowsToReleve(rows);
  // Les lignes avant la première opération (hors soldes) sont le plus souvent des en-têtes de pages
  releve.brut = brut;
  return releve;
}

module.exports = { lireReleve, lignesDuPdf, lignesEnRows };
