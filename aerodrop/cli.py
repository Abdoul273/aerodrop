"""Ligne de commande d'AeroDrop."""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import webbrowser
from pathlib import Path

from .app import VERSION, create_app
from .config import Settings
from .net import lan_addresses, qr_ascii

RESET = "\033[0m"
DIM = "\033[2m"
BOLD = "\033[1m"
VIOLET = "\033[38;5;141m"
CYAN = "\033[38;5;51m"
GREEN = "\033[38;5;42m"
YELLOW = "\033[38;5;220m"
RED = "\033[38;5;203m"


def free_port(host: str, preferred: int) -> int:
    """Retourne le port demandé, ou le suivant libre."""
    for port in range(preferred, preferred + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host if host != "0.0.0.0" else "", port))
                return port
            except OSError:
                continue
    raise SystemExit(f"{RED}Aucun port libre autour de {preferred}.{RESET}")


def banner(settings: Settings, port: int, urls: list[str]) -> None:
    line = "─" * 58
    print()
    print(f"{VIOLET}{BOLD}  AeroDrop{RESET} {DIM}v{VERSION} · partage local instantané{RESET}")
    print(f"{DIM}  {line}{RESET}")
    print(f"  {DIM}Appareil{RESET}  {BOLD}{settings.device_name}{RESET}")
    print(f"  {DIM}Dossier {RESET}  {settings.root_path}")
    if settings.readonly:
        print(f"  {DIM}Mode    {RESET}  {YELLOW}lecture seule{RESET}")
    if settings.pin:
        print(f"  {DIM}Code    {RESET}  {YELLOW}{settings.pin}{RESET}")
    print(f"{DIM}  {line}{RESET}")
    print(f"  {CYAN}Ouvre ce lien depuis n'importe quel PC du réseau :{RESET}")
    for url in urls:
        print(f"    {BOLD}{url}{RESET}")
    if not urls:
        print(f"    {BOLD}http://localhost:{port}{RESET}")
    print(f"  {DIM}Local   http://localhost:{port}{RESET}")
    print(f"{DIM}  {line}{RESET}")

    if urls:
        print(qr_ascii(urls[0]))
        print(f"  {DIM}Scanne avec ton téléphone (même Wi-Fi).{RESET}")
    print(f"  {DIM}Ctrl+C pour arrêter le partage.{RESET}")
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="aerodrop",
        description="Partage de fichiers et dossiers en réseau local.",
    )
    parser.add_argument(
        "root",
        nargs="?",
        default=".",
        help="dossier à partager (défaut : dossier courant)",
    )
    parser.add_argument("-p", "--port", type=int, default=8080, help="port d'écoute")
    parser.add_argument("--host", default="0.0.0.0", help="interface d'écoute")
    parser.add_argument("--pin", default=None, help="code d'accès (4-6 chiffres conseillés)")
    parser.add_argument("--name", default="AeroDrop", help="nom affiché de cet appareil")
    parser.add_argument("--readonly", action="store_true", help="interdire envoi/suppression")
    parser.add_argument("--no-open", action="store_true", help="ne pas ouvrir le navigateur")
    parser.add_argument("--window", action="store_true", help="fenêtre desktop (pywebview)")
    args = parser.parse_args(argv)

    root = Path(args.root).expanduser()
    if not root.exists():
        print(f"{RED}Dossier introuvable : {root}{RESET}")
        return 1
    if not root.is_dir():
        print(f"{RED}Ce n'est pas un dossier : {root}{RESET}")
        return 1

    port = free_port(args.host, args.port)
    if port != args.port:
        print(f"{YELLOW}Port {args.port} occupé → utilisation de {port}.{RESET}")

    settings = Settings(
        root=root,
        host=args.host,
        port=port,
        pin=args.pin,
        name=args.name,
        readonly=args.readonly,
    )
    app = create_app(settings)

    urls = [f"http://{ip}:{port}" for ip in lan_addresses()]
    local_url = f"http://localhost:{port}"
    banner(settings, port, urls)

    if args.window:
        try:
            import webview  # type: ignore
        except ImportError:
            print(
                f"{YELLOW}pywebview absent → ouverture dans le navigateur.{RESET}"
                f"\n{DIM}Pour la fenêtre desktop : pip install pywebview{RESET}"
            )
            webbrowser.open(local_url)
        else:
            import uvicorn

            server = uvicorn.Server(
                uvicorn.Config(app, host=args.host, port=port, log_level="warning")
            )
            thread = threading.Thread(target=server.run, daemon=True)
            thread.start()
            webview.create_window(
                f"AeroDrop · {settings.device_name}",
                local_url,
                width=1280,
                height=840,
                min_size=(900, 600),
                background_color="#07080f",
            )
            webview.start()
            server.should_exit = True
            return 0
    elif not args.no_open:
        threading.Timer(0.8, lambda: webbrowser.open(local_url)).start()

    import uvicorn

    try:
        uvicorn.run(app, host=args.host, port=port, log_level="warning")
    except KeyboardInterrupt:
        print(f"\n{DIM}Partage arrêté.{RESET}")
    return 0


def desktop_main() -> int:
    """Lance AeroDrop dans sa fenêtre desktop native."""
    return main([*sys.argv[1:], "--window"])


if __name__ == "__main__":
    sys.exit(main())
