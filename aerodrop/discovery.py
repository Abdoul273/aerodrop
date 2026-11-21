"""Découverte automatique des AeroDrop présents sur le réseau local.

Le protocole reste volontairement très petit : des annonces UDP broadcast, sans
serveur, compte ou dépendance externe. Les appareils détectés expirent vite afin
de ne jamais afficher un PC qui a fermé AeroDrop.
"""

from __future__ import annotations

import json
import socket
import threading
import time
import uuid
from dataclasses import dataclass

DISCOVERY_PORT = 45_454
ANNOUNCE_EVERY = 2.0
PEER_TTL = 7.0
MAX_PACKET_SIZE = 4_096
PROTOCOL = "aerodrop/1"


@dataclass(frozen=True)
class Peer:
    """Un appareil AeroDrop détecté récemment."""

    id: str
    name: str
    host: str
    port: int
    locked: bool
    readonly: bool
    seen_at: float

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "url": f"http://{self.host}:{self.port}",
            "locked": self.locked,
            "readonly": self.readonly,
        }


class Discovery:
    """Annonce AeroDrop et maintient la liste des appareils voisins."""

    def __init__(self, *, name: str, port: int, locked: bool, readonly: bool) -> None:
        self._id = uuid.uuid4().hex
        self._name = name
        self._port = port
        self._locked = locked
        self._readonly = readonly
        self._peers: dict[str, Peer] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="aerodrop-discovery", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)

    def peers(self) -> list[dict[str, object]]:
        cutoff = time.monotonic() - PEER_TTL
        with self._lock:
            self._peers = {key: peer for key, peer in self._peers.items() if peer.seen_at >= cutoff}
            peers = list(self._peers.values())
        return [peer.as_dict() for peer in sorted(peers, key=lambda peer: peer.name.casefold())]

    def _payload(self) -> bytes:
        return json.dumps(
            {
                "protocol": PROTOCOL,
                "id": self._id,
                "name": self._name[:80],
                "port": self._port,
                "locked": self._locked,
                "readonly": self._readonly,
            },
            separators=(",", ":"),
        ).encode()

    def _run(self) -> None:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except (AttributeError, OSError):
                pass
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.bind(("", DISCOVERY_PORT))
            sock.settimeout(0.35)
        except OSError:
            # Un firewall ou un port réservé ne doit jamais empêcher le partage manuel.
            return

        next_announce = 0.0
        try:
            while not self._stop.is_set():
                now = time.monotonic()
                if now >= next_announce:
                    try:
                        sock.sendto(self._payload(), ("<broadcast>", DISCOVERY_PORT))
                    except OSError:
                        pass
                    next_announce = now + ANNOUNCE_EVERY
                try:
                    raw, address = sock.recvfrom(MAX_PACKET_SIZE)
                except TimeoutError:
                    continue
                except OSError:
                    break
                self._receive(raw, address[0])
        finally:
            sock.close()

    def _receive(self, raw: bytes, host: str) -> None:
        try:
            data = json.loads(raw.decode("utf-8"))
            port = int(data["port"])
            peer_id = str(data["id"])
        except (UnicodeDecodeError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            return
        if data.get("protocol") != PROTOCOL or peer_id == self._id or not 1 <= port <= 65_535:
            return
        if not host or host.startswith("127."):
            return
        peer = Peer(
            id=peer_id,
            name=str(data.get("name") or "AeroDrop")[:80],
            host=host,
            port=port,
            locked=bool(data.get("locked")),
            readonly=bool(data.get("readonly")),
            seen_at=time.monotonic(),
        )
        with self._lock:
            self._peers[peer_id] = peer
