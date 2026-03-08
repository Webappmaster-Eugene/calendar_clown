#!/usr/bin/env python3
"""
Конвертирует конфиг AmneziaVPN (vpn://...) в WireGuard/AmneziaWG .conf.
Использование: python3 scripts/amnezia-vpn-to-wg.py path/to/file.vpn
Файл может содержать только строку vpn://... (или путь к нему через аргумент).
Выход: файл с тем же именем и суффиксом .conf в текущей директории или в --output.
Логика декодирования: base64url + qUncompress (zlib, пропуск первых 4 байт).
"""
import argparse
import base64
import configparser
import io
import json
import sys
from pathlib import Path


def from_base64_urlsafe(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (4 - len(s) % 4))


import zlib


def zlib_decompress_qcompress(s: bytes) -> bytes:
    # Qt qCompress: первые 4 байта — размер, далее zlib
    return zlib.decompress(s[4:])


def extract_json_from_vpn_string(vpn_string: str) -> str:
    vpn_string = vpn_string.strip().strip("vpn://").strip()
    encoded = vpn_string
    compressed = from_base64_urlsafe(encoded)
    decompressed = zlib_decompress_qcompress(compressed)
    return decompressed.decode("utf-8")


def make_wireguard_conf(amnezia_config_json: str) -> str:
    amnezia = json.loads(amnezia_config_json)
    # Amnezia Premium (config_version 2): конфиг подгружается с сервера по api_key, в ссылке нет .conf
    if amnezia.get("config_version") == 2 or amnezia.get("api_config"):
        name = amnezia.get("name") or "Amnezia Premium"
        raise ValueError(
            f"{name}: это конфиг Amnezia Premium (API). "
            "Для Linux-сервера нужен готовый .conf. "
            "Скачайте его в личном кабинете: https://cp.amnezia.org → ваш профиль → экспорт в формате WireGuard (.conf)."
        )
    containers = amnezia.get("containers") or []
    if not containers:
        raise ValueError("В конфиге нет containers (и не Premium API).")
    last = containers[-1]
    awg = last.get("awg") or last.get("amneziawg")
    if not awg:
        raise ValueError("Нет awg/amneziawg в последнем контейнере")
    last_config_json = awg.get("last_config")
    if not last_config_json:
        raise ValueError("Нет last_config в awg")
    last_config = json.loads(last_config_json)
    wg_config = last_config.get("config") or ""
    dns1 = (amnezia.get("dns1") or "").strip() or "1.1.1.1"
    dns2 = (amnezia.get("dns2") or "").strip() or "8.8.8.8"
    wg_config = wg_config.replace("$PRIMARY_DNS", dns1).replace("$SECONDARY_DNS", dns2)
    if last_config.get("mtu"):
        try:
            config = configparser.ConfigParser()
            config.optionxform = lambda x: x
            config.read_string(wg_config)
            if "Interface" in config:
                config["Interface"]["MTU"] = str(last_config["mtu"])
            if last_config.get("port") and "Interface" in config:
                config["Interface"]["ListenPort"] = str(last_config["port"])
            buf = io.StringIO()
            config.write(buf)
            wg_config = buf.getvalue()
        except Exception:
            pass
    return wg_config


def main():
    parser = argparse.ArgumentParser(description="Amnezia vpn:// → WireGuard .conf")
    parser.add_argument("vpn_file", type=Path, help="Файл с строкой vpn://...")
    parser.add_argument("-o", "--output", type=Path, help="Путь к выходному .conf")
    args = parser.parse_args()
    vpn_path = args.vpn_file
    if not vpn_path.exists():
        print(f"Ошибка: файл не найден: {vpn_path}", file=sys.stderr)
        sys.exit(1)
    raw = vpn_path.read_text().strip()
    if raw.startswith("vpn://"):
        vpn_string = raw
    else:
        vpn_string = raw
    try:
        json_str = extract_json_from_vpn_string(vpn_string)
        wg = make_wireguard_conf(json_str)
    except Exception as e:
        print(f"Ошибка декодирования: {e}", file=sys.stderr)
        sys.exit(1)
    out = args.output or vpn_path.with_suffix(".conf")
    out.write_text(wg)
    print(f"Записано: {out}")


if __name__ == "__main__":
    main()
