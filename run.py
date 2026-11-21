"""Lanceur d'AeroDrop — partage de fichiers ultra rapide en réseau local.

    python run.py                          # partage le dossier courant, port 8080
    python run.py ~/Documents/Partage      # partage un dossier précis
    python run.py . --port 9000 --pin 1234 # port et code d'accès
    python run.py . --window               # fenêtre desktop (pywebview)
"""

from __future__ import annotations

import sys

from aerodrop.cli import main

if __name__ == "__main__":
    sys.exit(main())
