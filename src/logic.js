/* Logique commune : utilisée par l'interface (navigateur) et par le processus principal / les tests (Node). */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.Logic = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const A_CLASSER = 'À classer';
  const N1_NOM = 'N-1 (année précédente)';

  /** La catégorie est-elle celle des dépenses/recettes de l'année précédente ? */
  function estN1(nom, categories) {
    if (!nom) return false;
    const c = (categories || []).find(x => x.nom === nom);
    return !!(c && c.type === 'n-1');
  }

  const MOIS_ABR = ['JAN', 'JANV', 'JANVIER', 'FEV', 'FEVR', 'FEVRIER', 'MARS', 'MAR', 'AVR', 'AVRIL', 'MAI', 'JUIN', 'JUIL', 'JUILLET', 'AOUT', 'SEPT', 'SEP', 'SEPTEMBRE', 'OCT', 'OCTOBRE', 'NOV', 'NOVEMBRE', 'DEC', 'DECEMBRE'];

  /**
   * L'opération fait-elle référence à l'année précédente (ex. « 202512 », « SOLDE 2025 », « DEC 2025 », « 12/2025 ») ?
   * Seulement pour les opérations du premier semestre. Renvoie le morceau de texte trouvé, ou null.
   */
  function suggereN1(op) {
    if (!op || !op.date) return null;
    const y = +op.date.slice(0, 4), m = +op.date.slice(5, 7);
    if (m > 6) return null;
    const p = String(y - 1);
    const texte = norm([op.libelle].concat(op.details || []).join(' '));
    const motifs = [
      new RegExp('\\b((?:' + MOIS_ABR.join('|') + ')\\.? ?' + p + ')(?![0-9])'),              // DEC 2025
      new RegExp('(?:^|[^0-9])((?:0?[1-9]|1[0-2])[\\/.-]' + p + ')(?![0-9])'),               // 12/2025
      new RegExp('(?:^|[^0-9])(' + p + '(?:0[1-9]|1[0-2]))(?![0-9])'),                       // 202512 / 202512M
      new RegExp('(?:^|[^0-9])(' + p + ')(?![0-9])'),                                        // 2025 seul
    ];
    for (const re of motifs) { const r = texte.match(re); if (r) return r[1]; }
    return null;
  }

  /**
   * Garantit une catégorie N-1 (type 'n-1'). Les anciennes catégories nommées par une année
   * (ex. « 2025 » dans le classeur Excel) y sont fusionnées. Renvoie true si quelque chose a changé.
   */
  function migrerN1(data) {
    let change = false;
    data.categories = data.categories || [];
    let n1 = data.categories.find(c => c.type === 'n-1');
    if (!n1) {
      n1 = data.categories.find(c => c.nom === N1_NOM);
      if (n1) n1.type = 'n-1';
      else { n1 = { nom: N1_NOM, compte: '', type: 'n-1' }; data.categories.unshift(n1); }
      change = true;
    }
    const annees = data.categories.filter(c => c !== n1 && /^(19|20)\d\d$/.test(String(c.nom).trim())).map(c => c.nom);
    if (annees.length) {
      const remplace = nom => annees.includes(nom) ? n1.nom : nom;
      data.categories = data.categories.filter(c => !annees.includes(c.nom));
      (data.regles || []).forEach(r => { r.categorie = remplace(r.categorie); });
      (data.operations || []).forEach(o => {
        if (o.categorie) o.categorie = remplace(o.categorie);
        (o.ventilation || []).forEach(v => { if (v.categorie) v.categorie = remplace(v.categorie); });
      });
      change = true;
    }
    return change;
  }

  /** Majuscules, sans accents, espaces simples. */
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
  }

  /** "51.112,32" / "616,8" / "616.80" / 616.8 -> nombre (ou null). */
  function parseMontant(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : null;
    let s = String(v).replace(/[\s  €]/g, '');
    if (!s) return null;
    let neg = false;
    if (/^-/.test(s)) { neg = true; s = s.slice(1); }
    if (/,/.test(s) && /\./.test(s)) {
      // les deux séparateurs : le dernier est le séparateur décimal (1.234,56 ou 1,234.56)
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (/,/.test(s)) {
      if ((s.match(/,/g) || []).length > 1) return null;
      s = s.replace(',', '.');
    } else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Math.round(parseFloat(s) * 100) / 100;
    return neg ? -n : n;
  }

  /** "05/01/2026", "05/01/26", "2026-01-05", Date -> "2026-01-05" (ou null). */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) {
      return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      const d = +m[1], mo = +m[2];
      if (mo < 1 || mo > 12 || d < 1 || d > joursDuMois(y, mo)) return null;
      return y + '-' + pad(mo) + '-' + pad(d);
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= joursDuMois(+m[1], +m[2])) return m[1] + '-' + m[2] + '-' + m[3];
    return null;
  }
  function joursDuMois(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Calculs en centimes entiers : aucune erreur d'arrondi, quel que soit le nombre d'opérations. */
  const cts = n => Math.round((+n || 0) * 100);
  const deCts = c => c / 100;
  function somme(valeurs) { return deCts(valeurs.reduce((t, v) => t + cts(v), 0)); }

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d + '/' + m + '/' + y;
  }
  function formatMontant(n) {
    if (n == null || n === '' || isNaN(n)) return '';
    return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Moyen de paiement, même logique que la formule Excel (dans un ordre plus sûr). */
  function detectMoyen(libelle) {
    const t = norm(libelle);
    if (/REM(ISE)? ?CH(Q|EQUE)/.test(t)) return 'Remise chèque';
    if (/CHEQUE|\bCHQ\b/.test(t)) return 'Chèque';
    if (/REDEVANCE/.test(t)) return 'Redevance';
    if (/VERSEMENT/.test(t)) return 'Versement';
    if (/\bVIR\b|VIREMENT/.test(t)) return 'Virement';
    if (/\bPRLV\b|PRELEVEMENT/.test(t)) return 'Prélèvement';
    if (/\bCB\b|PAIEMENT PSC|CARTE \d{4}/.test(t)) return 'Carte bancaire';
    if (/\bRETRAIT\b|\bDAB\b/.test(t)) return 'Retrait';
    if (/\bFRAIS\b|COMMISSION|COTIS/.test(t)) return 'Frais bancaires';
    if (/FACT/.test(t)) return 'Facture';
    return 'Autre';
  }

  /** Règles triées : la plus longue (la plus précise) gagne. */
  function prepareRegles(regles) {
    return (regles || [])
      .filter(r => r && norm(r.motcle) && r.categorie)
      .map(r => ({ motcle: norm(r.motcle), re: motifMot(norm(r.motcle)), categorie: r.categorie, src: r }))
      .sort((a, b) => b.motcle.length - a.motcle.length);
  }

  /**
   * Le mot-clé doit commencer un mot : « SCOUT » trouve « SCOUTS », mais « SFR » ne trouve pas « BOUSFR ».
   */
  function motifMot(motNorm) { return new RegExp('(^|[^A-Z0-9])' + motNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }
  function contientMot(texte, motNorm) { return !!motNorm && motifMot(motNorm).test(norm(texte)); }

  /** Catégorie automatique : cherche d'abord dans le libellé, puis dans les lignes de détail. */
  function autoCategorie(op, reglesPreparees) {
    const lib = norm(op.libelle);
    for (const r of reglesPreparees) if (r.re.test(lib)) return r;
    const det = norm((op.details || []).join(' '));
    if (det) for (const r of reglesPreparees) if (r.re.test(det)) return r;
    return null;
  }

  function categorieDe(op, reglesPreparees) {
    if (op.categorie) return op.categorie;
    const r = autoCategorie(op, reglesPreparees);
    return r ? r.categorie : A_CLASSER;
  }

  /**
   * Une opération peut être ventilée en plusieurs parts (ex. une remise de chèques
   * qui mélange plusieurs catégories). Renvoie toujours une liste de parts.
   */
  function partsDe(op, reglesPreparees) {
    const v = op.ventilation;
    if (v && v.length) {
      const parts = v.map((p, i) => ({
        index: i, categorie: p.categorie || A_CLASSER,
        debit: op.debit ? Math.abs(p.montant || 0) : 0,
        credit: op.debit ? 0 : Math.abs(p.montant || 0),
        facture: p.facture || '', note: p.note || '', ventile: true,
      }));
      // Ventilation incomplète ou trop forte : la différence reste « À classer »,
      // pour que la somme des parts soit toujours égale au montant de la banque.
      const reste = resteVentilation(op);
      if (reste) parts.push({ index: parts.length, categorie: A_CLASSER, debit: op.debit ? reste : 0, credit: op.debit ? 0 : reste, facture: '', note: '', ventile: true, reste: true });
      return parts;
    }
    return [{ index: 0, categorie: categorieDe(op, reglesPreparees), debit: op.debit || 0, credit: op.credit || 0, facture: op.facture || '', note: op.note || '', ventile: false }];
  }

  /** Reste à ventiler (0 si la ventilation est complète). */
  function resteVentilation(op) {
    if (!op.ventilation || !op.ventilation.length) return 0;
    const total = cts(Math.abs((op.credit || 0) - (op.debit || 0)));
    const total2 = op.ventilation.reduce((t, p) => t + cts(Math.abs(p.montant || 0)), 0);
    return deCts(total - total2);
  }

  /** Propose un mot-clé à partir d'un libellé : retire les préfixes bancaires, dates et numéros. */
  function suggestMotcle(libelle) {
    let t = norm(libelle);
    t = t.replace(/^(VIR(EMENT)?( SEPA)?( INST)?( RECU)?|PRLV( SEPA)?|PAIEMENT (CB|PSC)( \d{4})?|CB \d{4}|REM CHQ|CHEQUE)\s+/, '');
    t = t.replace(/\b\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?\b/g, ' ');
    t = t.replace(/\b\d{4,}\b/g, ' ');
    t = t.replace(/\bCARTE \d{4}\b/g, ' ');
    // retire les mots qui contiennent des chiffres (références, numéros de chèque…)
    t = t.split(' ').filter(m => !/\d/.test(m) && /[A-Z]/.test(m)).join(' ');
    t = t.replace(/[^A-Z]+$/, '').replace(/^[^A-Z]+/, '').replace(/\s+/g, ' ').trim();
    return t.replace(/[^A-Z]/g, '').length >= 3 ? t : '';
  }

  /** Clé pour repérer les doublons. */
  function opKey(op) {
    const montant = Math.round(((op.credit || 0) - (op.debit || 0)) * 100);
    return [op.compte || '', op.date, montant, norm(op.libelle).replace(/[^A-Z0-9]/g, '')].join('|');
  }

  function cleProbable(op) { return [op.compte || '', op.date, cts((op.credit || 0) - (op.debit || 0))].join('|'); }

  /**
   * Marque les doublons d'un import par rapport aux opérations existantes, en comptant :
   * si 2 opérations identiques existent déjà et que le relevé en contient 3, seule la 3e est nouvelle.
   * 'exact' : même compte, date, montant et libellé. 'probable' : même compte, date et montant, libellé différent
   * (ex. même relevé lu une fois en PDF et une fois en copier-coller).
   */
  function marquerDoublons(nouvelles, existantes) {
    const exact = new Map(), prob = new Map();
    const ajoute = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    const prend = (m, k) => { const n = m.get(k) || 0; if (n > 0) { m.set(k, n - 1); return true; } return false; };
    for (const o of existantes) { ajoute(exact, opKey(o)); }
    const restant = [];
    for (const o of nouvelles) {
      if (prend(exact, opKey(o))) o._doublon = 'exact';
      else { o._doublon = null; restant.push(o); }
    }
    // pour les probables : seulement les existantes qui n'ont pas déjà servi de doublon exact
    const exactRestant = new Map(exact);
    for (const o of existantes) if ((exactRestant.get(opKey(o)) || 0) > 0) { exactRestant.set(opKey(o), exactRestant.get(opKey(o)) - 1); ajoute(prob, cleProbable(o)); }
    for (const o of restant) if (prend(prob, cleProbable(o))) o._doublon = 'probable';
    return nouvelles;
  }

  function montantSigne(op) { return Math.round(((op.credit || 0) - (op.debit || 0)) * 100) / 100; }

  /**
   * Transforme des lignes "brutes" (PDF ou copier-coller) en opérations.
   * row = { date, dateValeur, texte, debit, credit }
   */
  function rowsToReleve(rows) {
    const operations = [];
    const soldes = [];
    const ignorees = [];
    let totaux = null;
    let cur = null;
    const close = () => { if (cur) { operations.push(cur); cur = null; } };

    for (const row of rows) {
      const texte = String(row.texte || '').replace(/\s+/g, ' ').trim();
      const T = norm(texte);
      if (/SOLDE (CREDITEUR|DEBITEUR|AU) /.test(T) || /^(ANCIEN|NOUVEAU) SOLDE\b/.test(T) || (!row.date && /^SOLDE\b/.test(T) && (row.debit != null || row.credit != null))) {
        close();
        const md = texte.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        let montant = row.credit != null ? row.credit : (row.debit != null ? -row.debit : null);
        if (montant != null && /DEBITEUR/.test(T) && montant > 0) montant = -montant;
        if (montant != null) soldes.push({ date: parseDate(md ? md[1] : row.date) || row.date || null, montant, texte });
        continue;
      }
      if (/^TOTAL\b/.test(T) || /^TOTAUX\b/.test(T)) {
        close();
        // le total des opérations du relevé (pas un autre total, ex. récapitulatif annuel des frais en dernière page)
        const vraiTotal = /TOTAL DES (MOUVEMENTS|OPERATIONS)|^TOTAUX/.test(T);
        if ((row.debit != null || row.credit != null) && (vraiTotal || !totaux) && !(totaux && totaux.vrai))
          totaux = { debit: Math.abs(row.debit || 0), credit: Math.abs(row.credit || 0), vrai: vraiTotal };
        continue;
      }
      if (row.date) {
        close();
        if (!texte && row.debit == null && row.credit == null) continue;
        cur = {
          date: row.date,
          dateValeur: row.dateValeur || null,
          libelle: texte,
          details: [],
          debit: row.debit != null ? Math.abs(row.debit) : 0,
          credit: row.credit != null ? Math.abs(row.credit) : 0,
        };
        continue;
      }
      if (cur) {
        if (texte) {
          if (!cur.libelle) cur.libelle = texte;
          else if (norm(texte) !== norm(cur.libelle)) cur.details.push(texte);
        }
        if (!cur.debit && !cur.credit) {
          if (row.debit != null) cur.debit = Math.abs(row.debit);
          else if (row.credit != null) cur.credit = Math.abs(row.credit);
        }
      } else if (texte) {
        ignorees.push(texte);
      }
    }
    close();
    // Nettoyage : retire les détails qui répètent exactement le libellé
    for (const op of operations) {
      op.details = op.details.filter((d, i, a) => a.indexOf(d) === i);
      op.moyen = detectMoyen(op.libelle);
      if (op.debit && op.credit) op.anomalie = 'Débit et crédit lus sur la même ligne';
      // Libellé trop vague (La Banque Postale : « VIREMENT POUR », le nom est sur la ligne suivante) :
      // on ajoute le nom du bénéficiaire ou de l'émetteur, pour la lecture, les règles et les doublons.
      if (/^(VIREMENT( INSTANTANE| SEPA)?( RECU)? (POUR|DE|A)|PRELEVEMENT( SEPA)? DE|VIREMENT RECU DE)$/.test(norm(op.libelle)) && op.details[0]) {
        const nom = op.details[0].split(/\s+(COMPTE|REF\b|REFERENCE|FACT\.?)\b/)[0].trim().slice(0, 45).replace(/[\s\-–:.,]+$/, '');
        if (nom) op.libelle = op.libelle + ' ' + nom;
      }
    }
    return { operations: operations.filter(o => o.debit || o.credit), soldes, ignorees, totaux,
      sansMontant: operations.filter(o => !o.debit && !o.credit) };
  }

  /** Copier-coller depuis Excel (colonnes séparées par des tabulations). */
  function parseCollage(text) {
    const lignes = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
    const grille = lignes.map(l => l.split('\t').map(c => c.trim()));
    let iDate = -1, iVal = -1, iOp = -1, iDeb = -1, iCred = -1, debut = 0;
    for (let r = 0; r < Math.min(grille.length, 10); r++) {
      const cells = grille[r].map(norm);
      const d = cells.findIndex(c => /^DEBIT/.test(c));
      const c = cells.findIndex(c => /^CREDIT/.test(c));
      if (d >= 0 && c >= 0) {
        iDeb = d; iCred = c;
        iDate = cells.findIndex(x => /^DATE( OPERATION| OPE)?$/.test(x));
        iVal = cells.findIndex(x => /VALEUR/.test(x));
        iOp = cells.findIndex(x => /OPERATION|LIBELLE/.test(x) && !/^DATE/.test(x));
        debut = r + 1;
        break;
      }
    }
    const rows = [];
    for (let r = debut; r < grille.length; r++) {
      const cells = grille[r];
      let debit = null, credit = null, date = null, dateValeur = null;
      const textes = [];
      if (iDeb >= 0) {
        debit = parseMontant(cells[iDeb]);
        credit = parseMontant(cells[iCred]);
        if (iDate >= 0) date = parseDate(cells[iDate]);
        if (iVal >= 0) dateValeur = parseDate(cells[iVal]);
        cells.forEach((c, i) => {
          if (i === iDeb || i === iCred || i === iDate || i === iVal || !c) return;
          if (iDate < 0 && !date && parseDate(c)) { date = parseDate(c); return; }
          if (parseDate(c) && i < (iOp >= 0 ? iOp : 99)) { if (!date) date = parseDate(c); else if (!dateValeur) dateValeur = parseDate(c); return; }
          textes.push(c);
        });
      } else {
        // Pas d'en-tête : dates au début, deux dernières colonnes = débit / crédit
        const n = cells.length;
        if (n >= 3) { debit = parseMontant(cells[n - 2]); credit = parseMontant(cells[n - 1]); }
        cells.forEach((c, i) => {
          if (!c || (n >= 3 && i >= n - 2)) return;
          const d = parseDate(c);
          if (d && i < 2) { if (!date) date = d; else if (!dateValeur) dateValeur = d; return; }
          textes.push(c);
        });
      }
      rows.push({ date, dateValeur, texte: textes.join(' '), debit, credit });
    }
    return rowsToReleve(rows);
  }

  /** Contrôle : solde de départ + mouvements = solde final ? */
  function controleSoldes(releve) {
    const r2 = x => Math.round(x * 100) / 100;
    const debits = somme(releve.operations.map(o => o.debit));
    const credits = somme(releve.operations.map(o => o.credit));
    const res = { debits, credits, messages: [], ok: null };
    const s = releve.soldes || [];
    if (s.length >= 2) {
      res.debut = s[0].montant; res.fin = s[s.length - 1].montant;
      res.ecart = deCts(cts(res.debut) + cts(credits) - cts(debits) - cts(res.fin));
      res.ok = Math.abs(res.ecart) < 0.005;
      res.messages.push(res.ok
        ? 'Solde de départ + mouvements = solde final : le relevé est complet.'
        : 'Écart de ' + formatMontant(res.ecart) + ' € entre les soldes du relevé et les opérations lues.');
    }
    if (releve.totaux) {
      const okT = Math.abs(releve.totaux.debit - debits) < 0.005 && Math.abs(releve.totaux.credit - credits) < 0.005;
      if (!okT) res.messages.push('Totaux du relevé : ' + formatMontant(releve.totaux.debit) + ' € au débit, ' + formatMontant(releve.totaux.credit) + ' € au crédit ; lus : ' + formatMontant(debits) + ' € et ' + formatMontant(credits) + ' €.');
      res.ok = (res.ok !== false) && okT;
    }
    const anomalies = releve.operations.filter(o => o.anomalie);
    if (anomalies.length) {
      res.messages.push(anomalies.length + ' opération(s) avec un débit ET un crédit (à vérifier) : ' + anomalies.map(o => formatDate(o.date) + ' ' + o.libelle).join(' ; '));
      res.ok = false;
    }
    if (releve.sansMontant && releve.sansMontant.length) {
      res.messages.push(releve.sansMontant.length + ' opération(s) sans montant lisible : ' + releve.sansMontant.map(o => formatDate(o.date) + ' ' + o.libelle).join(' ; '));
      res.ok = false;
    }
    return res;
  }

  /**
   * Rapprochement : pour chaque relevé importé d'un compte, compare (solde début + opérations rattachées)
   * au solde de fin, et vérifie que le solde de fin d'un relevé = solde de début du suivant.
   * Détecte : opération supprimée ou ajoutée par erreur, doublon, relevé manquant.
   */
  function rapprochement(releves, operations, compte) {
    const tous = (releves || []).filter(r => r.compte === compte)
      .slice().sort((a, b) => (a.du || '').localeCompare(b.du || '') || (a.au || '').localeCompare(b.au || ''));
    const mvts = r => operations.filter(o => o.releve === r.id).reduce((t, o) => t + cts(o.credit) - cts(o.debit), 0);
    const res = [];
    let precedent = null, entreDeux = 0;
    for (const r of tous) {
      if (r.soldeDebut == null || r.soldeFin == null) {
        // relevé sans soldes (ex. copier-coller) : ses mouvements sont reportés sur le contrôle suivant
        if (precedent) entreDeux += mvts(r);
        continue;
      }
      const ops = operations.filter(o => o.releve === r.id);
      const mouvements = deCts(mvts(r));
      const ecart = deCts(cts(r.soldeDebut) + cts(mouvements) - cts(r.soldeFin));
      const rupture = precedent ? deCts(cts(r.soldeDebut) - cts(precedent.soldeFin) - entreDeux) : 0;
      res.push({ releve: r, nbOps: ops.length, mouvements, ecart, rupture, precedent: precedent ? precedent.nom : null });
      precedent = r; entreDeux = 0;
    }
    return res;
  }

  /** Solde connu le plus récent (fin du dernier relevé) + opérations postérieures non rattachées à un relevé. */
  function soldeActuel(releves, operations, compte) {
    const liste = (releves || []).filter(r => r.compte === compte && r.soldeFin != null).sort((a, b) => (a.au || '').localeCompare(b.au || ''));
    if (!liste.length) return null;
    const dernier = liste[liste.length - 1];
    const apres = operations.filter(o => o.compte === compte && !o.releve && o.date > dernier.au);
    const total = deCts(cts(dernier.soldeFin) + apres.reduce((t, o) => t + cts(o.credit) - cts(o.debit), 0));
    const derniereDate = apres.reduce((m, o) => o.date > m ? o.date : m, dernier.au);
    return { solde: total, date: derniereDate, releve: dernier.nom };
  }

  function moisDe(iso) { return iso ? iso.slice(0, 7) : ''; }

  return {
    A_CLASSER, N1_NOM, cts, deCts, somme, marquerDoublons, cleProbable, rapprochement, soldeActuel, estN1, migrerN1, suggereN1, norm, parseMontant, parseDate, formatDate, formatMontant, detectMoyen,
    prepareRegles, autoCategorie, contientMot, categorieDe, partsDe, resteVentilation, suggestMotcle, opKey, montantSigne,
    rowsToReleve, parseCollage, controleSoldes, moisDe,
  };
});
