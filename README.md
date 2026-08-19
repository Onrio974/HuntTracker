# Compteur Pokémon — Application Windows (Electron)

Ce projet transforme le fichier HTML `index.html` (ton compteur Pokémon
existant) en une véritable application de bureau Windows (`.exe`), grâce à
Electron + electron-builder. **Le HTML n'a pas été modifié** : c'est une
copie exacte du fichier que tu m'as fourni.

---

## 1. Arborescence du projet

```
electron-app/
├── package.json        → config npm + electron-builder (nom, version, build Windows)
├── main.js              → processus principal Electron (fenêtre, sécurité, capture d'écran)
├── preload.js            → pont sécurisé Electron ↔ page web (minimal, rien de dangereux exposé)
├── index.html            → ton fichier HTML d'origine, non modifié
├── assets/                → dossier vide, prévu pour de futures ressources locales
│   └── .gitkeep
├── build/
│   ├── icon.ico            → icône Pokéball générée pour l'app et l'installateur
│   └── icon.png            → même icône en PNG (référence / réutilisation future)
└── README.md              → ce fichier
```

---

## 2. Analyse du HTML fourni

Ton fichier est **un fichier HTML unique et autonome** : tout le CSS et
tout le JavaScript sont déjà intégrés directement dans `index.html`
(pas de fichiers `.css`/`.js` séparés, pas d'images locales, pas de polices
locales, pas de JSON local). Il n'y avait donc **aucun chemin relatif à
corriger**.

Deux ressources externes sont utilisées, identiques à leur fonctionnement
dans un navigateur classique :

| Ressource | Usage | Fonctionne hors ligne ? |
|---|---|---|
| `cdn.jsdelivr.net/.../tesseract.min.js` | Moteur OCR (lecture automatique des rencontres à l'écran) | ❌ Nécessite Internet au premier chargement (comme dans un navigateur) |
| `pokeapi.co` (fetch) | Récupération des données Pokémon (liste, taux de capture...) | ❌ Nécessite Internet |
| `localStorage` | Sauvegarde de tes chasses/compteurs | ✅ Fonctionne toujours, y compris hors ligne |
| `navigator.mediaDevices.getDisplayMedia` | Capture d'écran pour l'OCR | ✅ Fonctionne hors ligne (voir point de configuration ci-dessous) |

**Important à savoir :** ton HTML original nécessitait déjà Internet pour
l'OCR (script CDN) et pour les données PokeAPI — ce n'est donc pas une
régression introduite par le passage à Electron. Toutes les fonctionnalités
qui marchaient hors ligne dans le navigateur (compteurs, sauvegarde,
capture d'écran) continuent de marcher hors ligne dans l'app.

> 💡 Si tu veux un jour une app **100 % hors ligne**, il suffira de
> télécharger `tesseract.min.js` (+ ses fichiers de langue `.traineddata`)
> et de les placer dans `assets/`, puis de remplacer la ligne
> `<script src="https://cdn.jsdelivr.net/...">` par
> `<script src="./assets/tesseract.min.js">` dans `index.html`. Je peux le
> faire pour toi si tu me le demandes — je ne l'ai pas fait par défaut car
> tu as demandé de ne pas modifier le HTML inutilement.

### Point technique corrigé pour que l'app fonctionne réellement

Une chose **ne fonctionne pas par défaut dans Electron** et a dû être
prise en charge côté `main.js`, sans toucher au HTML : la capture d'écran
(`getDisplayMedia`). Electron n'affiche pas nativement la fenêtre "Partager
votre écran" comme un navigateur — il faut lui fournir explicitement un
gestionnaire. C'est fait dans `main.js` via
`session.defaultSession.setDisplayMediaRequestHandler(...)`, avec
`useSystemPicker: true` pour afficher le sélecteur natif de Windows, et un
repli automatique (sélection de l'écran principal) si ce sélecteur n'est
pas disponible sur ta version de Windows. **Ta fonctionnalité "Capture /
OCR" fonctionne donc normalement dans l'app compilée.**

---

## 3. Sécurité appliquée

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Aucune API Node.js exposée à la page (le HTML n'en a pas besoin :
  il n'utilise que des API navigateur standard)
- Ouverture de liens externes dans le navigateur système plutôt que dans
  l'app (au cas où)
- Navigation hors du fichier local bloquée (l'app ne peut pas être
  redirigée ailleurs)
- DevTools désactivées dans la version packagée (disponibles en mode `npm start`)

---

## 4. Commandes à exécuter

Depuis le dossier `electron-app/`, avec [Node.js](https://nodejs.org)
installé (version 18 ou plus récente recommandée) :

```bash
npm install
```

Lancer l'application en mode développement (fenêtre Electron) :

```bash
npm start
```

Compiler l'application Windows (génère l'installateur + la version portable) :

```bash
npm run build
```

(`npm run dist` et `npm run package` font exactement la même chose — ce
sont des alias, au cas où tu préfères l'un ou l'autre.)

---

## 5. Résultat du build

Après `npm run build`, tu trouveras dans le dossier **`dist/`** :

- `CompteurPokemon-Setup-1.0.0.exe` → **installateur Windows** (NSIS).
  Propose le choix du dossier d'installation, crée un raccourci Bureau et
  un raccourci Menu Démarrer, et permet une désinstallation propre depuis
  "Ajout/Suppression de programmes".
- `CompteurPokemon-Portable-1.0.0.exe` → **version portable**, un seul
  fichier `.exe` à lancer directement par double-clic, sans installation
  (utile pour une clé USB par exemple).

Les deux fichiers sont de vraies applications Windows autonomes : à
l'ouverture, aucune fenêtre de navigateur n'apparaît, uniquement la
fenêtre de l'application.

---

## 6. Personnaliser l'icône (optionnel)

Une icône Pokéball (`build/icon.ico`) a déjà été générée et est prête à
l'emploi. Si tu veux la remplacer par la tienne : génère un fichier
`.ico` (multi-tailles, idéalement 16/32/48/256 px — des convertisseurs
en ligne gratuits existent) et remplace `build/icon.ico` par le tien.
Rien d'autre à changer, `package.json` pointe déjà vers ce chemin.

---

## 7. Checklist finale — vérifier que tout fonctionne

- [ ] `npm install` se termine sans erreur
- [ ] `npm start` ouvre une fenêtre Electron affichant ton app (pas de page blanche)
- [ ] Aucune fenêtre de navigateur (Chrome/Edge) ne s'ouvre — uniquement l'app
- [ ] Les compteurs, chasses, et sauvegardes fonctionnent (localStorage)
- [ ] Le bouton de capture d'écran / OCR fonctionne (avec Internet, au premier lancement du moteur OCR)
- [ ] Fermer la fenêtre ferme bien tout le processus (pas de processus fantôme dans le Gestionnaire des tâches)
- [ ] `npm run build` se termine sans erreur
- [ ] Le dossier `dist/` contient bien `CompteurPokemon-Setup-1.0.0.exe` et `CompteurPokemon-Portable-1.0.0.exe`
- [ ] Double-clic sur l'installateur → installation propre, raccourci Bureau + Menu Démarrer créés
- [ ] L'app installée se lance et fonctionne comme en mode `npm start`
- [ ] La désinstallation depuis "Ajout/Suppression de programmes" fonctionne et ne laisse pas de résidus gênants
- [ ] L'icône Pokéball apparaît bien sur le `.exe`, le raccourci et dans la barre des tâches

---

## 8. Notes / limites connues

- Ce projet cible **Windows** (comme demandé). `main.js` contient un peu
  de code standard multiplateforme (comportement macOS habituel) qui ne
  gêne en rien sur Windows — il n'a simplement aucun effet ici.
- Le titre de la fenêtre reprend la balise `<title>` de ton HTML
  (actuellement `HuntTracker.cs`). Si tu veux un autre titre affiché dans
  la barre de titre Windows, il suffit de changer cette ligne dans
  `index.html`.
- Aucune dépendance inutile n'a été ajoutée : uniquement `electron` et
  `electron-builder` (toutes deux en `devDependencies`, donc absentes du
  `.exe` final — seul Electron lui-même, qui embarque Chromium, est
  inclus dans l'app compilée, ce qui explique la taille de l'installateur
  final, environ 80-120 Mo — c'est normal et inhérent à Electron).
