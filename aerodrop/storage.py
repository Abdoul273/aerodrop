"""Accès au système de fichiers, confiné à une racine de partage."""

from __future__ import annotations

import os
import shutil
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

HIDDEN_PREFIXES = (".",)


class BadPath(Exception):
    """Chemin refusé (hors racine, invalide, etc.)."""


class NotFound(BadPath):
    """Chemin inexistant."""


def normalize(rel: str | None) -> str:
    """Normalise un chemin relatif façon URL (sans '..' ni absolu)."""
    if not rel:
        return ""
    rel = rel.replace("\\", "/").strip()
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise BadPath("Chemin interdit")
    return "/".join(parts)


def safe_path(root: Path, rel: str | None) -> Path:
    """Résout un chemin relatif en garantissant qu'il reste dans la racine."""
    rel = normalize(rel)
    root = root.resolve()
    target = (root / rel).resolve() if rel else root
    if target != root and root not in target.parents:
        raise BadPath("Chemin hors de la zone partagée")
    return target


def safe_name(name: str) -> str:
    """Valide un nom de fichier ou dossier (pas de séparateurs)."""
    name = (name or "").strip()
    if not name or name in (".", ".."):
        raise BadPath("Nom invalide")
    if any(c in name for c in ("/", "\\", "\0")):
        raise BadPath("Le nom ne peut pas contenir de séparateur")
    return name


@dataclass
class Entry:
    name: str
    path: str
    is_dir: bool
    size: int
    mtime: float
    count: int | None = None

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "path": self.path,
            "is_dir": self.is_dir,
            "size": self.size,
            "mtime": self.mtime,
            "count": self.count,
        }


def _natural_key(text: str) -> list[tuple[int, int | str]]:
    """Clé de tri naturel comparable, même entre noms texte et numériques."""
    out: list[tuple[int, int | str]] = []
    buf = ""
    digits = False
    for ch in text.lower():
        is_digit = ch.isdigit()
        if buf and is_digit != digits:
            out.append((0, int(buf)) if digits else (1, buf))
            buf = ""
        buf += ch
        digits = is_digit
    if buf:
        out.append((0, int(buf)) if digits else (1, buf))
    return out


def list_dir(root: Path, rel: str | None = "") -> tuple[str, list[Entry]]:
    rel = normalize(rel)
    target = safe_path(root, rel)
    if not target.exists():
        raise NotFound("Dossier introuvable")
    if not target.is_dir():
        raise BadPath("Ce n'est pas un dossier")

    entries: list[Entry] = []
    with os.scandir(target) as it:
        for item in it:
            try:
                is_dir = item.is_dir(follow_symlinks=False)
                stat = item.stat(follow_symlinks=False)
            except OSError:
                continue
            child = f"{rel}/{item.name}" if rel else item.name
            count = None
            if is_dir:
                try:
                    count = sum(1 for _ in os.scandir(item.path))
                except OSError:
                    count = None
            entries.append(
                Entry(
                    name=item.name,
                    path=child,
                    is_dir=is_dir,
                    size=0 if is_dir else stat.st_size,
                    mtime=stat.st_mtime,
                    count=count,
                )
            )

    entries.sort(key=lambda e: (not e.is_dir, _natural_key(e.name)))
    return rel, entries


def search(root: Path, query: str, limit: int = 200) -> list[Entry]:
    query = (query or "").strip().lower()
    if not query:
        return []
    root = root.resolve()
    results: list[Entry] = []
    started = time.monotonic()
    for dirpath, dirnames, filenames in os.walk(root):
        if len(results) >= limit or time.monotonic() - started > 4:
            break
        dirnames[:] = sorted(
            d for d in dirnames if not d.startswith(HIDDEN_PREFIXES)
        )[:400]
        base = Path(dirpath)
        for name in list(dirnames) + filenames:
            if query not in name.lower():
                continue
            full = base / name
            try:
                is_dir = full.is_dir()
                stat = full.stat()
            except OSError:
                continue
            rel = full.relative_to(root).as_posix()
            results.append(
                Entry(
                    name=name,
                    path=rel,
                    is_dir=is_dir,
                    size=0 if is_dir else stat.st_size,
                    mtime=stat.st_mtime,
                )
            )
            if len(results) >= limit:
                break
    results.sort(key=lambda e: (not e.is_dir, e.name.lower()))
    return results


def unique_destination(directory: Path, name: str) -> Path:
    """Trouve un nom libre : 'photo.png' -> 'photo (1).png'."""
    candidate = directory / name
    if not candidate.exists():
        return candidate
    stem, suffix = Path(name).stem, Path(name).suffix
    index = 1
    while True:
        candidate = directory / f"{stem} ({index}){suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def folder_size(path: Path) -> int:
    total = 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for name in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                pass
    return total


def zip_folder(root: Path, rel: str, dest: Path) -> None:
    """Compresse un dossier (ou fichier) dans une archive zip."""
    target = safe_path(root, rel)
    if not target.exists():
        raise NotFound("Introuvable")
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        if target.is_file():
            zf.write(target, target.name)
            return
        base_parent = target.parent
        for dirpath, dirnames, filenames in os.walk(target):
            dirnames.sort()
            for name in sorted(filenames):
                full = Path(dirpath) / name
                try:
                    zf.write(full, full.relative_to(base_parent).as_posix())
                except OSError:
                    continue


def remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink()
