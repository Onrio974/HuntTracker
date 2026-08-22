// Étape exécutée automatiquement par electron-builder juste après avoir
// assemblé l'app macOS (.app), avant de la mettre dans le .dmg / .zip.
//
// Pourquoi ce fichier existe : sans certificat Apple Developer payant, on ne
// peut pas obtenir une "vraie" signature Apple. On applique donc une
// signature "ad-hoc" (gratuite, locale) avec l'option --deep, qui signe
// AUSSI tous les composants internes de l'app (Electron Framework, process
// Helper, etc.) et pas seulement l'enveloppe extérieure. C'est cette
// signature "profonde" et cohérente sur toute l'arborescence qui évite le
// message "l'app est endommagée et ne peut pas être ouverte" que montre
// macOS/Gatekeeper quand la chaîne de signature est incomplète ou invalide,
// en particulier sur Apple Silicon (arm64) qui est beaucoup plus strict que
// les anciens Mac Intel sur ce point.
//
// Ça ne remplace pas une vraie notarisation Apple (payante), donc le tout
// premier lancement affichera quand même l'avertissement "développeur non
// identifié" — il faudra faire clic droit → Ouvrir une seule fois. Mais
// l'app ne devrait plus être refusée comme "endommagée".

const { execSync } = require('child_process');
const path = require('path');

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  // Cette étape ne concerne que macOS ; sur Windows electron-builder ne
  // l'appelle de toute façon pas, cette vérification est juste une sécurité.
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[afterSign] Signature ad-hoc (--deep) de : ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });

  // Vérification : si la signature est invalide/incomplète, cette commande
  // affichera clairement l'erreur dans les logs GitHub Actions plutôt que
  // de laisser passer silencieusement une app cassée.
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' });
  console.log('[afterSign] Signature vérifiée OK.');
};
