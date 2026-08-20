// preload.js — Pont sécurisé entre Electron et la page HTML
//
// L'application HTML d'origine (index.html) fonctionne entièrement en
// JavaScript "navigateur" classique : localStorage, fetch(), Canvas,
// getDisplayMedia(), Tesseract.js. Elle n'a besoin d'AUCUNE API Node.js
// pour fonctionner. Ce preload.js reste donc volontairement minimal :
// il n'expose rien de dangereux, conformément aux consignes de sécurité
// (contextIsolation activée, nodeIntegration désactivée, sandbox activée).
//
// On expose uniquement quelques informations inoffensives en lecture seule
// (nom de l'app, version) via contextBridge, disponibles côté page sous
// window.appInfo, si jamais tu veux les afficher un jour (ex: dans un
// futur écran "À propos"). Rien de plus n'est exposé.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', {
  platform: process.platform,
  isElectron: true
});

// Pont pour les 4 contrôles de fenêtre demandés (toujours au premier plan,
// transparence, mode compact, langue). On expose uniquement des fonctions
// précises et bornées (pas ipcRenderer brut) : la page ne peut rien faire
// d'autre que ces 4 actions, conformément à contextIsolation + sandbox.
// setLanguage permet à main.js de savoir dans quelle langue (fr/en/ko)
// l'app est actuellement affichée, pour ouvrir dans la même langue les
// fenêtres qu'il gère lui-même (ex: le sélecteur de capture d'écran).
contextBridge.exposeInMainWorld('windowControls', {
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('controls:setAlwaysOnTop', flag),
  setOpacity: (value) => ipcRenderer.invoke('controls:setOpacity', value),
  setCompact: (flag) => ipcRenderer.invoke('controls:setCompact', flag),
  setLanguage: (lang) => ipcRenderer.invoke('controls:setLanguage', lang)
});
