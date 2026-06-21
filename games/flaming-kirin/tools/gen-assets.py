#!/usr/bin/env python3
"""
Legend of the Flaming Kirin — asset generation via Google Nano Banana Pro (Gemini 3 Pro Image).

A flaming-kirin / deep-ocean fantasy slot: a flaming qilin (kirin) mascot, sea-dragon
queen + phoenix-king + golden-shark picture symbols, flaming royal cards, a 4-tier
progressive jackpot, and a gold dragon-head WILD. Original Goldwave art — it reproduces the
LAYOUT/symbol concepts of the reference mockup, NOT the trademarked "Fire Kirin" wordmark or
brand logo (the title is the descriptive "Legend of the Flaming Kirin").

Every sprite is rendered at 4K on a solid pure-WHITE background so prep-assets.py can key it
to alpha by edge flood-fill. The single full-scene BACKGROUND is the one exception — it is the
backdrop itself, so it is generated as a full-bleed underwater scene (nothing to key out).
The on-art TEXT seen in the mockup (symbol captions, GRAND/MAJOR labels, "SPIN", values) is UI
overlay drawn by the client, NOT baked here — so plates/pills/buttons are generated empty and
the icon buttons carry only their glyph. Reads GEMINI_API_KEY from the environment.

  GEMINI_API_KEY=... python3 games/flaming-kirin/tools/gen-assets.py [asset_name ...]
  GEMINI_CONCURRENCY=4 ...   # parallel workers (default 3; backs off on 429/5xx)

Idempotent: overwrites. Pass names to regenerate a subset.
"""
import base64
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

MODEL = "gemini-3-pro-image"  # Nano Banana Pro / "Nano Banana 2"
API = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
IMAGE_SIZE = "4K"

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "assets", "flaming-kirin-assets", "raw"))

STYLE = (
    "STYLE: premium mobile-casino SLOT art, 'flaming kirin' fire-meets-deep-ocean theme for "
    "\"Goldwave Casino\" — vivid teal-and-navy underwater base lit by molten-gold, ember-orange "
    "and crimson flame accents, glossy semi-3D painterly render, bold clean dark outline, strong "
    "glowing rim light, ultra-high detail, one cohesive set. No text, no caption, no watermark, "
    "no baked-in drop shadow, no UI chrome. Single centered subject that fills the frame."
)
WHITE_BG = (
    " The single subject is perfectly centered on a 100% FLAT, SOLID, OPAQUE, PURE-WHITE (#FFFFFF) "
    "studio background — exactly like a product photo on a seamless white sweep. The background must "
    "be a single uniform white fill: absolutely NO checkerboard, NO transparency pattern, NO grid, "
    "NO gradient, NO texture, NO shadow, NO reflection, NO floor. Generous even white margins around "
    "the subject."
)

# name, aspect_ratio, kind(white|scene), subject
ASSETS = [
    # ---- full-scene background (the one non-keyed asset) ----
    ("bg_main", "9:16", "scene",
     "a vertical slot-machine background: a sunken Asian fantasy palace deep underwater — teal "
     "and navy ocean water with god-rays from above, a tiered pagoda temple silhouette, coral and "
     "kelp, drifting pink jellyfish and small tropical fish, warm orange embers rising through the "
     "water, with decoration ONLY around the outer edges. The whole CENTER is a completely dark, "
     "empty, uncluttered deep teal-to-near-black area — NO baked-in reel frame, NO glowing "
     "rectangle, NO grid lines, NO reel-column divider lines — so a separate reel grid sits cleanly "
     "on top. Atmospheric, luminous, full-bleed vertical."),

    # ---- frame + banners (keyed on white) ----
    ("reel_frame", "4:3", "scene",
     "an ornate WIDE LANDSCAPE rectangular slot-machine frame for a 5-column by 4-row reel grid: "
     "thick polished GOLD filigree border fused with deep-navy lacquer and small orange flame "
     "motifs, ornamental crossed-torch/blade crests at the two TOP corners, ember gems at the "
     "corners, surrounding a single EMPTY dark near-black glossy rectangular window that is clearly "
     "WIDER THAN TALL (about 5:4) — no symbols, no grid lines, no text, just the ornate frame "
     "around a plain dark panel. Drawn straight-on, centered, on a solid white background."),
    ("banner_palace", "16:9", "white",
     "a single ornate horizontal GOLD ribbon banner plaque with curled scroll ends and small flame "
     "filigree, deep-navy enamel center field left EMPTY (no text), a premium slot header nameplate, "
     "drawn straight-on and centered."),

    # ---- 4-tier progressive jackpot plates (wide, empty value field) ----
    ("jackpot_grand", "21:9", "white",
     "a single long horizontal jackpot plate: a rounded GOLD-trimmed pill split into a small left "
     "label cap and a long value field, glowing hot RED-and-ORANGE with fiery sparks and embers, "
     "the value field a dark glossy panel left EMPTY (no text), top-tier 'GRAND' jackpot bar, "
     "straight-on, centered."),
    ("jackpot_major", "21:9", "white",
     "a single long horizontal jackpot plate: a rounded GOLD-trimmed pill split into a small left "
     "label cap and a long value field, glowing PURPLE-and-magenta with sparkles, the value field a "
     "dark glossy panel left EMPTY (no text), 'MAJOR' jackpot bar, straight-on, centered."),
    ("jackpot_minor", "21:9", "white",
     "a single long horizontal jackpot plate: a rounded GOLD-trimmed pill split into a small left "
     "label cap and a long value field, glowing CYAN-and-blue, the value field a dark glossy panel "
     "left EMPTY (no text), 'MINOR' jackpot bar, straight-on, centered."),
    ("jackpot_mini", "21:9", "white",
     "a single long horizontal jackpot plate: a rounded GOLD-trimmed pill split into a small left "
     "label cap and a long value field, glowing GREEN-and-lime, the value field a dark glossy panel "
     "left EMPTY (no text), 'MINI' jackpot bar, straight-on, centered."),

    # ---- picture symbols (high value) ----
    ("sym_kirin", "1:1", "white",
     "a majestic flaming KIRIN (Chinese qilin) head and mane wreathed in living orange-and-crimson "
     "fire, golden scales and antlers, fierce noble eyes, the marquee high symbol of the slot."),
    ("sym_sea_dragon_queen", "1:1", "white",
     "a regal SEA-DRAGON QUEEN: a beautiful ocean empress with cool blue-toned skin, a jeweled "
     "sapphire-and-teal crown and pearl tiara, flowing teal hair, draped blue-and-gold sea-silk — "
     "predominantly cool BLUE and aquatic tones with only faint orange ember accents at the very "
     "edges, the one cool-blue high picture symbol of the set, bust/portrait."),
    ("sym_phoenix_king", "1:1", "white",
     "a blazing golden-orange PHOENIX bird with wings spread wide and a fan tail of fire and gold "
     "feathers, a crowned 'phoenix king', a high picture symbol."),
    ("sym_golden_shark", "1:1", "white",
     "a sleek armored GOLDEN TORPEDO SHARK: a polished gold mecha-shark with glowing cyan eye and "
     "fins, mouth open showing teeth, dynamic, a high picture symbol."),
    ("sym_treasure_chest", "1:1", "white",
     "an open ornate wooden-and-gold TREASURE CHEST overflowing with glowing gold coins and gems, "
     "warm ember sparks, a high picture symbol."),
    ("sym_bell", "1:1", "white",
     "a single classic glossy GOLD casino BELL with a subtle ember glow and ornate scrollwork, a "
     "premium slot mid symbol, no text."),
    ("sym_wild", "1:1", "white",
     "a roaring GOLD DRAGON head emblem mounted on an ornate flaming gold-and-navy heraldic SHIELD "
     "badge engulfed in orange fire, glowing — a high-value slot WILD emblem, blank (no text)."),
    ("sym_ruby", "1:1", "white",
     "a single brilliant faceted blood-RED ruby 'fire' gemstone, glossy, sparkling, edge-lit by "
     "orange flame, a premium picture symbol."),
    ("sym_lotus", "1:1", "white",
     "a single luminous PURPLE-and-pink LOTUS FLOWER blossom floating on a glowing pad, dewy and "
     "radiant, a premium picture symbol."),

    # ---- special symbols ----
    ("sym_scatter", "1:1", "white",
     "a glowing iridescent PEARL nestled in an open golden clam SHELL with sparkling light rays, a "
     "premium slot SCATTER symbol, no text."),
    ("sym_bonus", "1:1", "white",
     "a glowing red-and-green compass CROSSHAIR target reticle with a golden ornate ring and a "
     "central gem, an arcade fish-game BONUS / aim symbol, no text, centered."),

    # ---- royal card letters (flaming, the low symbols) ----
    ("card_a", "1:1", "white",
     "a bold glossy capital letter 'A' as a slot low symbol, deep-RED 3D beveled metallic letter "
     "with a gold edge wreathed in small orange flames at the base, correct single letter A, no "
     "other text."),
    ("card_k", "1:1", "white",
     "a bold glossy capital letter 'K' as a slot low symbol, sapphire-BLUE 3D beveled metallic "
     "letter with a gold edge and small orange flames at the base, correct single letter K, no "
     "other text."),
    ("card_q", "1:1", "white",
     "a bold glossy capital letter 'Q' as a slot low symbol, emerald-GREEN 3D beveled metallic "
     "letter with a gold edge and small orange flames at the base, correct single letter Q, no "
     "other text."),
    ("card_j", "1:1", "white",
     "a bold glossy capital letter 'J' as a slot low symbol, EMERALD-GREEN 3D beveled metallic "
     "letter (the SAME jade-green as the letter Q, definitely NOT gold or orange) with a gold edge "
     "and small orange flames licking up from the base, correct single letter J, no other text."),

    # ---- hero art ----
    ("mascot_kirin", "3:4", "white",
     "a full-body rearing FLAMING KIRIN (Chinese qilin): a noble horse-dragon creature with golden "
     "scales, blue-flame mane and tail, antlers, leaping mid-air engulfed in swirling orange-and-blue "
     "fire, dynamic hero pose, the game's mascot."),
    ("dragon_eye", "1:1", "white",
     "a single intense glowing reptilian DRAGON EYE: a fiery orange-and-gold slit-pupil eye orb with "
     "a dark scaled lid and ember glow, looking forward, the centerpiece motif of a spin button, "
     "centered, no text."),

    # ---- control buttons (circular, glyph only, no caption text) ----
    ("btn_spin", "1:1", "white",
     "a large round glossy SPIN button for a slot game: a thick fiery orange-and-gold beveled ring "
     "with crimson flame highlights around a dark glassy center, two small teal dragon-fin crests "
     "on the sides, blank center (no text), premium 3D, centered."),
    ("btn_autoplay", "1:1", "white",
     "a round glossy deep-BLUE beveled game button with a gold rim, carrying a single white PLAY "
     "triangle inside a circular-arrow 'autoplay' glyph, no text, centered."),
    ("btn_autobet", "1:1", "white",
     "a round glossy deep-BLUE beveled game button with a gold rim, carrying a single white circular "
     "refresh/auto-loop glyph, no text, centered."),
    # NOTE: btn_minus is NOT generated — the model is unreliable at drawing a bare "−" (it has
    # produced a dragon in the glyph slot). prep-assets.py derives a pixel-matched minus from
    # btn_plus instead (reconstruct the face, draw the bar), guaranteeing a consistent pair.
    ("btn_plus", "1:1", "white",
     "a round glossy deep-BLUE beveled game button with a gold rim, carrying a single bold white "
     "PLUS '+' sign, no other text, centered."),
    ("btn_maxbet", "1:1", "white",
     "a rounded-square glossy deep-BLUE beveled game button with a gold rim and a thin orange flame "
     "accent ONLY along the outer edge; the center face is a clean EMPTY glossy blue panel (no "
     "flames across the interior, no text), a 'max bet' action button, straight-on, centered."),
    ("btn_info", "1:1", "white",
     "a round glossy deep-BLUE beveled game button with a gold rim, carrying a single white lowercase "
     "info 'i' glyph in a circle, no other text, centered."),
    ("btn_settings", "1:1", "white",
     "a round glossy deep-BLUE beveled game button with a gold rim, carrying a single white GEAR/cog "
     "settings glyph, no text, centered."),
    ("btn_sound", "1:1", "white",
     "a round glossy deep-BLUE beveled game button with a gold rim, carrying a single white SPEAKER "
     "with sound-waves glyph, no text, centered."),
    ("btn_chat", "1:1", "white",
     "a round glossy deep-BLUE beveled game button with a gold rim, carrying a single white speech "
     "CHAT-BUBBLE glyph, no text, centered."),

    # ---- pills / panels / badges (empty art) ----
    ("avatar_frame", "1:1", "white",
     "a circular GOLD avatar ring frame: an ornate glossy gold-and-navy beveled ring with a small "
     "flame crest at the top and an EMPTY hollow transparent-looking center (just the ring), a small "
     "blank level-badge notch at the bottom, no text, centered, straight-on."),
    ("readout_pill", "21:9", "white",
     "a single long horizontal rounded READOUT pill: a glossy dark-navy glass capsule with a thin "
     "gold rim and a subtle inner glow, the face left completely EMPTY (no text), a value display "
     "pill, straight-on, centered."),
    ("panel_balance", "16:9", "white",
     "a single rounded rectangular BALANCE panel: a glossy dark-navy plate with a gold rim and a "
     "soft inner cyan glow, the face left completely EMPTY (no text), straight-on, centered."),
    ("totalwin_bar", "21:9", "white",
     "a single long horizontal progress METER bar in an ornate gold frame, the channel filled with a "
     "hot orange-to-yellow fire gradient glow, glossy, no text, a 'total win' meter, straight-on, "
     "centered."),
    ("badge_multiplier", "1:1", "white",
     "a single bold HEXAGON badge glowing hot orange-and-red with a gold beveled rim and flame "
     "filigree, the center field left EMPTY (no text), a fire 'multiplier' badge, centered."),
    ("win_plate", "16:9", "white",
     "a single rounded rectangular WIN plate: a dark glossy navy panel with an ornate gold-and-flame "
     "trim border and a soft ember glow, the face left completely EMPTY (no text), a 'total win' "
     "amount plate, straight-on, centered, perfectly isolated with no stray smudges, ghosting or "
     "duplicate marks anywhere on the white background."),

    # ---- title logo ----
    ("title_logo", "16:9", "white",
     "a premium casino slot TITLE LOGO reading exactly 'LEGEND OF THE FLAMING KIRIN' on three "
     "stacked lines: 'LEGEND OF THE' in smaller icy-blue 3D beveled letters, then 'FLAMING KIRIN' "
     "large in bold molten-gold-and-orange 3D flaming metallic letters with a dark outline, flanked "
     "by two blue feathered dragon wings, correct spelling, centered, no tagline, no other text."),
]


def build_prompt(kind, subject):
    return f"{STYLE}\n\n{subject}{WHITE_BG if kind == 'white' else ''}"


def _save_first_image(payload, name):
    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                path = os.path.join(OUT, f"{name}.png")
                with open(path, "wb") as f:
                    f.write(base64.b64decode(inline["data"]))
                return path
    return None


_print_lock = threading.Lock()


def _log(msg):
    with _print_lock:
        print(msg, flush=True)


def generate(name, ar, kind, subject, api_key):
    body = {
        "contents": [{"role": "user", "parts": [{"text": build_prompt(kind, subject)}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": ar, "imageSize": IMAGE_SIZE},
        },
    }
    data = json.dumps(body).encode()
    url = f"{API}?key={api_key}"
    last = None
    for attempt in range(1, 6):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                payload = json.load(resp)
            saved = _save_first_image(payload, name)
            if saved:
                _log(f"  ok   {name:<20} {ar:>5} {IMAGE_SIZE}  -> {os.path.relpath(saved)}")
                return (name, True, None)
            last = "no image part: " + json.dumps(payload)[:300]
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode()[:300]}"
        except Exception as e:  # noqa: BLE001
            last = repr(e)
        _log(f"  retry {name} ({attempt}/5): {last}")
        time.sleep(min(30, 3 * attempt * attempt))  # quadratic backoff for 429/5xx
    return (name, False, last)


def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GEMINI_API_KEY not set")
    os.makedirs(OUT, exist_ok=True)
    want = set(sys.argv[1:])
    todo = [a for a in ASSETS if not want or a[0] in want]
    if want:
        missing = want - {a[0] for a in ASSETS}
        if missing:
            raise SystemExit(f"unknown asset(s): {', '.join(sorted(missing))}")
    workers = max(1, int(os.environ.get("GEMINI_CONCURRENCY", "3")))
    print(f"Generating {len(todo)} assets with {MODEL} @ {IMAGE_SIZE}, "
          f"concurrency={workers} -> {OUT}")

    failures = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(generate, n, ar, k, s, api_key): n for n, ar, k, s in todo}
        for fut in as_completed(futs):
            name, ok, err = fut.result()
            if not ok:
                failures.append((name, err))

    if failures:
        print("\nFAILED:")
        for name, err in failures:
            print(f"  {name}: {err}")
        raise SystemExit(f"{len(failures)} asset(s) failed")
    print("Done.")


if __name__ == "__main__":
    main()
