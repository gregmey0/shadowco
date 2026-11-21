# Shadow CO – course d'orientation connectée

Application de course d'orientation pour coureurs voyants, avec suivi en direct par l'organisateur.

- **Création de parcours** sur le terrain : départ, postes, arrivée enregistrés au GPS (position moyennée).
- **Trois types de course** : ordre imposé, ordre libre (tous les postes, dans l'ordre de son choix) ou score (un maximum de points en temps limité, pénalité par minute de retard, points modifiables par poste).
- **Course** : carte avec les postes sur le fond choisi (IGN, OpenStreetMap, relief, photo), validation automatique en passant sur le poste, temps par poste, bips d'approche en aide. Comme en vraie course d'orientation, la position du coureur n'est affichée que jusqu'au départ (option en course seul ; en course organisée, l'organisateur décide de l'affichage de la position et de la trace).
- **Organisation en direct** : code + QR code pour rejoindre, départ groupé ou individuel, carte de tous les coureurs avec leur trace, postes, temps, batterie, alertes (immobile, sans nouvelles), classement et export CSV.
- **Replay** : l'organisateur rejoue la course (curseur de temps, vitesse ×10 à ×120, postes validés au fil du temps). Les traces restent sur son appareil, même après effacement du relais.
- **Suivi d'entraînement** (enseignant, entraîneur) : une séance sans parcours. Les pratiquants rejoignent avec le code ou le QR code et rangent leur téléphone ; l'encadrant suit tout le monde sur la carte en direct (trace, distance, vitesse moyenne, batterie, alertes), puis en replay. Bilan CSV et traces GPX.
- **Échange** des parcours en GPX (compatible O'Guide).

## Installer

- **Android** : télécharger [ShadowCO.apk](../../releases/latest/download/ShadowCO.apk) depuis le téléphone, l'ouvrir et autoriser l'installation. Le suivi continue téléphone verrouillé.
- **Web (tout téléphone, iPhone compris)** : https://gregmey0.github.io/shadowco/ puis « Installer l'appli » / « Sur l'écran d'accueil ». Garder l'écran allumé pendant la course.

## Relais et confidentialité

Le suivi en direct passe par un relais MQTT public (HiveMQ, à défaut EMQX). Tout est chiffré de bout en bout (AES-GCM) avec une clé dérivée du code de la course : le relais ne voit que des données illisibles. En fin de course, l'organisateur peut effacer la course du relais (menu ⋯) : résultats et replay restent alors uniquement sur son appareil.

## Développement

- Sources : `src/js/*.js` (modules concaténés), `src/style.css`, `src/body.html`. `python3 build.py` produit `docs/` (version web, GitHub Pages) et `www/` (contenu de l'appli).
- Android : projet Capacitor dans `android/`. Chaque push sur `main` compile l'APK (GitHub Actions) et le publie dans **Releases**.
- La clé `android/app/shadowco-sideload.jks` est volontairement publique : elle sert seulement à ce que chaque nouvelle version s'installe par-dessus la précédente.

<sub>Greg Meyer, STAPS Avignon</sub>
