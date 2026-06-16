#!/usr/bin/env python3
"""Batch-generate the royal-slot sound pack via the ElevenLabs Sound Effects API.

Key is read from $ELEVENLABS_API_KEY or ~/.eleven_key (never printed, never committed).
Raw MP3s land in ./raw/, Godot-ready audio in ./out/ (.wav for short one-shots,
.ogg for loops + longer musical cues). Re-running skips cues already generated
unless --force is passed, so a partial run resumes cheaply.

Usage:
    export ELEVENLABS_API_KEY=...        # or: printf %s 'KEY' > ~/.eleven_key
    python3 generate_sfx.py              # generate + convert
    python3 generate_sfx.py --no-convert # raw mp3 only
    python3 generate_sfx.py --only win_big,megawin_fanfare
    python3 generate_sfx.py --force      # regenerate everything
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API_URL = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128"

# (name, prompt, duration_seconds, loop, prompt_influence)
CUES: list[tuple[str, str, float, bool, float]] = [
    # --- spin & reels ---
    ("spin_start", "Mechanical slot reels whoosh into motion, a quick rising mechanical whir with a soft golden chime accent, punchy and short, casino slot game, no music, no vocals", 0.8, False, 0.6),
    ("spin_loop", "Seamless looping whir of spinning slot reels, smooth airy mechanical rotation with a subtle metallic shimmer, steady tempo, no music, no vocals", 2.0, True, 0.6),
    ("reel_stop", "Single heavy slot reel locking into place, a deep wooden-and-metal thunk with a short tail, satisfying and weighty, no music", 0.5, False, 0.6),
    ("reel_stop_b", "Single heavy slot reel locking into place, a deep wooden-and-metal thunk with a short tail, satisfying and weighty, no music", 0.5, False, 0.6),
    ("reel_stop_c", "Single heavy slot reel locking into place, a deep wooden-and-metal thunk with a short tail, satisfying and weighty, no music", 0.5, False, 0.6),
    ("anticipation_riser", "Tense rising riser as a slot reel slows down, swelling orchestral strings and a low brass crescendo with a heartbeat pulse, medieval fantasy suspense, no vocals", 3.0, False, 0.6),
    ("nearmiss_hold", "Suspenseful slowed reel stop, a teasing dragged mechanical click with a held shimmering tone, anticipation, no vocals", 1.2, False, 0.6),
    # --- wins ---
    ("win_small", "Pleasant short win chime for a slot, bright sparkling bells and a soft harp glissando, cheerful, medieval royal theme, no vocals", 1.2, False, 0.6),
    ("win_medium", "Rewarding medium slot win, ascending golden bell arpeggio with a triumphant brass stab and coin sparkle, regal, no vocals", 1.8, False, 0.6),
    ("win_big", "Big win celebration for a royal slot, soaring brass fanfare with a choir swell, sparkling chimes and rolling coins, triumphant and grand, medieval fantasy, no vocals", 3.0, False, 0.6),
    ("bigwin_fanfare", "Triumphant royal fanfare, full brass and french horns with timpani hits and a choir, victorious medieval castle celebration, grand and cinematic, no vocals", 4.0, False, 0.6),
    ("megawin_fanfare", "Epic mega-win fanfare, massive orchestral brass and choir crescendo, cascading gold coins, cymbal crashes and timpani rolls, overwhelming triumphant medieval celebration, no vocals", 5.0, False, 0.6),
    ("coin_tick", "Single short coin-counter tick, a tiny bright metallic coin clink, crisp and clean, one-shot, no music", 0.5, False, 0.6),
    ("coin_shower", "Cascade of gold coins pouring and clattering onto a pile, rich metallic jingling treasure shower, abundant, no music", 2.5, False, 0.6),
    # --- special symbols ---
    ("wild_land", "Magical joker wild symbol landing on a reel, a whimsical sparkle with a playful bell flourish and a soft magical shimmer, no vocals", 1.0, False, 0.6),
    ("wild_expand", "Magical wild symbol expanding with a shimmering swirl, ascending sparkle and a soft enchanted whoosh, fantasy magic, no vocals", 1.5, False, 0.6),
    ("scatter_land", "Treasure-chest scatter symbol landing with a heavy golden chime and a bright sparkle, important and rewarding, no music", 0.8, False, 0.6),
    ("scatter_trigger", "Bonus triggered as three treasure chests align, a magical unlocking chime rising into a sparkle and a triumphant short brass hit, exciting reveal, no vocals", 2.0, False, 0.6),
    ("chest_open", "Heavy wooden treasure chest creaking open with a burst of magical golden shimmer and jingling coins, fantasy reward, no vocals", 1.8, False, 0.6),
    # --- free spins & multipliers ---
    ("freespins_enter", "Transition into a free-spins bonus, a magical swelling shimmer rising into a regal harp and choir flourish, enchanting medieval fantasy, no vocals", 3.0, False, 0.6),
    ("freespins_loop", "Seamless looping background music for a medieval slot free-spins round, uplifting harp and strings with light percussion and a regal melody, magical and hopeful, instrumental, no vocals", 20.0, True, 0.3),
    ("multiplier_apply", "Multiplier increases in a slot, a quick ascending magical zap with a bright golden ding, powerful and satisfying, no vocals", 0.8, False, 0.6),
    # --- music & ambience ---
    ("music_base_loop", "Seamless looping background music for a medieval royal slot, a stately mid-tempo lute and harp melody over soft strings and gentle percussion, regal castle ambience, relaxed and elegant, instrumental, no vocals", 20.0, True, 0.3),
    ("ambient_castle", "Subtle looping ambience of a grand castle hall, faint echoing room tone with distant flickering torches and warm air, calm, no music, no vocals", 15.0, True, 0.3),
    # --- UI ---
    ("spin_press", "Pressing a large ornate spin button, a satisfying mechanical lever clunk with a soft golden ring, no music", 0.5, False, 0.6),
    ("button_tap", "Soft ornate UI button click for a fantasy game, a gentle wooden tap with a subtle golden chime, crisp and short, no music", 0.5, False, 0.6),
    ("bet_change", "Quick UI blip for changing a bet value, a short bright coin tick with a soft ping, clean, no music", 0.5, False, 0.6),
    ("autospin_toggle", "UI toggle for autoplay, a short ascending two-note chime, crisp and positive, no music", 0.5, False, 0.6),
    ("error_blip", "Gentle error notification for a game UI, a soft low descending two-note buzz, polite negative feedback, no music, no vocals", 0.5, False, 0.6),
    ("intro_sting", "Short regal game-intro sting, a brief brass and harp flourish announcing a medieval slot, grand and welcoming, no vocals", 2.5, False, 0.6),
]

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
# Converted, game-ready audio. NOT named "out/" — the repo's root .gitignore has a
# blanket out/ rule that would swallow these committed assets.
OUT = HERE / "cues"


def resolve_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if key:
        return key
    keyfile = Path.home() / ".eleven_key"
    if keyfile.exists():
        key = keyfile.read_text(encoding="utf-8").strip()
        if key:
            return key
    sys.exit("No API key. Set $ELEVENLABS_API_KEY or write it to ~/.eleven_key")


def candidate_bodies(prompt: str, dur: float, loop: bool, influence: float) -> list[dict]:
    """Progressively simpler payloads so a stricter API revision still succeeds."""
    full = {
        "text": prompt,
        "duration_seconds": dur,
        "prompt_influence": influence,
        "model_id": "eleven_text_to_sound_v2",
    }
    if loop:
        full["loop"] = True
    no_model = {k: v for k, v in full.items() if k != "model_id"}
    minimal = {"text": prompt, "duration_seconds": dur, "prompt_influence": influence}
    # de-dup while preserving order
    out, seen = [], set()
    for b in (full, no_model, minimal):
        sig = json.dumps(b, sort_keys=True)
        if sig not in seen:
            seen.add(sig)
            out.append(b)
    return out


def generate(name: str, prompt: str, dur: float, loop: bool, influence: float, key: str) -> bool:
    dest = RAW / f"{name}.mp3"
    for body in candidate_bodies(prompt, dur, loop, influence):
        for attempt in range(3):
            req = urllib.request.Request(
                API_URL,
                data=json.dumps(body).encode("utf-8"),
                headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    audio = resp.read()
                if len(audio) < 256:
                    raise ValueError(f"suspiciously small response ({len(audio)} bytes)")
                dest.write_bytes(audio)
                print(f"  ok    {name:18s} {len(audio)//1024:>5d} KB")
                return True
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:300]
                if e.code in (400, 422):
                    # bad field set — try the next, simpler candidate body
                    print(f"  retry {name:18s} HTTP {e.code} (dropping optional fields)")
                    break
                if e.code == 429:
                    wait = 5 * (attempt + 1)
                    print(f"  rate  {name:18s} 429 — backing off {wait}s")
                    time.sleep(wait)
                    continue
                print(f"  ERR   {name:18s} HTTP {e.code}: {detail}")
                return False
            except (urllib.error.URLError, ValueError, TimeoutError) as e:
                print(f"  retry {name:18s} {e} (attempt {attempt + 1}/3)")
                time.sleep(2 * (attempt + 1))
    print(f"  FAIL  {name:18s} all payload variants rejected")
    return False


def convert(name: str, dur: float, loop: bool) -> None:
    src = RAW / f"{name}.mp3"
    if not src.exists():
        return
    musical = loop or dur >= 3.0          # loops + longer cues -> ogg/stereo
    ext = "ogg" if musical else "wav"
    dst = OUT / f"{name}.{ext}"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ar", "44100"]
    if musical:
        # Native ffmpeg "vorbis" encoder (needs -strict -2) — libvorbis isn't in
        # every build. Godot 4.x imports .ogg Vorbis natively and loops it gaplessly.
        cmd += ["-ac", "2", "-c:a", "vorbis", "-strict", "-2", "-b:a", "128k"]
        if dur >= 2.0:                    # normalize beds/fanfares for consistent loudness
            cmd += ["-af", "loudnorm=I=-16:TP=-1:LRA=11"]
    else:
        cmd += ["-ac", "1", "-c:a", "pcm_s16le"]
    cmd.append(str(dst))
    subprocess.run(cmd, check=True)
    print(f"  conv  {name:18s} -> out/{name}.{ext}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-convert", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated cue names")
    args = ap.parse_args()

    key = resolve_key()
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    wanted = {s.strip() for s in args.only.split(",") if s.strip()}
    cues = [c for c in CUES if not wanted or c[0] in wanted]
    has_ffmpeg = shutil.which("ffmpeg") is not None
    if not has_ffmpeg and not args.no_convert:
        print("note: ffmpeg not found — generating raw mp3 only (skip conversion)")

    print(f"Generating {len(cues)} cues -> {RAW}")
    failed = []
    for name, prompt, dur, loop, influence in cues:
        if (RAW / f"{name}.mp3").exists() and not args.force:
            print(f"  skip  {name:18s} (exists)")
        elif not generate(name, prompt, dur, loop, influence, key):
            failed.append(name)
            continue
        time.sleep(1)  # gentle pacing between API calls
        if has_ffmpeg and not args.no_convert:
            convert(name, dur, loop)

    print(f"\nDone. {len(cues) - len(failed)}/{len(cues)} generated.")
    if failed:
        print("Failed: " + ", ".join(failed) + "  (re-run to retry just these with --only)")


if __name__ == "__main__":
    main()
