#!/usr/bin/env python3
"""
Plinko — asset generation via Google Nano Banana Pro (Gemini 3 Pro Image).

Generates the Plinko-specific art set into assets/plinko-assets/raw/. Sprites land on a
solid WHITE background (keyed to alpha in prep-assets.sh); the background is a full scene;
the win-burst FX lands on solid BLACK (luminance keyed to alpha so the glow falloff
survives). Reads GEMINI_API_KEY from the environment.

  GEMINI_API_KEY=... python3 games/plinko/tools/gen-assets.py [asset_name ...]

Pass asset names to (re)generate a subset; omit to generate all. Idempotent: overwrites.
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
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "assets", "plinko-assets", "raw"))

STYLE = (
    "STYLE: premium mobile casino game art for \"Goldwave Casino\" — deep obsidian & "
    "midnight-navy base, molten-gold and electric-teal neon accents, glossy semi-3D "
    "rendered look, soft rim lighting, ultra-clean, high detail, one cohesive set. "
    "No text, no watermark, no baked-in drop shadow. Centered subject."
)

WHITE_BG = (
    " The subject is perfectly centered on a plain, flat, solid pure-white (#FFFFFF) "
    "background with generous even margins, no shadow, no gradient, no floor — just the "
    "subject floating on flat white so the background keys out cleanly to transparency."
)
BLACK_BG = (
    " Rendered on a plain, flat, solid pure-black (#000000) background with no other "
    "elements, so the bright glowing FX can be composited additively over the game."
)

# name, aspect_ratio, image_size, background_kind, subject prompt
ASSETS = [
    ("bg_plinko", "9:16", "2K", "scene",
     "a vertical neon \"drop chamber\" background for a Plinko game: dark obsidian side "
     "walls with faint gold circuitry etching, soft teal volumetric glow rising from the "
     "bottom, an empty clean dark center column where a triangular pegboard will be placed, "
     "atmospheric, full-bleed vertical, keep the center uncluttered."),
    ("peg", "1:1", "2K", "white",
     "a single small glowing gold peg/pin for a Plinko board: a smooth polished metallic "
     "gold sphere with a soft warm halo and a bright specular highlight."),
    ("ball", "1:1", "2K", "white",
     "a single glossy molten-gold coin-orb that a player drops down a Plinko board: a "
     "perfectly round metallic gold sphere with a subtle inner fire glow and one bright "
     "specular highlight, premium and weighty."),
    ("buckets_row", "21:9", "2K", "white",
     "a horizontal row of THREE Plinko landing slots, evenly spaced and clearly separated "
     "with white gaps between them. All three are the EXACT same shape: a flat, "
     "front-facing, symmetric trapezoid (wider at the top, narrower at the bottom) on a "
     "dark glossy glass body with a completely EMPTY face (no number, no text), drawn "
     "straight-on with no perspective tilt. The LEFT slot has an emerald-green neon "
     "glowing rim, the MIDDLE slot has a molten-gold neon glowing rim, the RIGHT slot has "
     "a crimson-red neon glowing rim. Identical size and orientation, in one cohesive set."),
    ("win_burst", "1:1", "2K", "black",
     "a radial burst of gold coins and bright sparks exploding outward from the center, a "
     "win-celebration FX, with bright molten-gold light rays and glittering particles."),
    ("title_logo", "21:9", "2K", "white",
     "a premium casino game TITLE LOGO: the single word \"PLINKO\" in bold, rounded, "
     "playful arcade letters made of 3D glossy gold metal with beveled edges and a subtle "
     "electric-teal rim glow and a thin dark outline for legibility; a little row of "
     "glowing gold pegs/dots arcs above the word; correct spelling, centered horizontal "
     "lockup, no tagline, no extra text."),
]


def build_prompt(kind: str, subject: str) -> str:
    tail = {"white": WHITE_BG, "black": BLACK_BG, "scene": ""}[kind]
    return f"{STYLE}\n\n{subject}{tail}"


def generate(name: str, ar: str, size: str, kind: str, subject: str, api_key: str) -> None:
    body = {
        "contents": [{"role": "user", "parts": [{"text": build_prompt(kind, subject)}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": ar, "imageSize": size},
        },
    }
    data = json.dumps(body).encode()
    url = f"{API}?key={api_key}"
    last_err = None
    for attempt in range(1, 5):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                payload = json.load(resp)
            saved = _save_first_image(payload, name)
            if saved:
                print(f"  ok   {name:<14} {ar:>5} {size}  -> {os.path.relpath(saved)}")
                return
            last_err = "no image part in response: " + json.dumps(payload)[:400]
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}: {e.read().decode()[:400]}"
        except Exception as e:  # noqa: BLE001 — CLI tool, surface anything
            last_err = repr(e)
        print(f"  retry {name} (attempt {attempt}): {last_err}")
        time.sleep(2 * attempt)
    raise SystemExit(f"FAILED {name}: {last_err}")


def _save_first_image(payload: dict, name: str):
    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                raw = base64.b64decode(inline["data"])
                path = os.path.join(OUT, f"{name}.png")
                with open(path, "wb") as f:
                    f.write(raw)
                return path
    return None


def main() -> None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GEMINI_API_KEY not set")
    os.makedirs(OUT, exist_ok=True)
    want = set(sys.argv[1:])
    todo = [a for a in ASSETS if not want or a[0] in want]
    print(f"Generating {len(todo)} assets with {MODEL} -> {OUT}")
    for name, ar, size, kind, subject in todo:
        generate(name, ar, size, kind, subject, api_key)
    print("Done.")


if __name__ == "__main__":
    main()
