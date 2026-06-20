#!/usr/bin/env python3
"""
Inferno Link — asset generation via Google Nano Banana Pro (Gemini 3 Pro Image).

A fire-themed hold-and-spin slot (the "fire link" genre): gem + 7 + bell pay symbols,
a flaming FIREBALL money symbol, and a 4-tier jackpot. Original Goldwave art — NOT the
trademarked "Ultimate Fire Link" name/logo/symbol art.

Sprites land on solid WHITE (keyed to alpha in prep-assets.py); the background and reel
frame are full scenes. Reads GEMINI_API_KEY from the environment.

  GEMINI_API_KEY=... python3 games/inferno-link/tools/gen-assets.py [asset_name ...]

Idempotent: overwrites. Pass names to regenerate a subset.
"""
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error

MODEL = "gemini-3-pro-image"  # Nano Banana Pro / "Nano Banana 2"
API = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "assets", "inferno-link-assets", "raw"))

STYLE = (
    "STYLE: premium mobile casino SLOT art, fire/inferno theme for \"Goldwave Casino\" — "
    "deep charred-obsidian base with molten-gold, ember-orange and crimson flame accents, "
    "glossy semi-3D rendered look, glowing rim light, ultra-clean, high detail, one cohesive "
    "set. No text, no watermark, no baked-in drop shadow. Centered subject."
)
WHITE_BG = (
    " The subject is perfectly centered on a plain, flat, solid pure-white (#FFFFFF) "
    "background with generous even margins, no shadow, no gradient, no floor — just the "
    "subject floating on flat white so the background keys out cleanly to transparency."
)

# name, aspect_ratio, kind(white|scene), subject
ASSETS = [
    ("bg_inferno", "9:16", "scene",
     "a vertical slot-machine background: a dark volcanic cavern of charred rock with rivers "
     "of glowing molten lava, drifting embers and sparks, warm orange-and-crimson fire glow "
     "rising from the bottom, atmospheric, full-bleed vertical, keep the center area darker "
     "and uncluttered so a reel grid sits on top."),
    ("reel_frame", "4:3", "scene",
     "an ornate WIDE LANDSCAPE rectangular GOLD slot-machine frame for a 5-column by 4-row "
     "reel grid: thick molten-gold filigree border with small flame motifs and ember gems at "
     "the corners, surrounding a single EMPTY dark near-black glossy rectangular window that "
     "is clearly WIDER THAN TALL (about 5:4) — no symbols, no grid lines, no text, just the "
     "gold frame around a plain dark panel. Drawn straight-on, centered, on a solid white "
     "background."),
    # paying symbols (single, blank-faced where text would go)
    ("gem_green", "1:1", "white", "a single brilliant emerald-green faceted gemstone, glossy, sparkling, premium slot low symbol."),
    ("gem_blue", "1:1", "white", "a single brilliant sapphire-blue faceted gemstone, glossy, sparkling, premium slot low symbol."),
    ("gem_purple", "1:1", "white", "a single brilliant amethyst-purple faceted gemstone, glossy, sparkling, premium slot low symbol."),
    ("gem_red", "1:1", "white", "a single brilliant ruby-red faceted gemstone, glossy, sparkling, premium slot low symbol."),
    ("bell", "1:1", "white", "a single classic glossy gold casino BELL with a subtle ember glow, premium slot mid symbol, no text."),
    ("coin", "1:1", "white", "a single glossy gold casino COIN token on edge-lit fire, blank face with a subtle flame emboss, no text, no numerals."),
    ("seven", "1:1", "white", "a single bold glossy red lucky number SEVEN (the numeral 7) wreathed in orange flames, gold outline, premium slot top symbol."),
    ("wild", "1:1", "white", "a blazing gold shield/emblem badge engulfed in orange-and-crimson flames with a blank dark center medallion (no text), a high-value slot WILD emblem."),
    # the money symbol: a flaming orb with a blank center disc (value drawn in code)
    ("fireball", "1:1", "white",
     "a glowing molten FIREBALL orb: a sphere of crimson-and-orange fire with a polished gold "
     "ring around a blank dark circular medallion in the very center (the center disc is empty, "
     "no text, no number), bright sparks, the money symbol of a fire slot."),
    # logo
    ("title_logo", "16:9", "white",
     "a premium casino slot TITLE LOGO: the two words \"INFERNO LINK\" stacked on two lines in "
     "bold 3D glossy gold metallic lettering with beveled edges, the letters wreathed in "
     "orange-and-crimson flames and ember glow, a thin dark outline for legibility, correct "
     "spelling, centered, no tagline, no extra text."),
]


def build_prompt(kind, subject):
    return f"{STYLE}\n\n{subject}{WHITE_BG if kind == 'white' else ''}"


def _save_first_image(payload, name):
    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                with open(os.path.join(OUT, f"{name}.png"), "wb") as f:
                    f.write(base64.b64decode(inline["data"]))
                return os.path.join(OUT, f"{name}.png")
    return None


def generate(name, ar, kind, subject, api_key):
    body = {
        "contents": [{"role": "user", "parts": [{"text": build_prompt(kind, subject)}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": ar, "imageSize": "2K"}},
    }
    data = json.dumps(body).encode()
    url = f"{API}?key={api_key}"
    last = None
    for attempt in range(1, 5):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                payload = json.load(resp)
            saved = _save_first_image(payload, name)
            if saved:
                print(f"  ok   {name:<14} {ar:>5}  -> {os.path.relpath(saved)}")
                return
            last = "no image part: " + json.dumps(payload)[:300]
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode()[:300]}"
        except Exception as e:  # noqa: BLE001
            last = repr(e)
        print(f"  retry {name} ({attempt}): {last}")
        time.sleep(2 * attempt)
    raise SystemExit(f"FAILED {name}: {last}")


def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GEMINI_API_KEY not set")
    os.makedirs(OUT, exist_ok=True)
    want = set(sys.argv[1:])
    todo = [a for a in ASSETS if not want or a[0] in want]
    print(f"Generating {len(todo)} assets with {MODEL} -> {OUT}")
    for name, ar, kind, subject in todo:
        generate(name, ar, kind, subject, api_key)
    print("Done.")


if __name__ == "__main__":
    main()
