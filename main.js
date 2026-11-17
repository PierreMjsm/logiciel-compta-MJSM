'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { lireReleve } = require('./src/pdf-releve.js');
const { classeur } = require('./src/xlsx.js');
const { FICHIERS } = require('./src/modeles.js');

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

ipcMain.handle('asso:charger', (_e, id) => {
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
ipcMain.handle('asso:copieConflit', (_e, id, data) => {
  const p = cheminAsso(id);
  const dossier = path.join(path.dirname(p), 'Sauvegardes');
  fs.mkdirSync(dossier, { recursive: true });
  const nom = `${path.basename(p, '.compta.json')} conflit ${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
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
    try { res.push(Object.assign({ nom: path.basename(f) }, await lireReleve(fs.readFileSync(f)))); }
    catch (err) { res.push({ nom: path.basename(f), erreur: 'Lecture impossible : ' + err.message, operations: [], soldes: [] }); }
  }
  return res;
});
ipcMain.handle('pdf:lireChemin', async (_e, f) => {
  try { return Object.assign({ nom: path.basename(f) }, await lireReleve(fs.readFileSync(f))); }
  catch (err) { return { nom: path.basename(f), erreur: 'Lecture impossible : ' + err.message, operations: [], soldes: [] }; }
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
ipcMain.handle('shell:ouvrir', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:montrer', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('app:version', () => app.getVersion());

app.whenReady().then(creerFenetre);
app.on('window-all-closed', () => app.quit());
