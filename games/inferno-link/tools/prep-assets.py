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

SENT_OUT = (255, 0, 255)   # outer (white bg) sentinel
SENT_IN = (0, 255, 255)    # inner (dark window) sentinel


def _cut_frame(rgb: Image.Image):
    """Return (frame_with_transparent_center, window_fractions). The white background AND the
    dark inner window are both keyed to transparency, leaving only the ornate gold border —
    so a reel layer placed BEHIND the frame shows through the hole and symbols read as
    emerging from behind the border. window_fractions = (l, t, r, b) of the cut hole as
    fractions of the trimmed frame, for pixel-accurate grid alignment in Godot."""
    work = rgb.convert("RGB").copy()
    w, h = work.size
    step = max(8, min(w, h) // 28)
    for x in range(0, w, step):
        for y in (0, h - 1):
            px = work.getpixel((x, y))
            if px[0] > 205 and px[1] > 205 and px[2] > 205:
                ImageDraw.floodfill(work, (x, y), SENT_OUT, thresh=45)
    for y in range(0, h, step):
        for x in (0, w - 1):
            px = work.getpixel((x, y))
            if px[0] > 205 and px[1] > 205 and px[2] > 205:
                ImageDraw.floodfill(work, (x, y), SENT_OUT, thresh=45)
    # cut the dark inner window — flood-fill from several interior points so disconnected
    # dark sub-regions (e.g. the glossy top reflection band) all clear, stopping at the
    # bright gold border. Only seed on genuinely dark pixels so the gold is never eaten.
    for fx in (0.5, 0.3, 0.7):
        for fy in (0.5, 0.25, 0.4, 0.6, 0.75):
            sx, sy = int(w * fx), int(h * fy)
            px = work.getpixel((sx, sy))
            if px in (SENT_OUT, SENT_IN):
                continue
            if px[0] < 95 and px[1] < 95 and px[2] < 95:
                ImageDraw.floodfill(work, (sx, sy), SENT_IN, thresh=78)

    arr = np.asarray(work)
    outer = np.all(arr == np.array(SENT_OUT), axis=-1)
    inner = np.all(arr == np.array(SENT_IN), axis=-1)
    alpha = np.where(outer | inner, 0, 255).astype(np.uint8)

    rgba = rgb.convert("RGBA")
    a = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.8))
    rgba.putalpha(a)

    # trim to the gold border's outer bbox, then express the hole as fractions of that.
    bbox = rgba.split()[-1].getbbox()
    rgba = rgba.crop(bbox)
    ys, xs = np.where(inner)
    hole = (xs.min() - bbox[0], ys.min() - bbox[1], xs.max() - bbox[0], ys.max() - bbox[1])
    fw, fh = rgba.size
    fracs = (hole[0] / fw, hole[1] / fh, hole[2] / fw, hole[3] / fh)
    return rgba, fracs


def main() -> None:
    for sub in ("bg", "ui", "symbols"):
        os.makedirs(os.path.join(ART, sub), exist_ok=True)

    # background: flat scene → 1080-wide JPG
    bg = Image.open(os.path.join(RAW, "bg_inferno.png")).convert("RGB")
    _save(_fit_w(bg, 1080).convert("RGB"), "bg/bg_inferno.jpg", quality=88)

    # reel frame: cut the center to transparency so a reel layer shows through behind it.
    frame, fracs = _cut_frame(Image.open(os.path.join(RAW, "reel_frame.png")))
    _save(_fit_w(frame, 980), "ui/reel_frame.png")
    print(f"  >>> reel_frame window fractions (l,t,r,b): "
          f"{fracs[0]:.4f}, {fracs[1]:.4f}, {fracs[2]:.4f}, {fracs[3]:.4f}")

    # tall bonus frame (5×6 hold-and-spin board): same cutout treatment
    bframe, bfracs = _cut_frame(Image.open(os.path.join(RAW, "bonus_frame.png")))
    _save(_fit_w(bframe, 820), "ui/bonus_frame.png")
    print(f"  >>> bonus_frame window fractions (l,t,r,b): "
          f"{bfracs[0]:.4f}, {bfracs[1]:.4f}, {bfracs[2]:.4f}, {bfracs[3]:.4f}")

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
