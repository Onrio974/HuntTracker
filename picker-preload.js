// picker-preload.js — Pont sécurisé pour la fenêtre "Choisir une source"
//
// picker.html a besoin de deux choses côté page :
//   1. recevoir la liste des sources (écrans / fenêtres) envoyée par
//      main.js via pickerWindow.webContents.send('picker:sources', ...)
//   2. renvoyer l'id de la source choisie par l'utilisateur vers main.js
//      (écouté côté main via ipcMain.on('picker:selected', ...))
//
// Comme pour preload.js, on garde contextIsolation activée et on n'expose
// que le strict nécessaire via contextBridge — jamais ipcRenderer en entier.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerAPI', {
  // Reçoit la liste des sources (id, name, type, thumbnail) depuis main.js
  onSources: (callback) => {
    ipcRenderer.on('picker:sources', (event, sources) => callback(sources));
  },
  // Envoie l'id de la source cliquée par l'utilisateur vers main.js
  select: (sourceId) => {
    ipcRenderer.send('picker:selected', sourceId);
  }
});
