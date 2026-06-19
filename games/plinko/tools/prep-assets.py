#!/usr/bin/env python3
"""
Plinko — asset prep / background removal.

Turns the raw Nano Banana art in assets/plinko-assets/raw/ into game-ready textures under
games/plinko/art/. Background removal is done by EDGE FLOOD-FILL (only white pixels
connected to the image border are keyed to transparency) so interior white specular
highlights on the gold orb/peg survive. The win burst (rendered on black) instead uses
luminance-as-alpha so its glow falloff composites cleanly. The three buckets are generated
as one row and sliced apart on the white gaps between them. Sprites are then trimmed and
downscaled; the background is a flat scene resized to 1080-wide JPG (no keying).

  python3 games/plinko/tools/prep-assets.py

Idempotent. Requires Pillow + numpy.
"""
import os
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RAW = os.path.join(REPO, "assets", "plinko-assets", "raw")
ART = os.path.join(REPO, "games", "plinko", "art")
WHEEL_UI = os.path.join(REPO, "games", "fortune-wheel", "art", "ui")

SENTINEL = (255, 0, 255)  # magenta marker for keyed-out background; absent from the art


def _key_white_edges(rgb: Image.Image, thresh: int = 60) -> Image.Image:
    """Flood-fill near-white from every border point, return an RGBA with that region
    transparent and the interior (incl. white highlights) intact. Edge eroded + feathered
    to kill the anti-aliased white fringe."""
    work = rgb.convert("RGB").copy()
    w, h = work.size
    seeds = []
    step = max(8, min(w, h) // 24)
    for x in range(0, w, step):
        seeds += [(x, 0), (x, h - 1)]
    for y in range(0, h, step):
        seeds += [(0, y), (w - 1, y)]
    for s in seeds:
        px = work.getpixel(s)
        if px[0] > 200 and px[1] > 200 and px[2] > 200:  # only seed on near-white border
            ImageDraw.floodfill(work, s, SENTINEL, thresh=thresh)

    arr = np.asarray(work)
    bg = np.all(arr == np.array(SENTINEL), axis=-1)
    alpha = np.where(bg, 0, 255).astype(np.uint8)

    out = rgb.convert("RGBA")
    a = Image.fromarray(alpha, "L")
    a = a.filter(ImageFilter.MinFilter(3))      # erode 1px → drop the white fringe ring
    a = a.filter(ImageFilter.GaussianBlur(1.1))  # feather the edge
    out.putalpha(a)
    return out


def _luminance_alpha(rgb: Image.Image) -> Image.Image:
    """For FX on black: alpha = brightness (max channel), boosted, so the glow fades out
    instead of sitting on a black box. RGB preserved for normal (non-additive) blending."""
    arr = np.asarray(rgb.convert("RGB")).astype(np.float32)
    lum = arr.max(axis=-1)
    a = np.clip(lum * 1.15, 0, 255).astype(np.uint8)
    out = rgb.convert("RGBA")
    out.putalpha(Image.fromarray(a, "L"))
    return out


def _trim(img: Image.Image, pad: int = 6) -> Image.Image:
    bbox = img.split()[-1].getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(img.width, r + pad), min(img.height, b + pad)
    return img.crop((l, t, r, b))


def _fit(img: Image.Image, *, w: int | None = None, h: int | None = None) -> Image.Image:
    if w:
        h2 = round(img.height * w / img.width)
        return img.resize((w, h2), Image.LANCZOS)
    h3 = h or img.height
    w2 = round(img.width * h3 / img.height)
    return img.resize((w2, h3), Image.LANCZOS)


def _save(img: Image.Image, rel: str) -> None:
    path = os.path.join(ART, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print(f"  {rel:<22} {img.size}")


def _split_buckets(rgba: Image.Image) -> list[Image.Image]:
    """Split a row of 3 sprites on transparent gaps using per-column opacity runs."""
    alpha = np.asarray(rgba.split()[-1])
    col_has = (alpha > 8).sum(axis=0) > 0
    runs, start = [], None
    for x, on in enumerate(col_has):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append((start, x)); start = None
    if start is not None:
        runs.append((start, len(col_has)))
    runs = [r for r in runs if r[1] - r[0] > rgba.width * 0.04]  # drop specks
    runs.sort(key=lambda r: r[1] - r[0], reverse=True)
    runs = sorted(runs[:3], key=lambda r: r[0])
    return [_trim(rgba.crop((l, 0, r, rgba.height))) for l, r in runs]


def main() -> None:
    os.makedirs(os.path.join(ART, "bg"), exist_ok=True)
    os.makedirs(os.path.join(ART, "ui"), exist_ok=True)

    # background: flat scene, no keying → 1080-wide JPG (matches the wheel pipeline)
    bg = Image.open(os.path.join(RAW, "bg_plinko.png")).convert("RGB")
    _save(_fit(bg, w=1080).convert("RGB"), "bg/bg_plinko.jpg")

    # white-keyed sprites
    peg = _trim(_key_white_edges(Image.open(os.path.join(RAW, "peg.png"))))
    _save(_fit(peg, w=160), "ui/peg.png")

    ball = _trim(_key_white_edges(Image.open(os.path.join(RAW, "ball.png"))))
    _save(_fit(ball, w=200), "ui/ball.png")

    logo = _trim(_key_white_edges(Image.open(os.path.join(RAW, "title_logo.png"))))
    _save(_fit(logo, w=1400), "ui/title_logo.png")

    # win burst: luminance alpha (rendered on black)
    burst = _trim(_luminance_alpha(Image.open(os.path.join(RAW, "win_burst.png"))))
    _save(_fit(burst, w=768), "ui/win_burst.png")

    # buckets: one row → 3 sprites
    row = _key_white_edges(Image.open(os.path.join(RAW, "buckets_row.png")))
    parts = _split_buckets(row)
    if len(parts) != 3:
        raise SystemExit(f"expected 3 buckets, sliced {len(parts)}")
    for name, part in zip(["bucket_green", "bucket_gold", "bucket_red"], parts):
        _save(_fit(part, w=380), f"ui/{name}.png")

    # reuse the shared Goldwave UI kit already processed for Fortune Wheel
    shared = ["btn_action", "btn_minus", "btn_plus", "btn_sound", "btn_info",
              "btn_menu", "toggle_pill", "readout_pill"]
    for name in shared:
        src = os.path.join(WHEEL_UI, f"{name}.png")
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(ART, "ui", f"{name}.png"))
            print(f"  ui/{name}.png          (shared)")
        else:
            print(f"  WARN missing shared button: {src}")

    print(f"Done. Output: {ART}")


if __name__ == "__main__":
    main()
