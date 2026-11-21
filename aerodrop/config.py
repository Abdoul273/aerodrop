"""Configuration de l'application AeroDrop."""

from __future__ import annotations

import socket
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    """Paramètres d'exécution du serveur de partage."""

    root: Path
    host: str = "0.0.0.0"
    port: int = 8080
    pin: str | None = None
    name: str = "AeroDrop"
    readonly: bool = False

    @property
    def root_path(self) -> Path:
        return self.root.resolve()

    @property
    def device_name(self) -> str:
        if self.name and self.name != "AeroDrop":
            return self.name
        return socket.gethostname() or "AeroDrop"
