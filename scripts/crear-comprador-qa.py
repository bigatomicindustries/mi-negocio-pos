"""Crea un comprador mexicano desde la terminal del titular (macOS o Linux)."""
import getpass
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPRedirectHandler, Request


class SoloDestinoOriginal(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def solicitar(cliente, ruta, token, datos=None):
    cuerpo = None if datos is None else json.dumps(datos).encode()
    peticion = Request("https://api.mercadopago.com" + ruta, data=cuerpo, headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json",
    })
    with cliente.open(peticion, timeout=20) as respuesta:
        return json.load(respuesta)


def main():
    if os.name != "posix" or not sys.stdin.isatty():
        sys.exit("Ejecuta el script desde una terminal interactiva de macOS o Linux.")
    carpeta = Path.home() / ".mi-negocio-qa"
    carpeta.mkdir(mode=0o700, exist_ok=True)
    if carpeta.is_symlink() or carpeta.stat().st_uid != os.getuid() or carpeta.stat().st_mode & 0o077:
        sys.exit("La carpeta de QA requiere acceso exclusivo de tu usuario.")
    archivo = carpeta / "comprador-mx.json"
    if archivo.exists():
        sys.exit(f"Ya hay un intento registrado. Revisa {archivo} antes de crear otra cuenta.")
    token = getpass.getpass("Access Token del titular de la aplicación (entrada oculta): ").strip()
    if not token:
        sys.exit("Falta la credencial del titular.")
    cliente = build_opener(SoloDestinoOriginal())
    titular = solicitar(cliente, "/users/me", token)
    if titular.get("site_id") != "MLM" or "test_user" in titular.get("tags", []) or token.startswith("TEST-"):
        sys.exit("Se requiere la cuenta titular de México para crear un usuario de prueba.")
    # Reservar antes del POST evita crear dos compradores después de un timeout.
    with os.fdopen(os.open(archivo, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as salida:
        json.dump({"estado": "solicitud iniciada"}, salida)
        salida.flush()
        os.fsync(salida.fileno())
        cuenta = solicitar(cliente, "/users/test", token, {
            "site_id": "MLM", "description": "Mi Negocio POS DEV - comprador de suscripciones",
        })
        credenciales = {k: cuenta.get(k) for k in ("id", "site_id", "nickname", "email", "password")}
        salida.seek(0)
        json.dump(credenciales, salida, indent=2)
        salida.truncate()
        salida.flush()
        os.fsync(salida.fileno())
    print(f"Datos del comprador de prueba guardados en {archivo}.")
    email = cuenta.get("email") or ""
    if not re.fullmatch(r"[a-zA-Z0-9._-]+@testuser\.com", email, re.IGNORECASE):
        sys.exit("Mercado Pago respondió sin un correo de prueba válido. Revisa la cuenta ya creada en el panel.")
    print("Correo de prueba para el POS:", email)


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        sys.exit(f"Mercado Pago respondió HTTP {error.code}. Revisa el resultado en Cuentas de prueba.")
    except (URLError, TimeoutError, ValueError, OSError):
        sys.exit("No se pudo confirmar el resultado. Revisa la cuenta en Mercado Pago antes de reintentar.")
