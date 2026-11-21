"""Diffusion d'événements temps réel vers les navigateurs connectés."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect


class Hub:
    """Registre des clients WebSocket et diffusion de messages."""

    def __init__(self) -> None:
        self._clients: dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    async def add(self, ws: WebSocket, label: str = "") -> None:
        async with self._lock:
            self._clients[ws] = label

    async def remove(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.pop(ws, None)

    @property
    def count(self) -> int:
        return len(self._clients)

    async def broadcast(self, payload: dict[str, Any], exclude: WebSocket | None = None) -> None:
        targets = [ws for ws in self._clients if ws is not exclude]
        if not targets:
            return

        async def send(ws: WebSocket) -> None:
            try:
                await ws.send_json(payload)
            except (RuntimeError, WebSocketDisconnect):
                await self.remove(ws)

        await asyncio.gather(*(send(ws) for ws in targets), return_exceptions=True)

    async def announce_clients(self) -> None:
        await self.broadcast({"type": "clients", "count": self.count})
