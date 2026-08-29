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

// Désactive complètement l'autofill natif de Chromium (suggestions de
// recherche/adresses/mots de passe). Sans ça, sur certaines configs Linux,
// Chromium peut faire apparaître une popup native (rendue par la boîte à
// outils du système, PAS par le DOM de la page) juste sous un <input> texte
// dès qu'on tape dedans — avec un placeholder générique du navigateur
// ("Search for a site...") qui n'a rien à voir avec l'app. Cette popup
// native se dessine PAR-DESSUS le contenu de la page (elle ignore le
// z-index/CSS de l'app), ce qui, pour les menus déroulants Boss/Méga
// Gemmes/Quêtes/etc. (qui ont un champ de recherche juste au-dessus de la
// liste), donne l'impression que "le menu n'affiche plus que la barre de
// recherche" : la liste est toujours là dans le DOM, elle est juste cachée
// visuellement sous cette popup native. On coupe cette fonctionnalité à la
// racine (aucune perte pour l'app : elle n'a besoin d'aucune suggestion
// native, tous ses champs de recherche sont gérés par son propre JS).
app.commandLine.appendSwitch('disable-features', 'Autofill,AutofillServerCommunication,AutofillShowTypePredictions');

// Quand une grosse partie de la page se redessine d'un coup (ex. compteur
// d'un Pokémon qui vient d'être capturé : render() remplace en une seule
// fois tout le contenu de #mainArea en innerHTML — liste de Pokémon,
// graphique de convergence, panneaux, etc., voir la fonction render() dans
// index.html), le compositeur GPU de Chromium peut afficher brièvement une
// image noire pendant qu'il recalcule les calques — un artefact de rendu
// accéléré matériellement pendant un gros redessin synchrone. On croyait au
// départ ce souci limité à Linux (pilotes Mesa), mais il a aussi été
// signalé sous Windows : on désactive donc l'accélération matérielle sur
// TOUTES les plateformes plutôt que juste Linux. L'app est une interface 2D
// assez simple (pas de jeu/3D à afficher), le coût en performance de passer
// en rendu logiciel est négligeable comparé au bénéfice de ne plus avoir
// ces flashs noirs à chaque rencontre comptée.
app.disableHardwareAcceleration();

let mainWindow = null;
let pickerWindow = null;

// Reflète l'état "toujours au premier plan" demandé par la page (voir
// controls:setAlwaysOnTop et le gestionnaire 'blur' dans createWindow, qui
// réapplique ce flag après chaque perte de focus pour éviter que la
// fenêtre reste bloquée en arrière-plan sous Windows).
let alwaysOnTopEnabled = false;

// Minuteur qui réapplique périodiquement le mode "toujours au premier plan"
// (voir startAlwaysOnTopWatchdog/stopAlwaysOnTopWatchdog plus bas) — voir le
// commentaire sur son démarrage dans controls:setAlwaysOnTop pour le
// pourquoi (les gestionnaires 'blur'/'focus' seuls ne suffisent pas).
let alwaysOnTopWatchdog = null;

// Vrai tant qu'un <select> HTML natif de la page a le focus (donc
// potentiellement ouvert) — voir controls:setSelectOpen plus bas, appelé
// par index.html sur les évènements focus/blur de tout <select>. Sert à
// mettre en pause, le temps que le <select> soit ouvert, le comportement
// "toujours au premier plan" ci-dessous (moveTop()/setAlwaysOnTop répétés
// par reassertAlwaysOnTop et startAlwaysOnTopWatchdog) : la liste déroulante
// d'un <select> natif est une fenêtre popup séparée au niveau du système
// d'exploitation, distincte de notre BrowserWindow. Si on force notre
// fenêtre principale au premier plan (moveTop/setAlwaysOnTop) PENDANT que
// cette popup est ouverte, elle lui vole l'activation — ce qui, sous
// Windows, ferme instantanément la popup du <select> (signalé par un
// utilisateur : les menus déroulants "Forme / événement" et du graphique
// de convergence se refermaient dès l'ouverture quand "toujours au premier
// plan" était actif). D'où cette pause pendant que nativeSelectOpen est vrai.
let nativeSelectOpen = false;

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
    // minWidth/minHeight étaient fixés à 1024x700, ce qui empêchait de
    // réduire la fenêtre en dessous de cette taille en tirant simplement
    // sur ses bords (indépendamment du mode "toujours au premier plan" —
    // cette limite s'appliquait de toute façon, tout le temps). On
    // reprend la même taille plancher que le mode compact (voir
    // COMPACT_WIDTH/COMPACT_HEIGHT et controls:setCompact plus bas) pour
    // qu'on puisse librement agrandir/réduire la fenêtre par les bords,
    // sans avoir besoin de passer par le bouton dédié au mode compact.
    minWidth: COMPACT_WIDTH,
    minHeight: COMPACT_HEIGHT,
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

  // Sous Windows, une fenêtre "toujours au premier plan" peut se faire
  // reléguer silencieusement derrière une autre fenêtre elle-même topmost
  // (typiquement le jeu). Deux moments distincts peuvent déclencher ça :
  //   - en PERDANT le focus (ex. on reclique dans le jeu) -> 'blur'
  //   - en REGAGNANT le focus (ex. on clique sur le tracker depuis le jeu,
  //     cas signalé par l'utilisateur : c'est CE clic précis qui le fait
  //     passer derrière le jeu et s'y bloquer) -> 'focus'
  // Dans les deux cas, elle reste ensuite coincée en arrière-plan : seul un
  // changement de fenêtre (Windows+Tab, ou fermer/rouvrir) la ramenait au
  // premier plan. On réapplique donc le flag topmost après CHAQUE
  // changement de focus (perte ET gain) tant que le mode est actif, avec un
  // court délai pour laisser Windows finir de traiter le changement de
  // focus déclenché par le clic avant de forcer le recalcul de l'ordre
  // d'affichage (le forcer de façon parfaitement synchrone, pendant que
  // Windows traite encore le clic, s'est révélé moins fiable dans des bugs
  // similaires rapportés sur Electron). Voir aussi le niveau 'screen-saver'
  // (au lieu de 'floating') dans controls:setAlwaysOnTop ci-dessous, plus
  // assertif face à une fenêtre de jeu qui se dispute elle aussi le
  // premier plan.
  const reassertAlwaysOnTop = () => {
    setTimeout(() => {
      if (alwaysOnTopEnabled && mainWindow && !nativeSelectOpen) {
        mainWindow.setAlwaysOnTop(false);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.moveTop();
      }
    }, 60);
  };
  mainWindow.on('blur', reassertAlwaysOnTop);
  mainWindow.on('focus', reassertAlwaysOnTop);

  // Le minuteur (voir startAlwaysOnTopWatchdog) doit s'arrêter avec la
  // fenêtre, sinon il continuerait à tourner dans le vide (et à planter en
  // essayant d'utiliser une fenêtre détruite) une fois l'app fermée.
  mainWindow.on('closed', stopAlwaysOnTopWatchdog);
}

// Les gestionnaires 'blur'/'focus' ci-dessus ne suffisaient pas : ils ne se
// déclenchent QUE quand NOTRE fenêtre change elle-même de focus, or un jeu
// qui reprend le premier plan tout seul (ex. quand il affiche une nouvelle
// zone, une fenêtre modale interne, ou simplement en continuant de
// tourner) peut se replacer au-dessus sans que le tracker perde/regagne le
// focus au sens d'Electron — auquel cas 'blur'/'focus' ne se déclenchent
// jamais et le tracker reste bloqué en arrière-plan. Signalé aussi bien
// sous Windows que sous Linux. On réapplique donc le flag topmost en plus
// à intervalle régulier, tant que le mode est actif, indépendamment de tout
// évènement de focus — nettement plus robuste face à une fenêtre de jeu qui
// se dispute le premier plan de façon imprévisible.
function startAlwaysOnTopWatchdog() {
  if (alwaysOnTopWatchdog) return;
  alwaysOnTopWatchdog = setInterval(() => {
    if (!alwaysOnTopEnabled || !mainWindow || mainWindow.isDestroyed() || nativeSelectOpen) return;
    if (!mainWindow.isAlwaysOnTop()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    mainWindow.moveTop();
  }, 700);
}

function stopAlwaysOnTopWatchdog() {
  if (alwaysOnTopWatchdog) {
    clearInterval(alwaysOnTopWatchdog);
    alwaysOnTopWatchdog = null;
  }
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
  alwaysOnTopEnabled = !!flag;
  // Niveau 'screen-saver' plutôt que 'floating' : plus assertif face à une
  // fenêtre de jeu qui se dispute elle aussi le premier plan (voir le
  // commentaire sur le gestionnaire 'blur' dans createWindow).
  mainWindow.setAlwaysOnTop(alwaysOnTopEnabled, 'screen-saver');

  // Sous Linux, le "toujours au premier plan" d'Electron/GTK ne suffit
  // souvent pas face à une fenêtre de jeu qui prend tout l'écran : beaucoup
  // de gestionnaires de fenêtres (GNOME/KDE...) placent une appli
  // plein-écran dans une couche d'affichage à part, au-dessus de toute
  // fenêtre "toujours au-dessus" classique. setVisibleOnAllWorkspaces aide
  // dans certains cas (la fenêtre reste visible même si le jeu bascule sur
  // un autre bureau/espace de travail), donc on l'active en plus par
  // sécurité. ATTENTION : sous une session Wayland (de plus en plus
  // fréquente par défaut sur les distributions récentes), Electron ne peut
  // tout simplement PAS forcer une fenêtre au-dessus des autres par
  // conception du protocole (restriction volontaire de Wayland, pas un bug
  // de cette app) - dans ce cas, la seule solution fiable est d'utiliser
  // l'option "toujours au premier plan" du gestionnaire de fenêtres
  // lui-même (clic droit sur la barre de titre / le bouton dans la barre
  // des tâches selon l'environnement de bureau), indépendante de l'app.
  if (process.platform === 'linux') {
    try {
      mainWindow.setVisibleOnAllWorkspaces(alwaysOnTopEnabled, { visibleOnFullScreen: true });
    } catch (ignored) {}
  }

  // Voir startAlwaysOnTopWatchdog/stopAlwaysOnTopWatchdog : réapplique le
  // flag topmost en continu tant que le mode est actif (signalé insuffisant
  // sous Windows ET Linux avec les seuls gestionnaires 'blur'/'focus').
  if (alwaysOnTopEnabled) {
    startAlwaysOnTopWatchdog();
  } else {
    stopAlwaysOnTopWatchdog();
  }

  return mainWindow.isAlwaysOnTop();
});

// Voir la déclaration de nativeSelectOpen plus haut : index.html appelle
// ceci sur chaque focus/blur d'un <select> natif de la page, pour mettre
// en pause le "toujours au premier plan" agressif le temps que la liste
// déroulante soit potentiellement ouverte.
ipcMain.handle('controls:setSelectOpen', (event, flag) => {
  nativeSelectOpen = !!flag;
  return nativeSelectOpen;
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
    // Même taille plancher qu'à la création (voir createWindow) : on ne
    // réimpose plus l'ancienne limite de 1024x700 en sortant du mode
    // compact, pour rester cohérent avec le redimensionnement libre par
    // les bords désormais autorisé en mode normal aussi.
    mainWindow.setMinimumSize(COMPACT_WIDTH, COMPACT_HEIGHT);
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
