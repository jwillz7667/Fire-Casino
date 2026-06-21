#!/usr/bin/env python3
"""
Legend of the Flaming Kirin — asset prep / background removal / control-button compile.

Turns the raw 4K Nano Banana art in assets/flaming-kirin-assets/raw/ into game-ready textures
under games/flaming-kirin/art/. Background removal is EDGE FLOOD-FILL (only white pixels
connected to the border are keyed) so interior highlights and glow survive; fire/glow subjects
get a softer key (higher threshold, no erode) so the colored flame is kept. The full-scene
background is just down-scaled to JPG; the reel frame has BOTH its white surround and its dark
inner window cut so a reel layer shows through behind the gold border.

The CONTROL BUTTONS are keyed, boxed to uniform cells, written individually to art/ui/, and
also composited into a single labelled contact sheet art/ui/controls_sheet.png so the whole
control set can be reviewed compiled together.

  python3 games/flaming-kirin/tools/prep-assets.py

Idempotent. Requires Pillow + numpy.
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RAW = os.path.join(REPO, "assets", "flaming-kirin-assets", "raw")
ART = os.path.join(REPO, "games", "flaming-kirin", "art")

SENTINEL = (255, 0, 255)
SENT_OUT = (255, 0, 255)   # outer (white bg) sentinel
SENT_IN = (0, 255, 255)    # inner (dark window) sentinel


def _key_white_edges(rgb: Image.Image, thresh: int = 55, erode: bool = True) -> Image.Image:
    """Key the studio background connected to the image border to alpha, preserving interior
    highlights/glints/glow. The model bakes a faint TAN transparency-checkerboard into the white
    background; a pure-white flood-fill leaves the tan squares (~150-200, too far from white for
    the threshold) opaque — visible clutter on a dark game background. So the background is
    detected as BRIGHT + LOW-SATURATION (white AND tan AND light grey), then only the component
    connected to the border is cut; saturated or dark subject pixels, and interior bright glints
    not touching the border, survive."""
    src = rgb.convert("RGB")
    arr = np.asarray(src).astype(np.int16)
    mx = arr.max(-1)
    sat = mx - arr.min(-1)
    w, h = src.size
    # Background = the studio sweep: WHITE (255) + the baked TAN checker (~150-200) + the dark
    # grey SMUDGE blotches the model adds (down to ~120). All are LOW-SATURATION (sat < ~20);
    # subjects are either saturated colour or dark outline. Floor at 112 brightness catches the
    # darkest smudge; sat<=36 keeps colourful + pale-warm subject pixels. Only the component
    # connected to the border is cut, so interior low-sat glints/pearls/pale skin survive.
    bg_cand = (mx >= 112) & (sat <= 36)
    label = Image.fromarray(np.where(bg_cand, 255, 0).astype(np.uint8)).convert("RGB")
    step = max(5, min(w, h) // 90)
    for x in range(0, w, step):
        for s in ((x, 1), (x, h - 2)):
            if label.getpixel(s) == (255, 255, 255):
                ImageDraw.floodfill(label, s, SENTINEL, thresh=10)
    for y in range(0, h, step):
        for s in ((1, y), (w - 2, y)):
            if label.getpixel(s) == (255, 255, 255):
                ImageDraw.floodfill(label, s, SENTINEL, thresh=10)

    bg = np.all(np.asarray(label) == np.array(SENTINEL), axis=-1)
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


def _box(img: Image.Image, size: int, fill_frac: float = 1.0) -> Image.Image:
    """Fit a trimmed sprite into a transparent SIZE×SIZE canvas (a shared cell box)."""
    s = _trim(img)
    target = size * fill_frac
    scale = min(target / s.width, target / s.height)
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
    print(f"  {rel:<28} {img.size}")


def _open(name: str) -> Image.Image:
    return Image.open(os.path.join(RAW, f"{name}.png"))


def _cut_frame(rgb: Image.Image):
    """Keep ONLY the ornate gold/flame border and cut everything else — the white surround, the
    dark glossy window AND every grey reflection patch inside it — to transparency. The previous
    flood-fill cut only reached DARK window pixels and left lighter reflections opaque (grey
    clutter on the dark game background); this keeps a saturation+brightness mask of the actual
    border art instead, which is robust to reflections. Returns (frame_rgba, window_fractions
    (l,t,r,b) of the trimmed frame) for pixel-accurate grid alignment in the client."""
    arr = np.asarray(rgb.convert("RGB")).astype(np.int16)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    mx = arr.max(-1)
    sat = mx - arr.min(-1)
    w, h = rgb.size
    # GOLD/flame border colour = WARM (r >= b), saturated, not too dark — plus warm near-white
    # gold highlights. The dark glossy WINDOW also reflects warm sheen, which is colour-identical
    # to the border, so colour alone can't separate them. Connectivity does: the real border is
    # the gold connected to the frame's OUTER edge band; reflection sheen inside the window forms
    # isolated islands. Keep only the edge-connected gold; cut window + islands + outer surround.
    gold = (sat >= 40) & (mx >= 70) & (r >= b - 4)
    gold |= (mx >= 220) & (r >= b + 4)
    gold_img = Image.fromarray(np.where(gold, 255, 0).astype(np.uint8), "L")
    gold_img = gold_img.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))

    keep_img = gold_img.convert("RGB")  # gold = white(255,255,255), else black
    KEEP = (0, 255, 0)

    def flood_if_gold(p):
        if 0 <= p[0] < w and 0 <= p[1] < h and keep_img.getpixel(p) == (255, 255, 255):
            ImageDraw.floodfill(keep_img, p, KEEP, thresh=10)

    bx = max(6, w // 90)
    by = max(6, h // 90)
    for frac in (0.03, 0.05, 0.08, 0.12, 0.88, 0.92, 0.95, 0.97):
        yy = min(max(int(h * frac), 1), h - 2)
        for x in range(1, w - 1, bx):
            flood_if_gold((x, yy))
        xx = min(max(int(w * frac), 1), w - 2)
        for y in range(1, h - 1, by):
            flood_if_gold((xx, y))
    keep = np.all(np.asarray(keep_img) == np.array(KEEP), axis=-1)
    alpha = np.where(keep, 255, 0).astype(np.uint8)

    rgba = rgb.convert("RGBA")
    # feather lightly; edge pixels are GOLD (kept side), so the soft edge is gold, not a white halo.
    rgba.putalpha(Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.5)))

    # window hole = the central cut region (flood from centre over the non-keep area; the warm
    # reflection islands are non-keep too, so the measured opening spans the whole window).
    hole_img = Image.fromarray(np.where(keep, 255, 0).astype(np.uint8)).convert("RGB")
    ImageDraw.floodfill(hole_img, (w // 2, h // 2), SENT_IN, thresh=10)
    hole_mask = np.all(np.asarray(hole_img) == np.array(SENT_IN), axis=-1)
    bbox = rgba.split()[-1].getbbox()
    rgba = rgba.crop(bbox)
    ys, xs = np.where(hole_mask)
    hole = (xs.min() - bbox[0], ys.min() - bbox[1], xs.max() - bbox[0], ys.max() - bbox[1])
    fw, fh = rgba.size
    fracs = (hole[0] / fw, hole[1] / fh, hole[2] / fw, hole[3] / fh)
    return rgba, fracs


def _clean_backplate(w: int, h: int) -> Image.Image:
    """A clean dark reel-window panel (navy vertical gradient + soft top sheen + edge vignette),
    drawn procedurally so it never carries the raw frame's glossy reflection clutter."""
    arr = np.zeros((h, w, 3), np.float32)
    for y in range(h):
        f = y / max(1, h - 1)
        top = np.array([20, 30, 52], np.float32)
        bot = np.array([6, 9, 18], np.float32)
        arr[y, :, :] = top * (1.0 - f) + bot * f
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    # subtle radial edge vignette
    vig = Image.new("L", (w, h), 0)
    vd = ImageDraw.Draw(vig)
    vd.ellipse([-int(w * 0.12), -int(h * 0.12), int(w * 1.12), int(h * 1.12)], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(min(w, h) * 0.12))
    dark = Image.new("RGB", (w, h), (3, 5, 11))
    return Image.composite(img, dark, vig)


def _derive_minus_rgb() -> Image.Image:
    """Build a pixel-matched MINUS button from btn_plus (the model is unreliable at a bare '−').
    Reconstruct a clean radial face over the plus (sampled from the glyph-free diagonals), then
    draw a fresh white minus bar at the plus arm's width/thickness. Returns RGB on white bg so it
    flows through the same key/box path as the other buttons."""
    src = _open("btn_plus").convert("RGB")
    a = np.asarray(src).astype(np.float32)
    H, W, _ = a.shape
    cx, cy = W / 2.0, H / 2.0
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.hypot(xx - cx, yy - cy)
    th = np.arctan2(yy - cy, xx - cx)
    rfill = 660.0
    deg = np.degrees(th) % 360
    diag = (np.abs((deg - 45 + 180) % 360 - 180) < 22) | (np.abs((deg - 135 + 180) % 360 - 180) < 22) | \
           (np.abs((deg - 225 + 180) % 360 - 180) < 22) | (np.abs((deg - 315 + 180) % 360 - 180) < 22)
    sample = diag & (r < rfill + 40)
    rbin = np.clip(r.astype(int), 0, int(rfill) + 60)
    lut = np.zeros((int(rfill) + 61, 3), np.float32)
    sr = rbin[sample]
    sc = a[sample]
    for ch in range(3):
        sums = np.bincount(sr, weights=sc[:, ch], minlength=lut.shape[0])
        cnt = np.bincount(sr, minlength=lut.shape[0]).astype(np.float32)
        cnt[cnt == 0] = 1
        v = sums / cnt
        last = v[0] if v[0] > 0 else 60.0
        for i in range(len(v)):
            if cnt[i] <= 1 and v[i] == 0:
                v[i] = last
            else:
                last = v[i]
        lut[:, ch] = v
    out = a.copy()
    region = r < rfill
    out[region] = lut[rbin[region]]
    res = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    sm = res.filter(ImageFilter.GaussianBlur(6))
    mask = Image.fromarray(((r < rfill - 8) * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(10))
    res = Image.composite(sm, res, mask)
    d = ImageDraw.Draw(res)
    bw, bh = 1121, 300
    x0, y0 = int(cx - bw / 2), int(cy - bh / 2)
    x1, y1 = int(cx + bw / 2), int(cy + bh / 2)
    rad = bh // 2
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([x0, y0 + 18, x1, y1 + 18], radius=rad, fill=(8, 18, 46, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    res = Image.alpha_composite(res.convert("RGBA"), sh).convert("RGB")
    d = ImageDraw.Draw(res)
    d.rounded_rectangle([x0 - 6, y0 - 6, x1 + 6, y1 + 6], radius=rad + 6, fill=(18, 40, 86))
    d.rounded_rectangle([x0, y0, x1, y1], radius=rad, fill=(247, 250, 255))
    d.rounded_rectangle([x0 + 20, y0 + 16, x1 - 20, y0 + 74], radius=30, fill=(255, 255, 255))
    return res


# fire/glow subjects: flame wisps fade to white, so key softer and don't erode.
SOFT = {
    "sym_kirin", "sym_phoenix_king", "sym_wild", "mascot_kirin", "dragon_eye", "btn_spin",
    "badge_multiplier", "title_logo", "jackpot_grand", "jackpot_major", "jackpot_minor",
    "jackpot_mini", "totalwin_bar", "banner_palace",
}

# reel symbols boxed to one 512 cell (4K source → keep crisp)
SYMBOLS = [
    "sym_kirin", "sym_sea_dragon_queen", "sym_phoenix_king", "sym_golden_shark",
    "sym_treasure_chest", "sym_bell", "sym_wild", "sym_ruby", "sym_lotus",
    "sym_scatter", "sym_bonus", "card_a", "card_k", "card_q", "card_j",
]

# circular icon buttons boxed to one 320 cell; the action button slightly larger
BUTTONS = [
    "btn_spin", "btn_autoplay", "btn_autobet", "btn_minus", "btn_plus",
    "btn_maxbet", "btn_info", "btn_settings", "btn_sound", "btn_chat",
]

# wide UI plates: width to fit at, keyed
PLATES = {
    "banner_palace": 1100,
    "jackpot_grand": 1200, "jackpot_major": 1200, "jackpot_minor": 1200, "jackpot_mini": 1200,
    "readout_pill": 900, "panel_balance": 760, "totalwin_bar": 1000, "win_plate": 820,
}


def _key(name: str) -> Image.Image:
    soft = name in SOFT
    return _key_white_edges(_open(name), thresh=72 if soft else 52, erode=not soft)


def _font(size: int):
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def _contact_sheet(tiles, cols, cell, pad, title):
    """Compose keyed button tiles (name, RGBA) into a labelled contact sheet on dark felt."""
    rows = (len(tiles) + cols - 1) // cols
    label_h = 46
    head_h = 96
    cw = cell + pad
    ch = cell + label_h + pad
    W = cols * cw + pad
    H = head_h + rows * ch + pad
    sheet = Image.new("RGBA", (W, H), (12, 18, 32, 255))
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, 34), title, font=_font(40), fill=(255, 210, 120, 255))
    for i, (name, img) in enumerate(tiles):
        r, c = divmod(i, cols)
        x = pad + c * cw
        y = head_h + r * ch
        fitted = _box(img, cell, fill_frac=0.92)
        sheet.alpha_composite(fitted, (x, y))
        tw = draw.textlength(name, font=_font(26))
        draw.text((x + (cell - tw) / 2, y + cell + 6), name, font=_font(26), fill=(210, 225, 245, 255))
    return sheet


def main() -> None:
    for sub in ("bg", "ui", "symbols"):
        os.makedirs(os.path.join(ART, sub), exist_ok=True)

    # full-scene background → 1080-wide JPG
    bg = _open("bg_main").convert("RGB")
    _save(_fit_w(bg, 1080), "bg/bg_main.jpg", quality=88)

    # reel frame: cut center to transparency (gold border only) so symbols read as emerging from
    # behind the frame top, plus a CLEAN procedural backplate beneath (never the raw window crop).
    frame, fracs = _cut_frame(_open("reel_frame"))
    _save(_fit_w(frame, 1100), "ui/reel_frame.png")
    bw = 1000
    bh = int(round(bw * (fracs[3] - fracs[1]) / (fracs[2] - fracs[0]) * 735.0 / 1100.0))
    _save(_clean_backplate(bw, max(400, bh)), "ui/reel_backplate.jpg", quality=92)
    print(f"  >>> reel_frame window fractions (l,t,r,b): "
          f"{fracs[0]:.4f}, {fracs[1]:.4f}, {fracs[2]:.4f}, {fracs[3]:.4f}")

    # reel symbols → common 512 cell
    for name in SYMBOLS:
        _save(_box(_key(name), 512), f"symbols/{name}.png")

    # control buttons → individual keyed cells + a compiled contact sheet. btn_minus is DERIVED
    # from btn_plus (the model draws a dragon in the glyph slot, not a "−").
    button_tiles = []
    for name in BUTTONS:
        if name == "btn_minus":
            keyed = _key_white_edges(_derive_minus_rgb(), thresh=52, erode=True)
        else:
            keyed = _key(name)
        # action button keeps more of the cell; round icons share a 320 box
        cell = 384 if name == "btn_spin" else 320
        fitted = _box(keyed, cell, fill_frac=0.96 if name == "btn_spin" else 0.9)
        _save(fitted, f"ui/{name}.png")
        button_tiles.append((name, keyed))
    sheet = _contact_sheet(button_tiles, cols=5, cell=240, pad=28,
                           title="Legend of the Flaming Kirin — control buttons")
    _save(sheet, "ui/controls_sheet.png")

    # avatar ring frame, multiplier badge → square cells
    _save(_box(_key("avatar_frame"), 384), "ui/avatar_frame.png")
    _save(_box(_key("badge_multiplier"), 256), "ui/badge_multiplier.png")

    # wide plates / pills / panels
    for name, width in PLATES.items():
        _save(_fit_w(_trim(_key(name)), width), f"ui/{name}.png")

    # title logo
    _save(_fit_w(_trim(_key("title_logo")), 1400), "ui/title_logo.png")

    print(f"Done. Output: {ART}")


if __name__ == "__main__":
    main()
