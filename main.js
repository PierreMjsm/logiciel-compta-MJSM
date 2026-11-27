'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { lireReleve } = require('./src/pdf-releve.js');
const { classeur } = require('./src/xlsx.js');
const { FICHIERS, FICHIER_ANCIEN_ACEL, separerAcel } = require('./src/modeles.js');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
let fenetre = null;

function lireConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { return {}; }
}
function ecrireConfig(c) {
  fs.mkdirSync(path.dirname(CONFIG()), { recursive: true });
  fs.writeFileSync(CONFIG(), JSON.stringify(c, null, 2));
}
function cheminAsso(id) {
  const c = lireConfig();
  if (!c.dossier) throw new Error('Aucun dossier de données choisi.');
  return path.join(c.dossier, FICHIERS[id] || (id + '.compta.json'));
}
function mtime(p) { try { return fs.statSync(p).mtimeMs; } catch { return null; } }

/** Copie de sauvegarde une fois par jour, on garde les 30 dernières par association. */
function sauvegarde(p) {
  if (!fs.existsSync(p)) return;
  const dossier = path.join(path.dirname(p), 'Sauvegardes');
  fs.mkdirSync(dossier, { recursive: true });
  const jour = new Date().toISOString().slice(0, 10);
  const base = path.basename(p, '.compta.json');
  const cible = path.join(dossier, `${base} ${jour}.json`);
  if (!fs.existsSync(cible)) fs.copyFileSync(p, cible);
  const anciens = fs.readdirSync(dossier).filter(f => f.startsWith(base + ' ') && f.endsWith('.json')).sort();
  while (anciens.length > 30) fs.unlinkSync(path.join(dossier, anciens.shift()));
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 650,
    title: 'Compta Banque – ACEL & Jeunes de Saint-Médard',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f4f2ec',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  fenetre.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  fenetre.on('focus', () => fenetre.webContents.send('focus'));
  // Avant de fermer : laisser l'interface enregistrer la dernière modification
  let fermeturePrete = false;
  fenetre.on('close', e => {
    if (fermeturePrete) return;
    e.preventDefault();
    fenetre.webContents.send('avant-fermeture');
    setTimeout(() => { fermeturePrete = true; if (!fenetre.isDestroyed()) fenetre.close(); }, 8000);
  });
  ipcMain.removeHandler('app:fermer');
  ipcMain.handle('app:fermer', () => { fermeturePrete = true; setImmediate(() => { if (!fenetre.isDestroyed()) fenetre.close(); }); });
  fenetre.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') fenetre.webContents.toggleDevTools();
  });
}

ipcMain.handle('config:lire', () => lireConfig());
ipcMain.handle('config:ecrire', (_e, partiel) => { const c = Object.assign(lireConfig(), partiel); ecrireConfig(c); return c; });
ipcMain.handle('config:choisirDossier', async () => {
  const r = await dialog.showOpenDialog(fenetre, {
    title: 'Dossier où ranger les données (par exemple dans OneDrive)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const c = Object.assign(lireConfig(), { dossier: r.filePaths[0] });
  ecrireConfig(c);
  return c;
});

/**
 * Passage à 3 espaces : si l'ancien fichier ACEL (comptes 01 et 02 ensemble) existe encore,
 * il est séparé en deux fichiers, puis renommé « (avant séparation) » pour ne plus être relu.
 */
function separerAncienAcel() {
  const c = lireConfig();
  if (!c.dossier) return;
  const ancien = path.join(c.dossier, FICHIER_ANCIEN_ACEL);
  if (!fs.existsSync(ancien)) return;
  const p1 = path.join(c.dossier, FICHIERS['acel-01']), p2 = path.join(c.dossier, FICHIERS['acel-02']);
  if (fs.existsSync(p1) || fs.existsSync(p2)) return;
  const donnees = JSON.parse(fs.readFileSync(ancien, 'utf8'));
  const parts = separerAcel(donnees);
  fs.writeFileSync(p1, JSON.stringify(Object.assign(parts['acel-01'], { revision: 1 }), null, 1));
  fs.writeFileSync(p2, JSON.stringify(Object.assign(parts['acel-02'], { revision: 1 }), null, 1));
  fs.renameSync(ancien, path.join(c.dossier, 'ACEL Saint-Médard (avant séparation des comptes).json'));
}

ipcMain.handle('asso:charger', (_e, id) => {
  if (id === 'acel-01' || id === 'acel-02') separerAncienAcel();
  const p = cheminAsso(id);
  if (!fs.existsSync(p)) return { data: null, mtime: null, chemin: p };
  return { data: JSON.parse(fs.readFileSync(p, 'utf8')), mtime: mtime(p), chemin: p };
});
ipcMain.handle('asso:mtime', (_e, id) => mtime(cheminAsso(id)));
/** Numéro de version des données enregistrées dans le fichier (augmente à chaque enregistrement). */
function revisionFichier(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).revision || 0; } catch { return null; }
}
ipcMain.handle('asso:revision', (_e, id) => revisionFichier(cheminAsso(id)));
ipcMain.handle('asso:sauver', (_e, id, data, revisionAttendue) => {
  const p = cheminAsso(id);
  // Conflit = quelqu'un d'autre a enregistré depuis notre dernière lecture (comparaison du numéro
  // de révision, plus fiable que la date du fichier, que OneDrive peut modifier en synchronisant).
  if (fs.existsSync(p)) {
    const actuelle = revisionFichier(p);
    if (actuelle !== null && actuelle !== (revisionAttendue || 0)) return { conflit: true, revision: actuelle };
  }
  sauvegarde(p);
  const copie = Object.assign({}, data, { revision: (revisionAttendue || 0) + 1, enregistreLe: new Date().toISOString() });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(copie, null, 1));
  // relecture de contrôle avant de remplacer le vrai fichier
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, p);
  return { ok: true, revision: copie.revision, mtime: mtime(p) };
});
ipcMain.handle('asso:copieConflit', (_e, id, data, motif) => {
  const p = cheminAsso(id);
  const dossier = path.join(path.dirname(p), 'Sauvegardes');
  fs.mkdirSync(dossier, { recursive: true });
  const quoi = String(motif || 'conflit').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
  const nom = `${path.basename(p, '.compta.json')} ${quoi} ${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(dossier, nom), JSON.stringify(data, null, 1));
  return nom;
});
ipcMain.handle('asso:importerFichier', async (_e, id) => {
  const r = await dialog.showOpenDialog(fenetre, {
    title: 'Choisir un fichier de données (.json)', properties: ['openFile'],
    filters: [{ name: 'Données Compta Banque', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  if (!data || !Array.isArray(data.operations)) throw new Error("Ce fichier n'est pas un fichier de données Compta Banque.");
  return data;
});

ipcMain.handle('pdf:ouvrir', async () => {
  const r = await dialog.showOpenDialog(fenetre, {
    title: 'Choisir un ou plusieurs relevés PDF', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Relevés PDF', extensions: ['pdf'] }],
  });
  if (r.canceled) return [];
  const res = [];
  for (const f of r.filePaths) {
    try { res.push(Object.assign({ nom: path.basename(f), cheminSource: f }, await lireReleve(fs.readFileSync(f)))); }
    catch (err) { res.push({ nom: path.basename(f), erreur: 'Lecture impossible : ' + err.message, operations: [], soldes: [] }); }
  }
  return res;
});
ipcMain.handle('pdf:lireChemin', async (_e, f) => {
  try { return Object.assign({ nom: path.basename(f), cheminSource: f }, await lireReleve(fs.readFileSync(f))); }
  catch (err) { return { nom: path.basename(f), erreur: 'Lecture impossible : ' + err.message, operations: [], soldes: [] }; }
});

/* Relevés PDF d'origine : copiés dans « Relevés/<espace>/<année>/ » du dossier des données (partagé). */
const nomSur = n => String(n).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'releve';
ipcMain.handle('releve:archiver', (_e, source, espace, annee, nom) => {
  const c = lireConfig();
  const rel = path.join('Relevés', nomSur(espace), nomSur(annee || 'sans date'));
  fs.mkdirSync(path.join(c.dossier, rel), { recursive: true });
  const ext = path.extname(nom) || '.pdf', base = path.basename(nom, ext);
  let cible = path.join(rel, nomSur(base) + ext), i = 2;
  while (fs.existsSync(path.join(c.dossier, cible))) cible = path.join(rel, `${nomSur(base)} (${i++})${ext}`);
  fs.copyFileSync(source, path.join(c.dossier, cible));
  return cible.split(path.sep).join('/');
});
ipcMain.handle('releve:ouvrir', async (_e, rel) => {
  const p = path.join(lireConfig().dossier, ...String(rel).split('/'));
  if (!p.startsWith(lireConfig().dossier) || !fs.existsSync(p)) return 'fichier absent du dossier des données';
  return shell.openPath(p);
});
ipcMain.handle('releve:retirer', (_e, rel) => {
  const c = lireConfig();
  const p = path.join(c.dossier, ...String(rel).split('/'));
  if (!p.startsWith(c.dossier) || !fs.existsSync(p)) return;
  const dossier = path.join(c.dossier, 'Sauvegardes', 'Relevés supprimés');
  fs.mkdirSync(dossier, { recursive: true });
  fs.renameSync(p, path.join(dossier, `${new Date().toISOString().slice(0, 10)} ${path.basename(p)}`));
});

ipcMain.handle('excel:exporter', async (_e, feuilles, nomParDefaut) => {
  const c = lireConfig();
  const r = await dialog.showSaveDialog(fenetre, {
    title: 'Enregistrer l\'export pour le comptable',
    defaultPath: path.join(c.dossierExport || c.dossier || app.getPath('documents'), nomParDefaut),
    filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, classeur(feuilles));
  ecrireConfig(Object.assign(lireConfig(), { dossierExport: path.dirname(r.filePath) }));
  return r.filePath;
});
/** Enregistre la page affichée en PDF (mise en page « impression » : sans menus ni boutons, A4 paysage). */
ipcMain.handle('pdf:enregistrerPage', async (_e, nomParDefaut, options = {}) => {
  const c = lireConfig();
  const r = await dialog.showSaveDialog(fenetre, {
    title: 'Enregistrer en PDF',
    defaultPath: path.join(c.dossierExport || c.dossier || app.getPath('documents'), nomParDefaut),
    filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  // Tableaux : A4 paysage. Courrier (demande de subvention) : A4 portrait (la page fournit sa règle @page).
  const pdf = await fenetre.webContents.printToPDF(options.portrait
    ? { landscape: false, printBackground: true, pageSize: 'A4', preferCSSPageSize: true }
    : { landscape: true, printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
  fs.writeFileSync(r.filePath, pdf);
  ecrireConfig(Object.assign(lireConfig(), { dossierExport: path.dirname(r.filePath) }));
  return r.filePath;
});
ipcMain.handle('shell:ouvrir', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:montrer', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('app:version', () => app.getVersion());

app.whenReady().then(creerFenetre);
app.on('window-all-closed', () => app.quit());
