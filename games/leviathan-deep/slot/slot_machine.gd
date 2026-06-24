extends Node2D

## Leviathan's Deep — responsive portrait web slot client (the Goldwave marquee game).
##
## SERVER-AUTHORITATIVE: this scene never decides an outcome. On spin it asks the host page
## (window.LeviathanDeepGodot bridge) to place the bet; the page calls the Aureus API and hands
## back the authoritative LeviathanOutcome, which this scene RENDERS. Standalone (no bridge —
## editor or a directly-opened export) a local mock drives the visuals so the presentation can be
## built and QA'd offline. The bridge message names/shapes mirror the other Goldwave Godot clients
## exactly (see web/leviathan-bridge.js).
##
## CONTRACT (packages/shared/src/schemas/leviathan.ts — FROZEN): 6x5 column-major grid, WAYS wins,
## TUMBLING cascades (base.cascades[]), 4+ SCATTER free spins with a persistent rising-tide
## multiplier (freeSpins.startTide/endTide), a 3+ BONUS "Kraken Awakens" instant prize (bonus),
## and a presentation-only `feel` (winTier + per-reel anticipation + near-miss) that drives the
## suspense/celebration without ever changing the money figure.
##
## LAYERING (the "emerging from the frame" look): the backplate (art/ui/reel_backplate.png) sits
## at the back; per-reel CLIPPED symbol windows scroll/tumble above it; the ornate frame
## (art/ui/reel_frame.png — transparent centre) sits ON TOP, so a symbol entering from above is
## hidden by the frame's top border until it drops into the window. The grid is placed inside the
## frame's cut window using the WIN_* fractions measured from the frame art's alpha.
##
## 2.5D ANIMATION: rising-bubble parallax field + slow background drift, idle "breathing" on
## premium symbols, eased/overshooting reel-stop bounces, a pop on landing, an anticipation
## drumroll + zoom on scatter/bonus hunts, the rising-tide free-spins ramp, and a full-screen
## Kraken takeover — so the AI art reads as alive and dimensional without a real 3D pipeline.

const DESIGN := Vector2(1080, 1920)
const COLS := 6
const ROWS := 5
const SPR := ROWS + 2   # sprites per reel: idx0 top buffer, idx1..ROWS visible rows, idx(SPR-1) bottom buffer

const SYMBOL_IDS := [
	"LEVIATHAN", "KRAKEN", "SIREN", "TRIDENT", "CHEST",
	"PEARL", "AQUA", "SAPPHIRE", "AMETHYST", "EMERALD",
	"WILD", "SCATTER", "BONUS", "MULT_ORB",
]
## Engine symbol id -> art file stem under art/symbols/.
const SYMBOL_FILE := {
	"LEVIATHAN": "sym_leviathan", "KRAKEN": "sym_kraken", "SIREN": "sym_siren",
	"TRIDENT": "sym_trident", "CHEST": "sym_chest",
	"PEARL": "sym_pearl", "AQUA": "sym_aqua", "SAPPHIRE": "sym_sapphire",
	"AMETHYST": "sym_amethyst", "EMERALD": "sym_emerald",
	"WILD": "sym_wild", "SCATTER": "sym_scatter", "BONUS": "sym_bonus", "MULT_ORB": "sym_mult_orb",
}
const HIGH := ["LEVIATHAN", "KRAKEN", "SIREN", "TRIDENT", "CHEST"]
const LOW := ["PEARL", "AQUA", "SAPPHIRE", "AMETHYST", "EMERALD"]
const WILD := "WILD"
const SCATTER := "SCATTER"
const BONUS := "BONUS"
const MULT_ORB := "MULT_ORB"
const SCATTER_TRIGGER := 4
const BONUS_TRIGGER := 3

## Mock-only ways paytable (offline demo). bps for ONE matching way at N consecutive reels; the
## win multiplies by the number of ways. The server is authoritative in live play.
const MOCK_PAY := {
	"LEVIATHAN": {3: 2000, 4: 6000, 5: 20000, 6: 50000},
	"KRAKEN": {3: 1500, 4: 5000, 5: 15000, 6: 40000},
	"SIREN": {3: 1200, 4: 4000, 5: 12000, 6: 30000},
	"TRIDENT": {3: 1000, 4: 3000, 5: 9000, 6: 24000},
	"CHEST": {3: 800, 4: 2400, 5: 7000, 6: 18000},
	"PEARL": {3: 500, 4: 1200, 5: 3500, 6: 9000},
	"AQUA": {3: 400, 4: 1000, 5: 3000, 6: 8000},
	"SAPPHIRE": {3: 300, 4: 800, 5: 2400, 6: 6500},
	"AMETHYST": {3: 250, 4: 700, 5: 2000, 6: 5500},
	"EMERALD": {3: 200, 4: 600, 5: 1800, 6: 5000},
}
const MOCK_KRAKEN := {3: 300000, 4: 800000, 5: 2000000, 6: 6000000}
const MOCK_MAX_CASCADES := 7

## Paytable display copy (Info screen only; the server is authoritative for real pays). Each row is
## [symbol id, pay for 3, 4, 5, 6 of a kind] — per matching WAY, as a multiple of the total bet.
## Held as strings so the screen renders the exact figures from docs without float formatting drift.
const PT_HIGH := [
	["LEVIATHAN", "0.2x", "0.6x", "2x", "6x"],
	["KRAKEN", "0.12x", "0.4x", "1.2x", "3.6x"],
	["SIREN", "0.08x", "0.25x", "0.8x", "2.4x"],
	["TRIDENT", "0.05x", "0.16x", "0.5x", "1.5x"],
	["CHEST", "0.035x", "0.1x", "0.3x", "0.9x"],
]
const PT_LOW := [
	["EMERALD", "0.02x", "0.06x", "0.18x", "0.5x"],
	["AMETHYST", "0.016x", "0.048x", "0.14x", "0.4x"],
	["SAPPHIRE", "0.012x", "0.036x", "0.1x", "0.3x"],
	["AQUA", "-", "0.032x", "0.09x", "0.24x"],
	["PEARL", "-", "0.026x", "0.07x", "0.18x"],
]
const PT_SUBTITLES := [
	"HIGH SYMBOLS    -    pays per way x total bet",
	"GEM SYMBOLS    -    pays per way x total bet",
	"SPECIAL SYMBOLS & FEATURES",
	"HOW IT PAYS",
]

## Cut-window opening as fractions of the frame art (measured from reel_frame.png alpha:
## central transparent run l,t,r,b). Window aspect ~1.324; the 6x5 grid is centred inside it.
const WIN_L := 0.1013
const WIN_T := 0.2288
const WIN_R := 0.8984
const WIN_B := 0.8858

const SPIN_SPEED := 3050.0
const REEL_STOP_STAGGER := 0.12
const ANTICIPATE_STAGGER := 0.60
const CASCADE_HOLD := 0.58
const CASCADE_CLEAR := 0.24
const CASCADE_DROP := 0.30

## Session-only animation pace. NORMAL is the tuned baseline; SLOW/FAST multiply every gameplay
## duration through dur(). Default NORMAL (index 1). No persistence is required.
const SPEED_SCALES := [1.5, 1.0, 0.55]
const SPEED_NAMES := ["SLOW", "NORMAL", "FAST"]

# ---- ocean palette ----
const AQUA_C := Color(0.36, 0.86, 1.0)
const TEAL := Color(0.12, 0.62, 0.66)
const GOLD := Color(1.0, 0.82, 0.38)
const CORAL := Color(1.0, 0.42, 0.36)
const SEAFOAM := Color(0.55, 1.0, 0.86)
const PEARL_C := Color(0.93, 0.97, 1.0)
const PANEL := Color(0.04, 0.13, 0.19, 0.9)
# Multiplier number drawn on the near-white pearl orb: a DARK fill so it reads on the bright pearl,
# with a warm-gold rim so it also pops when the number drifts off the orb onto the deep background.
const ORB_NUM := Color(0.04, 0.12, 0.22)
const ORB_NUM_OUT := Color(1.0, 0.86, 0.45)

# ---- live layout ----
var view := DESIGN
var portrait := true
var grid_pos := Vector2(120, 360)
var cell_w := 150.0
var cell_h := 150.0
var frame_pos := Vector2.ZERO
var frame_size := Vector2.ZERO
var win_pos := Vector2.ZERO
var win_size := Vector2.ZERO
var frame_aspect := 2991.0 / 2740.0

# ---- nodes ----
var board: Node2D
var bg_layer: CanvasLayer
var cur_bg: TextureRect
var grad_overlay: TextureRect
var bubbles: CPUParticles2D
var backplate: TextureRect
var frame_art: TextureRect
var fx_layer: Node2D
var hud: CanvasLayer
var word_layer: CanvasLayer
var kraken_layer: CanvasLayer

var textures := {}
var words := {}
var _add_mat: CanvasItemMaterial
var _radial_glow_tex: GradientTexture2D

# reel state
var reels := []
var spinning := false

# HUD
var logo: TextureRect
var pill_balance: TextureRect
var pill_bet: TextureRect
var pill_win: TextureRect
var lbl_balance: Label
var lbl_bet: Label
var lbl_win: Label
var lbl_msg: Label
var lbl_ways: Label
var banner: Label
var tide_orb: TextureRect
var lbl_tide: Label
var spin_btn: TextureButton
var lbl_spin: Label
var speed_btn
var bet_minus_btn
var bet_plus_btn
var maxbet_btn
var autoplay_btn
var settings_btn
var sound_btn
var info_btn
var menu_btn

# audio
var _audio := {}
var _spin_loop: AudioStreamPlayer
var _music: AudioStreamPlayer
var _music_fs: AudioStreamPlayer
var _audio_unlocked := false
var _sfx_on := true            # gates play()/spin-loop (SFX master, toggled from HUD + overlays)
var _music_on := true          # controls the music streams (separate from SFX)
var _fs_music := false          # which loop is "current": free-spins loop vs base loop

# session (from bridge)
var balance_minor := 0
var bet_minor := 1000
var min_bet := 50
var max_bet := 10000
var currency := "CREDIT"
var busy := false
var bridge = null
var _bet_cb = null
var _bal_timer: Timer

var _autospin := false
var _autospin_left := 0
var _speed_idx := 1            # index into SPEED_SCALES/SPEED_NAMES; 1 == NORMAL (default)
var speed_scale := 1.0         # multiplies every gameplay animation duration (see dur())
var _zoomed := false
var _t := 0.0
var _gen_orbs := false   # mock: include MULT_ORB in the symbol pool during free-spin generation

# ---- WIN display calibration (FIX A) ----
# outcome.totalWinBps is the ONLY authoritative win. Per-step stepWinBps are PRE-CALIBRATION (the
# server multiplies the base+free-spins slice by a hidden scalar before producing totalWinBps), so
# summing them overstates the win — we use them ONLY as relative weights. See _calibrated_win_bps().
var _raw_total := 0       # Σ all stepWinBps across base + free-spins cascades (display weights)
var _raw_so_far := 0      # Σ stepWinBps that have been presented so far this round
var _scaled_target := 0   # totalWinBps - bonus_award (the calibrated base+free-spins slice)
var _bonus_award := 0     # verbatim Kraken award (an exact, un-scaled portion of totalWinBps)
var _bonus_shown := 0     # 0 until the Kraken reveal, then == _bonus_award

var BET_STEPS := [50, 100, 250, 500, 1000, 2000, 5000, 10000]  # $0.05 .. $10.00

# ---- modal overlays (INFO / SETTINGS / MENU) — own high CanvasLayer above the HUD ----
var overlay_layer: CanvasLayer
var _overlay := ""                 # "" | "info" | "settings" | "menu" — only one open at a time
var _overlay_root: Control
var _overlay_panel: Control
var _overlay_scrim: ColorRect
var _pt_page := 0                  # paytable page index (persists across reopen)
var _pt_pages := []                # page Controls inside the paytable panel
var _pt_dots                       # PageDots indicator
var _pt_subtitle: Label
var _sfx_switch                    # live ToggleSwitch in the open panel (SFX) — synced on change
var _music_switch                  # live ToggleSwitch in the open panel (music)
var _speed_seg                     # live SegmentedControl in the open settings panel

func _ready() -> void:
	randomize()
	_apply_window_size()
	view = get_viewport().get_visible_rect().size
	_load_textures()
	_load_audio()

	bg_layer = CanvasLayer.new(); bg_layer.layer = -10; add_child(bg_layer)
	_build_bg()
	board = Node2D.new(); board.name = "Board"; add_child(board)
	fx_layer = Node2D.new(); fx_layer.name = "Fx"; fx_layer.z_index = 60; add_child(fx_layer)

	_build_reel_surfaces()
	_build_reels()
	_build_hud()
	_build_word_layer()
	_build_overlay_layer()
	_apply_layout()
	_idle_fill()
	_connect_bridge()
	set_process(true)
	set_process_input(true)
	get_viewport().size_changed.connect(_on_resize)

func _input(event: InputEvent) -> void:
	if _audio_unlocked:
		return
	if event is InputEventScreenTouch or event is InputEventMouseButton or event is InputEventKey:
		if event.is_pressed():
			_unlock_audio()

func _unlock_audio() -> void:
	if _audio_unlocked:
		return
	_audio_unlocked = true
	_start_music()

func _apply_window_size() -> void:
	if OS.has_feature("web"):
		return
	var sz := DESIGN
	var env := OS.get_environment("LV_SIZE")
	if env.find("x") > 0:
		var parts := env.split("x")
		sz = Vector2(float(parts[0]), float(parts[1]))
	get_window().size = sz

func _on_resize() -> void:
	var v := get_viewport().get_visible_rect().size
	if v.x < 1.0 or v.y < 1.0:
		return
	view = v
	_apply_layout()
	if _overlay != "":
		# rebuild the open overlay against the new viewport (preserves the paytable page; no anim)
		var which := _overlay
		_teardown_overlay()
		_overlay = ""
		_open_overlay(which, false)

# ----------------------------------------------------------------- layout
func _apply_layout() -> void:
	_layout_metrics()
	_position_all_reels()
	_layout_reel_surfaces()
	_layout_bg()
	_layout_hud()

## Fit the ornate frame honouring its native aspect, then place the 6x5 grid INSIDE the frame's
## cut window (the WIN_* fractions). The window fills ~the screen width so the reels stay large;
## only the gold border bleeds toward/off the screen edges. Cells are SQUARE and centred in the
## window with even margins (the window is wider than a 6:5 grid).
func _layout_metrics() -> void:
	var W := view.x
	var H := view.y
	portrait = H >= W
	var win_w_frac := WIN_R - WIN_L
	var max_fw := (W * 0.93 / win_w_frac) if portrait else (W * 0.60)
	var max_fh := H * (0.60 if portrait else 0.72)
	var fw := max_fw
	var fh := fw / frame_aspect
	if fh > max_fh:
		fh = max_fh
		fw = fh * frame_aspect
	var cy := H * (0.45 if portrait else 0.50)
	frame_pos = Vector2(W * 0.5 - fw * 0.5, cy - fh * 0.5)
	frame_size = Vector2(fw, fh)
	win_pos = Vector2(frame_pos.x + WIN_L * fw, frame_pos.y + WIN_T * fh)
	win_size = Vector2((WIN_R - WIN_L) * fw, (WIN_B - WIN_T) * fh)
	var pitch: float = min(win_size.x / COLS, win_size.y / ROWS)
	cell_w = pitch
	cell_h = pitch
	grid_pos = Vector2(
		win_pos.x + (win_size.x - pitch * COLS) * 0.5,
		win_pos.y + (win_size.y - pitch * ROWS) * 0.5,
	)

func _reel_x(col: int) -> float:
	return grid_pos.x + (col + 0.5) * cell_w

func _row_y(row: int) -> float:
	return grid_pos.y + (row + 0.5) * cell_h

func _grid_center() -> Vector2:
	return grid_pos + Vector2(cell_w * COLS, cell_h * ROWS) * 0.5

## Every gameplay animation duration passes through here so the SLOW/NORMAL/FAST control rescales
## the whole round at once. UI affordances (button taps, audio fades, idle breathing) deliberately
## stay unscaled so the interface always feels responsive.
func dur(base: float) -> float:
	return base * speed_scale

func _position_all_reels() -> void:
	if reels.is_empty():
		return
	var win_w := cell_w
	var win_h := cell_h * ROWS
	for col in COLS:
		var reel: Dictionary = reels[col]
		var window: Control = reel.window
		window.position = Vector2(_reel_x(col) - win_w * 0.5, grid_pos.y)
		window.size = Vector2(win_w, win_h)
		for idx in SPR:
			reel.sprites[idx].position.x = win_w * 0.5
		_position_reel(reel, false)

# ----------------------------------------------------------------- assets
func _load_textures() -> void:
	for id in SYMBOL_IDS:
		var p := "res://art/symbols/%s.png" % SYMBOL_FILE[id]
		if ResourceLoader.exists(p):
			textures[id] = load(p)
	for w in ["big_win", "mega_win", "epic_win", "free_spins", "kraken_awakens"]:
		var wp := "res://art/ui/word_%s.png" % w
		if ResourceLoader.exists(wp):
			words[w] = load(wp)
	var fr := "res://art/ui/reel_frame.png"
	if ResourceLoader.exists(fr):
		var f: Texture2D = load(fr)
		if f and f.get_height() > 0:
			frame_aspect = float(f.get_width()) / float(f.get_height())

func _sym_scale(tex: Texture2D) -> Vector2:
	if tex == null:
		return Vector2.ONE
	var target: float = min(cell_w, cell_h) * 0.92
	var s: float = target / float(tex.get_width())
	return Vector2(s, s)

func _additive_mat() -> CanvasItemMaterial:
	if _add_mat == null:
		_add_mat = CanvasItemMaterial.new()
		_add_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	return _add_mat

## Cached soft radial glow (white core -> transparent). Tinted via a sprite's modulate + additive
## blend; used for the red Kraken-eye takeover glow (FIX B). 128px so it scales up cleanly.
func _radial_glow() -> GradientTexture2D:
	if _radial_glow_tex == null:
		var g := Gradient.new()
		g.offsets = PackedFloat32Array([0.0, 0.45, 1.0])
		g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.5), Color(1, 1, 1, 0.0)])
		var tex := GradientTexture2D.new()
		tex.gradient = g
		tex.fill = GradientTexture2D.FILL_RADIAL
		tex.fill_from = Vector2(0.5, 0.5)
		tex.fill_to = Vector2(1.0, 0.5)
		tex.width = 128
		tex.height = 128
		_radial_glow_tex = tex
	return _radial_glow_tex

# ----------------------------------------------------------------- audio
func _cue_stream(name: String) -> AudioStream:
	for ext in [".ogg", ".wav"]:
		var p := "res://audio/cues/%s%s" % [name, ext]
		if ResourceLoader.exists(p):
			return load(p)
	return null

## All audio is referenced by name; missing cues are skipped so the build runs silent until the
## stems in audio/cues/README.md are dropped in. Mirrors the flaming-kirin audio wiring.
func _load_audio() -> void:
	for name in [
		"spin_start", "spin_press", "button_tap", "bet_change", "error_blip",
		"reel_land", "reel_land_b", "reel_land_c",
		"symbol_land", "wild_land", "scatter_land", "bonus_land", "orb_land",
		"cascade_pop", "tide_rise", "anticipation", "near_miss",
		"win_small", "win_medium", "win_big",
		"bigwin_fanfare", "megawin_fanfare", "epicwin_fanfare",
		"free_spins_intro", "kraken_awakens", "kraken_roar",
		"coin_shower", "coin_tick",
	]:
		var st := _cue_stream(name)
		if st == null: continue
		var pl := AudioStreamPlayer.new()
		pl.stream = st
		add_child(pl)
		_audio[name] = pl
	_spin_loop = _make_loop("spin_loop", -12.0)
	_music = _make_loop("music_base_loop", -11.0)
	_music_fs = _make_loop("music_freespins_loop", -11.0)

func _make_loop(name: String, db: float) -> AudioStreamPlayer:
	var st := _cue_stream(name)
	if st == null: return null
	if st is AudioStreamOggVorbis: st.loop = true
	elif st is AudioStreamWAV: st.loop_mode = AudioStreamWAV.LOOP_FORWARD
	var pl := AudioStreamPlayer.new()
	pl.stream = st; pl.volume_db = db
	add_child(pl)
	return pl

func play(name: String) -> void:
	if not _sfx_on: return
	var pl = _audio.get(name, null)
	if pl: pl.play()

func _spin_whir(on: bool) -> void:
	if _spin_loop == null: return
	if on and not _sfx_on: return
	var t := create_tween()
	if on:
		_spin_loop.volume_db = -30.0
		if not _spin_loop.playing: _spin_loop.play()
		t.tween_property(_spin_loop, "volume_db", -12.0, 0.18)
	else:
		t.tween_property(_spin_loop, "volume_db", -34.0, 0.28)
		t.tween_callback(_spin_loop.stop)

func _start_music() -> void:
	if _music and _music_on: _music.play()

func _duck_music(on: bool) -> void:
	if _music:
		_music.volume_db = -17.0 if on else -11.0

func _set_music_fs(on: bool) -> void:
	_fs_music = on
	if _music_fs == null: return
	if on:
		if _music_on: _music_fs.play()
		if _music: _music.stop()
	else:
		_music_fs.stop()
		if _music and _audio_unlocked and _music_on: _music.play()

## Settings/menu SFX toggle. Gates play()/the spin loop; already-playing one-shots are short so we
## only need to silence the looping whir immediately. Keeps the HUD speaker glyph + any open switch
## in sync so the three entry points never disagree.
func _set_sfx(on: bool) -> void:
	_sfx_on = on
	if not on and _spin_loop and _spin_loop.playing:
		_spin_loop.stop()
	if sound_btn:
		sound_btn.active = on
		sound_btn.queue_redraw()
	if _sfx_switch and is_instance_valid(_sfx_switch):
		_sfx_switch.apply(on, true)

## Settings MUSIC toggle — actually stops/starts the looping streams (the current loop is whichever
## the round selected via _set_music_fs). No bus muting so SFX is unaffected.
func _set_music(on: bool) -> void:
	_music_on = on
	if on:
		if _audio_unlocked:
			if _fs_music:
				if _music_fs: _music_fs.play()
			elif _music:
				_music.play()
	else:
		if _music: _music.stop()
		if _music_fs: _music_fs.stop()
	if _music_switch and is_instance_valid(_music_switch):
		_music_switch.apply(on, true)

# ----------------------------------------------------------------- background
func _build_bg() -> void:
	cur_bg = TextureRect.new()
	cur_bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	cur_bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	if ResourceLoader.exists("res://art/bg/bg_main.jpg"):
		cur_bg.texture = load("res://art/bg/bg_main.jpg")
	bg_layer.add_child(cur_bg)

	# rising bubble field for depth (slow, soft, additive) — the deep-ocean equivalent of embers.
	bubbles = CPUParticles2D.new()
	bubbles.amount = 56
	bubbles.lifetime = 6.0
	bubbles.preprocess = 4.0
	bubbles.direction = Vector2(0, -1)
	bubbles.gravity = Vector2(0, -22)
	bubbles.initial_velocity_min = 12.0
	bubbles.initial_velocity_max = 46.0
	bubbles.angular_velocity_min = -20.0
	bubbles.angular_velocity_max = 20.0
	bubbles.scale_amount_min = 2.0
	bubbles.scale_amount_max = 7.0
	bubbles.color = Color(0.6, 0.92, 1.0, 0.32)
	var ramp := Gradient.new()
	ramp.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	ramp.colors = PackedColorArray([Color(0.7, 0.95, 1.0, 0.0), Color(0.6, 0.92, 1.0, 0.42), Color(0.5, 0.85, 1.0, 0.0)])
	bubbles.color_ramp = ramp
	bubbles.material = _additive_mat()
	bg_layer.add_child(bubbles)

	grad_overlay = TextureRect.new()
	grad_overlay.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	grad_overlay.stretch_mode = TextureRect.STRETCH_SCALE
	grad_overlay.texture = _make_vertical_vignette()
	grad_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bg_layer.add_child(grad_overlay)

func _make_vertical_vignette() -> GradientTexture2D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.22, 0.62, 1.0])
	g.colors = PackedColorArray([
		Color(0.01, 0.03, 0.06, 0.74),
		Color(0.01, 0.03, 0.06, 0.04),
		Color(0.01, 0.03, 0.06, 0.12),
		Color(0.01, 0.02, 0.05, 0.86),
	])
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.fill_from = Vector2(0, 0)
	tex.fill_to = Vector2(0, 1)
	tex.width = 8
	tex.height = 256
	return tex

func _layout_bg() -> void:
	var over := 1.07
	if cur_bg:
		cur_bg.size = view * over
		cur_bg.position = -view * (over - 1.0) * 0.5
	if grad_overlay:
		grad_overlay.position = Vector2.ZERO
		grad_overlay.size = view
	if bubbles:
		bubbles.position = Vector2(view.x * 0.5, view.y + 20.0)
		bubbles.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
		bubbles.emission_rect_extents = Vector2(view.x * 0.5, 8.0)

# ----------------------------------------------------------------- reel surfaces
func _build_reel_surfaces() -> void:
	backplate = TextureRect.new()
	backplate.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	backplate.stretch_mode = TextureRect.STRETCH_SCALE
	backplate.mouse_filter = Control.MOUSE_FILTER_IGNORE
	backplate.z_index = 1
	if ResourceLoader.exists("res://art/ui/reel_backplate.png"):
		backplate.texture = load("res://art/ui/reel_backplate.png")
	board.add_child(backplate)

	frame_art = TextureRect.new()
	frame_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	frame_art.stretch_mode = TextureRect.STRETCH_SCALE
	frame_art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame_art.z_index = 40
	if ResourceLoader.exists("res://art/ui/reel_frame.png"):
		frame_art.texture = load("res://art/ui/reel_frame.png")
	board.add_child(frame_art)

func _layout_reel_surfaces() -> void:
	backplate.position = win_pos
	backplate.size = win_size
	frame_art.position = frame_pos
	frame_art.size = frame_size

func _build_reels() -> void:
	for col in COLS:
		var window := Control.new()
		window.clip_contents = true
		window.z_index = 10
		board.add_child(window)
		var sprites := []
		for idx in SPR:
			var sp := Sprite2D.new()
			sp.centered = true
			window.add_child(sp)
			sprites.append(sp)
		reels.append({
			"window": window, "sprites": sprites,
			"symbols": _fresh_strip(col),
			"scroll": 0.0, "state": "idle",
		})

func _fresh_strip(col: int) -> Array:
	var s := []
	for idx in SPR:
		s.append(_rand_sym(col))
	return s

func _paint_reels() -> void:
	for col in COLS:
		_position_reel(reels[col], false)

func _apply_symbol(sp: Sprite2D, id: String) -> void:
	var tex = textures.get(id, null)
	sp.texture = tex
	sp.modulate = Color(1, 1, 1, 1)
	sp.scale = _sym_scale(tex)

func _idle_fill() -> void:
	for col in COLS:
		reels[col].symbols = _fresh_strip(col)
	_paint_reels()

func _rand_sym(col: int) -> String:
	var pool := [
		"LEVIATHAN", "KRAKEN", "SIREN", "TRIDENT", "CHEST",
		"PEARL", "PEARL", "AQUA", "AQUA", "SAPPHIRE", "SAPPHIRE",
		"AMETHYST", "AMETHYST", "EMERALD", "EMERALD",
		"SCATTER", "BONUS",
	]
	if col != 0 and col != COLS - 1:
		pool.append("WILD")
	if _gen_orbs and col != 0 and col != COLS - 1:
		pool.append("MULT_ORB")
	return pool[randi() % pool.size()]

# ----------------------------------------------------------------- process
func _process(dt: float) -> void:
	_t += dt
	_drift_bg()
	if spinning:
		# Scroll velocity is routed through speed_scale (inversely): SLOW (1.5) scrolls slower and
		# FAST (0.55) scrolls faster, so the spin VISIBLY differs by speed — the stop staggers (via
		# dur()) already scale the duration, but without this the blur looked identical at SLOW/NORMAL.
		var scroll_v := SPIN_SPEED / speed_scale
		for col in COLS:
			var reel: Dictionary = reels[col]
			if reel.state != "spin": continue
			reel.scroll += scroll_v * dt
			while reel.scroll >= cell_h:
				reel.scroll -= cell_h
				reel.symbols.push_front(reel.symbols.pop_back())
				reel.symbols[0] = _rand_sym(col)
			_position_reel(reel, true)
	elif not busy:
		_breathe()

func _drift_bg() -> void:
	if cur_bg == null: return
	var over := 1.07
	var base := -view * (over - 1.0) * 0.5
	cur_bg.position = base + Vector2(sin(_t * 0.11) * 16.0, cos(_t * 0.09) * 12.0)

## Subtle idle "breathing" + bob on landed premium picture symbols → reads as living/dimensional.
func _breathe() -> void:
	for col in COLS:
		var reel: Dictionary = reels[col]
		if reel.state == "spin": continue
		for row in ROWS:
			var sp: Sprite2D = reel.sprites[row + 1]
			if sp.texture == null: continue
			var id: String = reel.symbols[row + 1]
			if not (id in HIGH): continue
			var base_s := _sym_scale(sp.texture)
			var k := 1.0 + 0.026 * sin(_t * 2.0 + col * 0.7 + row * 0.5)
			sp.scale = base_s * k
			sp.position.y = (row) * cell_h + cell_h * 0.5 + sin(_t * 1.4 + col * 0.9) * 2.0

func _position_reel(reel: Dictionary, blurred: bool) -> void:
	var sprites: Array = reel.sprites
	var syms: Array = reel.symbols
	for idx in SPR:
		_apply_symbol(sprites[idx], syms[idx])
		sprites[idx].position.y = (idx - 1) * cell_h + cell_h * 0.5 + reel.scroll
		if blurred and sprites[idx].texture:
			sprites[idx].scale = _sym_scale(sprites[idx].texture) * Vector2(0.96, 1.20)
			sprites[idx].modulate = Color(1, 1, 1, 0.92)

# ----------------------------------------------------------------- spin / round
func _begin_spin_visual() -> void:
	spinning = true
	for col in COLS:
		var st := _fresh_strip(col)
		reels[col].symbols = st
		reels[col].scroll = 0.0
		reels[col].state = "spin"
	_reset_dim()
	_spin_whir(true)

func request_spin() -> void:
	if busy or _overlay != "": return
	_unlock_audio()
	busy = true
	spin_btn.disabled = true
	lbl_win.text = ""
	lbl_ways.text = ""
	_tide_visible(false)
	_flash("")
	play("spin_start")
	_begin_spin_visual()
	if bridge != null:
		_bet_cb = JavaScriptBridge.create_callback(_on_bridge_result)
		bridge.placeBet(bet_minor, _bet_cb)
	else:
		await get_tree().create_timer(dur(0.9)).timeout
		_resolve(_mock_outcome())

func _on_bridge_result(args: Array) -> void:
	var raw: String = String(args[0]) if args.size() > 0 else ""
	var data = JSON.parse_string(raw)
	if typeof(data) != TYPE_DICTIONARY:
		_flash("Network error"); _force_stop(); return
	if data.has("error"):
		play("error_blip"); _flash(str(data.get("error"))); _force_stop(); return
	if data.has("balanceAfterMinor"):
		balance_minor = int(str(data.balanceAfterMinor))
	_resolve(data.get("outcome", {}))

func _resolve(outcome: Dictionary) -> void:
	var feel: Dictionary = outcome.get("feel", {})
	if typeof(feel) != TYPE_DICTIONARY: feel = {}
	var base: Dictionary = outcome.get("base", {})
	var cascades: Array = base.get("cascades", [])
	var first_grid: Array = (cascades[0].get("grid", []) if cascades.size() > 0 else [])

	await _stop_reels(first_grid, feel)
	_spin_whir(false)
	if _zoomed:
		_zoom_board(1.0, 0.3)

	# FIX A — drive the WIN from the authoritative outcome.totalWinBps. stepWinBps are pre-calibration
	# and used ONLY as relative weights: the WIN is the calibrated base+free-spins slice scaled in
	# proportionally as steps show, plus the verbatim Kraken award once revealed. Both terms only ever
	# grow, so the displayed WIN is monotonic non-decreasing and lands exactly on totalWinBps.
	var total := _num(outcome.get("totalWinBps", 0))
	var bonus_d = outcome.get("bonus", null)
	_bonus_award = _num(bonus_d.get("awardBps", 0)) if typeof(bonus_d) == TYPE_DICTIONARY else 0
	_scaled_target = maxi(0, total - _bonus_award)
	_raw_total = _sum_round_raw(outcome)
	_raw_so_far = 0
	_bonus_shown = 0

	await _present_cascades(base)
	if bonus_d != null:
		await _present_bonus(bonus_d)
	if outcome.get("freeSpins", null) != null:
		await _run_free_spins(outcome.freeSpins)

	var mult := _final_multiplier(outcome)
	if total > 0 and mult > 1:
		await _fly_multiply_to_win(mult, total)
	await _celebrate(str(feel.get("winTier", "NONE")), total)
	# Snap to the exact authoritative figure (guards against integer-rounding drift during the climb).
	if total > 0:
		_show_win_amount(total)

	_update_hud()
	busy = false
	spinning = false
	spin_btn.disabled = false
	_maybe_autospin()

## Stop the reels left->right with an eased, slightly-overshooting bounce. `feel.anticipation`
## drives the drumroll: once a reel index reaches a trigger symbol's `fromReel`, the remaining
## reels slow into suspense (longer stagger + zoom + tension cue). A `feel.nearMiss` plays the
## deflating sting after the reels settle.
func _stop_reels(grid: Array, feel: Dictionary) -> void:
	var anticipate_from := COLS + 1
	var antic_sym := ""
	for a in feel.get("anticipation", []):
		var fr = a.get("fromReel", null)
		if fr != null and int(fr) < anticipate_from:
			anticipate_from = int(fr)
			antic_sym = str(a.get("symbol", ""))
	var anticipating := false
	for col in COLS:
		if not anticipating and col >= anticipate_from:
			anticipating = true
			_enter_anticipation(antic_sym)
		var stagger := REEL_STOP_STAGGER
		if anticipating:
			stagger = ANTICIPATE_STAGGER
			play("anticipation")
		await get_tree().create_timer(dur(stagger)).timeout
		var final_col: Array = grid[col] if col < grid.size() else _rand_col(col)
		_land_reel(col, final_col)
		_play_stop(col)
		_reveal_specials(col, final_col)
	await get_tree().create_timer(dur(0.18)).timeout
	if not feel.get("nearMiss", []).is_empty():
		_near_miss_sting()

func _reveal_specials(col: int, column: Array) -> void:
	for row in min(column.size(), ROWS):
		var sym: String = column[row]
		if sym == SCATTER:
			play("scatter_land"); _pulse_cell(col, row); _glow_cell(col, row, sym, true)
		elif sym == BONUS:
			play("bonus_land"); _pulse_cell(col, row); _glow_cell(col, row, sym, true)
		elif sym == WILD:
			play("wild_land"); _wild_burst(col, row)
		elif sym == MULT_ORB:
			play("orb_land"); _glow_cell(col, row, sym, true)

func _rand_col(col: int) -> Array:
	var c := []
	for row in ROWS:
		c.append(_rand_sym(col))
	return c

func _enter_anticipation(sym: String) -> void:
	_zoom_board(1.06, 0.35)
	_flash("KRAKEN STIRS…" if sym == BONUS else "THE DEEP RISES…")
	_shake(3.0, 0.25)

## Suspense beat played mid-cascade when a BONUS is one symbol from awakening the Kraken and the
## next tumble could complete it. Zooms + teases, then settles so the drop reveals the outcome.
func _anticipate_bonus_drop() -> void:
	_enter_anticipation(BONUS)
	play("anticipation")
	await get_tree().create_timer(dur(0.7)).timeout
	if _zoomed:
		_zoom_board(1.0, dur(0.3))

func _near_miss_sting() -> void:
	play("near_miss")
	_flash("SO CLOSE…")
	var t := create_tween().set_trans(Tween.TRANS_SINE)
	t.tween_property(board, "scale", board.scale * 0.985, dur(0.12))
	t.tween_property(board, "scale", Vector2.ONE if not _zoomed else board.scale, dur(0.18))

func _zoom_board(factor: float, secs: float) -> void:
	_zoomed = factor != 1.0
	var center := _grid_center()
	var d := dur(secs)
	var t := create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	t.tween_property(board, "scale", Vector2(factor, factor), d)
	t.parallel().tween_property(board, "position", center * (1.0 - factor), d)

func _play_stop(col: int) -> void:
	var v := ["reel_land", "reel_land_b", "reel_land_c"]
	play(v[col % v.size()])

func _land_reel(col: int, column: Array) -> void:
	var reel: Dictionary = reels[col]
	reel.state = "stopped"
	var s := [_rand_sym(col)]
	for row in ROWS:
		s.append(column[row] if row < column.size() else _rand_sym(col))
	s.append(_rand_sym(col))
	reel.symbols = s
	reel.scroll = 0.0
	_position_reel(reel, false)
	# overshoot bounce: drop the whole window slightly above the rest position then settle.
	var win: Control = reel.window
	var base_y := grid_pos.y
	win.position.y = base_y - 18.0
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(win, "position:y", base_y, dur(0.26))
	# pop the freshly landed visible cells.
	for row in ROWS:
		var sp: Sprite2D = reel.sprites[row + 1]
		if sp.texture == null: continue
		var bs := _sym_scale(sp.texture)
		sp.scale = bs * 0.82
		var pt := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		pt.tween_property(sp, "scale", bs, dur(0.22))

func _force_stop() -> void:
	for col in COLS:
		reels[col].state = "stopped"
		reels[col].scroll = 0.0
		_position_reel(reels[col], false)
	if _zoomed:
		_zoom_board(1.0, 0.2)
	spinning = false
	busy = false
	spin_btn.disabled = false
	_spin_whir(false)
	_autospin = false
	_autospin_left = 0
	_update_autospin_visual()

# ----------------------------------------------------------------- cascades
## Render every tumble step: highlight winners, clear them, drop the next grid in, repeat. The
## grid for cascades[i] is already on screen (reel-stop for i=0, the previous tumble otherwise).
func _present_cascades(spin: Dictionary) -> void:
	var cascades: Array = spin.get("cascades", [])
	for i in cascades.size():
		var step: Dictionary = cascades[i]
		var wins: Array = step.get("wins", [])
		if wins.is_empty():
			continue
		await _highlight_step(step)
		_raw_so_far += _num(step.get("stepWinBps", 0))
		_show_win_amount(_calibrated_win_bps())
		if i + 1 < cascades.size():
			# Bonus drop-in anticipation: with exactly 2 BONUS already on the board, the next
			# tumble could complete the 3-BONUS Kraken trigger — build suspense before it drops.
			if _count(step.get("grid", []), BONUS) == BONUS_TRIGGER - 1:
				await _anticipate_bonus_drop()
			await _tumble_to(cascades[i + 1].get("grid", []), step)
		else:
			_reset_dim()

func _highlight_step(step: Dictionary) -> void:
	var cells := _win_cells(step)
	var mult := _num(step.get("multiplier", 1))
	for col in COLS:
		for row in ROWS:
			reels[col].sprites[row + 1].modulate = Color(1, 1, 1, 0.30)
	var any_high := false
	var top_ways := 0
	var top_sym := ""
	for w in step.get("wins", []):
		if _num(w.get("ways", 0)) >= top_ways:
			top_ways = _num(w.get("ways", 0)); top_sym = str(w.get("symbol", ""))
	for key in cells.keys():
		var parts: Array = key.split(":")
		var col := int(parts[0]); var row := int(parts[1])
		if col < 0 or col >= COLS or row < 0 or row >= ROWS: continue
		var sp: Sprite2D = reels[col].sprites[row + 1]
		sp.modulate = Color(1, 1, 1, 1)
		var bs := _sym_scale(sp.texture)
		var t := create_tween().set_loops(2).set_trans(Tween.TRANS_SINE)
		t.tween_property(sp, "scale", bs * 1.16, dur(0.16))
		t.tween_property(sp, "scale", bs, dur(0.16))
		var sym: String = cells[key]
		if sym in HIGH: any_high = true
		_glow_cell(col, row, sym, sym in HIGH)
	if top_ways > 0:
		lbl_ways.text = "%d WAYS  %s" % [top_ways, top_sym]
		_pulse(lbl_ways)
	if mult > 1:
		_show_cascade_mult(mult)
	play("win_big" if any_high else "win_medium")
	play("cascade_pop")
	await get_tree().create_timer(dur(CASCADE_HOLD)).timeout

func _tumble_to(next_grid: Array, step: Dictionary) -> void:
	var cleared := _win_cells(step)
	for key in cleared.keys():
		var parts: Array = key.split(":")
		_explode_cell(int(parts[0]), int(parts[1]))
	play("cascade_pop")
	await get_tree().create_timer(dur(CASCADE_CLEAR)).timeout
	var longest := 0.0
	for col in COLS:
		var col_syms: Array = next_grid[col] if col < next_grid.size() else _rand_col(col)
		longest = max(longest, _drop_column(col, col_syms))
	await get_tree().create_timer(longest + 0.04).timeout
	_reset_dim()

## Whole-column re-drop tumble: after the winners burst, the column refills from the top. The next
## grid is server-authoritative, so re-dropping the entire column (survivors included) is robust
## against the exact survivor mapping and reads as a satisfying cascade. Bottom rows land first.
func _drop_column(col: int, col_syms: Array) -> float:
	var reel: Dictionary = reels[col]
	var s := [_rand_sym(col)]
	for row in ROWS:
		s.append(col_syms[row] if row < col_syms.size() else _rand_sym(col))
	s.append(_rand_sym(col))
	reel.symbols = s
	reel.scroll = 0.0
	reel.state = "stopped"
	var longest := 0.0
	for idx in SPR:
		var sp: Sprite2D = reel.sprites[idx]
		_apply_symbol(sp, s[idx])
		var final_y := (idx - 1) * cell_h + cell_h * 0.5
		if idx >= 1 and idx <= ROWS:
			var row := idx - 1
			var bs := _sym_scale(sp.texture)
			sp.position.y = final_y - cell_h * (ROWS - row + 0.8)
			sp.scale = bs * 0.84
			var delay := dur((ROWS - 1 - row) * 0.045)
			var drop := dur(CASCADE_DROP)
			var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
			t.tween_interval(delay)
			t.tween_property(sp, "position:y", final_y, drop)
			t.parallel().tween_property(sp, "scale", bs, drop)
			longest = max(longest, delay + drop)
		else:
			sp.position.y = final_y
	play("symbol_land")
	return longest

func _explode_cell(col: int, row: int) -> void:
	if col < 0 or col >= COLS or row < 0 or row >= ROWS: return
	var sp: Sprite2D = reels[col].sprites[row + 1]
	if sp.texture:
		var bs := _sym_scale(sp.texture)
		var t := create_tween().set_trans(Tween.TRANS_SINE)
		t.tween_property(sp, "scale", bs * 1.34, dur(0.16))
		t.parallel().tween_property(sp, "modulate:a", 0.0, dur(0.18))
	var burst := CPUParticles2D.new()
	burst.position = _cell_world(col, row)
	burst.z_index = 58
	burst.one_shot = true
	burst.explosiveness = 0.92
	burst.amount = 18
	burst.lifetime = 0.6
	burst.direction = Vector2(0, -1)
	burst.spread = 180.0
	burst.gravity = Vector2(0, -30)
	burst.initial_velocity_min = 50.0
	burst.initial_velocity_max = 170.0
	burst.scale_amount_min = 2.0
	burst.scale_amount_max = 6.0
	burst.color = Color(0.6, 0.95, 1.0, 0.85)
	burst.material = _additive_mat()
	fx_layer.add_child(burst)
	burst.emitting = true
	get_tree().create_timer(1.0).timeout.connect(burst.queue_free)

func _win_cells(step: Dictionary) -> Dictionary:
	var cells := {}
	for w in step.get("wins", []):
		var sym: String = str(w.get("symbol", ""))
		for c in w.get("cells", []):
			if typeof(c) == TYPE_ARRAY and c.size() >= 2:
				cells["%d:%d" % [int(c[0]), int(c[1])]] = sym
	return cells

func _show_cascade_mult(mult: int) -> void:
	lbl_tide.visible = true
	lbl_tide.text = "x%d" % mult
	_set_tide_icon(true)
	_pulse(lbl_tide)
	_pulse(tide_orb)

# ----------------------------------------------------------------- win present
func _reset_dim() -> void:
	for col in COLS:
		for sp in reels[col].sprites:
			sp.modulate = Color(1, 1, 1, 1)

func _wild_burst(col: int, row: int) -> void:
	var burst := CPUParticles2D.new()
	burst.position = _cell_world(col, row)
	burst.z_index = 58
	burst.one_shot = true
	burst.explosiveness = 0.9
	burst.amount = 22
	burst.lifetime = 0.7
	burst.direction = Vector2(0, -1)
	burst.spread = 180.0
	burst.gravity = Vector2(0, -36)
	burst.initial_velocity_min = 60.0
	burst.initial_velocity_max = 200.0
	burst.scale_amount_min = 2.0
	burst.scale_amount_max = 7.0
	burst.color = Color(0.45, 1.0, 0.9, 0.9)
	burst.material = _additive_mat()
	fx_layer.add_child(burst)
	burst.emitting = true
	get_tree().create_timer(1.2).timeout.connect(burst.queue_free)
	_glow_cell(col, row, WILD, true)
	_shake(2.4, 0.16)

func _pulse_cell(col: int, row: int) -> void:
	var sp: Sprite2D = reels[col].sprites[row + 1]
	if sp.texture == null: return
	var bs := _sym_scale(sp.texture)
	var t := create_tween().set_loops(2).set_trans(Tween.TRANS_SINE)
	t.tween_property(sp, "scale", bs * 1.20, dur(0.16))
	t.tween_property(sp, "scale", bs, dur(0.16))

func _cell_world(col: int, row: int) -> Vector2:
	return board.position + Vector2(_reel_x(col), _row_y(row)) * board.scale.x

func _glow_color(sym: String) -> Color:
	if sym == BONUS: return CORAL
	if sym == SCATTER: return AQUA_C
	if sym == MULT_ORB: return SEAFOAM
	if sym in HIGH: return GOLD
	return AQUA_C

func _glow_cell(col: int, row: int, sym: String, strong: bool) -> void:
	var tex = textures.get(sym, null)
	if tex == null: return
	var bs := _sym_scale(tex) * board.scale.x
	var g := Sprite2D.new()
	g.texture = tex
	g.centered = true
	g.position = _cell_world(col, row)
	g.scale = bs * 1.02
	var tint := _glow_color(sym)
	g.modulate = Color(tint.r, tint.g, tint.b, 0.0)
	g.material = _additive_mat()
	g.z_index = 55
	fx_layer.add_child(g)
	var peak := 0.85 if strong else 0.5
	var grow := 1.36 if strong else 1.2
	var t := create_tween().set_trans(Tween.TRANS_SINE)
	t.tween_property(g, "modulate:a", peak, dur(0.18))
	t.parallel().tween_property(g, "scale", bs * grow, dur(0.18))
	t.tween_property(g, "modulate:a", 0.0, dur(0.55))
	t.tween_callback(g.queue_free)

func _celebrate(tier: String, total_bps: int) -> void:
	match tier:
		"NICE":
			play("win_small")
		"BIG":
			play("bigwin_fanfare"); _shake(7.0, 0.45); _coin_shower(1)
			await _show_word("big_win", 1.3)
		"MEGA":
			play("megawin_fanfare"); _shake(12.0, 0.65); _coin_shower(2)
			await _show_word("mega_win", 1.7)
		"EPIC", "JACKPOT":
			play("epicwin_fanfare"); _shake(16.0, 0.9); _coin_shower(3)
			_zoom_pulse()
			await _show_word("epic_win", 2.1)
		_:
			pass

func _zoom_pulse() -> void:
	var center := _grid_center()
	var t := create_tween().set_trans(Tween.TRANS_SINE)
	t.tween_property(board, "scale", Vector2(1.05, 1.05), dur(0.18))
	t.parallel().tween_property(board, "position", center * (1.0 - 1.05), dur(0.18))
	t.tween_property(board, "scale", Vector2.ONE, dur(0.3))
	t.parallel().tween_property(board, "position", Vector2.ZERO, dur(0.3))

func _coin_shower(intensity: int) -> void:
	play("coin_shower")
	var p := CPUParticles2D.new()
	p.z_index = 70
	p.one_shot = true
	p.explosiveness = 0.35
	p.amount = 40 * intensity
	p.lifetime = 1.6
	p.direction = Vector2(0, 1)
	p.spread = 28.0
	p.gravity = Vector2(0, 620.0)
	p.initial_velocity_min = 120.0
	p.initial_velocity_max = 420.0
	p.angular_velocity_min = -220.0
	p.angular_velocity_max = 220.0
	p.scale_amount_min = 4.0
	p.scale_amount_max = 9.0
	p.color = GOLD
	fx_layer.add_child(p)
	p.position = Vector2(view.x * 0.5, -20.0)
	p.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	p.emission_rect_extents = Vector2(view.x * 0.5, 8.0)
	p.emitting = true
	get_tree().create_timer(2.6).timeout.connect(p.queue_free)

func _show_word(key: String, hold: float) -> void:
	var tex = words.get(key, null)
	var w := TextureRect.new()
	w.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	w.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	w.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if tex: w.texture = tex
	var ww := view.x * 0.82
	var wh := view.y * 0.20
	w.size = Vector2(ww, wh)
	w.position = Vector2(view.x * 0.5 - ww * 0.5, view.y * 0.30)
	w.pivot_offset = Vector2(ww * 0.5, wh * 0.5)
	w.modulate = Color(1, 1, 1, 0)
	w.scale = Vector2(0.6, 0.6)
	word_layer.add_child(w)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(w, "modulate", Color(1, 1, 1, 1), dur(0.28))
	t.parallel().tween_property(w, "scale", Vector2(1, 1), dur(0.36))
	if hold > 0.0:
		await get_tree().create_timer(dur(hold)).timeout
		var ft := create_tween()
		ft.tween_property(w, "modulate", Color(1, 1, 1, 0), dur(0.4))
		ft.parallel().tween_property(w, "scale", Vector2(1.12, 1.12), dur(0.4))
		ft.tween_callback(w.queue_free)
	else:
		get_tree().create_timer(dur(2.4)).timeout.connect(w.queue_free)

func _show_banner(text: String) -> void:
	banner.text = text
	banner.visible = true
	banner.modulate = Color(1, 1, 1, 0)
	banner.scale = Vector2(0.6, 0.6)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(banner, "modulate", Color(1, 1, 1, 1), dur(0.25))
	t.parallel().tween_property(banner, "scale", Vector2(1, 1), dur(0.35))
	t.tween_interval(dur(1.0))
	t.tween_property(banner, "modulate", Color(1, 1, 1, 0), dur(0.4))
	t.tween_callback(func(): banner.visible = false)

func _shake(mag: float, secs: float) -> void:
	var origin := board.position
	var steps := int(secs / 0.04)
	var t := create_tween()
	for i in steps:
		var m := mag * (1.0 - float(i) / float(max(1, steps)))
		t.tween_property(board, "position", origin + Vector2(randf_range(-m, m), randf_range(-m, m)), dur(0.04))
	t.tween_property(board, "position", origin, dur(0.06))

## The authoritative WIN to display right now (FIX A): the calibrated base+free-spins slice scaled
## in by the fraction of step weight already shown, plus the verbatim Kraken award once revealed.
## Monotonic non-decreasing (both terms only ever grow); equals totalWinBps once every step has shown
## (_raw_so_far == _raw_total) and the bonus is in (round(scaled_target*1) + bonus_award == total).
func _calibrated_win_bps() -> int:
	return int(round(float(_scaled_target) * float(_raw_so_far) / float(maxi(_raw_total, 1)))) + _bonus_shown

func _sum_step_bps(spin: Dictionary) -> int:
	var s := 0
	for step in spin.get("cascades", []):
		s += _num(step.get("stepWinBps", 0))
	return s

func _sum_round_raw(outcome: Dictionary) -> int:
	var total := _sum_step_bps(outcome.get("base", {}))
	var fs = outcome.get("freeSpins", null)
	if typeof(fs) == TYPE_DICTIONARY:
		for sp in fs.get("spins", []):
			total += _sum_step_bps(sp)
	return total

func _show_win_amount(total_bps: int) -> void:
	var credits := float(total_bps) / 10000.0 * float(bet_minor) / 1000.0
	if credits <= 0:
		lbl_win.text = ""
		return
	play("coin_tick")
	lbl_win.text = _fmt(credits)
	lbl_win.pivot_offset = lbl_win.size * 0.5
	lbl_win.scale = Vector2(1.26, 1.26)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(lbl_win, "scale", Vector2(1.0, 1.0), dur(0.24))

## The dominant multiplier the player should see "applied" at the end of a round: the free-spins
## end tide if the feature ran, otherwise the top base-cascade multiplier.
func _final_multiplier(outcome: Dictionary) -> int:
	var fs = outcome.get("freeSpins", null)
	if typeof(fs) == TYPE_DICTIONARY:
		return maxi(1, _num(fs.get("endTide", 1)))
	var base: Dictionary = outcome.get("base", {})
	var m := 1
	for step in base.get("cascades", []):
		m = maxi(m, _num(step.get("multiplier", 1)))
	return m

## PRESENTATION ONLY — a cosmetic "delivering the multiplier" beat (FIX A): a multiplier orb (with
## its xN) flies from the tide cluster into the WIN and the WIN pulses on arrival. By the time this
## runs the WIN already reads the authoritative total (the proportional climb landed on it), so this
## NEVER touches the number — it is pure flourish and can only ever celebrate, not lower, the figure.
func _fly_multiply_to_win(mult: int, _total_bps: int) -> void:
	var fsz: float = maxf(tide_orb.size.x, 76.0)
	var start := tide_orb.position + tide_orb.size * 0.5
	var dest := lbl_win.position + lbl_win.size * 0.5
	var fly := TextureRect.new()
	fly.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	fly.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	fly.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fly.texture = tide_orb.texture
	fly.size = Vector2(fsz, fsz)
	fly.pivot_offset = Vector2(fsz, fsz) * 0.5
	fly.position = start - Vector2(fsz, fsz) * 0.5
	fly.z_index = 25
	hud.add_child(fly)
	var num := _styled_label(int(fsz * 0.5), ORB_NUM)
	num.add_theme_color_override("font_outline_color", ORB_NUM_OUT)
	num.add_theme_constant_override("outline_size", maxi(6, int(fsz * 0.07)))
	num.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	num.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	num.mouse_filter = Control.MOUSE_FILTER_IGNORE
	num.text = "x%d" % mult
	num.size = Vector2(fsz, fsz)
	fly.add_child(num)
	play("tide_rise")
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(fly, "scale", Vector2(1.3, 1.3), dur(0.16))
	t.chain().tween_property(fly, "position", dest - Vector2(fsz, fsz) * 0.5, dur(0.26)).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
	t.parallel().tween_property(fly, "scale", Vector2(0.45, 0.45), dur(0.26))
	t.parallel().tween_property(fly, "modulate:a", 0.0, dur(0.26))
	await t.finished
	fly.queue_free()
	_pulse(lbl_win)

## Count the WIN label from one bps figure to another over a short eased tween, then snap-pop the
## authoritative value. Keeps the displayed money exact at the end regardless of tween rounding.
func _count_up_win(from_bps: int, to_bps: int) -> void:
	if to_bps <= from_bps:
		_show_win_amount(to_bps)
		return
	play("coin_tick")
	var t := create_tween().set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	t.tween_method(_set_win_bps, float(from_bps), float(to_bps), dur(0.55))
	await t.finished
	_show_win_amount(to_bps)

func _set_win_bps(bps: float) -> void:
	lbl_win.text = _fmt(bps / 10000.0 * float(bet_minor) / 1000.0)

# --------------------------------------------------------------- free spins
## Free spins: a sequence of tumbling spins under a PERSISTENT rising tide. The tide only ever
## climbs; MULT_ORB landings + the per-spin cascade multipliers drive the displayed value, which
## ends on freeSpins.endTide. The mult-orb art + a code-drawn "x N" number front the feature.
func _run_free_spins(fs: Dictionary) -> void:
	_duck_music(true)
	play("free_spins_intro")
	await _show_word("free_spins", 1.6)
	_set_music_fs(true)
	var spins: Array = fs.get("spins", [])
	var tide := _num(fs.get("startTide", 1))
	_tide_visible(true)
	_set_tide(tide)
	for i in spins.size():
		var sp: Dictionary = spins[i]
		_flash("FREE SPIN  %d / %d" % [i + 1, spins.size()])
		_begin_spin_visual()
		await get_tree().create_timer(dur(0.35)).timeout
		var grid0: Array = (sp.get("cascades", [{}])[0].get("grid", []) if sp.get("cascades", []).size() > 0 else [])
		await _stop_reels(grid0, {})
		_spin_whir(false)
		var target := max(tide, _spin_max_mult(sp))
		if i == spins.size() - 1:
			target = max(target, _num(fs.get("endTide", target)))
		await _raise_tide(grid0, tide, target)
		tide = target
		await _present_cascades(sp)
		await get_tree().create_timer(dur(0.12)).timeout
	_flash("FREE SPINS COMPLETE")
	await get_tree().create_timer(dur(0.6)).timeout
	_tide_visible(false)
	_set_music_fs(false)
	_duck_music(false)
	_flash("")

func _spin_max_mult(sp: Dictionary) -> int:
	var m := 1
	for step in sp.get("cascades", []):
		m = max(m, _num(step.get("multiplier", 1)))
	return m

## Pop every MULT_ORB on the just-landed grid with a code-drawn "+N" and ramp the tide display
## from `from_tide` up to `to_tide`. The orbs share the increment (presentation-only; the money
## figure is still the server's totalWinBps).
func _raise_tide(grid: Array, from_tide: int, to_tide: int) -> void:
	var orb_cells := []
	for col in min(grid.size(), COLS):
		var column: Array = grid[col]
		for row in min(column.size(), ROWS):
			if column[row] == MULT_ORB:
				orb_cells.append([col, row])
	var inc := to_tide - from_tide
	if orb_cells.size() > 0 and inc > 0:
		var per := max(1, int(round(float(inc) / float(orb_cells.size()))))
		for c in orb_cells:
			_orb_popup(c[0], c[1], per)
		play("tide_rise")
	if inc <= 0:
		_set_tide(to_tide)
		return
	# ramp the displayed tide number for a satisfying climb.
	var steps := min(inc, 12)
	for s in range(1, steps + 1):
		var v := from_tide + int(round(float(inc) * float(s) / float(steps)))
		_set_tide(v)
		await get_tree().create_timer(dur(0.06)).timeout
	_set_tide(to_tide)

func _orb_popup(col: int, row: int, amount: int) -> void:
	_glow_cell(col, row, MULT_ORB, true)
	# the "+N" rises off the white pearl orb, so it's dark with a gold rim for contrast (item 5).
	var lbl := _styled_label(int(cell_h * 0.34), ORB_NUM)
	lbl.add_theme_color_override("font_outline_color", ORB_NUM_OUT)
	lbl.add_theme_constant_override("outline_size", maxi(7, int(cell_h * 0.07)))
	lbl.text = "+%d" % amount
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl.z_index = 62
	lbl.size = Vector2(cell_w, cell_h * 0.5)
	lbl.position = _cell_world(col, row) - Vector2(cell_w * 0.5, cell_h * 0.5)
	lbl.pivot_offset = Vector2(cell_w * 0.5, cell_h * 0.25)
	fx_layer.add_child(lbl)
	lbl.scale = Vector2(0.6, 0.6)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(lbl, "scale", Vector2(1.15, 1.15), dur(0.2))
	t.tween_property(lbl, "position:y", lbl.position.y - cell_h * 0.7, dur(0.6))
	t.parallel().tween_property(lbl, "modulate:a", 0.0, dur(0.6))
	t.tween_callback(lbl.queue_free)

func _tide_visible(on: bool) -> void:
	tide_orb.visible = on
	lbl_tide.visible = on

func _set_tide(value: int) -> void:
	# compact "xN" reads cleanly on the small orb cluster under the WIN pill (the orb gives context).
	lbl_tide.text = "x%d" % value
	_set_tide_icon(true)
	_pulse(lbl_tide)
	_pulse(tide_orb)

func _set_tide_icon(on: bool) -> void:
	tide_orb.visible = on

# --------------------------------------------------------------- kraken awakens
## Kraken Awakens — a full-screen BIG-WIN takeover decided server-side from the BONUS count (3..6).
## The fixed prize (awardBps: 20x/75x/300x/1000x) is the VERBATIM, un-scaled portion of totalWinBps,
## so the WIN counts UP by exactly it (FIX A). The cinematic (FIX B): a pulsing red kraken-eye glow
## at the frame's top-centre, the KRAKEN AWAKENS title pop, a redder/darker background + backplate
## hue shift, and a dramatic cue — all of which revert cleanly so the next spin looks normal.
func _present_bonus(bonus: Dictionary) -> void:
	_duck_music(true)
	play("kraken_awakens")
	var count := _num(bonus.get("krakenCount", 3))
	var award := _num(bonus.get("awardBps", 0))

	# (FIX B) shift the deep background + reel backplate toward a redder, darker tone for the takeover.
	var bg_was := cur_bg.modulate
	var bp_was := backplate.modulate
	var red_tint := Color(1.0, 0.55, 0.5) * 0.85
	var ht := create_tween().set_trans(Tween.TRANS_SINE)
	ht.tween_property(cur_bg, "modulate", red_tint, dur(0.5))
	ht.parallel().tween_property(backplate, "modulate", red_tint, dur(0.5))

	var dim := ColorRect.new()
	dim.color = Color(0.06, 0.01, 0.02, 0.0)   # red-black dim to match the Kraken takeover
	dim.size = view
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	kraken_layer.add_child(dim)
	var dt := create_tween()
	dt.tween_property(dim, "color", Color(0.06, 0.01, 0.02, 0.82), dur(0.4))

	# (FIX B) red kraken-eye glow at the frame's top-centre (where reel_frame's eye/trident motif is).
	# It lives on kraken_layer ABOVE the dim so it reads as the eye lighting up through the darkness,
	# and is positioned in screen space mirroring _cell_world() so it stays glued to the frame.
	var eye := Sprite2D.new()
	eye.texture = _radial_glow()
	eye.centered = true
	eye.material = _additive_mat()
	eye.z_index = 1
	eye.position = board.position + Vector2(frame_pos.x + frame_size.x * 0.5, frame_pos.y + frame_size.y * 0.12) * board.scale.x
	var eye_d: float = frame_size.x * 0.42 * board.scale.x
	var eye_base := Vector2(eye_d, eye_d) / float(_radial_glow().width)
	eye.scale = eye_base
	eye.modulate = Color(1.0, 0.12, 0.08, 0.0)
	kraken_layer.add_child(eye)
	create_tween().set_trans(Tween.TRANS_SINE).tween_property(eye, "modulate:a", 0.95, dur(0.35))
	var eye_pulse := create_tween().set_loops().set_trans(Tween.TRANS_SINE)
	eye_pulse.tween_property(eye, "scale", eye_base * 1.22, dur(0.45))
	eye_pulse.tween_property(eye, "scale", eye_base, dur(0.45))

	var kr := Sprite2D.new()
	var ktex = textures.get("KRAKEN", null)
	if ktex: kr.texture = ktex
	kr.centered = true
	kr.z_index = 2
	var ks: float = view.x * 0.9 / float(ktex.get_width()) if ktex else 1.0
	kr.scale = Vector2(ks, ks) * 0.4
	kr.position = Vector2(view.x * 0.5, view.y * 1.2)
	kr.modulate = Color(1, 1, 1, 0)
	kraken_layer.add_child(kr)
	var rt := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	rt.tween_property(kr, "position:y", view.y * 0.42, dur(0.6))
	rt.parallel().tween_property(kr, "scale", Vector2(ks, ks), dur(0.6))
	rt.parallel().tween_property(kr, "modulate", Color(1, 1, 1, 1), dur(0.4))

	await _show_word("kraken_awakens", 0.0)
	play("kraken_roar")
	_shake(12.0, 0.7)
	_flash("%d KRAKEN AMULETS" % count)
	# slow tentacle wiggle while the prize builds.
	var wt := create_tween().set_loops(3).set_trans(Tween.TRANS_SINE)
	wt.tween_property(kr, "rotation", 0.04, dur(0.5))
	wt.tween_property(kr, "rotation", -0.04, dur(0.5))
	await get_tree().create_timer(dur(1.6)).timeout

	# (FIX A) reveal the verbatim award: count the WIN up by exactly the Kraken prize. _bonus_shown
	# only ever goes 0 -> award, so the WIN climbs and stays monotonic.
	var before := _calibrated_win_bps()
	_bonus_shown += award
	var after := _calibrated_win_bps()
	_show_banner("+ %s" % _fmt(float(award) / 10000.0 * float(bet_minor) / 1000.0))
	await _count_up_win(before, after)
	await get_tree().create_timer(dur(1.2)).timeout

	# (FIX B) revert everything so a normal spin afterward looks normal: kill the eye pulse and fade
	# the glow, restore the bg/backplate hue, lift the dim and retract the kraken.
	eye_pulse.kill()
	var out := create_tween()
	out.tween_property(kr, "modulate", Color(1, 1, 1, 0), dur(0.4))
	out.parallel().tween_property(kr, "position:y", view.y * 1.2, dur(0.5))
	out.parallel().tween_property(dim, "color", Color(0.06, 0.01, 0.02, 0.0), dur(0.5))
	out.parallel().tween_property(eye, "modulate:a", 0.0, dur(0.4))
	out.parallel().tween_property(cur_bg, "modulate", bg_was, dur(0.5))
	out.parallel().tween_property(backplate, "modulate", bp_was, dur(0.5))
	out.tween_callback(kr.queue_free)
	out.tween_callback(dim.queue_free)
	out.tween_callback(eye.queue_free)
	await get_tree().create_timer(dur(0.5)).timeout
	_duck_music(false)

func _pulse(node: CanvasItem) -> void:
	if node == null: return
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	node.scale = Vector2(1.32, 1.32)
	t.tween_property(node, "scale", Vector2(1, 1), dur(0.3))

# ------------------------------------------------------------------------ HUD
func _styled_label(size: int, color: Color) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("outline_size", 6)
	return l

## Big, centred, "bold" readout label for a value sitting inside a pill. No bold font is bundled,
## so weight is faked with a heavy dark outline (outline_size) on top of a larger font_size — that
## reads clearly over the teal pill inset. Centred on both axes so layout can size it to the inset.
func _readout_label(size: int, color: Color) -> Label:
	var l := _styled_label(size, color)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.add_theme_constant_override("outline_size", 12)
	return l

## Position a value label over a pill's LOWER inset (the pill art bakes its caption — BALANCE /
## BET / WIN — into the top ~30%, leaving a recessed value box below). Centred in that box so the
## number reads dead-centre of the readout regardless of pill size.
func _place_value(lbl: Label, pill: TextureRect, font_size: int) -> void:
	var p := pill.position
	var s := pill.size
	_place_lbl(lbl, Vector2(p.x, p.y + s.y * 0.30), Vector2(s.x, s.y * 0.58))
	_set_font(lbl, font_size)
	# fake-bold weight scales with the font so the small bet pill doesn't get a blobby outline.
	lbl.add_theme_constant_override("outline_size", max(6, int(round(font_size * 0.16))))

func _pill(path: String) -> TextureRect:
	var r := TextureRect.new()
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if ResourceLoader.exists(path):
		r.texture = load(path)
	hud.add_child(r)
	return r

func _build_hud() -> void:
	hud = CanvasLayer.new(); hud.layer = 30; add_child(hud)

	logo = TextureRect.new()
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if ResourceLoader.exists("res://art/ui/title_logo.png"):
		logo.texture = load("res://art/ui/title_logo.png")
	hud.add_child(logo)

	pill_balance = _pill("res://art/ui/pill_balance.png")
	pill_bet = _pill("res://art/ui/pill_bet.png")
	pill_win = _pill("res://art/ui/pill_win.png")

	tide_orb = TextureRect.new()
	tide_orb.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tide_orb.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tide_orb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if ResourceLoader.exists("res://art/symbols/sym_mult_orb.png"):
		tide_orb.texture = load("res://art/symbols/sym_mult_orb.png")
	tide_orb.visible = false
	hud.add_child(tide_orb)

	# the multiplier number sits ON the white pearl orb, so it's drawn dark with a gold rim (item 5).
	lbl_tide = _styled_label(46, ORB_NUM)
	lbl_tide.add_theme_color_override("font_outline_color", ORB_NUM_OUT)
	lbl_tide.add_theme_constant_override("outline_size", 10)
	lbl_tide.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl_tide.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lbl_tide.visible = false
	hud.add_child(lbl_tide)

	lbl_msg = _styled_label(34, AQUA_C)
	lbl_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_msg)

	lbl_ways = _styled_label(30, SEAFOAM)
	lbl_ways.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_ways)

	banner = _styled_label(96, GOLD)
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.z_index = 5
	banner.visible = false
	hud.add_child(banner)

	lbl_balance = _readout_label(40, PEARL_C)
	hud.add_child(lbl_balance)

	lbl_win = _readout_label(48, GOLD)
	hud.add_child(lbl_win)

	lbl_bet = _readout_label(40, PEARL_C)
	hud.add_child(lbl_bet)

	bet_minus_btn = _glyph_button("minus", "")
	bet_minus_btn.pressed.connect(func(): _change_bet(-1))
	hud.add_child(bet_minus_btn)

	bet_plus_btn = _glyph_button("plus", "")
	bet_plus_btn.pressed.connect(func(): _change_bet(1))
	hud.add_child(bet_plus_btn)

	maxbet_btn = _glyph_button("text", "MAX")
	maxbet_btn.pressed.connect(_max_bet)
	hud.add_child(maxbet_btn)

	autoplay_btn = _glyph_button("auto", "")
	autoplay_btn.pressed.connect(_toggle_autospin)
	hud.add_child(autoplay_btn)

	settings_btn = _glyph_button("gear", "")
	settings_btn.pressed.connect(func(): _open_overlay("settings"))
	hud.add_child(settings_btn)

	sound_btn = _glyph_button("sound", "")
	sound_btn.active = true
	sound_btn.pressed.connect(_toggle_sound)
	hud.add_child(sound_btn)

	info_btn = _glyph_button("info", "")
	info_btn.pressed.connect(func(): _open_overlay("info"))
	hud.add_child(info_btn)

	menu_btn = _glyph_button("menu", "")
	menu_btn.pressed.connect(func(): _open_overlay("menu"))
	hud.add_child(menu_btn)

	spin_btn = _tex_button("res://art/ui/btn_spin.png")
	spin_btn.pressed.connect(func(): play("spin_press"); request_spin())
	hud.add_child(spin_btn)

	# "SPIN" caption centred directly under the spin button (positioned in _layout_hud).
	lbl_spin = _styled_label(40, GOLD)
	lbl_spin.text = "SPIN"
	lbl_spin.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl_spin.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lbl_spin.add_theme_constant_override("outline_size", 8)
	lbl_spin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(lbl_spin)

	# the old turbo button is repurposed into a 3-state SLOW / NORMAL / FAST speed cycle.
	speed_btn = _glyph_button("speed", SPEED_NAMES[_speed_idx])
	speed_btn.pressed.connect(_cycle_speed)
	hud.add_child(speed_btn)

	_update_hud()
	_update_speed_visual()

func _build_word_layer() -> void:
	word_layer = CanvasLayer.new(); word_layer.layer = 45; add_child(word_layer)
	kraken_layer = CanvasLayer.new(); kraken_layer.layer = 44; add_child(kraken_layer)

func _layout_hud() -> void:
	var W := view.x
	var H := view.y
	var grid_bottom := frame_pos.y + frame_size.y
	if portrait:
		_place_lbl(logo, Vector2(W * 0.5 - W * 0.46, H * 0.006), Vector2(W * 0.92, H * 0.085))

		# top readout row under the logo: BALANCE (left pill) + WIN (right pill). BET moves down to
		# its stepper in the control deck, so WIN takes the top-right slot beside the balance.
		var pill_y := H * 0.098
		var pw := W * 0.42
		var ph := pw * (437.0 / 1597.0)
		_place_lbl(pill_balance, Vector2(W * 0.04, pill_y), Vector2(pw, ph))
		_place_value(lbl_balance, pill_balance, int(ph * 0.36))
		_place_lbl(pill_win, Vector2(W * 0.54, pill_y), Vector2(pw, ph))
		_place_value(lbl_win, pill_win, int(ph * 0.36))

		# multiplier indicator (free-spins rising tide / base cascade mult): orb + "xN" sitting
		# DIRECTLY UNDER the WIN pill so it reads as part of the win cluster (item 4).
		var win_b := pill_y + ph
		var orb_s := ph * 0.66
		var tide_num_w := pw * 0.34
		var pair_w := orb_s + tide_num_w
		var pair_x := (W * 0.54 + pw * 0.5) - pair_w * 0.5
		var clu_y := win_b + H * 0.004
		_place_lbl(tide_orb, Vector2(pair_x, clu_y), Vector2(orb_s, orb_s))
		tide_orb.pivot_offset = Vector2(orb_s * 0.5, orb_s * 0.5)
		var tide_fs := int(orb_s * 0.62)
		_place_lbl(lbl_tide, Vector2(pair_x + orb_s, clu_y), Vector2(tide_num_w, orb_s)); _set_font(lbl_tide, tide_fs)
		lbl_tide.add_theme_constant_override("outline_size", maxi(6, int(tide_fs * 0.2)))
		lbl_tide.pivot_offset = Vector2(tide_num_w * 0.5, orb_s * 0.5)

		# transient callouts sit on the frame's lower gold border (just below the symbols)
		_place_lbl(lbl_msg, Vector2(0, grid_bottom - H * 0.052), Vector2(W, 44)); _set_font(lbl_msg, 34)
		_place_lbl(lbl_ways, Vector2(0, grid_bottom - H * 0.020), Vector2(W, 34)); _set_font(lbl_ways, 28)
		_place_lbl(banner, Vector2(0, _grid_center().y - 70), Vector2(W, 140))
		banner.pivot_offset = Vector2(W * 0.5, 70)

		# main control deck: AUTO  [ − BET + ]  SPIN  SPEED — the minus/plus tightly flank the bet
		# pill so it reads as one stepper, with the spin button to its right. The deck is raised a
		# touch (and the utility row dropped) to open a clean band for the SPIN caption.
		var spin_y := H * 0.84
		var bp_w := W * 0.27
		var bp_h := bp_w * (437.0 / 1597.0)
		var step_btn := Vector2(W * 0.085, bp_h)
		var step_gap := W * 0.006
		var step_cx := W * 0.355
		_place_lbl(pill_bet, Vector2(step_cx - bp_w * 0.5, spin_y - bp_h * 0.5), Vector2(bp_w, bp_h))
		_place_value(lbl_bet, pill_bet, int(bp_h * 0.46))
		_place_btn(bet_minus_btn, Vector2(step_cx - bp_w * 0.5 - step_gap - step_btn.x * 0.5, spin_y), step_btn)
		_place_btn(bet_plus_btn, Vector2(step_cx + bp_w * 0.5 + step_gap + step_btn.x * 0.5, spin_y), step_btn)
		var spin_c := Vector2(W * 0.72, spin_y)
		var spin_sz := Vector2(W * 0.24, W * 0.24)
		_place_btn(spin_btn, spin_c, spin_sz)
		_place_btn(autoplay_btn, Vector2(W * 0.07, spin_y), Vector2(W * 0.10, W * 0.10))
		# wider + taller SPEED box so "NORMAL" fits without clipping (item 3); the value font also
		# auto-shrinks to the box width in GlyphButton._draw_glyph.
		_place_btn(speed_btn, Vector2(W * 0.92, spin_y), Vector2(W * 0.15, W * 0.13))
		# utility row: MAX BET + settings / sound / info / menu (dropped slightly)
		var icon_y := H * 0.96
		_place_btn(maxbet_btn, Vector2(W * 0.145, icon_y), Vector2(W * 0.18, W * 0.085))
		_place_btn(settings_btn, Vector2(W * 0.40, icon_y), Vector2(W * 0.095, W * 0.095))
		_place_btn(sound_btn, Vector2(W * 0.525, icon_y), Vector2(W * 0.095, W * 0.095))
		_place_btn(info_btn, Vector2(W * 0.65, icon_y), Vector2(W * 0.095, W * 0.095))
		_place_btn(menu_btn, Vector2(W * 0.775, icon_y), Vector2(W * 0.095, W * 0.095))
		# SPIN caption centred in the gap between the spin button and the utility row (item 1).
		# icon_top uses the TALLEST utility glyph (W*0.095, info/menu flank the spin column) so the
		# caption can never overlap them.
		var cap_w := W * 0.32
		var cap_h := H * 0.022
		var spin_bottom := spin_c.y + spin_sz.y * 0.5
		var icon_top := icon_y - (W * 0.095) * 0.5
		var cap_cy: float = (spin_bottom + icon_top) * 0.5
		_place_lbl(lbl_spin, Vector2(spin_c.x - cap_w * 0.5, cap_cy - cap_h * 0.5), Vector2(cap_w, cap_h))
		_set_font(lbl_spin, int(cap_h * 0.82))
		lbl_spin.add_theme_constant_override("outline_size", 8)
	else:
		_place_lbl(logo, Vector2(W * 0.5 - W * 0.22, H * 0.01), Vector2(W * 0.44, H * 0.10))
		var pw := W * 0.22
		var ph := pw * (437.0 / 1597.0)
		_place_lbl(pill_balance, Vector2(W * 0.03, H * 0.04), Vector2(pw, ph))
		_place_value(lbl_balance, pill_balance, int(ph * 0.36))
		_place_lbl(pill_win, Vector2(W * 0.75, H * 0.04), Vector2(pw, ph))
		_place_value(lbl_win, pill_win, int(ph * 0.36))
		# multiplier indicator directly under the WIN pill (item 4), mirroring portrait.
		var lwin_b := H * 0.04 + ph
		var lorb_s := ph * 0.7
		var ltide_num_w := pw * 0.4
		var lpair_w := lorb_s + ltide_num_w
		var lpair_x := (W * 0.75 + pw * 0.5) - lpair_w * 0.5
		var lclu_y := lwin_b + H * 0.01
		_place_lbl(tide_orb, Vector2(lpair_x, lclu_y), Vector2(lorb_s, lorb_s))
		tide_orb.pivot_offset = Vector2(lorb_s * 0.5, lorb_s * 0.5)
		var ltide_fs := int(lorb_s * 0.6)
		_place_lbl(lbl_tide, Vector2(lpair_x + lorb_s, lclu_y), Vector2(ltide_num_w, lorb_s)); _set_font(lbl_tide, ltide_fs)
		lbl_tide.add_theme_constant_override("outline_size", maxi(6, int(ltide_fs * 0.2)))
		lbl_tide.pivot_offset = Vector2(ltide_num_w * 0.5, lorb_s * 0.5)
		_place_lbl(lbl_ways, Vector2(0, frame_pos.y - 44), Vector2(W, 40)); _set_font(lbl_ways, 28)
		_place_lbl(lbl_msg, Vector2(0, frame_pos.y - 86), Vector2(W, 44))
		_place_lbl(banner, Vector2(0, _grid_center().y - 64), Vector2(W, 130))
		banner.pivot_offset = Vector2(W * 0.5, 64)
		var bar_y := H * 0.9
		# bet stepper: [ − BET + ] grouped at the left of the control bar
		var bp_w := W * 0.16
		var bp_h := bp_w * (437.0 / 1597.0)
		var step_btn := Vector2(W * 0.05, bp_h)
		var step_gap := W * 0.004
		var step_cx := W * 0.30
		_place_lbl(pill_bet, Vector2(step_cx - bp_w * 0.5, bar_y - bp_h * 0.5), Vector2(bp_w, bp_h))
		_place_value(lbl_bet, pill_bet, int(bp_h * 0.46))
		_place_btn(bet_minus_btn, Vector2(step_cx - bp_w * 0.5 - step_gap - step_btn.x * 0.5, bar_y), step_btn)
		_place_btn(bet_plus_btn, Vector2(step_cx + bp_w * 0.5 + step_gap + step_btn.x * 0.5, bar_y), step_btn)
		_place_btn(maxbet_btn, Vector2(W * 0.45, bar_y), Vector2(120, 76))
		_place_btn(autoplay_btn, Vector2(W * 0.55, bar_y), Vector2(92, 92))
		_place_btn(speed_btn, Vector2(W * 0.655, bar_y), Vector2(172, 108))
		_place_btn(spin_btn, Vector2(W * 0.88, bar_y), Vector2(150, 150))
		# SPIN caption tucked under the spin button (clamped within the bottom margin).
		var lcap_h := minf(H * 0.034, maxf(0.0, H - (bar_y + 78.0) - H * 0.004))
		_place_lbl(lbl_spin, Vector2(W * 0.88 - W * 0.09, bar_y + 78.0), Vector2(W * 0.18, lcap_h))
		_set_font(lbl_spin, int(lcap_h * 0.78))
		lbl_spin.add_theme_constant_override("outline_size", 6)
		_place_btn(settings_btn, Vector2(W * 0.05, H * 0.20), Vector2(72, 72))
		_place_btn(sound_btn, Vector2(W * 0.05, H * 0.30), Vector2(72, 72))
		_place_btn(info_btn, Vector2(W * 0.95, H * 0.20), Vector2(72, 72))
		_place_btn(menu_btn, Vector2(W * 0.95, H * 0.30), Vector2(72, 72))

func _set_font(l: Control, size: int) -> void:
	l.add_theme_font_size_override("font_size", size)

func _place_lbl(l: Control, pos: Vector2, size: Vector2) -> void:
	l.position = pos
	l.size = size

func _place_btn(b: Control, center: Vector2, size: Vector2) -> void:
	b.custom_minimum_size = size
	b.size = size
	b.position = center - size * 0.5
	b.pivot_offset = size * 0.5

func _tex_button(path: String) -> TextureButton:
	var b := TextureButton.new()
	if ResourceLoader.exists(path):
		b.texture_normal = load(path)
	b.ignore_texture_size = true
	b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	b.pressed.connect(func(): _btn_feedback(b))
	return b

func _glyph_button(kind: String, text_label: String):
	var b := GlyphButton.new()
	b.kind = kind
	b.text_label = text_label
	b.accent = AQUA_C
	b.pressed.connect(func(): _btn_feedback(b))
	return b

func _btn_feedback(b: Control) -> void:
	play("button_tap")
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	b.scale = Vector2(0.92, 0.92)
	t.tween_property(b, "scale", Vector2(1, 1), 0.18)

func _toggle_sound() -> void:
	_set_sfx(not _sfx_on)

func _cycle_speed() -> void:
	_set_speed((_speed_idx + 1) % SPEED_SCALES.size())

## Absolute speed select (HUD cycle + settings segmented control share this). Keeps a live
## segmented control in sync so the two surfaces never drift apart.
func _set_speed(idx: int) -> void:
	_speed_idx = clampi(idx, 0, SPEED_SCALES.size() - 1)
	speed_scale = SPEED_SCALES[_speed_idx]
	_update_speed_visual()
	if _speed_seg and is_instance_valid(_speed_seg):
		_speed_seg.select_index(_speed_idx)

func _update_speed_visual() -> void:
	if speed_btn == null: return
	var col := SEAFOAM            # NORMAL
	if _speed_idx == 0: col = AQUA_C   # SLOW
	elif _speed_idx == 2: col = GOLD   # FAST
	speed_btn.text_label = SPEED_NAMES[_speed_idx]
	speed_btn.accent = col
	speed_btn.active = true
	speed_btn.queue_redraw()

func _toggle_autospin() -> void:
	play("bet_change")
	if _autospin:
		_autospin = false
		_autospin_left = 0
	else:
		_autospin = true
		_autospin_left = 10
	_update_autospin_visual()
	if _autospin and not busy:
		request_spin()

func _update_autospin_visual() -> void:
	if autoplay_btn:
		autoplay_btn.active = _autospin
		autoplay_btn.queue_redraw()

func _maybe_autospin() -> void:
	if not _autospin: return
	_autospin_left -= 1
	if _autospin_left <= 0:
		_autospin = false
		_update_autospin_visual()
		return
	await get_tree().create_timer(dur(0.5)).timeout
	if _autospin and not busy:
		request_spin()

func _change_bet(dir: int) -> void:
	play("bet_change")
	var idx := BET_STEPS.find(bet_minor)
	if idx == -1: idx = 4
	idx = clamp(idx + dir, 0, BET_STEPS.size() - 1)
	bet_minor = clamp(BET_STEPS[idx], min_bet, max_bet)
	_update_hud()

func _max_bet() -> void:
	play("bet_change")
	bet_minor = max_bet
	_update_hud()

func _fmt(c: float) -> String:
	# "$1,234,567.89" with thousands separators.
	var neg := c < 0.0
	var cents := int(round(abs(c) * 100.0))
	var dollars := cents / 100
	var rem := cents % 100
	var s := str(dollars)
	var out := ""
	var n := s.length()
	for i in n:
		if i > 0 and (n - i) % 3 == 0:
			out += ","
		out += s[i]
	return "%s$%s.%02d" % ["-" if neg else "", out, rem]

func _update_hud() -> void:
	# the pill art bakes the "BALANCE" / "BET" captions, so the labels carry the value only.
	lbl_balance.text = _fmt(float(balance_minor) / 1000.0)
	lbl_bet.text = _fmt(float(bet_minor) / 1000.0)

func _flash(msg: String) -> void:
	if lbl_msg: lbl_msg.text = msg

func _num(v) -> int:
	if v == null: return 0
	if typeof(v) == TYPE_STRING: return int(v)
	return int(round(float(v)))

# --------------------------------------------------------------------- bridge
func _connect_bridge() -> void:
	if not OS.has_feature("web"): return
	if not JavaScriptBridge.has_method("get_interface"): return
	var ok = JavaScriptBridge.eval("typeof window.LeviathanDeepGodot === 'object'", true)
	if ok:
		bridge = JavaScriptBridge.get_interface("LeviathanDeepGodot")
		var init_json: String = str(JavaScriptBridge.eval("JSON.stringify(window.LeviathanDeepGodot.getInit())", true))
		var init = JSON.parse_string(init_json)
		if typeof(init) == TYPE_DICTIONARY:
			balance_minor = int(str(init.get("balanceMinor", 0)))
			min_bet = int(str(init.get("minBetMinor", 50)))
			max_bet = int(str(init.get("maxBetMinor", 10000)))
			currency = str(init.get("currency", "CREDIT"))
			bet_minor = clamp(bet_minor, min_bet, max_bet)
		_update_hud()
		_bal_timer = Timer.new()
		_bal_timer.wait_time = 1.5
		_bal_timer.timeout.connect(_poll_balance)
		add_child(_bal_timer)
		_bal_timer.start()

func _poll_balance() -> void:
	if bridge == null or busy:
		return
	var j: String = str(JavaScriptBridge.eval("JSON.stringify(window.LeviathanDeepGodot.getInit())", true))
	var d = JSON.parse_string(j)
	if typeof(d) == TYPE_DICTIONARY:
		var b := int(str(d.get("balanceMinor", balance_minor)))
		if b != balance_minor:
			balance_minor = b
			_update_hud()

# ----------------------------------------------------------------------- mock
## Offline demo only — produces a contract-shaped LeviathanOutcome so the exported build is
## directly QA-able without a host. The server is authoritative in live play. The mock's tumble
## (clear -> drop survivors -> refill from top) matches the engine semantics the renderer assumes.
func _eval_ways(grid: Array) -> Array:
	var wins := []
	for sym in MOCK_PAY.keys():
		var reels_matched := 0
		var ways := 1
		var cells := []
		for col in COLS:
			var cnt := 0
			var col_cells := []
			for row in ROWS:
				var s: String = grid[col][row]
				if s == sym or s == WILD:
					cnt += 1
					col_cells.append([col, row])
			if cnt == 0:
				break
			reels_matched += 1
			ways *= cnt
			for c in col_cells: cells.append(c)
		if reels_matched >= 3:
			var base: int = int(MOCK_PAY[sym].get(reels_matched, 0))
			if base > 0:
				wins.append({"symbol": sym, "reels": reels_matched, "ways": ways, "payBps": base * ways, "cells": cells})
	return wins

func _rand_grid() -> Array:
	var grid := []
	for col in COLS:
		var column := []
		for row in ROWS:
			column.append(_rand_sym(col))
		grid.append(column)
	return grid

func _refill(grid: Array, cleared: Dictionary) -> Array:
	var ng := []
	for col in COLS:
		var survivors := []
		for row in ROWS:
			if not cleared.has("%d:%d" % [col, row]):
				survivors.append(grid[col][row])
		var k := ROWS - survivors.size()
		var col_new := []
		for i in k:
			col_new.append(_rand_sym(col))
		for sv in survivors:
			col_new.append(sv)
		ng.append(col_new)
	return ng

func _count(grid: Array, sym: String) -> int:
	var n := 0
	for col in COLS:
		for row in ROWS:
			if grid[col][row] == sym: n += 1
	return n

func _mock_spin(tide_mult: int) -> Dictionary:
	var cur := _rand_grid()
	var initial := cur
	var cascades := []
	var spin_bps := 0
	var end_mult := tide_mult
	for c in MOCK_MAX_CASCADES:
		var wins := _eval_ways(cur)
		var step_win := 0
		for w in wins: step_win += int(w.payBps)
		step_win *= tide_mult
		cascades.append({"grid": cur, "wins": wins, "multiplier": tide_mult, "stepWinBps": step_win})
		if wins.is_empty():
			break
		spin_bps += step_win
		var cleared := {}
		for w in wins:
			for cell in w.cells:
				cleared["%d:%d" % [cell[0], cell[1]]] = true
		cur = _refill(cur, cleared)
	if not cascades[cascades.size() - 1].wins.is_empty():
		cascades.append({"grid": cur, "wins": [], "multiplier": tide_mult, "stepWinBps": 0})
	return {
		"cascades": cascades, "spinWinBps": spin_bps, "endMultiplier": end_mult,
		"scatterCount": _count(initial, SCATTER), "bonusCount": _count(initial, BONUS),
	}

func _force_special(sym: String, n: int) -> Dictionary:
	var sr := _mock_spin(1)
	var grid: Array = sr.cascades[0].grid
	var placed := 0
	var guard := 0
	while placed < n and guard < 200:
		guard += 1
		var col := randi() % COLS
		var row := randi() % ROWS
		if grid[col][row] != sym:
			grid[col][row] = sym
			placed += 1
	sr.scatterCount = _count(grid, SCATTER)
	sr.bonusCount = _count(grid, BONUS)
	# the forced grid no longer matches its evaluated wins; keep cascades[0] as the shown grid and
	# strip line wins so the demo focuses on the trigger animation.
	sr.cascades = [{"grid": grid, "wins": [], "multiplier": 1, "stepWinBps": 0}]
	sr.spinWinBps = 0
	return sr

func _anticipation_for(grid: Array, sym: String, needed: int) -> Dictionary:
	var reel_idxs := []
	var running := 0
	var from_reel = null
	for col in COLS:
		var here := 0
		for row in ROWS:
			if grid[col][row] == sym: here += 1
		if here > 0:
			reel_idxs.append(col)
		running += here
		if running == needed - 1 and col < COLS - 1 and from_reel == null:
			from_reel = col + 1
	return {"symbol": sym, "reels": reel_idxs, "count": running, "needed": needed, "fromReel": from_reel}

func _build_feel(initial: Array, total_bps: int, scatter_ct: int, bonus_ct: int) -> Dictionary:
	var tier := "NONE"
	if total_bps >= 500000: tier = "EPIC"
	elif total_bps >= 250000: tier = "MEGA"
	elif total_bps >= 100000: tier = "BIG"
	elif total_bps > 0: tier = "NICE"
	var anticipation := []
	var near_miss := []
	var sa := _anticipation_for(initial, SCATTER, SCATTER_TRIGGER)
	if sa.fromReel != null:
		anticipation.append(sa)
		if scatter_ct < SCATTER_TRIGGER:
			near_miss.append({"symbol": SCATTER, "count": scatter_ct, "needed": SCATTER_TRIGGER})
	var ba := _anticipation_for(initial, BONUS, BONUS_TRIGGER)
	if ba.fromReel != null:
		anticipation.append(ba)
		if bonus_ct < BONUS_TRIGGER:
			near_miss.append({"symbol": BONUS, "count": bonus_ct, "needed": BONUS_TRIGGER})
	return {"winTier": tier, "anticipation": anticipation, "nearMiss": near_miss}

var _demo_n := 0
func _mock_outcome() -> Dictionary:
	_demo_n += 1
	var base: Dictionary
	var scenario := _demo_n % 6
	if scenario == 1:
		base = _force_special(SCATTER, SCATTER_TRIGGER - 1)   # scatter near-miss
	elif scenario == 2:
		base = _force_special(SCATTER, SCATTER_TRIGGER)       # free spins trigger
	elif scenario == 3:
		base = _force_special(BONUS, BONUS_TRIGGER - 1)       # bonus near-miss
	elif scenario == 4:
		base = _force_special(BONUS, BONUS_TRIGGER)           # kraken trigger
	else:
		base = _mock_spin(1)                                  # normal / random tumble win

	var initial: Array = base.cascades[0].grid
	var total_bps := int(base.spinWinBps)

	var bonus = null
	if int(base.bonusCount) >= BONUS_TRIGGER:
		var award: int = MOCK_KRAKEN.get(min(int(base.bonusCount), 6), 300000)
		total_bps += award
		bonus = {"triggered": true, "krakenCount": int(base.bonusCount), "awardBps": award}

	var fs = null
	if int(base.scatterCount) >= SCATTER_TRIGGER:
		fs = _mock_freespins(int(base.scatterCount))
		total_bps += int(fs.totalBps)

	var feel := _build_feel(initial, total_bps, int(base.scatterCount), int(base.bonusCount))
	return {
		"kind": "leviathan-deep", "win": total_bps > 0,
		"base": base, "freeSpins": fs, "bonus": bonus, "totalWinBps": total_bps, "feel": feel,
	}

func _mock_freespins(scatter_ct: int) -> Dictionary:
	_gen_orbs = true
	var n := 8 + 2 * maxi(0, scatter_ct - SCATTER_TRIGGER)
	var spins := []
	var tide := 1
	var total := 0
	for i in n:
		var sr := _mock_spin(tide)
		var orbs := _count(sr.cascades[0].grid, MULT_ORB)
		total += int(sr.spinWinBps)
		spins.append(sr)
		tide += orbs
	_gen_orbs = false
	return {
		"triggered": true, "spins": spins, "totalSpins": n,
		"startTide": 1, "endTide": tide, "totalBps": total,
	}


# ===================================================================== overlays
## INFO / SETTINGS / MENU modals. Every overlay node lives on `overlay_layer` (a CanvasLayer ABOVE
## the HUD/word/kraken layers), so the full-screen scrim Control intercepts input first and blocks
## the reels + HUD on its own; request_spin() also guards on `_overlay`. Only one panel is open at a
## time — opening another tears the current one down. Open/close animate with a scale+fade tween.
func _build_overlay_layer() -> void:
	overlay_layer = CanvasLayer.new()
	overlay_layer.layer = 80
	add_child(overlay_layer)

func _open_overlay(which: String, animate := true) -> void:
	if which == _overlay:
		return
	if not (which == "info" or which == "settings" or which == "menu"):
		return
	if _overlay != "":
		_teardown_overlay()
	_overlay = which

	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay_layer.add_child(root)
	_overlay_root = root

	var scrim := ColorRect.new()
	scrim.set_anchors_preset(Control.PRESET_FULL_RECT)
	scrim.color = Color(0.012, 0.07, 0.10, 0.0)
	scrim.mouse_filter = Control.MOUSE_FILTER_STOP
	scrim.gui_input.connect(_on_scrim_input)
	root.add_child(scrim)
	_overlay_scrim = scrim

	var panel: Control
	match which:
		"info": panel = _build_paytable_panel()
		"settings": panel = _build_settings_panel()
		"menu": panel = _build_menu_panel()
	root.add_child(panel)
	_overlay_panel = panel
	panel.pivot_offset = panel.size * 0.5

	if animate:
		play("button_tap")
		create_tween().tween_property(scrim, "color:a", 0.72, dur(0.18))
		panel.scale = Vector2(0.86, 0.86)
		panel.modulate = Color(1, 1, 1, 0)
		var pt := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		pt.tween_property(panel, "scale", Vector2.ONE, dur(0.22))
		pt.parallel().tween_property(panel, "modulate:a", 1.0, dur(0.18))
	else:
		scrim.color.a = 0.72
		panel.scale = Vector2.ONE
		panel.modulate = Color(1, 1, 1, 1)

func _on_scrim_input(event: InputEvent) -> void:
	var hit := false
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		hit = true
	elif event is InputEventScreenTouch and event.pressed:
		hit = true
	if hit:
		_close_overlay()

func _close_overlay() -> void:
	if _overlay == "":
		return
	_overlay = ""
	play("button_tap")
	var root := _overlay_root
	var panel := _overlay_panel
	var scrim := _overlay_scrim
	if scrim and is_instance_valid(scrim):
		scrim.mouse_filter = Control.MOUSE_FILTER_IGNORE
		create_tween().tween_property(scrim, "color:a", 0.0, dur(0.16))
	if panel and is_instance_valid(panel):
		var pt := create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
		pt.tween_property(panel, "scale", Vector2(0.86, 0.86), dur(0.16))
		pt.parallel().tween_property(panel, "modulate:a", 0.0, dur(0.16))
	_clear_overlay_refs()
	if root and is_instance_valid(root):
		var ft := create_tween()
		ft.tween_interval(dur(0.2))
		ft.tween_callback(root.queue_free)

func _teardown_overlay() -> void:
	if _overlay_root and is_instance_valid(_overlay_root):
		_overlay_root.queue_free()
	_clear_overlay_refs()

func _clear_overlay_refs() -> void:
	_overlay_root = null
	_overlay_panel = null
	_overlay_scrim = null
	_pt_pages = []
	_pt_dots = null
	_pt_subtitle = null
	_sfx_switch = null
	_music_switch = null
	_speed_seg = null

# ---- shared panel construction ------------------------------------------------
func _make_panel(w: float, h: float) -> OceanPanel:
	var p := OceanPanel.new()
	p.size = Vector2(w, h)
	p.position = (view - Vector2(w, h)) * 0.5
	p.mouse_filter = Control.MOUSE_FILTER_STOP
	return p

## Title + close (X) shared by every panel. The X reuses the GlyphButton glyph set / tap feedback.
func _panel_header(panel: Control, title: String) -> void:
	var w := panel.size.x
	var pad := w * 0.05
	var head_h := panel.size.y * 0.085
	var csz := w * 0.10
	var title_lbl := _styled_label(int(w * 0.058), GOLD)
	title_lbl.text = title
	title_lbl.position = Vector2(pad, panel.size.y * 0.022)
	title_lbl.size = Vector2(w - pad * 2.0 - csz, head_h)
	title_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	title_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(title_lbl)
	var close = _glyph_button("close", "")
	close.accent = GOLD
	close.pressed.connect(_close_overlay)
	_place_btn(close, Vector2(w - pad - csz * 0.5, panel.size.y * 0.022 + head_h * 0.5), Vector2(csz, csz))
	panel.add_child(close)

func _ov_label(parent: Control, txt: String, pos: Vector2, sz: Vector2, font_size: int, color: Color, halign := HORIZONTAL_ALIGNMENT_LEFT, wrap := false) -> Label:
	var l := _styled_label(font_size, color)
	l.text = txt
	l.horizontal_alignment = halign
	l.position = pos
	l.size = sz
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.add_theme_constant_override("outline_size", maxi(2, int(font_size * 0.10)))
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	else:
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	parent.add_child(l)
	return l

func _ov_icon(parent: Control, id: String, pos: Vector2, sz: Vector2) -> TextureRect:
	var r := TextureRect.new()
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var t = textures.get(id, null)
	if t: r.texture = t
	r.position = pos
	r.size = sz
	parent.add_child(r)
	return r

func _ov_divider(parent: Control, pos: Vector2, width: float) -> void:
	var d := ColorRect.new()
	d.color = Color(GOLD.r, GOLD.g, GOLD.b, 0.30)
	d.mouse_filter = Control.MOUSE_FILTER_IGNORE
	d.position = pos
	d.size = Vector2(width, 2.0)
	parent.add_child(d)

# ---- INFO: paginated paytable & rules ----------------------------------------
func _build_paytable_panel() -> OceanPanel:
	var w: float = min(view.x * 0.94, 1010.0)
	var h := view.y * 0.86
	var panel := _make_panel(w, h)
	_panel_header(panel, "PAYTABLE & RULES")

	var pad := w * 0.05
	_pt_subtitle = _ov_label(panel, "", Vector2(pad, h * 0.095), Vector2(w - pad * 2.0, h * 0.05), int(w * 0.034), AQUA_C, HORIZONTAL_ALIGNMENT_CENTER)
	_ov_divider(panel, Vector2(pad, h * 0.155), w - pad * 2.0)

	var footer_h := h * 0.11
	var content_y := h * 0.175
	var content_h := h - content_y - footer_h - h * 0.015
	var content := Rect2(pad, content_y, w - pad * 2.0, content_h)

	_pt_pages = []
	_pt_pages.append(_pt_make_pay_page(panel, content, PT_HIGH))
	_pt_pages.append(_pt_make_pay_page(panel, content, PT_LOW))
	_pt_pages.append(_pt_make_special_page(panel, content))
	_pt_pages.append(_pt_make_rules_page(panel, content))

	var fy := h - footer_h
	var asz := footer_h * 0.66
	var left = _glyph_button("arrow_left", "")
	left.accent = GOLD
	left.pressed.connect(func(): _show_pt_page(_pt_page - 1))
	_place_btn(left, Vector2(pad + asz * 0.6, fy + footer_h * 0.5), Vector2(asz, asz))
	panel.add_child(left)
	var right = _glyph_button("arrow_right", "")
	right.accent = GOLD
	right.pressed.connect(func(): _show_pt_page(_pt_page + 1))
	_place_btn(right, Vector2(w - pad - asz * 0.6, fy + footer_h * 0.5), Vector2(asz, asz))
	panel.add_child(right)
	var dots := PageDots.new()
	dots.count = _pt_pages.size()
	dots.accent = GOLD
	dots.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dots.size = Vector2(w * 0.5, footer_h * 0.5)
	dots.position = Vector2(w * 0.25, fy + footer_h * 0.25)
	panel.add_child(dots)
	_pt_dots = dots

	_pt_page = clampi(_pt_page, 0, _pt_pages.size() - 1)
	_show_pt_page(_pt_page)
	return panel

func _show_pt_page(idx: int) -> void:
	if _pt_pages.is_empty():
		return
	var n := _pt_pages.size()
	_pt_page = ((idx % n) + n) % n
	for i in n:
		_pt_pages[i].visible = (i == _pt_page)
	if _pt_dots and is_instance_valid(_pt_dots):
		_pt_dots.index = _pt_page
		_pt_dots.queue_redraw()
	if _pt_subtitle and is_instance_valid(_pt_subtitle):
		_pt_subtitle.text = PT_SUBTITLES[_pt_page]

## A high/low symbol pay page: icon + name on the left, then right-aligned 3/4/5/6 columns under
## numeric headers. Headline pay figures are gold; the "-" (no pay) cells are dimmed.
func _pt_make_pay_page(panel: Control, content: Rect2, rows: Array) -> Control:
	var page := Control.new()
	page.position = content.position
	page.size = content.size
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(page)

	var cw := content.size.x
	var ch := content.size.y
	var head_h := ch * 0.11
	var n := rows.size()
	var row_h := (ch - head_h) / float(n)
	var val_left := cw * 0.40
	var val_w := (cw - val_left) / 4.0
	var head_fs := int(cw * 0.05)
	var name_fs := int(cw * 0.046)
	var val_fs := int(cw * 0.05)

	_ov_label(page, "OF A KIND", Vector2(0, 0), Vector2(val_left, head_h), int(cw * 0.036), Color(SEAFOAM.r, SEAFOAM.g, SEAFOAM.b, 0.85), HORIZONTAL_ALIGNMENT_LEFT)
	for c in 4:
		_ov_label(page, str(c + 3), Vector2(val_left + c * val_w, 0), Vector2(val_w, head_h), head_fs, AQUA_C, HORIZONTAL_ALIGNMENT_CENTER)

	for i in n:
		var rd: Array = rows[i]
		var ry := head_h + i * row_h
		if i % 2 == 1:
			var zebra := ColorRect.new()
			zebra.color = Color(SEAFOAM.r, SEAFOAM.g, SEAFOAM.b, 0.05)
			zebra.mouse_filter = Control.MOUSE_FILTER_IGNORE
			zebra.position = Vector2(0, ry)
			zebra.size = Vector2(cw, row_h)
			page.add_child(zebra)
		var isz := row_h * 0.80
		_ov_icon(page, str(rd[0]), Vector2(0, ry + (row_h - isz) * 0.5), Vector2(isz, isz))
		var name_x := isz + cw * 0.02
		_ov_label(page, str(rd[0]), Vector2(name_x, ry), Vector2(val_left - name_x, row_h), name_fs, PEARL_C, HORIZONTAL_ALIGNMENT_LEFT)
		for c in 4:
			var v := str(rd[c + 1])
			var col := GOLD if v != "-" else Color(0.55, 0.66, 0.72)
			_ov_label(page, v, Vector2(val_left + c * val_w, ry), Vector2(val_w, row_h), val_fs, col, HORIZONTAL_ALIGNMENT_CENTER)
	return page

func _pt_make_special_page(panel: Control, content: Rect2) -> Control:
	var page := Control.new()
	page.position = content.position
	page.size = content.size
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(page)

	var cw := content.size.x
	var ch := content.size.y
	var entries := [
		["WILD", "WILD", "Substitutes for every paying symbol. Appears on reels 2, 3, 4 and 5 only."],
		["SCATTER", "SCATTER  (CONCH)", "4 or more anywhere trigger FREE SPINS - 4 award 10 spins, 5 award 12, 6 award 15. Retriggers add +5 (up to 50). Scatters count across the whole tumbling sequence."],
		["BONUS", "BONUS  (KRAKEN AMULET)", "3 or more anywhere awaken the KRAKEN for an instant prize - 3 = 20x, 4 = 75x, 5 = 300x, 6 = 1000x total bet. Bonus symbols count across the whole cascade."],
		["MULT_ORB", "MULTIPLIER ORB", "Free spins only. Each orb adds to the persistent RISING TIDE multiplier (x2 / x3 / x5 / x10). The tide only ever rises during the feature."],
	]
	var n := entries.size()
	var row_h := ch / float(n)
	var isz := row_h * 0.62
	var title_fs := int(cw * 0.044)
	var body_fs := int(cw * 0.032)
	for i in n:
		var e: Array = entries[i]
		var ry := i * row_h
		_ov_icon(page, str(e[0]), Vector2(0, ry + (row_h - isz) * 0.5), Vector2(isz, isz))
		var tx := isz + cw * 0.035
		_ov_label(page, str(e[1]), Vector2(tx, ry + row_h * 0.06), Vector2(cw - tx, row_h * 0.28), title_fs, GOLD, HORIZONTAL_ALIGNMENT_LEFT)
		_ov_label(page, str(e[2]), Vector2(tx, ry + row_h * 0.34), Vector2(cw - tx, row_h * 0.62), body_fs, PEARL_C, HORIZONTAL_ALIGNMENT_LEFT, true)
	return page

func _pt_make_rules_page(panel: Control, content: Rect2) -> Control:
	var page := Control.new()
	page.position = content.position
	page.size = content.size
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(page)

	var cw := content.size.x
	var ch := content.size.y
	var blocks := [
		["WAYS", "Up to 15,625 ways. Matching symbols pay on ADJACENT reels starting from reel 1 (leftmost), in any position. Pays = paytable value x number of ways."],
		["TUMBLING", "Winning symbols burst and clear; symbols above fall and new ones drop in, repeating while there are wins. In the BASE game the win multiplier climbs x1, x2, x3, x5 across successive tumbles."],
		["FREE SPINS", "Tumbling continues under a persistent rising-tide multiplier fed by multiplier orbs - the tide carries from spin to spin and only ever rises."],
	]
	var head_fs := int(cw * 0.05)
	var body_fs := int(cw * 0.034)
	var block_h := ch * 0.27
	for i in blocks.size():
		var b: Array = blocks[i]
		var by := i * block_h
		_ov_label(page, str(b[0]), Vector2(0, by), Vector2(cw, ch * 0.07), head_fs, GOLD, HORIZONTAL_ALIGNMENT_LEFT)
		_ov_label(page, str(b[1]), Vector2(0, by + ch * 0.075), Vector2(cw, block_h - ch * 0.08), body_fs, PEARL_C, HORIZONTAL_ALIGNMENT_LEFT, true)
	_ov_divider(page, Vector2(cw * 0.1, ch * 0.86), cw * 0.8)
	_ov_label(page, "RTP 96.0%        MAX WIN 20,000x TOTAL BET", Vector2(0, ch * 0.88), Vector2(cw, ch * 0.1), int(cw * 0.042), GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	return page

# ---- SETTINGS -----------------------------------------------------------------
func _build_settings_panel() -> OceanPanel:
	var w: float = min(view.x * 0.88, 880.0)
	var h := view.y * 0.60
	var panel := _make_panel(w, h)
	_panel_header(panel, "SETTINGS")
	_ov_divider(panel, Vector2(w * 0.06, h * 0.135), w * 0.88)

	var x := w * 0.08
	var cw := w - x * 2.0
	var y := h * 0.20
	y = _settings_toggle_row(panel, x, y, cw, "SOUND EFFECTS", _sfx_on, _set_sfx, "sfx")
	y += h * 0.03
	y = _settings_toggle_row(panel, x, y, cw, "MUSIC", _music_on, _set_music, "music")
	y += h * 0.06

	_ov_label(panel, "GAME SPEED", Vector2(x, y), Vector2(cw, h * 0.08), int(w * 0.046), AQUA_C, HORIZONTAL_ALIGNMENT_LEFT)
	y += h * 0.09
	var seg := SegmentedControl.new()
	seg.options = SPEED_NAMES.duplicate()
	seg.index = _speed_idx
	seg.accent = GOLD
	seg.size = Vector2(cw, h * 0.14)
	seg.position = Vector2(x, y)
	seg.selected.connect(func(i): _set_speed(i))
	panel.add_child(seg)
	_speed_seg = seg
	return panel

func _settings_toggle_row(panel: Control, x: float, y: float, cw: float, label: String, state: bool, cb: Callable, kind: String) -> float:
	var rh := panel.size.y * 0.11
	_ov_label(panel, label, Vector2(x, y), Vector2(cw * 0.68, rh), int(panel.size.x * 0.046), PEARL_C, HORIZONTAL_ALIGNMENT_LEFT)
	var sw := ToggleSwitch.new()
	sw.on = state
	sw.accent = SEAFOAM
	var sww := panel.size.x * 0.20
	var swh := rh * 0.58
	sw.size = Vector2(sww, swh)
	sw.position = Vector2(x + cw - sww, y + (rh - swh) * 0.5)
	sw.toggled.connect(cb)
	panel.add_child(sw)
	if kind == "sfx":
		_sfx_switch = sw
	elif kind == "music":
		_music_switch = sw
	return y + rh

# ---- MENU ---------------------------------------------------------------------
func _build_menu_panel() -> OceanPanel:
	var w: float = min(view.x * 0.82, 760.0)
	var h := view.y * 0.62
	var panel := _make_panel(w, h)
	_panel_header(panel, "MENU")
	_ov_divider(panel, Vector2(w * 0.07, h * 0.135), w * 0.86)

	var x := w * 0.10
	var cw := w - x * 2.0
	var y := h * 0.19
	var bh := h * 0.13
	var gap := h * 0.035

	var resume := _menu_button(panel, "RESUME", "play", x, y, cw, bh)
	resume.pressed.connect(_close_overlay)
	y += bh + gap
	var rules := _menu_button(panel, "GAME RULES", "info", x, y, cw, bh)
	rules.pressed.connect(func(): _open_overlay("info"))
	y += bh + gap
	var setting := _menu_button(panel, "SETTINGS", "gear", x, y, cw, bh)
	setting.pressed.connect(func(): _open_overlay("settings"))
	y += bh + gap + h * 0.02
	_settings_toggle_row(panel, x, y, cw, "SOUND", _sfx_on, _set_sfx, "sfx")
	return panel

func _menu_button(panel: Control, text_label: String, icon_kind: String, x: float, y: float, w: float, h: float) -> OceanMenuButton:
	var b := OceanMenuButton.new()
	b.text_label = text_label
	b.icon_kind = icon_kind
	b.accent = GOLD
	b.size = Vector2(w, h)
	b.position = Vector2(x, y)
	b.pivot_offset = Vector2(w, h) * 0.5
	b.pressed.connect(func(): _btn_feedback(b))
	panel.add_child(b)
	return b


## Code-drawn control button (no art exists for bet +/-, max-bet, autoplay, settings, sound, info,
## menu). A rounded "glass" pill with a vector glyph, styled to the ocean palette; emits `pressed`
## on tap/click (touch is routed via Godot's emulate-mouse-from-touch). `active` brightens the
## border for toggles (autoplay on / sound on).
class GlyphButton extends Control:
	signal pressed
	var kind := "plus"
	var text_label := ""
	var accent := Color(0.36, 0.86, 1.0)
	var base_col := Color(0.04, 0.13, 0.19, 0.9)
	var active := false
	var _hover := false
	var _down := false

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_entered.connect(func(): _hover = true; queue_redraw())
		mouse_exited.connect(func(): _hover = false; _down = false; queue_redraw())

	func _gui_input(event: InputEvent) -> void:
		var press := false
		var rel := false
		if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
			press = event.pressed
			rel = not event.pressed
		elif event is InputEventScreenTouch:
			press = event.pressed
			rel = not event.pressed
		else:
			return
		if press:
			_down = true
			queue_redraw()
		elif rel:
			if _down:
				emit_signal("pressed")
			_down = false
			queue_redraw()

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		var sb := StyleBoxFlat.new()
		var fill := base_col
		if _down: fill = base_col.lightened(0.12)
		elif _hover: fill = base_col.lightened(0.05)
		sb.bg_color = fill
		var rad := int(min(size.x, size.y) * 0.32)
		sb.set_corner_radius_all(rad)
		sb.border_color = accent if active else Color(accent.r, accent.g, accent.b, 0.55)
		sb.set_border_width_all(max(2, int(min(size.x, size.y) * 0.05)))
		draw_style_box(sb, r)
		_draw_glyph(accent if active else Color(0.86, 0.96, 1.0))

	func _draw_glyph(c: Color) -> void:
		var w := size.x
		var h := size.y
		var cx := w * 0.5
		var cy := h * 0.5
		var u: float = min(w, h)
		var lw: float = max(2.0, u * 0.07)
		match kind:
			"plus":
				draw_line(Vector2(cx - u * 0.22, cy), Vector2(cx + u * 0.22, cy), c, lw)
				draw_line(Vector2(cx, cy - u * 0.22), Vector2(cx, cy + u * 0.22), c, lw)
			"minus":
				draw_line(Vector2(cx - u * 0.22, cy), Vector2(cx + u * 0.22, cy), c, lw)
			"text":
				var f := get_theme_default_font()
				var fs := int(u * 0.36)
				var ts := f.get_string_size(text_label, HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
				draw_string(f, Vector2(cx - ts.x * 0.5, cy + ts.y * 0.32), text_label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, c)
			"speed":
				# two-line label: "SPEED" caption above the current state (text_label). Both fonts
				# auto-shrink to the box width so the longest state ("NORMAL") never clips (item 3).
				var sf := get_theme_default_font()
				var avail: float = w * 0.84
				var cap := "SPEED"
				var cap_fs := int(h * 0.20)
				var cw := sf.get_string_size(cap, HORIZONTAL_ALIGNMENT_CENTER, -1, cap_fs).x
				if cw > avail:
					cap_fs = maxi(8, int(cap_fs * avail / cw))
					cw = sf.get_string_size(cap, HORIZONTAL_ALIGNMENT_CENTER, -1, cap_fs).x
				draw_string(sf, Vector2(cx - cw * 0.5, cy - h * 0.10), cap, HORIZONTAL_ALIGNMENT_LEFT, -1, cap_fs, Color(c.r, c.g, c.b, 0.8))
				var val_fs := int(h * 0.26)
				var vw := sf.get_string_size(text_label, HORIZONTAL_ALIGNMENT_CENTER, -1, val_fs).x
				if vw > avail:
					val_fs = maxi(8, int(val_fs * avail / vw))
					vw = sf.get_string_size(text_label, HORIZONTAL_ALIGNMENT_CENTER, -1, val_fs).x
				draw_string(sf, Vector2(cx - vw * 0.5, cy + h * 0.30), text_label, HORIZONTAL_ALIGNMENT_LEFT, -1, val_fs, c)
			"auto":
				# circular arrow (autoplay)
				draw_arc(Vector2(cx, cy), u * 0.26, deg_to_rad(40), deg_to_rad(310), 28, c, lw)
				var tip := Vector2(cx + u * 0.26 * cos(deg_to_rad(40)), cy + u * 0.26 * sin(deg_to_rad(40)))
				draw_line(tip, tip + Vector2(-u * 0.10, -u * 0.02), c, lw)
				draw_line(tip, tip + Vector2(-u * 0.02, u * 0.12), c, lw)
			"gear":
				draw_arc(Vector2(cx, cy), u * 0.20, 0, TAU, 32, c, lw)
				draw_circle(Vector2(cx, cy), u * 0.07, c)
				for i in 8:
					var a := TAU * float(i) / 8.0
					var p0 := Vector2(cx + cos(a) * u * 0.24, cy + sin(a) * u * 0.24)
					var p1 := Vector2(cx + cos(a) * u * 0.31, cy + sin(a) * u * 0.31)
					draw_line(p0, p1, c, lw)
			"sound":
				var bx := cx - u * 0.16
				draw_rect(Rect2(bx - u * 0.10, cy - u * 0.09, u * 0.10, u * 0.18), c)
				draw_colored_polygon(PackedVector2Array([
					Vector2(bx, cy - u * 0.09), Vector2(bx + u * 0.16, cy - u * 0.20),
					Vector2(bx + u * 0.16, cy + u * 0.20), Vector2(bx, cy + u * 0.09),
				]), c)
				if active:
					draw_arc(Vector2(bx + u * 0.16, cy), u * 0.22, deg_to_rad(-45), deg_to_rad(45), 12, c, lw)
					draw_arc(Vector2(bx + u * 0.16, cy), u * 0.32, deg_to_rad(-45), deg_to_rad(45), 14, c, lw)
				else:
					draw_line(Vector2(cx + u * 0.10, cy - u * 0.14), Vector2(cx + u * 0.30, cy + u * 0.14), c, lw)
					draw_line(Vector2(cx + u * 0.30, cy - u * 0.14), Vector2(cx + u * 0.10, cy + u * 0.14), c, lw)
			"info":
				draw_arc(Vector2(cx, cy), u * 0.28, 0, TAU, 32, c, lw)
				draw_circle(Vector2(cx, cy - u * 0.13), u * 0.045, c)
				draw_line(Vector2(cx, cy - u * 0.03), Vector2(cx, cy + u * 0.16), c, lw)
			"menu":
				for j in 3:
					var yy := cy - u * 0.16 + float(j) * u * 0.16
					draw_line(Vector2(cx - u * 0.22, yy), Vector2(cx + u * 0.22, yy), c, lw)
			"close":
				draw_line(Vector2(cx - u * 0.18, cy - u * 0.18), Vector2(cx + u * 0.18, cy + u * 0.18), c, lw)
				draw_line(Vector2(cx + u * 0.18, cy - u * 0.18), Vector2(cx - u * 0.18, cy + u * 0.18), c, lw)
			"arrow_left":
				draw_line(Vector2(cx + u * 0.13, cy - u * 0.20), Vector2(cx - u * 0.15, cy), c, lw)
				draw_line(Vector2(cx - u * 0.15, cy), Vector2(cx + u * 0.13, cy + u * 0.20), c, lw)
			"arrow_right":
				draw_line(Vector2(cx - u * 0.13, cy - u * 0.20), Vector2(cx + u * 0.15, cy), c, lw)
				draw_line(Vector2(cx + u * 0.15, cy), Vector2(cx - u * 0.13, cy + u * 0.20), c, lw)
			_:
				pass


## Code-drawn modal card: deep-teal rounded panel with a gold border, soft drop shadow and a faint
## inner hairline. Solid fill keeps it crisp on WebGL2. mouse_filter STOP so taps on the panel body
## don't fall through to the scrim (which closes the overlay).
class OceanPanel extends Control:
	var accent := Color(1.0, 0.82, 0.38)
	var fill := Color(0.03, 0.12, 0.18, 0.97)

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		var sb := StyleBoxFlat.new()
		sb.bg_color = fill
		var rad := int(min(size.x, size.y) * 0.045)
		sb.set_corner_radius_all(rad)
		sb.set_border_width_all(3)
		sb.border_color = accent
		sb.shadow_color = Color(0, 0, 0, 0.55)
		sb.shadow_size = 22
		draw_style_box(sb, r)
		var inner := StyleBoxFlat.new()
		inner.draw_center = false
		inner.set_corner_radius_all(maxi(0, rad - 6))
		inner.set_border_width_all(1)
		inner.border_color = Color(accent.r, accent.g, accent.b, 0.20)
		draw_style_box(inner, r.grow(-10.0))


## iOS-style sliding toggle. apply() drives the knob without re-emitting, so external state sync
## (HUD speaker / menu quick-toggle) never feedback-loops with the switch's own input.
class ToggleSwitch extends Control:
	signal toggled(on)
	var on := true
	var accent := Color(0.55, 1.0, 0.86)
	var off_col := Color(0.16, 0.24, 0.28)
	var _k := 1.0

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP
		_k = 1.0 if on else 0.0

	func _gui_input(event: InputEvent) -> void:
		var press := false
		if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			press = true
		elif event is InputEventScreenTouch and event.pressed:
			press = true
		if press:
			apply(not on, true)
			emit_signal("toggled", on)

	func apply(v: bool, animate: bool) -> void:
		on = v
		var target := 1.0 if on else 0.0
		if animate and is_inside_tree():
			var t := create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
			t.tween_method(_set_k, _k, target, 0.16)
		else:
			_set_k(target)

	func _set_k(v: float) -> void:
		_k = v
		queue_redraw()

	func _draw() -> void:
		var track := StyleBoxFlat.new()
		track.bg_color = off_col.lerp(accent, _k)
		track.set_corner_radius_all(int(size.y * 0.5))
		draw_style_box(track, Rect2(Vector2.ZERO, size))
		var kr := size.y * 0.5
		var kx: float = lerp(kr, size.x - kr, _k)
		draw_circle(Vector2(kx, size.y * 0.5), kr * 0.80, Color(0.98, 1.0, 1.0))


## Segmented control (SLOW / NORMAL / FAST). select_index() sets selection without emitting, for
## external sync with the HUD speed cycle.
class SegmentedControl extends Control:
	signal selected(index)
	var options: Array = []
	var index := 0
	var accent := Color(1.0, 0.82, 0.38)
	var base_col := Color(0.05, 0.16, 0.22, 0.95)

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP

	func _gui_input(event: InputEvent) -> void:
		var press := false
		if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			press = true
		elif event is InputEventScreenTouch and event.pressed:
			press = true
		if not press:
			return
		var n := options.size()
		if n == 0:
			return
		var seg_w := size.x / float(n)
		var i := clampi(int(event.position.x / seg_w), 0, n - 1)
		if i != index:
			index = i
			queue_redraw()
			emit_signal("selected", i)

	func select_index(i: int) -> void:
		index = clampi(i, 0, maxi(0, options.size() - 1))
		queue_redraw()

	func _draw() -> void:
		var sb := StyleBoxFlat.new()
		sb.bg_color = base_col
		sb.set_corner_radius_all(int(size.y * 0.30))
		sb.set_border_width_all(2)
		sb.border_color = Color(accent.r, accent.g, accent.b, 0.45)
		draw_style_box(sb, Rect2(Vector2.ZERO, size))
		var n := options.size()
		if n == 0:
			return
		var seg_w := size.x / float(n)
		var f := get_theme_default_font()
		var fs := int(size.y * 0.34)
		for i in n:
			if i == index:
				var hb := StyleBoxFlat.new()
				hb.bg_color = Color(accent.r, accent.g, accent.b, 0.92)
				hb.set_corner_radius_all(int(size.y * 0.26))
				draw_style_box(hb, Rect2(i * seg_w, 0, seg_w, size.y).grow(-4.0))
			var col := Color(0.03, 0.10, 0.14) if i == index else Color(0.86, 0.95, 1.0)
			var txt := str(options[i])
			var ts := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
			draw_string(f, Vector2(i * seg_w + seg_w * 0.5 - ts.x * 0.5, size.y * 0.5 + ts.y * 0.32), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
		for i in range(1, n):
			draw_line(Vector2(i * seg_w, size.y * 0.22), Vector2(i * seg_w, size.y * 0.78), Color(accent.r, accent.g, accent.b, 0.25), 1.0)


## Wide menu row: rounded pill with a left glyph, label and a right chevron. Emits pressed on
## release (mirrors GlyphButton's input handling).
class OceanMenuButton extends Control:
	signal pressed
	var text_label := ""
	var icon_kind := ""
	var accent := Color(1.0, 0.82, 0.38)
	var base_col := Color(0.05, 0.16, 0.22, 0.95)
	var _down := false
	var _hover := false

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_entered.connect(func(): _hover = true; queue_redraw())
		mouse_exited.connect(func(): _hover = false; _down = false; queue_redraw())

	func _gui_input(event: InputEvent) -> void:
		var press := false
		var rel := false
		if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
			press = event.pressed
			rel = not event.pressed
		elif event is InputEventScreenTouch:
			press = event.pressed
			rel = not event.pressed
		else:
			return
		if press:
			_down = true
			queue_redraw()
		elif rel:
			if _down:
				emit_signal("pressed")
			_down = false
			queue_redraw()

	func _draw() -> void:
		var sb := StyleBoxFlat.new()
		var fill := base_col
		if _down:
			fill = base_col.lightened(0.14)
		elif _hover:
			fill = base_col.lightened(0.06)
		sb.bg_color = fill
		sb.set_corner_radius_all(int(size.y * 0.30))
		sb.set_border_width_all(2)
		sb.border_color = Color(accent.r, accent.g, accent.b, 0.65 if (_hover or _down) else 0.4)
		draw_style_box(sb, Rect2(Vector2.ZERO, size))
		var h := size.y
		var pad := h * 0.42
		if icon_kind != "":
			_menu_glyph(icon_kind, Vector2(pad, h * 0.5), h * 0.30, accent)
		var f := get_theme_default_font()
		var fs := int(h * 0.38)
		var tx: float = pad + (h * 0.55 if icon_kind != "" else 0.0)
		var ts := f.get_string_size(text_label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
		draw_string(f, Vector2(tx, h * 0.5 + ts.y * 0.32), text_label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(0.9, 0.97, 1.0))
		var cxr := size.x - pad
		var cy := h * 0.5
		var s := h * 0.15
		var lw: float = max(2.0, h * 0.045)
		draw_line(Vector2(cxr - s, cy - s), Vector2(cxr, cy), accent, lw)
		draw_line(Vector2(cxr, cy), Vector2(cxr - s, cy + s), accent, lw)

	func _menu_glyph(kind: String, center: Vector2, rad: float, c: Color) -> void:
		var lw: float = max(2.0, rad * 0.18)
		match kind:
			"play":
				draw_colored_polygon(PackedVector2Array([
					center + Vector2(-rad * 0.5, -rad * 0.7),
					center + Vector2(rad * 0.75, 0),
					center + Vector2(-rad * 0.5, rad * 0.7),
				]), c)
			"info":
				draw_arc(center, rad, 0, TAU, 28, c, lw)
				draw_circle(center + Vector2(0, -rad * 0.45), rad * 0.14, c)
				draw_line(center + Vector2(0, -rad * 0.08), center + Vector2(0, rad * 0.55), c, lw)
			"gear":
				draw_arc(center, rad * 0.62, 0, TAU, 24, c, lw)
				draw_circle(center, rad * 0.24, c)
				for i in 8:
					var a := TAU * float(i) / 8.0
					var dir := Vector2(cos(a), sin(a))
					draw_line(center + dir * rad * 0.7, center + dir * rad * 1.0, c, lw)
			_:
				pass


## Pagination dots (filled = current page). Non-interactive; navigation is via the arrow buttons.
class PageDots extends Control:
	var count := 1
	var index := 0
	var accent := Color(1.0, 0.82, 0.38)

	func _draw() -> void:
		if count <= 0:
			return
		var rad := size.y * 0.30
		var gap := rad * 3.2
		var total := float(count - 1) * gap
		var x0 := size.x * 0.5 - total * 0.5
		var cy := size.y * 0.5
		for i in count:
			var cx := x0 + float(i) * gap
			if i == index:
				draw_circle(Vector2(cx, cy), rad, accent)
			else:
				draw_circle(Vector2(cx, cy), rad * 0.66, Color(accent.r, accent.g, accent.b, 0.35))
