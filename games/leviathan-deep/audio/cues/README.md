# Leviathan's Deep — audio cues

The client references these cue stems by name (see `_load_audio()` in
`slot/slot_machine.gd`). Drop `<name>.ogg` (preferred, looped music as Ogg Vorbis) or `<name>.wav`
(one-shots) into this folder. Missing files are skipped silently, so the build runs without audio.

One-shots:

- `spin_start`, `spin_press`, `button_tap`, `bet_change`, `error_blip`
- `reel_land`, `reel_land_b`, `reel_land_c` (rotated per reel)
- `symbol_land`, `wild_land`, `scatter_land`, `bonus_land`, `orb_land`
- `cascade_pop` (winning cluster clears), `tide_rise` (rising-tide bump)
- `anticipation` (drumroll tension as the trigger nears), `near_miss` (deflating "so close")
- `win_small`, `win_medium`, `win_big`
- `bigwin_fanfare`, `megawin_fanfare`, `epicwin_fanfare`
- `free_spins_intro`, `kraken_awakens`, `kraken_roar`
- `coin_shower`, `coin_tick`

Loops (set to loop; Ogg recommended):

- `spin_loop` — reel whir
- `music_base_loop` — base-game bed
- `music_freespins_loop` — free-spins bed (rising tide)
