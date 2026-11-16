'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  lireConfig: () => ipcRenderer.invoke('config:lire'),
  ecrireConfig: (c) => ipcRenderer.invoke('config:ecrire', c),
  choisirDossier: () => ipcRenderer.invoke('config:choisirDossier'),
  chargerAsso: (id) => ipcRenderer.invoke('asso:charger', id),
  mtimeAsso: (id) => ipcRenderer.invoke('asso:mtime', id),
  sauverAsso: (id, data, mtime) => ipcRenderer.invoke('asso:sauver', id, data, mtime),
  importerFichier: (id) => ipcRenderer.invoke('asso:importerFichier', id),
  ouvrirPdf: () => ipcRenderer.invoke('pdf:ouvrir'),
  lirePdfFichier: (file) => ipcRenderer.invoke('pdf:lireChemin', webUtils.getPathForFile(file)),
  exporterExcel: (feuilles, nom) => ipcRenderer.invoke('excel:exporter', feuilles, nom),
  ouvrir: (p) => ipcRenderer.invoke('shell:ouvrir', p),
  montrer: (p) => ipcRenderer.invoke('shell:montrer', p),
  version: () => ipcRenderer.invoke('app:version'),
  surFocus: (fn) => ipcRenderer.on('focus', fn),
});
