#!/usr/bin/env python3
"""
Downloads a curated set of open-license (OFL) Google Fonts as .ttf files
into static/fonts/, plus a fonts.json manifest used by the app.

Run once during setup:
    python3 scripts/download_fonts.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

API_BASE_ROOT = "https://api.github.com/repos/google/fonts/contents"
LICENSE_DIRS = ("ofl", "apache", "ufl")
FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "fonts")
MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "..", "static", "fonts", "fonts.json")

# display name -> google/fonts repo slug (lowercase, no spaces)
FONT_FAMILIES = {
    "Roboto": "roboto",
    "Open Sans": "opensans",
    "Lato": "lato",
    "Montserrat": "montserrat",
    "Oswald": "oswald",
    "Poppins": "poppins",
    "Raleway": "raleway",
    "Nunito": "nunito",
    "Merriweather": "merriweather",
    "Playfair Display": "playfairdisplay",
    "PT Sans": "ptsans",
    "Source Sans 3": "sourcesans3",
    "Inter": "inter",
    "Work Sans": "worksans",
    "Bebas Neue": "bebasneue",
    "Anton": "anton",
    "Archivo": "archivo",
    "Rubik": "rubik",
    "Karla": "karla",
    "Quicksand": "quicksand",
    "Dancing Script": "dancingscript",
    "Pacifico": "pacifico",
    "Lobster": "lobster",
    "Caveat": "caveat",
    "Bitter": "bitter",
    "Libre Baskerville": "librebaskerville",
    "Cormorant Garamond": "cormorantgaramond",
    "Barlow": "barlow",
    "Josefin Sans": "josefinsans",
    "DM Sans": "dmsans",
    "Space Mono": "spacemono",
    "Roboto Mono": "robotomono",
    "Fira Sans": "firasans",
    "Noto Sans": "notosans",
    "Abril Fatface": "abrilfatface",
    "Righteous": "righteous",
    "Comfortaa": "comfortaa",
    "Indie Flower": "indieflower",
    "Permanent Marker": "permanentmarker",
    "Playfair Display SC": "playfairdisplaysc",
    "Amatic SC": "amaticsc",
}

HEADERS = {"User-Agent": "image-template-tool-font-fetcher"}
if os.environ.get("GITHUB_TOKEN"):
    HEADERS["Authorization"] = f"token {os.environ['GITHUB_TOKEN']}"


def api_get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def download(url, dest):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def pick_regular_file(entries, slug):
    """Given a GitHub 'contents' listing for a font family dir, choose the
    best single .ttf file representing the Regular weight/style."""
    ttfs = [e for e in entries if e["type"] == "file" and e["name"].lower().endswith(".ttf")]

    # 1) static folder with an explicit "<Family>-Regular.ttf"
    for e in ttfs:
        name = e["name"]
        if name.endswith("-Regular.ttf") and "Italic" not in name:
            return e

    # 2) a variable font file like "Roboto[wdth,wght].ttf" (no Italic)
    non_italic = [e for e in ttfs if "italic" not in e["name"].lower()]
    if len(non_italic) == 1:
        return non_italic[0]
    if non_italic:
        # prefer the shortest name (usually the "base" family file, not a subfamily)
        return sorted(non_italic, key=lambda e: len(e["name"]))[0]

    # 3) fall back to any ttf at all
    if ttfs:
        return ttfs[0]
    return None


def main():
    os.makedirs(FONTS_DIR, exist_ok=True)
    manifest = []
    failures = []

    for display_name, slug in sorted(FONT_FAMILIES.items()):
        dest_filename = f"{slug}.ttf"
        dest_path = os.path.join(FONTS_DIR, dest_filename)

        if os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000:
            print(f"[skip] {display_name} already present")
            manifest.append({"name": display_name, "file": dest_filename})
            continue

        try:
            entries = None
            for lic in LICENSE_DIRS:
                try:
                    entries = api_get(f"{API_BASE_ROOT}/{lic}/{slug}")
                    break
                except urllib.error.HTTPError as e:
                    if e.code != 404:
                        raise
            if entries is None:
                raise RuntimeError("family directory not found under ofl/apache/ufl")
            # some families keep static weights under a "static/" subfolder
            static_entry = next((e for e in entries if e["type"] == "dir" and e["name"] == "static"), None)
            if static_entry:
                sub_entries = api_get(static_entry["url"].split("?")[0] + "?ref=main")
                chosen = pick_regular_file(sub_entries, slug)
            else:
                chosen = pick_regular_file(entries, slug)

            if not chosen:
                raise RuntimeError("no ttf found")

            size = download(chosen["download_url"], dest_path)
            print(f"[ok]   {display_name:<22} <- {chosen['name']}  ({size/1024:.0f} KB)")
            manifest.append({"name": display_name, "file": dest_filename})
        except Exception as exc:
            print(f"[FAIL] {display_name}: {exc}")
            failures.append(display_name)
        time.sleep(0.3)

    manifest.sort(key=lambda m: m["name"])
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n{len(manifest)} fonts ready, {len(failures)} failed.")
    if failures:
        print("Failed:", ", ".join(failures))
        sys.exit(1)


if __name__ == "__main__":
    main()
