#!/usr/bin/env python3
"""Generate DISTINCT, game-specific sound packs via the ElevenLabs Sound Effects API.

Each game previously reused Royal's medieval cues, so everything sounded the same. This
re-themes Dragon (draconic / molten hoard) and Fortune Wheel (bright casino gameshow),
and generates a casino-lounge loop for the arcade lobby. Royal keeps its own medieval
pack; Phoenix is built from an external repo and is untouched here.

Key from $ELEVENLABS_API_KEY or ~/.eleven_key (never printed/committed). Raw mp3 -> raw/,
Godot-ready audio -> each game's audio/cues/ (.wav one-shots, .ogg loops/long), and the
lobby loop -> apps/arcade/public/audio/lobby-music.mp3. Re-running skips existing unless
--force; --only name1,name2 limits cues; --group dragon|wheel|lobby limits groups.

    python3 tools/gen-game-audio.py
    python3 tools/gen-game-audio.py --group lobby
    python3 tools/gen-game-audio.py --only music_base_loop --force
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
REPO = Path(__file__).resolve().parent.parent

# (name, prompt, duration_seconds, loop, prompt_influence)
DRAGON = [
    ("spin_start", "Deep rumbling start of a dragon-themed slot reel spin, a low draconic growl easing into a heavy molten whir with ember crackle and cavern echo, ominous yet inviting, no music, no vocals", 0.8, False, 0.55),
    ("spin_loop", "Hypnotic continuous low rumble of spinning dragon-hoard slot reels, a warm molten whir with a faint draconic growl and ember sizzle, seamless loop, no music, no vocals", 2.5, True, 0.5),
    ("reel_stop", "Single dragon-slot reel locking into place, a heavy molten stone-and-gold thunk with a deep ember sizzle tail, weighty, no music", 0.5, False, 0.6),
    ("reel_stop_b", "Single dragon-slot reel locking into place, a heavy molten stone-and-gold thunk with a deep ember sizzle tail, weighty, no music", 0.5, False, 0.6),
    ("reel_stop_c", "Single dragon-slot reel locking into place, a heavy molten stone-and-gold thunk with a deep ember sizzle tail, weighty, no music", 0.5, False, 0.6),
    ("anticipation_riser", "Tense rising riser for a dragon slot, swelling low brass and a growing draconic growl with a heartbeat war drum, fiery fantasy suspense, no vocals", 3.0, False, 0.6),
    ("nearmiss_hold", "Suspenseful slowed reel stop on a dragon slot, a dragged molten click with a held smoldering ember tone, anticipation, no vocals", 1.2, False, 0.6),
    ("win_small", "Pleasant short win chime for a dragon-treasure slot, bright gold coin sparkle with a soft warm gong, cheerful, no vocals", 1.2, False, 0.6),
    ("win_medium", "Rewarding medium dragon-slot win, ascending golden gong arpeggio with a triumphant low brass and coin shimmer, draconic treasure, no vocals", 1.8, False, 0.6),
    ("win_big", "Big win for a dragon-hoard slot, soaring epic brass with a dragon roar accent, cascading gold coins and ember sparkle, triumphant fiery fantasy, no vocals", 3.0, False, 0.6),
    ("bigwin_fanfare", "Triumphant dragon-hoard fanfare, huge low brass and pounding war drums with a mighty dragon roar and cascading gold, grand fiery celebration, cinematic, no vocals", 4.0, False, 0.6),
    ("megawin_fanfare", "Epic mega-win for a dragon slot, massive orchestral brass and thunderous war drums, a colossal dragon roar, a torrent of gold coins and cymbal crashes, overwhelming fiery triumph, no vocals", 5.0, False, 0.6),
    ("coin_tick", "Single short gold coin counter tick, a tiny bright metallic clink, crisp, one-shot, no music", 0.5, False, 0.6),
    ("coin_shower", "Cascade of gold coins and gems pouring onto a dragon hoard, rich metallic clattering treasure shower, abundant, no music", 2.5, False, 0.6),
    ("wild_land", "Dragon wild crest landing on a reel, a fiery magical shimmer with a short draconic growl and ember sparkle, no vocals", 1.0, False, 0.6),
    ("wild_expand", "Dragon wild expanding with a fiery swirl, ascending ember sparkle and a draconic whoosh, fantasy fire magic, no vocals", 1.5, False, 0.6),
    ("scatter_land", "Gold-coin scatter symbol landing with a heavy treasure chime and a bright metallic sparkle, important and rewarding, no music", 0.8, False, 0.6),
    ("scatter_trigger", "Bonus triggered as gold-coin scatters align on a dragon slot, a rising magical chime into a dragon roar and a triumphant brass hit, exciting reveal, no vocals", 2.0, False, 0.6),
    ("chest_open", "Heavy dragon-hoard vault rumbling open with a burst of fiery golden shimmer and jingling coins, fantasy reward, no vocals", 1.8, False, 0.6),
    ("freespins_enter", "Transition into a dragon free-spins bonus, a swelling fiery shimmer rising into a draconic horn and a torrent of gold, epic fantasy reveal, no vocals", 3.0, False, 0.6),
    ("multiplier_apply", "Dragon-slot multiplier increases, a quick ascending fiery zap with a bright golden gong, powerful, no vocals", 0.8, False, 0.6),
    ("button_tap", "Soft UI button click for a dragon fantasy game, a gentle stone tap with a subtle ember crackle, crisp and short, no music", 0.5, False, 0.6),
    ("bet_change", "Quick UI blip for changing a bet, a short bright gold coin tick with a soft ember ping, clean, no music", 0.5, False, 0.6),
    ("autospin_toggle", "UI toggle for autoplay on a dragon slot, a short ascending two-note ember chime, crisp and positive, no music", 0.5, False, 0.6),
    ("error_blip", "Gentle error notification, a soft low descending two-note draconic grumble, polite negative feedback, no music, no vocals", 0.5, False, 0.6),
    ("music_base_loop", "Seamless looping background music for a dragon-hoard fantasy slot, a dark epic mid-tempo theme with low brass, tribal war drums, ominous strings and a hint of draconic menace, adventurous and grand, instrumental, no vocals", 22.0, True, 0.3),
    ("ambient_castle", "Subtle looping ambience of a vast dragon cavern, faint echoing dripping water, a distant low rumble and softly crackling embers, mysterious and cavernous, no music, no vocals", 18.0, True, 0.3),
]

WHEEL = [
    ("spin_press", "Pressing a big glossy casino spin button, a satisfying click with a bright golden ring, no music", 0.5, False, 0.6),
    ("spin_start", "Start of a spinning casino fortune wheel, a bright energetic whoosh into rapid ratcheting ticks, exciting gameshow, no music, no vocals", 0.8, False, 0.55),
    ("spin_loop", "Continuous spinning fortune-wheel ratchet ticks, a steady rhythmic clicking of a casino prize wheel turning, bright and exciting, seamless loop, no music, no vocals", 2.5, True, 0.5),
    ("reel_stop", "Fortune wheel ticker settling onto a winning segment, a final decisive click-thunk, satisfying, no music", 0.5, False, 0.6),
    ("win_small", "Pleasant short casino win chime, bright cheerful bells and a quick sparkle, upbeat gameshow, no vocals", 1.2, False, 0.6),
    ("win_medium", "Rewarding medium casino win, ascending bright bell arpeggio with a happy ding and coin sparkle, festive, no vocals", 1.8, False, 0.6),
    ("win_big", "Big casino win celebration, triumphant bright brass fanfare with ringing bells, sparkles and rolling coins, exciting gameshow jackpot, no vocals", 3.0, False, 0.6),
    ("bigwin_fanfare", "Triumphant casino jackpot fanfare, bright brass and ringing bells with celebratory energy and cascading coins, festive Vegas celebration, no vocals", 4.0, False, 0.6),
    ("megawin_fanfare", "Epic casino mega-jackpot fanfare, dazzling brass and a flurry of ringing bells, celebration sirens, a torrent of coins and confetti, overwhelming festive triumph, no vocals", 5.0, False, 0.6),
    ("coin_tick", "Single short coin counter tick, a tiny bright metallic clink, crisp, one-shot, no music", 0.5, False, 0.6),
    ("coin_shower", "Cascade of casino coins pouring out of a big win, rich metallic jingling, abundant jackpot payout, no music", 2.5, False, 0.6),
    ("button_tap", "Soft modern casino UI button click, a clean bright tap with a subtle chime, crisp and short, no music", 0.5, False, 0.6),
    ("bet_change", "Quick UI blip for changing a bet value, a short bright coin tick with a soft ping, clean, no music", 0.5, False, 0.6),
    ("error_blip", "Gentle error notification, a soft low descending two-note buzz, polite negative feedback, no music, no vocals", 0.5, False, 0.6),
    ("multiplier_apply", "Wheel multiplier reveal, a quick ascending sparkly chime with a bright ding, exciting, no vocals", 0.7, False, 0.6),
    ("music_base_loop", "Seamless looping background music for a glamorous casino fortune-wheel game, an upbeat swing-jazz lounge groove with brass stabs, walking bass, light brushed drums and a touch of sparkle, fun and luxurious, instrumental, no vocals", 22.0, True, 0.3),
]

LOBBY = [
    ("lobby-music", "Seamless looping background music for a luxurious online casino lobby, a smooth sophisticated lounge groove with mellow electric piano, soft muted brass, gentle nu-jazz brushed drums and a warm bassline, classy relaxed and inviting, instrumental, no vocals", 22.0, True, 0.3),
]

# Cosmic Slots: deep-space / neon-arcade / glassy-digital-synthwave theme. No vocals, no human speech.
# COSMIC — deliberately SOFT, WARM, ROUNDED, MELLOW tones. Every prompt avoids harsh
# treble / piercing highs (no "crisp/glassy/bright/clang/zap/sparkle/sharp"); lower
# prompt_influence (0.4) lets the model lean on natural, cushioned timbres.
COSMIC = [
    ("spin_start", "Soft warm cosmic whoosh as neon reels begin to spin, a gentle low synth sweep with a rounded cushioned tone, mellow and smooth, muted highs, no harsh treble, no music, no vocals", 0.8, False, 0.4),
    ("spin_loop", "Seamless gentle loop of spinning cosmic reels, a soft warm rounded synth whir with a smooth low hum, mellow and muted, no harsh highs, no clicks, no music, no vocals", 2.5, True, 0.4),
    ("reel_stop", "Soft cosmic reel settling into place, a warm muted low thud with a gentle rounded synth tone, cushioned and smooth, no sharp click, no harsh treble, no music", 0.5, False, 0.4),
    ("reel_stop_b", "Soft cosmic reel settling into place, a warm muted low thud with a gentle rounded synth tone, cushioned and smooth, no sharp click, no harsh treble, no music", 0.5, False, 0.4),
    ("reel_stop_c", "Soft cosmic reel settling into place, a warm muted low thud with a gentle rounded synth tone, cushioned and smooth, no sharp click, no harsh treble, no music", 0.5, False, 0.4),
    ("anticipation_riser", "Gentle rising cosmic riser, a soft swelling warm synth pad with a slow mellow pulse, smooth dreamy suspense, no harsh highs, no vocals", 3.0, False, 0.4),
    ("bonus_alarm", "Warm celebratory cosmic jackpot chime, soft rounded bells ringing gently in a pleasant glowing melody with a warm synth swell, joyful and inviting, mellow and smooth, NOT harsh, no piercing treble, no vocals", 3.0, False, 0.45),
    ("bonus_reveal", "Warm soft cosmic bonus reveal, gentle rounded chimes and a mellow glowing synth pad, rewarding and soothing, smooth, no harsh highs, no vocals", 2.0, False, 0.4),
    ("scatter_land", "Soft cosmic scatter landing, a warm gentle rounded chime, mellow and cushioned, no sharp sparkle, no harsh treble, no music", 0.8, False, 0.4),
    ("scatter_trigger", "Soft rising cosmic free-spins reveal, a gentle warm synth swell with mellow rounded notes, smooth and pleasant, no harsh highs, no vocals", 2.0, False, 0.4),
    ("wild_land", "Soft cosmic wild landing, a warm gentle shimmer with a smooth rounded tone, mellow, no sharp zap, no harsh treble, no music", 1.0, False, 0.4),
    ("win_small", "Soft pleasant cosmic win chime, warm rounded mellow notes, gentle and cheerful, cushioned, no harsh treble, no vocals", 1.2, False, 0.4),
    ("win_medium", "Warm rewarding cosmic win, a soft ascending mellow synth arpeggio with rounded notes, smooth and pleasant, no harsh highs, no vocals", 1.8, False, 0.4),
    ("win_big", "Big warm cosmic win, soft soaring mellow synth pads with gentle rounded swells, triumphant but smooth and warm, no harsh treble, no vocals", 3.0, False, 0.4),
    ("bigwin_fanfare", "Warm cosmic jackpot fanfare, soft glowing synth swells with gentle rounded chimes, grand but mellow, soothing and pleasant, no harsh highs, no vocals", 4.0, False, 0.4),
    ("coin_tick", "Soft tiny cosmic credit tick, a warm gentle rounded blip, muted and cushioned, no sharp click, one-shot, no music", 0.5, False, 0.4),
    ("button_tap", "Soft gentle UI tap, a warm rounded muted click, cushioned and smooth, no sharp treble, short, no music", 0.5, False, 0.4),
    ("bet_change", "Soft UI blip changing a bet, a gentle warm rounded two-note tone, mellow and smooth, no harsh ping, no music", 0.5, False, 0.4),
    ("error_blip", "Soft gentle error tone, a warm low descending mellow two-note hum, polite and smooth, no harsh buzz, no music, no vocals", 0.5, False, 0.4),
    ("music_base_loop", "Seamless looping background music for a cosmic neon slot, soft mellow downtempo synthwave with warm analog pads and a gentle slow arp, deep space ambience, soothing and chill, warm and smooth, no harsh highs, no vocals, loopable", 12.0, True, 0.4),
]

# Inferno Link: a fiery hold-and-spin slot. Molten/ember/lava timbres, a "fire link" feature
# where flaming balls drop and lock. Triumphant brass + crackling fire. No vocals.
INFERNO = [
    ("spin_press", "Pressing a big glossy fiery casino spin button, a satisfying click with a warm ember whoosh, no music", 0.5, False, 0.6),
    ("spin_start", "Start of a fiery slot spin, a rushing whoosh of flame with rapid ember crackle as reels drop, energetic and hot, no music, no vocals", 0.8, False, 0.55),
    ("spin_loop", "Continuous loop of spinning fiery slot reels, a steady warm roar of flame with a low molten rumble and ember sizzle, seamless loop, no music, no vocals", 2.5, True, 0.5),
    ("reel_land", "A slot reel of symbols dropping and slamming into place, a heavy molten thud with a short fiery whoosh and ember sizzle tail, weighty, no music", 0.5, False, 0.6),
    ("reel_land_b", "A slot reel of symbols dropping and slamming into place, a heavy molten thud with a short fiery whoosh and ember sizzle tail, weighty, no music", 0.5, False, 0.6),
    ("reel_land_c", "A slot reel of symbols dropping and slamming into place, a heavy molten thud with a short fiery whoosh and ember sizzle tail, weighty, no music", 0.5, False, 0.6),
    ("win_small", "Pleasant short fiery win chime, bright warm bells with a soft ember sparkle, cheerful, no vocals", 1.2, False, 0.6),
    ("win_medium", "Rewarding medium fire-slot win, an ascending warm bell arpeggio with a triumphant brass hit and ember crackle, festive and hot, no vocals", 1.8, False, 0.6),
    ("win_big", "Big fire-slot win celebration, soaring triumphant brass fanfare with roaring flames, ringing bells and cascading gold coins, exciting blazing jackpot, no vocals", 3.0, False, 0.6),
    ("bigwin_fanfare", "Triumphant fiery jackpot fanfare, huge bright brass and pounding drums with a roaring flame burst and cascading gold, grand blazing celebration, cinematic, no vocals", 4.0, False, 0.6),
    ("megawin_fanfare", "Epic fire mega-jackpot, massive orchestral brass and thunderous drums with a colossal flame roar, a torrent of gold coins and cymbal crashes, overwhelming blazing triumph, no vocals", 5.0, False, 0.6),
    ("fireball_land", "A glowing flaming ball dropping and locking onto a slot grid, a fiery whoosh into a warm molten thud with a bright ember pop, satisfying and hot, no music, no vocals", 0.7, False, 0.6),
    ("holdspin_enter", "Triggering a fire-link hold-and-spin bonus, a rising whoosh of flames into a triumphant brass blast and a roaring fire burst, exciting fiery reveal, no vocals", 2.0, False, 0.6),
    ("holdspin_respin", "Quick fiery respin tick for a hold-and-spin bonus, a short warm flame whoosh with an ember crackle, anticipatory, no music, no vocals", 0.6, False, 0.55),
    ("grand_jackpot", "Massive grand jackpot win on a fire slot, an enormous roaring flame explosion with triumphant orchestral brass, ringing bells, sirens and a torrent of gold coins, overwhelming blazing celebration, no vocals", 5.0, False, 0.6),
    ("coin_tick", "Single short gold coin counter tick, a tiny bright warm metallic clink, crisp, one-shot, no music", 0.5, False, 0.6),
    ("coin_shower", "Cascade of gold coins pouring out of a fiery win, rich warm metallic jingling, abundant blazing payout, no music", 2.5, False, 0.6),
    ("button_tap", "Soft fiery UI button click, a clean warm tap with a subtle ember crackle, crisp and short, no music", 0.5, False, 0.6),
    ("bet_change", "Quick UI blip for changing a bet, a short warm coin tick with a soft ember ping, clean, no music", 0.5, False, 0.6),
    ("error_blip", "Gentle error notification, a soft low descending two-note warm buzz, polite negative feedback, no music, no vocals", 0.5, False, 0.6),
    ("music_base_loop", "Seamless looping background music for a blazing fire-themed casino slot, an energetic mid-tempo theme with bold brass stabs, driving tribal drums, warm low strings and crackling fiery intensity, exciting and hot, instrumental, no vocals, loopable", 22.0, True, 0.3),
]

# Leviathan's Deep: a 6x5 ways + tumbling deep-ocean treasure slot. Abyssal/water/leviathan/kraken
# timbres, bioluminescent shimmer, rising-tide free spins, a Kraken Awakens bonus. No vocals.
LEVIATHAN = [
    ("spin_start", "Start of an undersea treasure slot spin, a deep watery whoosh with a swell of rushing current and a low oceanic rumble, mysterious and inviting, no music, no vocals", 0.8, False, 0.55),
    ("spin_press", "Pressing a large glossy gold-and-coral spin button on an undersea slot, a satisfying click with a deep watery bloop and a soft golden ring, no music", 0.5, False, 0.6),
    ("button_tap", "Soft UI button tap for an undersea treasure game, a gentle muffled bubble click, crisp and short, no music", 0.5, False, 0.6),
    ("bet_change", "Quick UI blip changing a bet on an undersea slot, a short watery bubble tick with a soft pearl ping, clean, no music", 0.5, False, 0.6),
    ("error_blip", "Gentle error notification, a soft low descending two-note watery bloop, polite negative feedback, no music, no vocals", 0.5, False, 0.6),
    ("reel_land", "An undersea slot reel dropping into place, a heavy watery thud with a deep bubble plonk and a short current swirl tail, weighty, no music", 0.5, False, 0.6),
    ("reel_land_b", "An undersea slot reel dropping into place, a heavy watery thud with a deep bubble plonk and a short current swirl tail, weighty, no music", 0.5, False, 0.6),
    ("reel_land_c", "An undersea slot reel dropping into place, a heavy watery thud with a deep bubble plonk and a short current swirl tail, weighty, no music", 0.5, False, 0.6),
    ("symbol_land", "A single treasure symbol settling onto an undersea reel, a soft watery tap with a faint shimmer, short, no music, no vocals", 0.6, False, 0.6),
    ("wild_land", "An ocean wild medallion landing on a reel, a magical watery shimmer with a deep glowing bloom and bubble sparkle, no vocals", 1.0, False, 0.6),
    ("scatter_land", "A golden conch scatter landing with a resonant watery chime and a bright bubble sparkle, important and rewarding, no music", 0.8, False, 0.6),
    ("bonus_land", "A glowing kraken-amulet bonus symbol landing on an undersea reel, an ominous deep watery boom with a dark shimmer and a faint kraken groan, important, no music, no vocals", 0.8, False, 0.6),
    ("orb_land", "A glowing bioluminescent multiplier orb landing on an undersea reel, a soft watery bloop into a bright magical chime, rewarding, no vocals", 0.7, False, 0.6),
    ("cascade_pop", "Treasure symbols bursting and dissolving in water as new ones tumble down, a watery pop with bubbles and a soft shimmering clink, satisfying, no music, no vocals", 0.5, False, 0.6),
    ("tide_rise", "A rising tide multiplier climbing on an undersea slot, an ascending watery swell with glowing bubbling shimmer and a bright magical ping at the top, no vocals", 1.5, False, 0.6),
    ("anticipation", "Tense rising undersea riser, a swelling deep ocean drone with a growing low kraken groan, churning water and a heartbeat pulse, suspenseful abyssal dread, no vocals", 3.0, False, 0.6),
    ("near_miss", "Suspenseful deflating undersea near-miss, a dragged watery groan sinking into a low disappointed bubble, anticipation fading, no vocals", 1.2, False, 0.6),
    ("win_small", "Pleasant short undersea win chime, bright watery bells with a soft pearl sparkle, cheerful, no vocals", 1.2, False, 0.6),
    ("win_medium", "Rewarding medium undersea win, an ascending watery bell arpeggio with a warm oceanic swell and bubbling shimmer, treasure, no vocals", 1.8, False, 0.6),
    ("win_big", "Big undersea-treasure win, soaring triumphant orchestral swell with a deep oceanic horn, cascading gold coins and a rush of water, exciting abyssal jackpot, no vocals", 3.0, False, 0.6),
    ("bigwin_fanfare", "Triumphant undersea jackpot fanfare, huge cinematic brass and pounding drums with a surging wave and cascading gold treasure, grand oceanic celebration, no vocals", 4.0, False, 0.6),
    ("megawin_fanfare", "Epic mega-win for an undersea slot, massive orchestral brass and thunderous drums, a colossal kraken roar, a torrent of gold coins and crashing waves, overwhelming abyssal triumph, no vocals", 5.0, False, 0.6),
    ("epicwin_fanfare", "Colossal epic-win for an undersea-treasure slot, enormous booming orchestra and choir-like swells, a monstrous leviathan roar, a tidal wave of gold and crashing surf, earth-shaking oceanic triumph, no vocals", 5.0, False, 0.6),
    ("free_spins_intro", "Transition into an undersea free-spins bonus, a swelling magical watery rise into a deep oceanic horn and a glowing tide of gold, epic abyssal reveal, no vocals", 3.0, False, 0.6),
    ("kraken_awakens", "The Kraken awakens beneath the sea, a monstrous deep groaning roar rising from the abyss with churning water, thunderous low brass and an ominous swell, terrifying and grand, no vocals", 4.0, False, 0.6),
    ("kraken_roar", "A short colossal kraken roar bursting through water, a deep monstrous bellow with a splash and rumble, powerful, no music, no vocals", 2.0, False, 0.6),
    ("coin_shower", "Cascade of gold coins and pearls pouring through water onto a sunken hoard, rich watery metallic clattering treasure shower, abundant, no music", 2.5, False, 0.6),
    ("coin_tick", "Single short gold coin counter tick, a tiny bright wet metallic clink, crisp, one-shot, no music", 0.5, False, 0.6),
    ("spin_loop", "Hypnotic continuous loop of spinning undersea slot reels, a steady watery whir with a low oceanic current rumble and faint bubbles, seamless loop, no music, no vocals", 2.5, True, 0.5),
    ("music_base_loop", "Seamless looping background music for a deep-ocean treasure slot, a mysterious mid-tempo cinematic theme with low strings, soft choir pads, gentle harp shimmer and a deep oceanic pulse, adventurous and majestic, instrumental, no vocals, loopable", 22.0, True, 0.3),
    ("music_freespins_loop", "Seamless looping music for an undersea free-spins bonus, an uplifting majestic orchestral theme with soaring strings, bright harp, triumphant low brass and a flowing oceanic energy, magical and rewarding, instrumental, no vocals, loopable", 22.0, True, 0.3),
]

GROUPS = {
    "dragon": (REPO / "games/dragon-hoard/audio", DRAGON),
    "leviathan": (REPO / "games/leviathan-deep/audio", LEVIATHAN),
    "wheel": (REPO / "games/fortune-wheel/audio", WHEEL),
    "lobby": (REPO / "apps/arcade/public/audio", LOBBY),
    "cosmic": (REPO / "games/cosmic-slots/audio", COSMIC),
    "inferno": (REPO / "games/inferno-link/audio", INFERNO),
}


def resolve_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if key:
        return key
    kf = Path.home() / ".eleven_key"
    if kf.exists() and kf.read_text(encoding="utf-8").strip():
        return kf.read_text(encoding="utf-8").strip()
    sys.exit("No API key. Set $ELEVENLABS_API_KEY or write it to ~/.eleven_key")


def candidate_bodies(prompt, dur, loop, influence):
    full = {"text": prompt, "duration_seconds": dur, "prompt_influence": influence, "model_id": "eleven_text_to_sound_v2"}
    if loop:
        full["loop"] = True
    no_model = {k: v for k, v in full.items() if k != "model_id"}
    minimal = {"text": prompt, "duration_seconds": dur, "prompt_influence": influence}
    out, seen = [], set()
    for b in (full, no_model, minimal):
        sig = json.dumps(b, sort_keys=True)
        if sig not in seen:
            seen.add(sig); out.append(b)
    return out


def generate(raw_dir, name, prompt, dur, loop, influence, key) -> bool:
    dest = raw_dir / f"{name}.mp3"
    for body in candidate_bodies(prompt, dur, loop, influence):
        for attempt in range(3):
            req = urllib.request.Request(
                API_URL, data=json.dumps(body).encode("utf-8"),
                headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
                method="POST")
            try:
                with urllib.request.urlopen(req, timeout=180) as resp:
                    audio = resp.read()
                if len(audio) < 256:
                    raise ValueError(f"tiny response ({len(audio)}B)")
                dest.write_bytes(audio)
                print(f"  ok    {name:18s} {len(audio)//1024:>5d} KB")
                return True
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:200]
                if e.code in (400, 422):
                    print(f"  retry {name:18s} HTTP {e.code} (simpler body)"); break
                if e.code == 429:
                    w = 5 * (attempt + 1); print(f"  rate  {name:18s} 429 — wait {w}s"); time.sleep(w); continue
                print(f"  ERR   {name:18s} HTTP {e.code}: {detail}"); return False
            except (urllib.error.URLError, ValueError, TimeoutError) as e:
                print(f"  retry {name:18s} {e} ({attempt+1}/3)"); time.sleep(2 * (attempt + 1))
    print(f"  FAIL  {name:18s} all variants rejected")
    return False


def convert(raw_dir, out_dir, name, dur, loop, is_lobby) -> None:
    src = raw_dir / f"{name}.mp3"
    if not src.exists():
        return
    if is_lobby:
        # Lobby plays in the browser — keep it mp3 (universal incl. Safari).
        shutil.copyfile(src, out_dir / f"{name}.mp3")
        print(f"  conv  {name:18s} -> {out_dir.name}/{name}.mp3")
        return
    musical = loop or dur >= 3.0
    ext = "ogg" if musical else "wav"
    dst = out_dir / f"{name}.{ext}"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ar", "44100"]
    if musical:
        cmd += ["-ac", "2", "-c:a", "vorbis", "-strict", "-2", "-b:a", "128k"]
        if dur >= 2.0:
            cmd += ["-af", "loudnorm=I=-16:TP=-1:LRA=11"]
    else:
        cmd += ["-ac", "1", "-c:a", "pcm_s16le"]
    cmd.append(str(dst))
    subprocess.run(cmd, check=True)
    print(f"  conv  {name:18s} -> cues/{name}.{ext}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-convert", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--group", default="", help="dragon|wheel|lobby|cosmic (default: all)")
    args = ap.parse_args()

    key = resolve_key()
    wanted_cues = {s.strip() for s in args.only.split(",") if s.strip()}
    wanted_groups = {s.strip() for s in args.group.split(",") if s.strip()}
    has_ffmpeg = shutil.which("ffmpeg") is not None

    for gname, (base, cues) in GROUPS.items():
        if wanted_groups and gname not in wanted_groups:
            continue
        is_lobby = gname == "lobby"
        raw_dir = base / "raw" if not is_lobby else base / "raw"
        out_dir = base / "cues" if not is_lobby else base
        raw_dir.mkdir(parents=True, exist_ok=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        sel = [c for c in cues if not wanted_cues or c[0] in wanted_cues]
        print(f"\n=== {gname}: {len(sel)} cues -> {raw_dir} ===")
        for name, prompt, dur, loop, inf in sel:
            if (raw_dir / f"{name}.mp3").exists() and not args.force:
                print(f"  skip  {name:18s} (exists)")
            elif not generate(raw_dir, name, prompt, dur, loop, inf, key):
                continue
            time.sleep(1)
            if has_ffmpeg and not args.no_convert:
                convert(raw_dir, out_dir, name, dur, loop, is_lobby)
    print("\nDone.")


if __name__ == "__main__":
    main()
