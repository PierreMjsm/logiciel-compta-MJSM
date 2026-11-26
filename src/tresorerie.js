/* Trésorerie : solde à une date, reste disponible par mois, plan de trésorerie (demandes de subvention). */
(function (root, factory) {
  const lib = factory(typeof module === 'object' && module.exports ? require('./logic.js') : root.Logic);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.Tresorerie = lib;
})(typeof self !== 'undefined' ? self : this, function (Logic) {
  'use strict';

  const cts = Logic.cts, deCts = Logic.deCts;
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const finMois = (y, m) => { const d = new Date(Date.UTC(y, m, 0)); return d.toISOString().slice(0, 10); }; // m : 1..12
  const veille = iso => new Date(Date.parse(iso) - 86400000).toISOString().slice(0, 10);

  /**
   * Points de solde connus d'un compte : soldes lus sur les relevés (début et fin), solde saisi à la main.
   * Le solde « au 31/12 » comprend les opérations du 31/12.
   */
  function pointsDeSolde(data) {
    const compte = (data.comptes && data.comptes[0] || {}).id;
    const pts = [];
    for (const r of data.releves || []) {
      if (r.compte && compte && r.compte !== compte) continue;
      if (r.soldeDebut != null && r.du) pts.push({ date: r.du, montant: r.soldeDebut });
      if (r.soldeFin != null && r.au) pts.push({ date: r.au, montant: r.soldeFin });
    }
    for (const s of data.soldes || []) if (s.date && s.montant != null && (!compte || !s.compte || s.compte === compte)) pts.push({ date: s.date, montant: s.montant });
    if (data.soldeDepart && data.soldeDepart.date && data.soldeDepart.montant != null) pts.push({ date: data.soldeDepart.date, montant: data.soldeDepart.montant, manuel: true });
    return pts.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Solde du compte au soir d'une date : point connu le plus proche + opérations entre les deux. */
  function soldeAu(data, date) {
    const pts = pointsDeSolde(data);
    if (!pts.length) return null;
    const avant = pts.filter(p => p.date <= date).pop();
    const ops = data.operations || [];
    if (avant) {
      const mv = ops.filter(o => o.date > avant.date && o.date <= date).reduce((t, o) => t + cts(o.credit) - cts(o.debit), 0);
      return deCts(cts(avant.montant) + mv);
    }
    const apres = pts[0];
    const mv = ops.filter(o => o.date > date && o.date <= apres.date).reduce((t, o) => t + cts(o.credit) - cts(o.debit), 0);
    return deCts(cts(apres.montant) - mv);
  }

  /**
   * Reste disponible, mois par mois : solde de fin de mois moins une réserve pour les dépenses habituelles
   * (salaires, charges, loyer…) des mois à venir.
   * params : { habituelles: Set de catégories, moisReserve: nombre de mois à garder, marge: montant fixe en plus }
   */
  function resteDisponible(data, annee, params) {
    const y = +annee;
    const R = Logic.prepareRegles(data.regles);
    const hab = params.habituelles || new Set();
    const ops = data.operations || [];
    const derniere = ops.reduce((m, o) => o.date > m ? o.date : m, '');
    const dernierMois = derniere && derniere.startsWith(String(y)) ? +derniere.slice(5, 7) : (derniere > `${y}-12-31` ? 12 : 0);
    const lignes = [];
    const histo = []; // dépenses habituelles des mois précédents (pour la moyenne)
    // mois de l'année précédente pour amorcer la moyenne
    for (let m = 1; m <= 12; m++) histo.push(depensesHabituelles(ops, R, hab, `${y - 1}-${String(m).padStart(2, '0')}`));
    for (let m = 1; m <= dernierMois; m++) {
      const mois = `${y}-${String(m).padStart(2, '0')}`;
      const deb = soldeAu(data, veille(`${mois}-01`)), fin = soldeAu(data, finMois(y, m));
      let rec = 0, depHab = 0, depAutres = 0;
      for (const o of ops) {
        if (!o.date.startsWith(mois)) continue;
        for (const p of Logic.partsDe(o, R)) {
          rec += cts(p.credit);
          if (hab.has(p.categorie)) depHab += cts(p.debit); else depAutres += cts(p.debit);
        }
      }
      histo.push(depHab);
      const recents = histo.slice(-(params.fenetre || 6)).filter(x => x > 0);
      const moyenne = recents.length ? Math.round(recents.reduce((a, b) => a + b, 0) / recents.length) : 0;
      const reserve = Math.round(moyenne * (params.moisReserve == null ? 1 : params.moisReserve)) + cts(params.marge || 0);
      lignes.push({
        mois, libelle: `${MOIS[m - 1]} ${y}`, enCours: m === dernierMois && derniere < finMois(y, m),
        debut: deb, recettes: deCts(rec), habituelles: deCts(depHab), autres: deCts(depAutres), fin,
        moyenneHabituelles: deCts(moyenne), reserve: deCts(reserve), disponible: fin == null ? null : deCts(cts(fin) - reserve),
      });
    }
    return { annee: y, lignes, derniere, soldeConnu: pointsDeSolde(data).length > 0 };
  }

  function depensesHabituelles(ops, R, hab, mois) {
    let t = 0;
    for (const o of ops) if (o.date.startsWith(mois)) for (const p of Logic.partsDe(o, R)) if (hab.has(p.categorie)) t += cts(p.debit);
    return t;
  }

  /**
   * Plan de trésorerie d'une année, au format présenté à Avenir Censier :
   * trésorerie au 31/12, « facturés au 31/12 » (N-1 payés dans l'année), réalisé par trimestre jusqu'à la date
   * d'arrêté, lignes à part (loyers, subventions : une ligne par opération), puis prévisions saisies,
   * avec le solde cumulé à chaque ligne.
   * opts : { dateArrete, isolees: Set de catégories mises sur une ligne à part, previsions: [{libelle, date, recettes, depenses}] }
   */
  function planTresorerie(data, annee, opts) {
    const y = +annee;
    const R = Logic.prepareRegles(data.regles);
    const ops = (data.operations || []).filter(o => o.date >= `${y}-01-01` && o.date <= (opts.dateArrete || `${y}-12-31`));
    const isolees = opts.isolees || new Set();
    const lignes = [];
    const depart = soldeAu(data, `${y - 1}-12-31`);
    let solde = cts(depart || 0);
    const noms = opts.libelles || {};
    const nomme = l => Object.assign(l, { auto: l.libelle, libelle: (noms[l.cle] || '').trim() || l.libelle });
    const ajoute = (l) => {
      solde += cts(l.recettes || 0) - cts(l.depenses || 0);
      lignes.push(nomme(Object.assign({}, l, { solde: deCts(solde) })));
    };
    lignes.push(nomme({ type: 'depart', cle: 'depart', libelle: `Trésorerie au 31/12/${y - 1}`, solde: depart }));

    // N-1 payés ou encaissés dans l'année
    let n1R = 0, n1D = 0;
    const parts = [];
    for (const o of ops) for (const p of Logic.partsDe(o, R)) {
      if (Logic.estN1(p.categorie, data.categories)) { n1R += cts(p.credit); n1D += cts(p.debit); }
      else parts.push({ o, p });
    }
    if (n1R || n1D) ajoute({ type: 'reel', cle: 'n1', libelle: `Facturés au 31/12/${y - 1}`, recettes: deCts(n1R), depenses: deCts(n1D) });

    // Réalisé par trimestre, avec les lignes à part dans leur trimestre
    const arrete = opts.dateArrete || `${y}-12-31`;
    for (let t = 0; t < 4; t++) {
      const du = `${y}-${String(t * 3 + 1).padStart(2, '0')}-01`, auT = finMois(y, t * 3 + 3);
      if (du > arrete) break;
      const au = auT < arrete ? auT : arrete;
      let r = 0, d = 0;
      const aPart = [];
      for (const { o, p } of parts) {
        if (o.date < du || o.date > au) continue;
        if (isolees.has(p.categorie)) aPart.push({ o, p });
        else { r += cts(p.credit); d += cts(p.debit); }
      }
      const finLib = au === auT ? MOIS[t * 3 + 2] : `${+au.slice(8, 10)} ${MOIS[+au.slice(5, 7) - 1]}`;
      if (r || d) ajoute({ type: 'reel', cle: `T${t + 1}`, libelle: `${MOIS[t * 3]} à ${finLib} ${y}`, recettes: deCts(r), depenses: deCts(d) });
      aPart.sort((a, b) => a.o.date.localeCompare(b.o.date));
      for (const { o, p } of aPart) {
        ajoute({ type: 'reel', cle: `op:${o.id}:${p.categorie}`, libelle: libelleIsole(p.categorie, o, y), detail: o.libelle, date: o.date, recettes: p.credit || 0, depenses: p.debit || 0 });
      }
    }
    const soldeReel = deCts(solde);
    const soldeBanque = soldeAu(data, arrete);
    // Prévisions (saisies), dans l'ordre des dates
    for (const pv of (opts.previsions || []).filter(p => !p.date || p.date > arrete).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
      ajoute({ type: 'prevision', cle: 'pv:' + pv.id, libelle: pv.libelle, date: pv.date, recettes: +pv.recettes || 0, depenses: +pv.depenses || 0, id: pv.id });
    }
    return {
      annee: y, dateArrete: arrete, depart, lignes, soldeReel, soldeBanque, soldeFinal: deCts(solde),
      ecartBanque: soldeBanque == null ? null : deCts(cts(soldeBanque) - cts(soldeReel)),
    };
  }

  /**
   * Libellé d'une ligne à part : « Loyer 4e trimestre 2025 » si le libellé bancaire indique le trimestre
   * (« VIR LOYER 4ETRI 2025 », « LOYER 1ER TRIM 2026 »), sinon « Loyer avril 2026 ».
   */
  function libelleIsole(categorie, o, y) {
    const txt = Logic.norm([o.libelle, ...(o.details || [])].join(' '));
    const m = txt.match(/(?:^|[^0-9])([1-4])\s*(?:ER|EME|E|IEME)?\s*TRI(?:M|MESTRE)?\b\.?\s*(20\d\d)?/);
    if (m) return `${categorie} ${m[1] === '1' ? '1er' : m[1] + 'e'} trimestre ${m[2] || y}`;
    return `${categorie} ${MOIS[+o.date.slice(5, 7) - 1]} ${y}`;
  }

  /** Montant en toutes lettres (français), pour les lettres officielles : 60000 → « soixante mille ». */
  function enLettres(n) {
    n = Math.round(+n || 0);
    if (n === 0) return 'zéro';
    const u = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
    const d = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
    const deux = x => {
      if (x < 20) return u[x];
      const dz = Math.floor(x / 10), un = x % 10;
      if (dz === 7 || dz === 9) return d[dz] + (dz === 7 && un === 1 ? '-et-' : '-') + u[10 + un];
      if (dz === 8) return un ? 'quatre-vingt-' + u[un] : 'quatre-vingts';
      return d[dz] + (un === 1 ? '-et-un' : un ? '-' + u[un] : '');
    };
    const trois = (x, final) => {
      const c = Math.floor(x / 100), r = x % 100;
      let s = '';
      if (c) s = (c > 1 ? u[c] + ' cent' : 'cent') + (c > 1 && !r && final ? 's' : '');
      if (r) s += (s ? ' ' : '') + deux(r);
      return s;
    };
    const parts = [];
    const mil = Math.floor(n / 1e6), k = Math.floor((n % 1e6) / 1000), reste = n % 1000;
    if (mil) parts.push(trois(mil, true) + (mil > 1 ? ' millions' : ' million'));
    if (k) parts.push(k === 1 ? 'mille' : trois(k, false).replace(/quatre-vingts$/, 'quatre-vingt') + ' mille');
    if (reste) parts.push(trois(reste, true));
    return parts.join(' ');
  }

  // ------------------------------------------------------------ dépenses habituelles (reste disponible)
  const HABITUELLES = {
    jsm: ['Salaires', 'Charges sociales', 'Loyer et charges locatives', 'Assurances', 'Logiciels', 'Téléphone', 'Frais bancaires', 'Eau énergie', 'Impôts', 'Honoraires'],
    acel: ['Salaire', 'Charge', 'Charge sociale', 'Loyer', 'SCI', 'BANQUE'],
  };
  /** Première ouverture : coche « dépense habituelle » sur les catégories courantes (salaires, charges, loyer…). */
  function migrerHabituelles(data) {
    if (data.tresorerie) return false;
    const liste = HABITUELLES[String(data.id || '').startsWith('acel') ? 'acel' : 'jsm'];
    const n = s => Logic.norm(s).replace(/[^A-Z0-9]/g, '');
    for (const c of data.categories || []) if (liste.some(x => n(c.nom) === n(x) || n(c.nom).startsWith(n(x)))) c.habituelle = true;
    data.tresorerie = { moisReserve: 1, marge: 0 };
    return true;
  }

  // ------------------------------------------------------------ demandes de subvention (ACEL → Avenir Censier)
  const ENTETE_ACEL = {
    nom: 'ACEL SAINT MEDARD', sous: 'Maison des Jeunes de Saint Médard',
    adresse: '3 rue du Gril – 14 rue Censier\n75005 Paris', tel: '01 43 31 44 84', mail: 'acel@mjsm.fr', site: 'http://mjsm.club.fr', siret: '51869352800011', ville: 'Paris',
  };
  function nouvelleSubvention(annee, precedente) {
    const p = precedente || {};
    return {
      organisme: p.organisme || 'Association Avenir Censier\n14 rue Censier\n75005 Paris',
      motcle: p.motcle || 'AVENIR CENSIER',
      montantVote: p.montantVote || null, dateAG: '', objet: p.objet || 'destinée à couvrir les frais de fonctionnement de l\'association',
      signataire: p.signataire || 'Sophie Mancel', qualite: p.qualite || 'Présidente',
      copies: p.copies != null ? p.copies : 'Père Pascal Genin, vice-président\nMélanie Joffret, trésorière\nJean-Pierre Pery',
      isolees: p.isolees || ['Loyer', 'Subvention'],
      demandes: [
        { date: '', montant: null, echeance: `juin ${annee}`, lettre: null, previsions: [] },
        { date: '', montant: null, echeance: `décembre ${annee}`, lettre: null, previsions: [] },
      ],
    };
  }
  const eurTxt = n => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).replace(/ | /g, ' ') + ' €';
  const dateLongue = iso => iso ? `${+iso.slice(8, 10) === 1 ? '1er' : +iso.slice(8, 10)} ${MOIS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '…';
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const jourLong = iso => iso ? `${JOURS[new Date(iso + 'T12:00:00Z').getUTCDay()]} ${dateLongue(iso)}` : '…';

  /** Texte de la lettre (modifiable ensuite dans le logiciel). i : 0 = 1re demande, 1 = 2e demande. */
  function texteLettre(sub, annee, i, dateArrete) {
    const d = sub.demandes[i] || {}, autre = sub.demandes[1 - i] || {};
    const total = +sub.montantVote || 0, m = +d.montant || 0;
    const corps = i === 0 ? [
      `À la suite de l'Assemblée générale et du Conseil d'administration de notre association, réunis le ${jourLong(sub.dateAG)}, nous avons l'honneur de solliciter auprès de votre association une subvention de ${eurTxt(total)} (${enLettres(total)} euros) pour l'exercice ${annee}, ${sub.objet || ''}.`.replace(/, \.$/, '.'),
      `Nous vous serions reconnaissants de bien vouloir procéder à un premier versement de ${eurTxt(m)} (${enLettres(m)} euros)${autre.montant ? ` ; le second versement de ${eurTxt(+autre.montant)} fera l'objet d'une demande en ${autre.echeance || 'fin d\'année'}` : ''}.`,
    ] : [
      `Lors de son Assemblée générale du ${dateLongue(sub.dateAG)}, notre association a voté une demande de subvention de ${eurTxt(total)} (${enLettres(total)} euros) pour l'exercice ${annee}${autre.montant ? `, dont un premier versement de ${eurTxt(+autre.montant)} nous a été accordé` : ''}.`,
      `Nous avons l'honneur de solliciter le second versement, d'un montant de ${eurTxt(m)} (${enLettres(m)} euros).`,
    ];
    return ['Madame, Monsieur,', ...corps,
      `Vous trouverez ci-joint notre plan de trésorerie ${annee}, arrêté au ${dateLongue(dateArrete || d.date)}.`,
      'En vous remerciant par avance, nous vous prions d\'agréer, Madame, Monsieur, l\'expression de nos sincères salutations.'].join('\n\n');
  }

  /** Versements de l'organisme trouvés en banque dans l'année (mot-clé dans le libellé ou le détail). */
  function versementsTrouves(datas, annee, motcle) {
    if (!motcle) return [];
    const R = [{ motcle, categorie: 'x' }];
    const re = Logic.prepareRegles(R)[0].re;
    const out = [];
    for (const [espace, data] of Object.entries(datas)) {
      const Rg = Logic.prepareRegles(data.regles);
      for (const o of data.operations || []) {
        if (!o.credit || !String(o.date).startsWith(String(annee))) continue;
        const txt = Logic.norm([o.libelle, ...(o.details || [])].join(' '));
        if (re.test(txt)) out.push({ espace, op: o, categorie: Logic.categorieDe(o, Rg) });
      }
    }
    return out.sort((a, b) => a.op.date.localeCompare(b.op.date));
  }

  /**
   * Prévisions proposées après la date d'arrêté, par trimestre :
   * d'après l'année précédente si la banque la contient, sinon au rythme mensuel de l'année en cours ;
   * les catégories à part (loyer) répétées tous les 3 mois ; les versements de subvention restant à demander.
   */
  function proposerPrevisions(data, annee, dateArrete, sub) {
    const y = +annee, R = Logic.prepareRegles(data.regles);
    const isolees = new Set(sub.isolees || []);
    const estSubv = c => /SUBV/i.test(Logic.norm(c));
    const ops = data.operations || [];
    const partsEntre = (du, au) => {
      const out = [];
      for (const o of ops) if (o.date >= du && o.date <= au) for (const p of Logic.partsDe(o, R)) if (!Logic.estN1(p.categorie, data.categories)) out.push({ o, p });
      return out;
    };
    const decale = (iso, n) => `${+iso.slice(0, 4) + n}${iso.slice(4)}`.replace(/-02-29$/, '-02-28');
    const premiere = ops.reduce((m, o) => !m || o.date < m ? o.date : m, '');
    const precDispo = premiere && premiere <= `${y - 1}-01-31`;
    const out = [];
    const mensuel = (() => {
      const pp = partsEntre(`${y}-01-01`, dateArrete).filter(x => !isolees.has(x.p.categorie));
      const nbMois = Math.max(1, (+dateArrete.slice(5, 7) - 1) + (+dateArrete.slice(8, 10)) / 30);
      return { r: pp.reduce((t, x) => t + cts(x.p.credit), 0) / nbMois, d: pp.reduce((t, x) => t + cts(x.p.debit), 0) / nbMois };
    })();
    const arrondi = c => Math.round(c / 100);
    let du = new Date(Date.parse(dateArrete) + 86400000).toISOString().slice(0, 10);
    while (du <= `${y}-12-31`) {
      const q = Math.floor((+du.slice(5, 7) - 1) / 3);
      const au = finMois(y, q * 3 + 3);
      const debutLib = du.slice(8, 10) === '01' ? MOIS[+du.slice(5, 7) - 1] : `${+du.slice(8, 10)} ${MOIS[+du.slice(5, 7) - 1]}`;
      const lib = (debutLib === MOIS[q * 3 + 2] ? `${debutLib} ${y}` : `${debutLib} à ${du.slice(8, 10) === '01' ? '' : 'fin '}${MOIS[q * 3 + 2]} ${y}`) + ' (prévision)';
      let r, d;
      if (precDispo) {
        const pp = partsEntre(decale(du, -1), decale(au, -1));
        r = pp.filter(x => !isolees.has(x.p.categorie)).reduce((t, x) => t + cts(x.p.credit), 0);
        d = pp.filter(x => !isolees.has(x.p.categorie)).reduce((t, x) => t + cts(x.p.debit), 0);
        for (const x of pp.filter(x => isolees.has(x.p.categorie) && !estSubv(x.p.categorie))) {
          out.push({ libelle: libelleIsole(x.p.categorie, x.o, y - 1).replace(/trimestre (\d{4})$/, (_, a) => `trimestre ${+a + 1}`), date: decale(x.o.date, 1), recettes: arrondi(cts(x.p.credit)), depenses: arrondi(cts(x.p.debit)) });
        }
      } else {
        const jours = (Date.parse(au) - Date.parse(du)) / 86400000 + 1;
        const k = jours / 30.4;
        r = mensuel.r * k; d = mensuel.d * k;
      }
      out.push({ libelle: lib, date: au, recettes: arrondi(r), depenses: arrondi(d), periode: true });
      du = new Date(Date.parse(au) + 86400000).toISOString().slice(0, 10);
    }
    if (!precDispo) {
      // catégories à part (loyer…) : dernier montant de l'année, répété tous les 3 mois
      for (const cat of isolees) {
        if (estSubv(cat)) continue;
        const pp = partsEntre(`${y}-01-01`, dateArrete).filter(x => x.p.categorie === cat && x.p.debit);
        if (!pp.length) continue;
        const der = pp[pp.length - 1];
        let dt = der.o.date;
        const tri = libelleIsole(cat, der.o, y).match(/ (\d)(?:er|e) trimestre (\d{4})$/);
        let tn = tri ? +tri[1] : 0, ta = tri ? +tri[2] : 0;
        for (;;) {
          const m = +dt.slice(5, 7) + 3, yy = +dt.slice(0, 4) + (m > 12 ? 1 : 0), mm = ((m - 1) % 12) + 1;
          dt = `${yy}-${String(mm).padStart(2, '0')}-${dt.slice(8, 10)}`;
          if (dt > `${y}-12-31`) break;
          if (tri) { tn++; if (tn > 4) { tn = 1; ta++; } }
          if (dt > dateArrete) out.push({ libelle: tri ? `${cat} ${tn === 1 ? '1er' : tn + 'e'} trimestre ${ta}` : `${cat} ${MOIS[mm - 1]} ${y}`, date: dt, recettes: 0, depenses: arrondi(cts(der.p.debit)) });
        }
      }
    }
    // versements déjà reçus en banque à la date d'arrêté : ils sont dans le réalisé
    let recu = versementsTrouves({ x: data }, y, sub.motcle).filter(v => v.op.date <= dateArrete).length;
    for (const dm of sub.demandes || []) {
      if (!dm.montant) continue;
      if (recu > 0) { recu--; continue; }
      const quand = dm.date && dm.date > dateArrete ? dm.date : '';
      const mois = MOIS.findIndex(m => Logic.norm(dm.echeance || '').includes(Logic.norm(m)));
      let dt = quand || (mois >= 0 ? `${y}-${String(mois + 1).padStart(2, '0')}-15` : `${y}-12-15`);
      if (dt <= dateArrete) dt = new Date(Date.parse(dateArrete) + 86400000).toISOString().slice(0, 10); // demandé, pas encore reçu
      out.push({ libelle: `Subvention ${(sub.organisme || '').split('\n')[0].replace(/^Association /, '')} ${mois >= 0 ? MOIS[mois] : ''}`.trim(), date: dt, recettes: +dm.montant, depenses: 0 });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.periode ? -1 : 1));
  }

  return { libelleIsole, pointsDeSolde, soldeAu, resteDisponible, planTresorerie, enLettres, MOIS, finMois, HABITUELLES, migrerHabituelles, ENTETE_ACEL, nouvelleSubvention, texteLettre, versementsTrouves, proposerPrevisions, dateLongue };
});
