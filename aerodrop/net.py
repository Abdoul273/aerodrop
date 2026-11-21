"""Découverte réseau : adresses locales et QR code."""

from __future__ import annotations

import socket


def lan_addresses() -> list[str]:
    """Liste des IPv4 locales utilisables par les autres machines du réseau."""
    found: list[str] = []
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        for info in infos:
            ip = info[4][0]
            if ip not in found and not ip.startswith("127."):
                found.append(ip)
    except OSError:
        pass

    # Astuce : un socket UDP "connecté" révèle l'IP de l'interface par défaut,
    # sans envoyer le moindre paquet.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            ip = sock.getsockname()[0]
            if ip not in found and not ip.startswith("127."):
                found.insert(0, ip)
    except OSError:
        pass

    return found


def qr_matrix(text: str) -> list[list[bool]]:
    """Matrice de modules du QR code (sans dépendance à Pillow)."""
    import qrcode

    qr = qrcode.QRCode(border=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(text)
    qr.make(fit=True)
    return qr.get_matrix()


def qr_svg(text: str, size: int = 512) -> str:
    matrix = qr_matrix(text)
    modules = len(matrix)
    parts = [
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {modules} {modules}" '
            f'width="{size}" height="{size}" shape-rendering="crispEdges">'
        ),
        f'<rect width="{modules}" height="{modules}" fill="#ffffff"/>',
        '<path fill="#0b0b12" d="',
    ]
    for y, row in enumerate(matrix):
        for x, cell in enumerate(row):
            if cell:
                parts.append(f"M{x} {y}h1v1h-1z")
    parts.append('"/></svg>')
    return "".join(parts)


def qr_ascii(text: str) -> str:
    """QR code lisible directement dans le terminal."""
    import io

    import qrcode

    qr = qrcode.QRCode(border=1, error_correction=qrcode.constants.ERROR_CORRECT_L)
    qr.add_data(text)
    qr.make(fit=True)
    buffer = io.StringIO()
    qr.print_ascii(out=buffer, invert=True)
    return buffer.getvalue()
