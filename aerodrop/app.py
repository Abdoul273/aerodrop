"""Application FastAPI d'AeroDrop : partage de fichiers en réseau local."""

from __future__ import annotations

import asyncio
import mimetypes
import os
import shutil
import tempfile
import time
import urllib.parse
from collections.abc import AsyncIterator
from pathlib import Path

import aiofiles
from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

from .config import Settings
from .discovery import Discovery
from .hub import Hub
from .net import lan_addresses, qr_svg
from .storage import (
    BadPath,
    NotFound,
    folder_size,
    list_dir,
    normalize,
    remove,
    safe_name,
    safe_path,
    search,
    unique_destination,
    zip_folder,
)

STATIC_DIR = Path(__file__).parent / "static"
VERSION = "1.1.1"
CHUNK = 256 * 1024
PROGRESS_INTERVAL = 0.15


def _parse_range(header: str, size: int) -> tuple[int, int] | None:
    """Analyse un en-tête Range simple (bytes=start-end)."""
    if not header.startswith("bytes="):
        return None
    spec = header[6:].split(",")[0].strip()
    if "-" not in spec:
        return None
    start_raw, end_raw = spec.split("-", 1)
    try:
        if start_raw == "":
            length = int(end_raw)
            if length <= 0:
                return None
            start = max(0, size - length)
            end = size - 1
        else:
            start = int(start_raw)
            end = int(end_raw) if end_raw else size - 1
    except ValueError:
        return None
    if start >= size:
        return None
    end = min(end, size - 1)
    if end < start:
        return None
    return start, end


def _content_disposition(name: str, inline: bool) -> str:
    kind = "inline" if inline else "attachment"
    ascii_name = name.encode("ascii", "ignore").decode() or "fichier"
    ascii_name = ascii_name.replace('"', "")
    quoted = urllib.parse.quote(name, safe="")
    return f'{kind}; filename="{ascii_name}"; filename*=UTF-8\'\'{quoted}'


def create_app(settings: Settings) -> FastAPI:
    root = settings.root_path
    hub = Hub()
    app = FastAPI(title="AeroDrop", version=VERSION, docs_url=None, redoc_url=None)
    app.state.settings = settings
    app.state.hub = hub
    app.state.discovery = Discovery(
        name=settings.device_name,
        port=settings.port,
        locked=bool(settings.pin),
        readonly=settings.readonly,
    )

    @app.on_event("startup")
    async def start_discovery() -> None:
        app.state.discovery.start()

    @app.on_event("shutdown")
    async def stop_discovery() -> None:
        app.state.discovery.stop()

    # ---------------------------------------------------------------- auth
    def authorized(request: Request) -> bool:
        if not settings.pin:
            return True
        cookie = request.cookies.get("aerodrop_pin", "")
        if cookie and cookie == settings.pin:
            return True
        header = request.headers.get("x-aerodrop-pin", "")
        if header and header == settings.pin:
            return True
        return request.query_params.get("pin", "") == settings.pin

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        path = request.url.path
        public = (
            path.startswith("/static")
            or path in ("/api/info", "/api/login", "/api/qr", "/favicon.ico", "/")
        )
        if settings.pin and not public and not authorized(request):
            if path.startswith("/api/"):
                return JSONResponse({"detail": "PIN requis", "locked": True}, status_code=401)
            return JSONResponse({"detail": "PIN requis", "locked": True}, status_code=401)
        return await call_next(request)

    def require_write() -> None:
        if settings.readonly:
            raise HTTPException(403, "Partage en lecture seule")

    # ---------------------------------------------------------------- helpers
    def resolve(rel: str | None) -> Path:
        try:
            return safe_path(root, rel)
        except BadPath as exc:
            raise HTTPException(400, str(exc)) from exc

    def stat_or_404(path: Path) -> os.stat_result:
        try:
            return path.stat()
        except OSError as exc:
            raise HTTPException(404, "Introuvable") from exc

    async def emit(payload: dict, exclude: WebSocket | None = None) -> None:
        await hub.broadcast(payload, exclude=exclude)

    # ---------------------------------------------------------------- pages
    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(
            STATIC_DIR / "index.html",
            headers={"Cache-Control": "no-cache"},
        )

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon() -> FileResponse:
        return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    # ---------------------------------------------------------------- api
    @app.get("/api/info")
    async def info(request: Request) -> dict:
        try:
            usage = shutil.disk_usage(root)
            disk = {"total": usage.total, "used": usage.used, "free": usage.free}
        except OSError:
            disk = {"total": 0, "used": 0, "free": 0}
        urls = [f"http://{ip}:{settings.port}" for ip in lan_addresses()]
        return {
            "name": settings.device_name,
            "version": VERSION,
            "root": root.name or str(root),
            "root_path": str(root),
            "readonly": settings.readonly,
            "locked": bool(settings.pin),
            "authorized": authorized(request),
            "disk": disk,
            "urls": urls,
            "clients": hub.count,
        }

    @app.get("/api/peers")
    async def peers() -> dict:
        """Appareils AeroDrop visibles sur le même réseau local."""
        return {"peers": app.state.discovery.peers()}

    @app.get("/api/peers/{peer_id}/connect")
    async def connect_peer(peer_id: str) -> dict:
        """Valide un appareil détecté avant de diriger le navigateur vers lui."""
        peer = app.state.discovery.peer(peer_id)
        if peer is None:
            raise HTTPException(404, "Cet appareil n'est plus visible sur le réseau")
        reachable = await asyncio.to_thread(app.state.discovery.reachable, peer)
        if not reachable:
            raise HTTPException(
                503,
                "Cet appareil est détecté, mais AeroDrop n'accepte pas encore les connexions. "
                f"Ouvre AeroDrop sur ce PC et autorise le port {peer.port} dans son pare-feu.",
            )
        return {"url": peer.as_dict()["url"]}

    @app.post("/api/login")
    async def login(request: Request, response: Response) -> dict:
        body = await request.json()
        pin = str(body.get("pin", "")).strip()
        if not settings.pin:
            return {"ok": True}
        if pin != settings.pin:
            raise HTTPException(403, "PIN incorrect")
        response.set_cookie(
            "aerodrop_pin",
            settings.pin,
            httponly=True,
            samesite="lax",
            max_age=60 * 60 * 24 * 30,
        )
        return {"ok": True}

    @app.get("/api/list")
    async def api_list(path: str = "") -> dict:
        try:
            rel, entries = list_dir(root, path)
        except NotFound as exc:
            raise HTTPException(404, str(exc)) from exc
        except BadPath as exc:
            raise HTTPException(400, str(exc)) from exc
        return {
            "path": rel,
            "entries": [entry.as_dict() for entry in entries],
            "parent": "/".join(rel.split("/")[:-1]) if rel else None,
        }

    @app.get("/api/search")
    async def api_search(q: str = "", limit: int = 200) -> dict:
        return {"entries": [entry.as_dict() for entry in search(root, q, limit)]}

    @app.put("/api/upload")
    async def api_upload(request: Request, path: str = "", tid: str = "") -> dict:
        require_write()
        raw_name = request.headers.get("x-file-name", "")
        name = urllib.parse.unquote(raw_name).strip()
        if not name:
            raise HTTPException(400, "Nom de fichier manquant")

        try:
            target_dir = resolve(path)
            if not target_dir.is_dir():
                raise HTTPException(400, "Dossier cible invalide")
            # Les envois de dossiers peuvent contenir un sous-chemin relatif.
            name = normalize(name)
            dest = resolve(f"{normalize(path)}/{name}" if path else name)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                dest = unique_destination(dest.parent, dest.name)
            rel_dest = dest.relative_to(root).as_posix()
        except BadPath as exc:
            raise HTTPException(400, str(exc)) from exc

        total = int(request.headers.get("content-length") or 0)
        temp = dest.with_name(dest.name + ".part")
        received = 0
        started = time.monotonic()
        last_emit = 0.0
        label = dest.name

        await emit(
            {
                "type": "upload",
                "id": tid,
                "status": "start",
                "name": label,
                "path": rel_dest,
                "size": total,
            }
        )
        try:
            async with aiofiles.open(temp, "wb") as handle:
                async for chunk in request.stream():
                    if not chunk:
                        continue
                    await handle.write(chunk)
                    received += len(chunk)
                    now = time.monotonic()
                    if now - last_emit > PROGRESS_INTERVAL:
                        last_emit = now
                        await emit(
                            {
                                "type": "upload",
                                "id": tid,
                                "status": "progress",
                                "name": label,
                                "path": rel_dest,
                                "received": received,
                                "size": total,
                                "speed": received / max(now - started, 0.001),
                            }
                        )
            os.replace(temp, dest)
        except Exception:
            temp.unlink(missing_ok=True)
            await emit(
                {
                    "type": "upload",
                    "id": tid,
                    "status": "error",
                    "name": label,
                    "path": rel_dest,
                }
            )
            raise

        elapsed = max(time.monotonic() - started, 0.001)
        await emit(
            {
                "type": "upload",
                "id": tid,
                "status": "done",
                "name": label,
                "path": rel_dest,
                "received": received,
                "size": received,
                "speed": received / elapsed,
                "elapsed": elapsed,
            }
        )
        await emit({"type": "fs", "action": "upload", "path": normalize(path)})
        return {"ok": True, "path": rel_dest, "size": received, "name": dest.name}

    @app.get("/api/download")
    async def api_download(
        request: Request,
        path: str,
        inline: bool = False,
        tid: str = "",
    ):
        target = resolve(path)
        stat = stat_or_404(target)
        if target.is_dir():
            raise HTTPException(400, "Utilisez /api/zip pour un dossier")

        size = stat.st_size
        start, end = 0, size - 1
        status = 200
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Disposition": _content_disposition(target.name, inline),
            "Cache-Control": "no-store",
        }
        range_header = request.headers.get("range")
        if range_header:
            parsed = _parse_range(range_header, size)
            if parsed is None:
                return Response(
                    status_code=416,
                    headers={"Content-Range": f"bytes */{size}"},
                )
            start, end = parsed
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        headers["Content-Length"] = str(end - start + 1)

        media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if inline and media_type == "application/octet-stream":
            media_type = "text/plain"

        async def stream() -> AsyncIterator[bytes]:
            sent = 0
            remaining = end - start + 1
            last_emit = 0.0
            started = time.monotonic()
            await emit(
                {
                    "type": "download",
                    "id": tid,
                    "status": "start",
                    "name": target.name,
                    "path": path,
                    "size": size,
                }
            )
            try:
                with target.open("rb") as handle:
                    handle.seek(start)
                    while remaining > 0:
                        chunk = await asyncio.to_thread(handle.read, min(CHUNK, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        sent += len(chunk)
                        yield chunk
                        now = time.monotonic()
                        if now - last_emit > PROGRESS_INTERVAL:
                            last_emit = now
                            await emit(
                                {
                                    "type": "download",
                                    "id": tid,
                                    "status": "progress",
                                    "name": target.name,
                                    "path": path,
                                    "received": sent,
                                    "size": size,
                                    "speed": sent / max(now - started, 0.001),
                                }
                            )
            finally:
                await emit(
                    {
                        "type": "download",
                        "id": tid,
                        "status": "done",
                        "name": target.name,
                        "path": path,
                        "received": sent,
                        "size": size,
                        "speed": sent / max(time.monotonic() - started, 0.001),
                    }
                )

        return StreamingResponse(
            stream(), status_code=status, media_type=media_type, headers=headers
        )

    @app.get("/api/zip")
    async def api_zip(path: str, tid: str = ""):
        target = resolve(path)
        stat_or_404(target)
        if target == root:
            archive_name = f"{root.name or 'partage'}.zip"
        else:
            archive_name = f"{target.name}.zip"

        await emit(
            {
                "type": "download",
                "id": tid,
                "status": "start",
                "name": archive_name,
                "path": path,
                "size": 0,
            }
        )
        fd, tmp_name = tempfile.mkstemp(suffix=".zip")
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            await asyncio.to_thread(zip_folder, root, path, tmp)
        except (BadPath, NotFound) as exc:
            tmp.unlink(missing_ok=True)
            raise HTTPException(400, str(exc)) from exc
        size = tmp.stat().st_size
        await emit(
            {
                "type": "download",
                "id": tid,
                "status": "progress",
                "name": archive_name,
                "path": path,
                "received": size,
                "size": size,
                "speed": 0,
            }
        )
        await emit(
            {
                "type": "download",
                "id": tid,
                "status": "done",
                "name": archive_name,
                "path": path,
                "received": size,
                "size": size,
                "speed": 0,
            }
        )
        return FileResponse(
            tmp,
            media_type="application/zip",
            filename=archive_name,
            headers={"Content-Disposition": _content_disposition(archive_name, False)},
            background=BackgroundTask(tmp.unlink, missing_ok=True),
        )

    @app.post("/api/mkdir")
    async def api_mkdir(request: Request) -> dict:
        require_write()
        body = await request.json()
        parent = normalize(body.get("path", ""))
        name = safe_name(body.get("name", ""))
        directory = resolve(parent)
        if not directory.is_dir():
            raise HTTPException(400, "Dossier parent invalide")
        target = resolve(f"{parent}/{name}" if parent else name)
        if target.exists():
            raise HTTPException(409, "Ce nom existe déjà")
        target.mkdir(parents=True)
        rel = target.relative_to(root).as_posix()
        await emit({"type": "fs", "action": "mkdir", "path": parent})
        return {"ok": True, "path": rel}

    @app.post("/api/rename")
    async def api_rename(request: Request) -> dict:
        require_write()
        body = await request.json()
        source = resolve(body.get("path", ""))
        name = safe_name(body.get("name", ""))
        stat_or_404(source)
        target = source.with_name(name)
        if target.exists():
            raise HTTPException(409, "Ce nom existe déjà")
        source.rename(target)
        rel = target.relative_to(root).as_posix()
        await emit({"type": "fs", "action": "rename", "path": rel})
        return {"ok": True, "path": rel}

    @app.post("/api/delete")
    async def api_delete(request: Request) -> dict:
        require_write()
        body = await request.json()
        rel = normalize(body.get("path", ""))
        if not rel:
            raise HTTPException(400, "Impossible de supprimer la racine")
        target = resolve(rel)
        stat_or_404(target)
        await asyncio.to_thread(remove, target)
        await emit({"type": "fs", "action": "delete", "path": rel})
        return {"ok": True}

    @app.get("/api/qr")
    async def api_qr(url: str) -> Response:
        if not url:
            urls = lan_addresses()
            url = f"http://{urls[0]}:{settings.port}" if urls else "http://localhost"
        svg = qr_svg(url)
        return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "max-age=60"})

    @app.get("/api/size")
    async def api_size(path: str) -> dict:
        target = resolve(path)
        stat_or_404(target)
        size = await asyncio.to_thread(folder_size, target) if target.is_dir() else target.stat().st_size
        return {"size": size}

    # ---------------------------------------------------------------- websocket
    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket) -> None:
        if settings.pin:
            provided = ws.query_params.get("pin", "") or ws.cookies.get("aerodrop_pin", "")
            if provided != settings.pin:
                await ws.close(code=4401)
                return
        await ws.accept()
        await hub.add(ws, ws.client.host if ws.client else "")
        await ws.send_json(
            {"type": "hello", "name": settings.device_name, "clients": hub.count}
        )
        await hub.announce_clients()
        try:
            while True:
                await ws.receive_text()
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            await hub.remove(ws)
            await hub.announce_clients()

    return app
