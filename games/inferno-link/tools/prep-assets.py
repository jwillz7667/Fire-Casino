#!/usr/bin/env python3
"""
Inferno Link — asset prep / background removal.

Turns the raw Nano Banana art in assets/inferno-link-assets/raw/ into game-ready textures
under games/inferno-link/art/. Background removal is EDGE FLOOD-FILL (only white pixels
connected to the border are keyed) so interior highlights survive; flame wisps that fade to
white get a slightly higher threshold so the colored fire is kept. The background + reel
frame are flat scenes (frame keyed on white, bg resized to JPG). Shared UI buttons are
reused from the Fortune Wheel set.

  python3 games/inferno-link/tools/prep-assets.py

Idempotent. Requires Pillow + numpy.
"""
import os
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RAW = os.path.join(REPO, "assets", "inferno-link-assets", "raw")
ART = os.path.join(REPO, "games", "inferno-link", "art")
WHEEL_UI = os.path.join(REPO, "games", "fortune-wheel", "art", "ui")

SENTINEL = (255, 0, 255)


def _key_white_edges(rgb: Image.Image, thresh: int = 55, erode: bool = True) -> Image.Image:
    work = rgb.convert("RGB").copy()
    w, h = work.size
    seeds = []
    step = max(8, min(w, h) // 28)
    for x in range(0, w, step):
        seeds += [(x, 0), (x, h - 1)]
    for y in range(0, h, step):
        seeds += [(0, y), (w - 1, y)]
    for s in seeds:
        px = work.getpixel(s)
        if px[0] > 205 and px[1] > 205 and px[2] > 205:
            ImageDraw.floodfill(work, s, SENTINEL, thresh=thresh)

    arr = np.asarray(work)
    bg = np.all(arr == np.array(SENTINEL), axis=-1)
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    out = rgb.convert("RGBA")
    a = Image.fromarray(alpha, "L")
    if erode:
        a = a.filter(ImageFilter.MinFilter(3))   # drop the anti-aliased white fringe
    a = a.filter(ImageFilter.GaussianBlur(1.0))   # feather
    out.putalpha(a)
    return out


def _trim(img: Image.Image, pad: int = 6) -> Image.Image:
    bbox = img.split()[-1].getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(img.width, r + pad), min(img.height, b + pad)
    return img.crop((l, t, r, b))


def _square(img: Image.Image, size: int) -> Image.Image:
    """Fit a sprite into a transparent SIZE×SIZE canvas (symbols share one cell box)."""
    s = _trim(img)
    scale = min(size / s.width, size / s.height)
    s = s.resize((max(1, round(s.width * scale)), max(1, round(s.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(s, ((size - s.width) // 2, (size - s.height) // 2))
    return canvas


def _fit_w(img: Image.Image, w: int) -> Image.Image:
    return img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)


def _save(img: Image.Image, rel: str, **kw) -> None:
    path = os.path.join(ART, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, **kw)
    print(f"  {rel:<26} {img.size}")


SYMBOLS = ["gem_green", "gem_blue", "gem_purple", "gem_red", "bell", "coin", "seven", "wild", "fireball"]


def main() -> None:
    for sub in ("bg", "ui", "symbols"):
        os.makedirs(os.path.join(ART, sub), exist_ok=True)

    # background: flat scene → 1080-wide JPG
    bg = Image.open(os.path.join(RAW, "bg_inferno.png")).convert("RGB")
    _save(_fit_w(bg, 1080).convert("RGB"), "bg/bg_inferno.jpg", quality=88)

    # reel frame: keyed on white, kept large (drawn behind the grid)
    frame = _trim(_key_white_edges(Image.open(os.path.join(RAW, "reel_frame.png")), thresh=45))
    _save(_fit_w(frame, 980), "ui/reel_frame.png")

    # symbols: keyed + boxed to a common 256 cell (flames need a softer key, no erode)
    for name in SYMBOLS:
        soft = name in ("seven", "wild", "fireball", "bell")
        keyed = _key_white_edges(Image.open(os.path.join(RAW, f"{name}.png")),
                                 thresh=70 if soft else 50, erode=not soft)
        _save(_square(keyed, 256), f"symbols/{name}.png")

    # logo
    logo = _trim(_key_white_edges(Image.open(os.path.join(RAW, "title_logo.png")), thresh=60))
    _save(_fit_w(logo, 1200), "ui/title_logo.png")

    # shared Goldwave UI kit from Fortune Wheel
    for name in ["btn_action", "btn_minus", "btn_plus", "btn_sound", "btn_info", "btn_menu",
                 "btn_autospin", "readout_pill", "toggle_pill"]:
        src = os.path.join(WHEEL_UI, f"{name}.png")
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(ART, "ui", f"{name}.png"))
            print(f"  ui/{name}.png             (shared)")
        else:
            print(f"  WARN missing shared button: {src}")

    print(f"Done. Output: {ART}")


if __name__ == "__main__":
    main()
