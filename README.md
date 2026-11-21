# AeroDrop

Application de partage de fichiers et dossiers sur le réseau local. AeroDrop ne dépend d'aucun cloud, compte ni connexion Internet : les données restent entre les appareils reliés au même réseau Wi-Fi ou Ethernet.

## Points forts

- Interface desktop sombre, fluide et responsive ; elle reste agréable sur PC et mobile.
- Envoi de fichiers et de dossiers complets par sélection ou glisser-déposer.
- Téléchargement de dossiers en `.zip`, aperçu des images, vidéos, audio, PDF et textes.
- Recherche, création, renommage et suppression depuis les appareils autorisés.
- Suivi en direct des envois/téléchargements et QR code pour ouvrir le partage sur un autre appareil.
- Code PIN optionnel, mode lecture seule et confinement strict au dossier choisi.

## Installation automatique (Arch Linux)

```bash
git clone https://github.com/Abdoul273/aerodrop.git
cd aerodrop
./installer.sh
```

Le script installe les dépendances, crée `~/Partage-AeroDrop`, et ajoute **AeroDrop** au menu des applications. Clique ensuite sur AeroDrop : la fenêtre desktop s'ouvre et partage ce dossier. Sur les autres PC, ouvre l'adresse ou le QR affiché ; aucune installation n'est requise.

## Installation manuelle

```fish
cd ~/development/aerodrop
python3 -m pip install -e '.[desktop]'
```

Pour l'ajouter au menu des applications Linux :

```fish
mkdir -p ~/.local/share/applications
cp packaging/aerodrop.desktop ~/.local/share/applications/
cp packaging/aerodrop-lancer ~/.local/bin/aerodrop-lancer
chmod +x ~/.local/bin/aerodrop-lancer
```

## Utilisation

Fenêtre desktop, pour partager le dossier courant :

```fish
aerodrop-desktop
```

Fenêtre desktop, pour partager un dossier précis avec un code :

```fish
aerodrop-desktop ~/Documents/Partage --pin 2734 --name "PC Abdoul"
```

Depuis les autres PC du même réseau, ouvre l'adresse affichée par AeroDrop dans Chrome, ou scanne le QR code. Aucune installation n'est nécessaire sur les PC qui reçoivent ou envoient via le navigateur.

Mode lecture seule :

```fish
aerodrop-desktop ~/Documents/Partage --readonly
```

## Démarrage sans fenêtre

```fish
aerodrop ~/Documents/Partage --pin 2734
```

Le serveur écoute sur le port `8080` (ou le premier port libre suivant). Garde AeroDrop ouvert pendant le partage.

## Sécurité

Le PIN protège les opérations et les liens de téléchargement. Le trafic reste local mais n'est pas chiffré : sur un réseau partagé, utilise un PIN fort et évite de partager des données sensibles.
