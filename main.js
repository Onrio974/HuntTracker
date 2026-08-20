// main.js — Processus principal Electron
//
// Rôle de ce fichier :
//   - créer la fenêtre de l'application (BrowserWindow)
//   - charger le fichier index.html local (celui de l'app HTML d'origine)
//   - appliquer une configuration de sécurité raisonnable
//   - autoriser la fonctionnalité de capture d'écran (navigator.mediaDevices.getDisplayMedia)
//     utilisée par la fonction "Capture / OCR" de l'application, AVEC un choix
//     explicite entre "Écran entier" et "Fenêtre" (sélecteur maison, fiable sur
//     toutes les versions de Windows/Electron, contrairement à useSystemPicker
//     qui n'est pas toujours disponible et retombe alors sur l'écran par défaut)
//   - gérer proprement la fermeture et les erreurs de chargement

const { app, BrowserWindow, session, desktopCapturer, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Icône optionnelle et multi-plateforme : Windows attend un .ico, macOS un
// .icns, Linux un .png. On prend la première qui existe pour la plateforme
// courante (avec repli sur les autres formats si besoin) ; si aucune n'est
// présente, on ne casse rien — Electron utilisera son icône par défaut.
function resolveAppIcon() {
  const candidatesByPlatform = {
    win32: ['icon.ico'],
    darwin: ['icon.icns', 'icon.png'],
    linux: ['icon.png', 'icon.ico']
  };
  const candidates = candidatesByPlatform[process.platform] || ['icon.png', 'icon.ico'];
  for (const name of candidates) {
    const candidatePath = path.join(__dirname, 'build', name);
    if (fs.existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
}
const appIcon = resolveAppIcon();

// Sur Windows, ceci évite certains soucis de cache/GPU sur des configurations
// matérielles particulières. Ne change rien au fonctionnement de l'app.
app.commandLine.appendSwitch('disable-http-cache', 'false');

let mainWindow = null;
let pickerWindow = null;

// Mémorise la taille/position "normale" de la fenêtre avant de passer en
// mode compact, pour pouvoir la restaurer exactement au clic sur "Agrandir".
let savedNormalBounds = null;
let isCompact = false;

// Langue actuellement affichée dans index.html (fr/en/ko), transmise via
// preload.js (voir controls:setLanguage ci-dessous). Sert à ouvrir le
// sélecteur de capture d'écran (fenêtre gérée par main.js, indépendante
// du DOM de la page) dans la même langue que le reste de l'app plutôt que
// de la laisser figée en français.
let currentAppLang = 'fr';
const PICKER_WINDOW_TITLES = {
  fr: 'Choisir une source de capture',
  en: 'Choose a capture source',
  ko: '캡처할 소스 선택'
};

// Taille de la fenêtre en mode compact (petit widget flottant, pratique pour
// laisser l'app visible par-dessus une vidéo YouTube pendant qu'on farm).
const COMPACT_WIDTH = 380;
const COMPACT_HEIGHT = 230;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false, // on affiche seulement quand le contenu est prêt (évite le flash blanc)
    backgroundColor: '#071522', // couleur de fond de l'app (évite un flash blanc au démarrage)
    icon: appIcon,
    autoHideMenuBar: true, // masque la barre de menu Electron par défaut (File/Edit/View...)
    webPreferences: {
      // --- Sécurité ---
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // isole le monde JS du preload de celui de la page
      nodeIntegration: false,   // pas d'accès direct à Node.js depuis le HTML
      sandbox: true,            // sandbox Chromium activée (l'app n'a besoin d'aucune API Node)
      webSecurity: true,        // garde les protections standard du navigateur (CORS, etc.)
      devTools: !app.isPackaged // DevTools dispo en dev, désactivées une fois packagée
    }
  });

  // Empêche l'ouverture de nouvelles fenêtres Electron non contrôlées.
  // Si jamais un lien "target=_blank" ou window.open() apparaissait un jour
  // dans le HTML, on l'ouvre dans le navigateur système plutôt que dans l'app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Charge le fichier HTML local (celui d'origine, non modifié).
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Affiche la fenêtre seulement une fois le contenu prêt (évite le flash blanc).
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Gestion propre des erreurs de chargement du fichier HTML.
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    dialog.showErrorBox(
      'Erreur de chargement',
      `Impossible de charger l'application.\n\nCode: ${errorCode}\n${errorDescription}`
    );
  });

  // Log discret des erreurs JS de la page dans la console du processus principal
  // (utile en dev ; n'affecte pas le fonctionnement de l'app).
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    if (details.reason !== 'clean-exit') {
      console.error('Le contenu de la fenêtre s\'est arrêté de façon inattendue :', details.reason);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Contrôles de fenêtre exposés à la page (toujours au premier plan,
//     transparence, mode compact) via preload.js + ipcMain.handle ---
//
// On utilise ipcMain.handle (invoke/response) plutôt que des événements
// "fire and forget" : ça permet à la page de savoir que l'action a bien
// été appliquée, et de garder son UI synchronisée avec l'état réel de
// la fenêtre.

ipcMain.handle('controls:setAlwaysOnTop', (event, flag) => {
  if (!mainWindow) return false;
  mainWindow.setAlwaysOnTop(!!flag, 'floating');
  return mainWindow.isAlwaysOnTop();
});

ipcMain.handle('controls:setOpacity', (event, value) => {
  if (!mainWindow) return 1;
  // On borne la valeur entre 0.15 (jamais totalement invisible, sinon plus
  // moyen de cliquer dessus) et 1 (opaque).
  const clamped = Math.min(1, Math.max(0.15, Number(value)));
  mainWindow.setOpacity(clamped);
  return clamped;
});

ipcMain.handle('controls:setLanguage', (event, lang) => {
  if (lang === 'fr' || lang === 'en' || lang === 'ko') currentAppLang = lang;
  return currentAppLang;
});

ipcMain.handle('controls:setCompact', (event, flag) => {
  if (!mainWindow) return false;
  const wantCompact = !!flag;
  if (wantCompact === isCompact) return isCompact;

  if (wantCompact) {
    // On sauvegarde la position/taille actuelle pour la restaurer plus tard.
    savedNormalBounds = mainWindow.getBounds();
    mainWindow.setMinimumSize(220, 150);
    mainWindow.setResizable(true);
    mainWindow.setBounds({
      x: savedNormalBounds.x,
      y: savedNormalBounds.y,
      width: COMPACT_WIDTH,
      height: COMPACT_HEIGHT
    });
    isCompact = true;
  } else {
    mainWindow.setMinimumSize(1024, 700);
    if (savedNormalBounds) {
      mainWindow.setBounds(savedNormalBounds);
    } else {
      mainWindow.setSize(1400, 900);
    }
    isCompact = false;
  }
  return isCompact;
});

// --- Sélecteur maison "Écran / Fenêtre" ---
//
// Ouvre une petite fenêtre modale listant, sous forme de vignettes, tous les
// écrans ET toutes les fenêtres disponibles (desktopCapturer avec les deux
// types), et attend le clic de l'utilisateur. Résout avec la source choisie,
// ou null si l'utilisateur annule / ferme la fenêtre.
function showSourcePicker(sources) {
  return new Promise((resolve) => {
    if (pickerWindow) {
      pickerWindow.close();
      pickerWindow = null;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('picker:selected', onSelected);
      if (pickerWindow) {
        pickerWindow.destroy();
        pickerWindow = null;
      }
      resolve(result);
    };

    const onSelected = (event, sourceId) => {
      const chosen = sources.find(s => s.id === sourceId) || null;
      finish(chosen);
    };
    ipcMain.on('picker:selected', onSelected);

    pickerWindow = new BrowserWindow({
      width: 760,
      height: 560,
      parent: mainWindow,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: PICKER_WINDOW_TITLES[currentAppLang] || PICKER_WINDOW_TITLES.fr,
      backgroundColor: '#071522',
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    pickerWindow.setMenuBarVisibility(false);

    pickerWindow.on('closed', () => {
      pickerWindow = null;
      finish(null); // fenêtre fermée sans choix => annulation
    });

    pickerWindow.loadFile(path.join(__dirname, 'picker.html')).then(() => {
      // Envoie la langue actuelle de l'app (fr/en/ko) AVANT les sources, pour
      // que picker.html traduise son interface dès le premier rendu plutôt
      // que d'afficher brièvement le français par défaut puis re-traduire.
      pickerWindow.webContents.send('picker:lang', currentAppLang);
      // Envoie la liste des sources (id, nom, type, vignette en data URL) une
      // fois la page prête à les recevoir.
      const payload = sources.map(s => ({
        id: s.id,
        name: s.name,
        type: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null
      }));
      pickerWindow.webContents.send('picker:sources', payload);
    });
  });
}

// --- Autorisation de la capture d'écran (navigator.mediaDevices.getDisplayMedia) ---
//
// On récupère à la fois les écrans et les fenêtres, puis on laisse
// l'utilisateur choisir via notre sélecteur maison (showSourcePicker),
// ce qui garantit le choix Écran/Fenêtre quel que soit le support ou non
// du sélecteur natif Windows sur la machine cible.
function setupScreenCaptureHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 300, height: 200 },
          fetchWindowIcons: true
        });

        if (sources.length === 0) {
          callback({});
          return;
        }

        const chosen = await showSourcePicker(sources);
        if (!chosen) {
          callback({}); // utilisateur a annulé
          return;
        }

        callback({ video: chosen, audio: 'loopback' });
      } catch (err) {
        console.error('Capture d\'écran indisponible :', err);
        callback({});
      }
    }
  );
}

app.whenReady().then(() => {
  setupScreenCaptureHandler();
  createWindow();

  app.on('activate', () => {
    // Comportement standard macOS : on garde par cohérence multiplateforme,
    // sans impact sur Windows.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Fermeture propre de l'application quand toutes les fenêtres sont fermées
// (comportement standard sur Windows/Linux ; sur macOS l'app reste dans le dock,
// ce qui ne concerne pas la cible Windows de ce projet mais ne pose aucun problème).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Sécurité supplémentaire : empêche la navigation de la fenêtre principale
// vers une origine externe (l'app ne doit jamais quitter son propre fichier HTML).
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (navEvent, url) => {
    const target = new URL(url);
    if (target.protocol !== 'file:') {
      navEvent.preventDefault();
      shell.openExternal(url);
    }
  });
});
