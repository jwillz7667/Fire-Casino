extends Node2D

## Legend of the Flaming Kirin — responsive web slot client.
##
## SERVER-AUTHORITATIVE: this scene never decides an outcome. On spin it asks the host page
## (window.FlamingKirinGodot bridge) to place the bet; the page calls the Aureus API and hands
## back the authoritative outcome, which this scene animates. Standalone (no bridge — editor or
## a directly-opened export) a local mock drives the visuals so the presentation can be built
## and QA'd offline.
##
## LAYERING (the "emerging from the frame" look): a dark backplate (art/ui/reel_backplate.jpg)
## sits at the back; per-reel CLIPPED symbol windows scroll above it; the ornate GOLD frame
## (art/ui/reel_frame.png — its centre cut to transparency by tools/prep-assets.py) sits ON TOP,
## so a symbol scrolling in from above is hidden by the frame's top border until it drops into
## the window. The grid is placed inside the frame's cut window using the WIN_* fractions the
## prep script printed.
##
## 2.5D ANIMATION: parallax ember field + slow background drift, idle "breathing" on premium
## symbols, a fire-burst + shake when a WILD lands, anticipation zoom on bonus hunts, a rising
## Kirin-Fire multiplier in free spins, and a four-tier jackpot siren — so the AI art reads as
## alive and dimensional without a real 3D pipeline.

const DESIGN := Vector2(1080, 1920)
const COLS := 5
const ROWS := 4
const SPR := 6   # sprites per reel: idx0 buffer, idx1..4 the 4 visible rows, idx5 buffer

const SYMBOL_IDS := [
	"KIRIN", "QUEEN", "PHOENIX", "SHARK", "CHEST", "BELL", "RUBY", "LOTUS",
	"A", "K", "Q", "J", "WILD", "SCATTER", "BONUS",
]
## Engine symbol id → art file stem under art/symbols/.
const SYMBOL_FILE := {
	"KIRIN": "sym_kirin", "QUEEN": "sym_sea_dragon_queen", "PHOENIX": "sym_phoenix_king",
	"SHARK": "sym_golden_shark", "CHEST": "sym_treasure_chest", "BELL": "sym_bell",
	"RUBY": "sym_ruby", "LOTUS": "sym_lotus", "A": "card_a", "K": "card_k", "Q": "card_q",
	"J": "card_j", "WILD": "sym_wild", "SCATTER": "sym_scatter", "BONUS": "sym_bonus",
}
const HIGH := ["KIRIN", "QUEEN", "PHOENIX", "SHARK"]
const WILD := "WILD"
const SCATTER := "SCATTER"
const BONUS := "BONUS"

## The 25 fixed paylines (row per reel, 0=top..3=bottom). Mirrors the server's PAYLINES
## (engines/kirin/math.ts) so the offline mock highlights the same cells; live play uses the
## server's authoritative `cells`.
const PAYLINES := [
	[1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [3, 3, 3, 3, 3], [0, 1, 2, 1, 0],
	[3, 2, 1, 2, 3], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2], [0, 0, 1, 0, 0], [3, 3, 2, 3, 3],
	[1, 0, 0, 0, 1], [2, 3, 3, 3, 2], [0, 1, 1, 1, 0], [3, 2, 2, 2, 3], [1, 2, 2, 2, 1],
	[2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [3, 2, 3, 2, 3], [1, 0, 1, 0, 1], [2, 3, 2, 3, 2],
	[0, 2, 0, 2, 0], [3, 1, 3, 1, 3], [1, 3, 1, 3, 1], [2, 0, 2, 0, 2], [0, 3, 0, 3, 0],
]

## Mock-only paytable (offline demo display); the server is authoritative live.
const MOCK_PAY := {
	"KIRIN": {3: 40000, 4: 200000, 5: 1000000}, "QUEEN": {3: 25000, 4: 120000, 5: 600000},
	"PHOENIX": {3: 18000, 4: 90000, 5: 450000}, "SHARK": {3: 12000, 4: 50000, 5: 180000},
	"CHEST": {3: 9000, 4: 36000, 5: 140000}, "BELL": {3: 7000, 4: 28000, 5: 100000},
	"RUBY": {3: 5000, 4: 20000, 5: 80000}, "LOTUS": {3: 4000, 4: 16000, 5: 64000},
	"A": {3: 3000, 4: 12000, 5: 48000}, "K": {3: 2500, 4: 10000, 5: 40000},
	"Q": {3: 2000, 4: 8000, 5: 32000}, "J": {3: 1500, 4: 6000, 5: 24000},
}
const MOCK_BONUS := {3: 200000, 4: 1000000, 5: 5000000}

## Cut-window opening as fractions of the frame art (printed by tools/prep-assets.py:
## ">>> reel_frame window fractions (l,t,r,b)").
const WIN_L := 0.1307
const WIN_T := 0.2266
const WIN_R := 0.8683
const WIN_B := 0.8673

const SPIN_SPEED := 2900.0
const REEL_STOP_STAGGER := 0.14
const ANTICIPATE_STAGGER := 0.62

const GOLD := Color(1.0, 0.78, 0.30)
const EMBER := Color(1.0, 0.5, 0.18)
const CRIMSON := Color(1.0, 0.34, 0.26)
const AQUA := Color(0.42, 0.86, 1.0)
const GREEN := Color(0.5, 1.0, 0.62)

## Jackpot tiers: display seed (dollars, pure flavour — the award is a fixed bet-multiple), and
## plate art + accent. Seeded near the source mockup figures, climb slowly on screen.
const JP_TIERS := ["GRAND", "MAJOR", "MINOR", "MINI"]
const JP_SEED := {"GRAND": 1234567.89, "MAJOR": 1269318.89, "MINOR": 21267.29, "MINI": 23932.59}
const JP_PLATE := {"GRAND": "jackpot_grand", "MAJOR": "jackpot_major", "MINOR": "jackpot_minor", "MINI": "jackpot_mini"}
const JP_COLOR := {"GRAND": Color(1.0, 0.5, 0.3), "MAJOR": Color(0.86, 0.45, 1.0), "MINOR": Color(0.42, 0.82, 1.0), "MINI": Color(0.5, 1.0, 0.6)}

# ---- live layout ----
var view := DESIGN
var portrait := true
var grid_pos := Vector2(120, 360)
var cell_w := 180.0
var cell_h := 200.0
var frame_pos := Vector2.ZERO
var frame_size := Vector2.ZERO
var win_pos := Vector2.ZERO      # the frame's cut opening (backplate fills this)
var win_size := Vector2.ZERO
var frame_aspect := 1100.0 / 741.0

# ---- nodes ----
var board: Node2D
var bg_layer: CanvasLayer
var cur_bg: TextureRect
var grad_overlay: TextureRect
var embers: CPUParticles2D
var backplate: TextureRect
var frame_art: TextureRect
var fx_layer: Node2D
var hud: CanvasLayer

var textures := {}
var _add_mat: CanvasItemMaterial

# reel state: [{window, sprites:[Sprite2D xSPR], symbols:[id xSPR], scroll, state}]
var reels := []
var spinning := false

# HUD
var logo: TextureRect
var lbl_balance: Label
var lbl_bet: Label
var lbl_win: Label
var lbl_msg: Label
var lbl_mult: Label
var banner: Label
var spin_btn: TextureButton
var bet_minus_btn: TextureButton
var bet_plus_btn: TextureButton
var maxbet_btn: TextureButton
var autoplay_btn: TextureButton
var autobet_btn: TextureButton
var sound_btn: TextureButton
var info_btn: TextureButton
var settings_btn: TextureButton
var chat_btn: TextureButton

# jackpot panel
var _jp_plate := {}     # tier -> TextureRect
var _jp_label := {}     # tier -> Label
var _jp_value := {}      # tier -> float (climbing display dollars)

# audio
var _audio := {}
var _spin_loop: AudioStreamPlayer
var _music: AudioStreamPlayer
var _audio_unlocked := false

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
var _zoomed := false
var _t := 0.0   # global animation clock (breathing / drift)

var BET_STEPS := [50, 100, 250, 500, 1000, 2000, 5000, 10000]  # $0.05 .. $10.00

func _ready() -> void:
	randomize()
	_apply_window_size()
	view = get_viewport().get_visible_rect().size
	_load_textures()
	_load_audio()
	for t in JP_TIERS:
		_jp_value[t] = JP_SEED[t]

	bg_layer = CanvasLayer.new(); bg_layer.layer = -10; add_child(bg_layer)
	_build_bg()
	board = Node2D.new(); board.name = "Board"; add_child(board)
	fx_layer = Node2D.new(); fx_layer.name = "Fx"; fx_layer.z_index = 60; add_child(fx_layer)

	_build_reel_surfaces()
	_build_reels()
	_build_hud()
	_apply_layout()
	_idle_fill()
	_connect_bridge()
	set_process(true)
	set_process_input(true)
	get_viewport().size_changed.connect(_on_resize)
	if OS.get_environment("FK_SHOT") != "":
		_run_shots()

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
	var env := OS.get_environment("FK_SIZE")
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

# ----------------------------------------------------------------- layout
func _apply_layout() -> void:
	_layout_metrics()
	_position_all_reels()
	_layout_reel_surfaces()
	_layout_bg()
	_layout_hud()

## Fit the ornate frame into the available area honouring its native aspect, then place the 5×4
## grid INSIDE the frame's cut window (the WIN_* fractions). Cells fill the window edge-to-edge
## (non-square); symbols are scaled to the min cell dimension so they stay square + centred.
func _layout_metrics() -> void:
	var W := view.x
	var H := view.y
	portrait = H >= W
	# The frame art is WIDE + thick-bordered (wrong shape for a portrait phone), so sizing it to
	# fit on-screen left the reel window small. Instead size it so the WINDOW fills ~the full
	# screen width — the window (reels) stays fully on-screen and large, and only the ornate gold
	# BORDER bleeds toward/off the screen edges. WIN width is (WIN_R-WIN_L) of the frame, so to put
	# the window at ~0.96 of W the frame width = 0.96*W/(WIN_R-WIN_L).
	var win_w_frac := WIN_R - WIN_L
	var max_fw := (W * 0.97 / win_w_frac) if portrait else (W * 0.66)
	var max_fh := H * (0.62 if portrait else 0.70)
	var fw := max_fw
	var fh := fw / frame_aspect
	if fh > max_fh:
		fh = max_fh
		fw = fh * frame_aspect
	var cy := H * (0.40 if portrait else 0.48)
	frame_pos = Vector2(W * 0.5 - fw * 0.5, cy - fh * 0.5)
	frame_size = Vector2(fw, fh)
	# the frame's cut opening (the dark backplate fills this whole rect)
	win_pos = Vector2(frame_pos.x + WIN_L * fw, frame_pos.y + WIN_T * fh)
	win_size = Vector2((WIN_R - WIN_L) * fw, (WIN_B - WIN_T) * fh)
	# SQUARE cells, the 5×4 grid centred in the opening with even dark margins (the frame art is
	# wider than a 5:4 grid, so centring square cells reads far cleaner than stretching them).
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
	var fr := "res://art/ui/reel_frame.png"
	if ResourceLoader.exists(fr):
		var f: Texture2D = load(fr)
		if f and f.get_height() > 0:
			frame_aspect = float(f.get_width()) / float(f.get_height())

func _sym_scale(tex: Texture2D) -> Vector2:
	var target: float = min(cell_w, cell_h) * 0.90
	var s: float = target / float(tex.get_width())
	return Vector2(s, s)

func _additive_mat() -> CanvasItemMaterial:
	if _add_mat == null:
		_add_mat = CanvasItemMaterial.new()
		_add_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	return _add_mat

# ----------------------------------------------------------------- audio
func _cue_stream(name: String) -> AudioStream:
	for ext in [".ogg", ".wav"]:
		var p := "res://audio/cues/%s%s" % [name, ext]
		if ResourceLoader.exists(p):
			return load(p)
	return null

func _load_audio() -> void:
	for name in [
		"spin_start", "spin_press", "reel_land", "reel_land_b", "reel_land_c",
		"fireball_land", "holdspin_enter", "holdspin_respin", "grand_jackpot", "coin_shower",
		"win_small", "win_medium", "win_big", "bigwin_fanfare", "megawin_fanfare",
		"coin_tick", "button_tap", "bet_change", "error_blip",
	]:
		var st := _cue_stream(name)
		if st == null: continue
		var pl := AudioStreamPlayer.new()
		pl.stream = st
		add_child(pl)
		_audio[name] = pl
	_spin_loop = _make_loop("spin_loop", -12.0)
	_music = _make_loop("music_base_loop", -11.0)

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
	var pl = _audio.get(name, null)
	if pl: pl.play()

func _spin_whir(on: bool) -> void:
	if _spin_loop == null: return
	var t := create_tween()
	if on:
		_spin_loop.volume_db = -30.0
		if not _spin_loop.playing: _spin_loop.play()
		t.tween_property(_spin_loop, "volume_db", -12.0, 0.18)
	else:
		t.tween_property(_spin_loop, "volume_db", -34.0, 0.28)
		t.tween_callback(_spin_loop.stop)

func _start_music() -> void:
	if _music: _music.play()

func _duck_music(on: bool) -> void:
	if _music:
		_music.volume_db = -17.0 if on else -11.0

# ----------------------------------------------------------------- background
func _build_bg() -> void:
	cur_bg = TextureRect.new()
	cur_bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	cur_bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	if ResourceLoader.exists("res://art/bg/bg_main.jpg"):
		cur_bg.texture = load("res://art/bg/bg_main.jpg")
	bg_layer.add_child(cur_bg)

	# rising ember field for depth (parallax-ish — slow, soft, additive).
	embers = CPUParticles2D.new()
	embers.amount = 60
	embers.lifetime = 5.0
	embers.preprocess = 3.0
	embers.direction = Vector2(0, -1)
	embers.gravity = Vector2(0, -26)
	embers.initial_velocity_min = 14.0
	embers.initial_velocity_max = 48.0
	embers.angular_velocity_min = -40.0
	embers.angular_velocity_max = 40.0
	embers.scale_amount_min = 2.0
	embers.scale_amount_max = 6.0
	embers.color = Color(1.0, 0.55, 0.2, 0.5)
	var ramp := Gradient.new()
	ramp.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	ramp.colors = PackedColorArray([Color(1, 0.7, 0.3, 0.0), Color(1, 0.55, 0.2, 0.7), Color(1, 0.3, 0.15, 0.0)])
	embers.color_ramp = ramp
	embers.material = _additive_mat()
	bg_layer.add_child(embers)

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
		Color(0.01, 0.02, 0.05, 0.72),
		Color(0.01, 0.02, 0.05, 0.04),
		Color(0.01, 0.02, 0.05, 0.10),
		Color(0.01, 0.02, 0.05, 0.82),
	])
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.fill_from = Vector2(0, 0)
	tex.fill_to = Vector2(0, 1)
	tex.width = 8
	tex.height = 256
	return tex

func _layout_bg() -> void:
	# Background slightly OVERSCANNED so the slow drift never shows an edge (parallax depth).
	var over := 1.07
	if cur_bg:
		cur_bg.size = view * over
		cur_bg.position = -view * (over - 1.0) * 0.5
	if grad_overlay:
		grad_overlay.position = Vector2.ZERO
		grad_overlay.size = view
	if embers:
		embers.position = Vector2(view.x * 0.5, view.y + 20.0)
		embers.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
		embers.emission_rect_extents = Vector2(view.x * 0.5, 8.0)

# ----------------------------------------------------------------- reel surfaces
func _build_reel_surfaces() -> void:
	# Dark backplate behind the symbols (fills the frame's cut window).
	backplate = TextureRect.new()
	backplate.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	backplate.stretch_mode = TextureRect.STRETCH_SCALE
	backplate.mouse_filter = Control.MOUSE_FILTER_IGNORE
	backplate.z_index = 1
	if ResourceLoader.exists("res://art/ui/reel_backplate.jpg"):
		backplate.texture = load("res://art/ui/reel_backplate.jpg")
	board.add_child(backplate)

	# Ornate gold frame ON TOP (its centre is transparent so symbols show through the hole).
	frame_art = TextureRect.new()
	frame_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	frame_art.stretch_mode = TextureRect.STRETCH_SCALE
	frame_art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame_art.z_index = 40
	if ResourceLoader.exists("res://art/ui/reel_frame.png"):
		frame_art.texture = load("res://art/ui/reel_frame.png")
	board.add_child(frame_art)

func _layout_reel_surfaces() -> void:
	# backplate fills the whole cut opening (so symbols sit on dark with even margins); frame on top.
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
			"symbols": ["A", "K", "Q", "J", "A", "K"],
			"scroll": 0.0, "state": "idle",
		})

func _paint_reels() -> void:
	for col in COLS:
		_position_reel(reels[col], false)

func _apply_symbol(sp: Sprite2D, id: String) -> void:
	var tex = textures.get(id, null)
	sp.texture = tex
	sp.modulate = Color(1, 1, 1, 1)
	if tex: sp.scale = _sym_scale(tex)

func _idle_fill() -> void:
	for col in COLS:
		var s := []
		for idx in SPR:
			s.append(_rand_sym(col))
		reels[col].symbols = s
	_paint_reels()

func _rand_sym(col: int) -> String:
	var pool := [
		"KIRIN", "QUEEN", "PHOENIX", "SHARK",
		"CHEST", "CHEST", "BELL", "BELL", "RUBY", "RUBY", "LOTUS", "LOTUS",
		"A", "A", "K", "K", "Q", "Q", "J", "J",
		"SCATTER", "BONUS",
	]
	if col != 0 and col != COLS - 1:
		pool.append("WILD")
	return pool[randi() % pool.size()]

# ----------------------------------------------------------------- process
func _process(dt: float) -> void:
	_t += dt
	_drift_bg()
	_climb_jackpots(dt)
	if spinning:
		for col in COLS:
			var reel: Dictionary = reels[col]
			if reel.state != "spin": continue
			reel.scroll += SPIN_SPEED * dt
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
	cur_bg.position = base + Vector2(sin(_t * 0.13) * 14.0, cos(_t * 0.11) * 10.0)

## Subtle idle "breathing" on landed premium picture symbols → reads as living/dimensional.
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
			var k := 1.0 + 0.028 * sin(_t * 2.1 + col * 0.7 + row * 0.5)
			sp.scale = base_s * k

func _position_reel(reel: Dictionary, blurred: bool) -> void:
	var sprites: Array = reel.sprites
	var syms: Array = reel.symbols
	for idx in SPR:
		_apply_symbol(sprites[idx], syms[idx])
		sprites[idx].position.y = (idx - 1) * cell_h + cell_h * 0.5 + reel.scroll
		if blurred and sprites[idx].texture:
			# pseudo motion-blur: stretch vertically + fade while scrolling fast.
			sprites[idx].scale = _sym_scale(sprites[idx].texture) * Vector2(0.96, 1.22)
			sprites[idx].modulate = Color(1, 1, 1, 0.92)

# ----------------------------------------------------------------- spin / round
func request_spin() -> void:
	if busy: return
	_unlock_audio()
	busy = true
	spin_btn.disabled = true
	lbl_win.text = ""
	_flash("")
	_reset_dim()
	play("spin_start")
	_spin_whir(true)
	spinning = true
	for col in COLS:
		reels[col].state = "spin"
	if bridge != null:
		_bet_cb = JavaScriptBridge.create_callback(_on_bridge_result)
		bridge.placeBet(bet_minor, _bet_cb)
	else:
		await get_tree().create_timer(0.9).timeout
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
	var base: Dictionary = outcome.get("base", {})
	var grid: Array = base.get("grid", [])
	await _stop_reels(grid)
	_spin_whir(false)
	if _zoomed:
		_zoom_board(1.0, 0.3)
	await _present_win(base, int(base.get("spinWinBps", outcome.get("totalWinBps", 0))))
	if outcome.get("bonus", null) != null:
		await _present_bonus(outcome.bonus)
	if outcome.get("jackpot", null) != null:
		await _present_jackpot(outcome.jackpot)
	if outcome.get("freeSpins", null) != null:
		await _run_free_spins(outcome.freeSpins)
	_update_hud()
	busy = false
	spinning = false
	spin_btn.disabled = false
	_maybe_autospin()

func _stop_reels(grid: Array) -> void:
	var bonus_so_far := 0
	var scatters_so_far := 0
	var anticipating := false
	for col in COLS:
		var final_col: Array = grid[col] if col < grid.size() else _rand_col(col)
		if not anticipating and bonus_so_far == 2:
			anticipating = true
			_enter_anticipation()
		var scatter_anticipate := not anticipating and scatters_so_far >= 2 and final_col.has(SCATTER)
		if anticipating:
			play("holdspin_enter")
			await get_tree().create_timer(ANTICIPATE_STAGGER).timeout
		elif scatter_anticipate:
			play("holdspin_enter")
			await get_tree().create_timer(0.5).timeout
		else:
			await get_tree().create_timer(REEL_STOP_STAGGER).timeout
		_land_reel(col, final_col)
		_play_stop(col)
		if final_col.has(SCATTER): play("fireball_land")
		if final_col.has(WILD):
			play("fireball_land")
			_wild_burst(col, final_col)
		scatters_so_far += _count_in_col(final_col, SCATTER)
		var bonus_here := _count_in_col(final_col, BONUS)
		if bonus_here > 0:
			play("fireball_land")
			_pulse_bonus_cells(col, final_col)
			bonus_so_far += bonus_here
			if bonus_so_far >= 3:
				play("grand_jackpot")
				_flash("BONUS!")
				_shake(9.0, 0.5)
				anticipating = false
	await get_tree().create_timer(0.20).timeout

func _rand_col(col: int) -> Array:
	var c := []
	for row in ROWS:
		c.append(_rand_sym(col))
	return c

func _enter_anticipation() -> void:
	_zoom_board(1.07, 0.35)
	_flash("KIRIN HUNT…")
	_shake(3.0, 0.25)

func _zoom_board(factor: float, dur: float) -> void:
	_zoomed = factor != 1.0
	var center := _grid_center()
	var t := create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	t.tween_property(board, "scale", Vector2(factor, factor), dur)
	t.parallel().tween_property(board, "position", center * (1.0 - factor), dur)

## A WILD landing throws a short fire-burst of additive embers + a glow flash and a tiny shake —
## the "Kirin Fire" wild reads as alive.
func _wild_burst(col: int, column: Array) -> void:
	for row in min(column.size(), ROWS):
		if column[row] != WILD: continue
		var burst := CPUParticles2D.new()
		burst.position = _cell_world(col, row)
		burst.z_index = 58
		burst.one_shot = true
		burst.explosiveness = 0.9
		burst.amount = 22
		burst.lifetime = 0.7
		burst.direction = Vector2(0, -1)
		burst.spread = 180.0
		burst.gravity = Vector2(0, -40)
		burst.initial_velocity_min = 60.0
		burst.initial_velocity_max = 200.0
		burst.scale_amount_min = 2.0
		burst.scale_amount_max = 7.0
		burst.color = Color(1.0, 0.6, 0.2, 0.9)
		burst.material = _additive_mat()
		fx_layer.add_child(burst)
		burst.emitting = true
		get_tree().create_timer(1.2).timeout.connect(burst.queue_free)
		_glow_cell(col, row, WILD, true)
	_shake(2.5, 0.18)

func _pulse_bonus_cells(col: int, column: Array) -> void:
	for row in min(column.size(), ROWS):
		if column[row] == BONUS:
			var sp: Sprite2D = reels[col].sprites[row + 1]
			if sp.texture == null: continue
			var base_s := _sym_scale(sp.texture)
			var t := create_tween().set_loops(2).set_trans(Tween.TRANS_SINE)
			t.tween_property(sp, "scale", base_s * 1.22, 0.18)
			t.tween_property(sp, "scale", base_s, 0.18)

func _count_in_col(col: Array, sym: String) -> int:
	var n := 0
	for c in col:
		if c == sym: n += 1
	return n

func _play_stop(col: int) -> void:
	var v := ["reel_land", "reel_land_b", "reel_land_c"]
	play(v[col % v.size()])

func _land_reel(col: int, column: Array) -> void:
	var reel: Dictionary = reels[col]
	reel.state = "stopped"
	var c0 = column[0] if column.size() > 0 else _rand_sym(col)
	var c1 = column[1] if column.size() > 1 else _rand_sym(col)
	var c2 = column[2] if column.size() > 2 else _rand_sym(col)
	var c3 = column[3] if column.size() > 3 else _rand_sym(col)
	reel.symbols = [_rand_sym(col), c0, c1, c2, c3, _rand_sym(col)]
	reel.scroll = 0.0
	_position_reel(reel, false)
	var win: Control = reel.window
	var base_y := grid_pos.y
	win.position.y = base_y - 16.0
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(win, "position:y", base_y, 0.26)

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

# ----------------------------------------------------------------- win present
func _reset_dim() -> void:
	for col in COLS:
		for sp in reels[col].sprites:
			sp.modulate = Color(1, 1, 1, 1)

func _winning_cells(base: Dictionary) -> Dictionary:
	var cells := {}
	for w in base.get("lineWins", []):
		var sym: String = str(w.get("symbol", ""))
		for c in w.get("cells", []):
			if typeof(c) == TYPE_ARRAY and c.size() >= 2:
				cells["%d:%d" % [int(c[0]), int(c[1])]] = sym
	if int(base.get("scatterCount", 0)) >= 3:
		var grid: Array = base.get("grid", [])
		for col in grid.size():
			var column: Array = grid[col]
			for row in column.size():
				if column[row] == SCATTER:
					cells["%d:%d" % [col, row]] = SCATTER
	return cells

func _present_win(base: Dictionary, total_bps: int) -> void:
	var cells := _winning_cells(base)
	if cells.is_empty() and total_bps == 0:
		_flash(""); return

	for col in COLS:
		for sp in reels[col].sprites:
			sp.modulate = Color(1, 1, 1, 0.34)
	var any_high := false
	for key in cells.keys():
		var parts: Array = key.split(":")
		var col := int(parts[0]); var row := int(parts[1])
		if col < 0 or col >= COLS or row < 0 or row >= ROWS: continue
		var sp: Sprite2D = reels[col].sprites[row + 1]
		sp.modulate = Color(1, 1, 1, 1)
		var base_s := _sym_scale(sp.texture) if sp.texture else Vector2.ONE
		var t := create_tween().set_loops(3).set_trans(Tween.TRANS_SINE)
		t.tween_property(sp, "scale", base_s * 1.18, 0.16)
		t.tween_property(sp, "scale", base_s, 0.16)
		var sym: String = cells[key]
		if sym in HIGH or sym == SCATTER: any_high = true
		_glow_cell(col, row, sym, sym in HIGH or sym == SCATTER)

	var mult := float(total_bps) / 10000.0
	if mult >= 50.0:
		await _mega_win()
	elif mult >= 8.0:
		await _big_win()
	else:
		play("win_big" if any_high else ("win_medium" if mult >= 2.0 else "win_small"))
	_count_up(total_bps)
	await get_tree().create_timer(0.5).timeout

func _present_bonus(bonus: Dictionary) -> void:
	var count := int(bonus.get("bonusCount", 3))
	var award_bps := int(bonus.get("awardBps", 0))
	_duck_music(true)
	play("coin_shower")
	_show_banner("FISH BONUS")
	_flash("%d BONUS  —  +%s" % [count, _fmt(float(award_bps) / 10000.0 * float(bet_minor) / 1000.0)])
	for col in COLS:
		for row in ROWS:
			if reels[col].symbols.size() > row + 1 and reels[col].symbols[row + 1] == BONUS:
				_glow_cell(col, row, BONUS, true)
	_shake(7.0, 0.6)
	await get_tree().create_timer(1.8).timeout
	_count_up(award_bps)
	await get_tree().create_timer(0.6).timeout
	_duck_music(false)

func _present_jackpot(jp: Dictionary) -> void:
	var tier := str(jp.get("tier", "MINI"))
	var award_bps := int(jp.get("awardBps", 0))
	_duck_music(true)
	play("grand_jackpot")
	_show_banner("%s JACKPOT" % tier)
	_flash("%s JACKPOT  —  +%s" % [tier, _fmt(float(award_bps) / 10000.0 * float(bet_minor) / 1000.0)])
	if _jp_plate.has(tier):
		_pulse(_jp_plate[tier])
		var plate: TextureRect = _jp_plate[tier]
		var t := create_tween().set_loops(4).set_trans(Tween.TRANS_SINE)
		t.tween_property(plate, "modulate", Color(1.6, 1.5, 1.2), 0.16)
		t.tween_property(plate, "modulate", Color(1, 1, 1), 0.16)
	_shake(12.0, 0.8)
	await get_tree().create_timer(2.0).timeout
	_count_up(award_bps)
	await get_tree().create_timer(0.8).timeout
	_duck_music(false)

func _cell_world(col: int, row: int) -> Vector2:
	return board.position + Vector2(_reel_x(col), _row_y(row)) * board.scale.x

func _glow_cell(col: int, row: int, sym: String, strong: bool) -> void:
	var tex = textures.get(sym, null)
	if tex == null: return
	var base_s := _sym_scale(tex) * board.scale.x
	var g := Sprite2D.new()
	g.texture = tex
	g.centered = true
	g.position = _cell_world(col, row)
	g.scale = base_s * 1.02
	var tint := EMBER if sym == BONUS else (GOLD if strong else GREEN)
	g.modulate = Color(tint.r, tint.g, tint.b, 0.0)
	g.material = _additive_mat()
	g.z_index = 55
	fx_layer.add_child(g)
	var peak := 0.85 if strong else 0.5
	var grow := 1.36 if strong else 1.2
	var t := create_tween().set_trans(Tween.TRANS_SINE)
	t.tween_property(g, "modulate:a", peak, 0.18)
	t.parallel().tween_property(g, "scale", base_s * grow, 0.18)
	t.tween_property(g, "modulate:a", 0.0, 0.55)
	t.tween_callback(g.queue_free)

func _big_win() -> void:
	play("bigwin_fanfare")
	_shake(7.0, 0.4)
	_show_banner("BIG WIN")
	await get_tree().create_timer(1.4).timeout

func _mega_win() -> void:
	play("megawin_fanfare")
	_shake(13.0, 0.7)
	_show_banner("MEGA WIN")
	await get_tree().create_timer(2.0).timeout

func _show_banner(text: String) -> void:
	banner.text = text
	banner.visible = true
	banner.modulate = Color(1, 1, 1, 0)
	banner.scale = Vector2(0.6, 0.6)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(banner, "modulate", Color(1, 1, 1, 1), 0.25)
	t.parallel().tween_property(banner, "scale", Vector2(1, 1), 0.35)
	t.tween_interval(1.0)
	t.tween_property(banner, "modulate", Color(1, 1, 1, 0), 0.4)
	t.tween_callback(func(): banner.visible = false)

func _shake(mag: float, dur: float) -> void:
	var origin := board.position
	var steps := int(dur / 0.04)
	var t := create_tween()
	for i in steps:
		var m := mag * (1.0 - float(i) / steps)
		t.tween_property(board, "position", origin + Vector2(randf_range(-m, m), randf_range(-m, m)), 0.04)
	t.tween_property(board, "position", origin, 0.06)

func _count_up(total_bps: int) -> void:
	var credits := float(total_bps) / 10000.0 * float(bet_minor) / 1000.0
	if credits <= 0:
		return
	play("coin_tick")
	lbl_win.text = "WIN  %s" % _fmt(credits)
	lbl_win.pivot_offset = lbl_win.size * 0.5
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	lbl_win.scale = Vector2(1.28, 1.28)
	t.tween_property(lbl_win, "scale", Vector2(1.0, 1.0), 0.24)

# --------------------------------------------------------------- free spins
func _run_free_spins(fs: Dictionary) -> void:
	_duck_music(true)
	play("holdspin_enter")
	lbl_mult.visible = true
	var spins: Array = fs.get("spins", [])
	for i in spins.size():
		var sp: Dictionary = spins[i]
		_flash("KIRIN FREE GAME  %d / %d" % [i + 1, spins.size()])
		var mult := int(sp.get("multiplier", 1))
		lbl_mult.text = "KIRIN FIRE  x%d" % mult
		_pulse(lbl_mult)
		_spin_whir(true)
		spinning = true
		for col in COLS:
			reels[col].state = "spin"
		await get_tree().create_timer(0.4).timeout
		await _stop_reels(sp.get("grid", []))
		spinning = false
		_spin_whir(false)
		if _zoomed:
			_zoom_board(1.0, 0.25)
		await _present_win(sp, int(sp.get("spinWinBps", 0)))
		await get_tree().create_timer(0.2).timeout
	lbl_mult.visible = false
	_flash("")
	_duck_music(false)

func _pulse(node: CanvasItem) -> void:
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	node.scale = Vector2(1.4, 1.4)
	t.tween_property(node, "scale", Vector2(1, 1), 0.3)

# ------------------------------------------------------------------------ HUD
func _styled_label(size: int, color: Color) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("outline_size", 6)
	return l

func _build_hud() -> void:
	hud = CanvasLayer.new(); hud.layer = 30; add_child(hud)

	logo = TextureRect.new()
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if ResourceLoader.exists("res://art/ui/title_logo.png"):
		logo.texture = load("res://art/ui/title_logo.png")
	hud.add_child(logo)

	_build_jackpot_panel()

	lbl_mult = _styled_label(54, EMBER)
	lbl_mult.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl_mult.visible = false
	hud.add_child(lbl_mult)

	lbl_msg = _styled_label(34, GOLD)
	lbl_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_msg)

	banner = _styled_label(104, EMBER)
	banner.text = "BIG WIN"
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.z_index = 5
	banner.visible = false
	hud.add_child(banner)

	lbl_balance = _styled_label(32, Color(0.95, 0.97, 1.0))
	hud.add_child(lbl_balance)

	lbl_win = _styled_label(46, GOLD)
	lbl_win.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_win)

	lbl_bet = _styled_label(34, Color.WHITE)
	lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_bet)

	bet_minus_btn = _tex_button("res://art/ui/btn_minus.png")
	bet_minus_btn.pressed.connect(func(): _change_bet(-1))
	hud.add_child(bet_minus_btn)

	bet_plus_btn = _tex_button("res://art/ui/btn_plus.png")
	bet_plus_btn.pressed.connect(func(): _change_bet(1))
	hud.add_child(bet_plus_btn)

	maxbet_btn = _tex_button("res://art/ui/btn_maxbet.png")
	maxbet_btn.pressed.connect(_max_bet)
	hud.add_child(maxbet_btn)

	autoplay_btn = _tex_button("res://art/ui/btn_autoplay.png")
	autoplay_btn.pressed.connect(_toggle_autospin)
	hud.add_child(autoplay_btn)

	autobet_btn = _tex_button("res://art/ui/btn_autobet.png")
	autobet_btn.pressed.connect(_toggle_autospin)
	hud.add_child(autobet_btn)

	spin_btn = _tex_button("res://art/ui/btn_spin.png")
	spin_btn.pressed.connect(func(): play("spin_press"); request_spin())
	hud.add_child(spin_btn)

	info_btn = _tex_button("res://art/ui/btn_info.png")
	info_btn.pressed.connect(func(): play("button_tap"))
	hud.add_child(info_btn)

	settings_btn = _tex_button("res://art/ui/btn_settings.png")
	settings_btn.pressed.connect(func(): play("button_tap"))
	hud.add_child(settings_btn)

	sound_btn = _tex_button("res://art/ui/btn_sound.png")
	sound_btn.pressed.connect(_toggle_sound)
	hud.add_child(sound_btn)

	chat_btn = _tex_button("res://art/ui/btn_chat.png")
	chat_btn.pressed.connect(func(): play("button_tap"))
	hud.add_child(chat_btn)

	_update_hud()

func _build_jackpot_panel() -> void:
	for tier in JP_TIERS:
		var plate := TextureRect.new()
		plate.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		plate.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var p := "res://art/ui/%s.png" % JP_PLATE[tier]
		if ResourceLoader.exists(p):
			plate.texture = load(p)
		hud.add_child(plate)
		_jp_plate[tier] = plate
		var lbl := _styled_label(30, JP_COLOR[tier])
		lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		hud.add_child(lbl)
		_jp_label[tier] = lbl

func _climb_jackpots(dt: float) -> void:
	for tier in JP_TIERS:
		# tiny stochastic climb for "live progressive" flavour (display only).
		_jp_value[tier] += dt * (randf() * (8.0 if tier == "GRAND" else (6.0 if tier == "MAJOR" else 0.5)))
		if _jp_label.has(tier):
			_jp_label[tier].text = _fmt(_jp_value[tier])

func _layout_hud() -> void:
	var W := view.x
	var H := view.y
	if portrait:
		_place_lbl(logo, Vector2(W * 0.5 - W * 0.45, H * 0.006), Vector2(W * 0.90, H * 0.078))
		_layout_jp(W, H, true)

		var grid_bottom := frame_pos.y + frame_size.y
		# win + multiplier ribbon just under the reels
		_place_lbl(lbl_mult, Vector2(0, grid_bottom + H * 0.004), Vector2(W, 60)); _set_font(lbl_mult, 46)
		lbl_mult.pivot_offset = Vector2(W * 0.5, 30)
		_place_lbl(lbl_win, Vector2(0, grid_bottom + H * 0.045), Vector2(W, 64)); _set_font(lbl_win, 54)
		_place_lbl(lbl_msg, Vector2(0, grid_bottom + H * 0.098), Vector2(W, 44)); _set_font(lbl_msg, 32)
		_place_lbl(banner, Vector2(0, _grid_center().y - 75), Vector2(W, 150))
		banner.pivot_offset = Vector2(W * 0.5, 75)

		# balance (left) / bet (right) readout row
		_place_lbl(lbl_balance, Vector2(W * 0.06, H * 0.745), Vector2(W * 0.5, 44)); _set_font(lbl_balance, 34)
		lbl_balance.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		_place_lbl(lbl_bet, Vector2(W * 0.44, H * 0.745), Vector2(W * 0.5, 44)); _set_font(lbl_bet, 34)

		# main control deck: AUTOPLAY  −  [ SPIN ]  +  AUTOBET  — one clean row, no overlap
		var spin_y := H * 0.835
		_place_btn(spin_btn, Vector2(W * 0.5, spin_y), Vector2(W * 0.30, W * 0.30))
		_place_btn(bet_minus_btn, Vector2(W * 0.255, spin_y), Vector2(W * 0.125, W * 0.125))
		_place_btn(bet_plus_btn, Vector2(W * 0.745, spin_y), Vector2(W * 0.125, W * 0.125))
		_place_btn(autoplay_btn, Vector2(W * 0.095, spin_y), Vector2(W * 0.12, W * 0.12))
		_place_btn(autobet_btn, Vector2(W * 0.905, spin_y), Vector2(W * 0.12, W * 0.12))
		# utility row: MAX BET pill + info / settings / sound / chat
		var icon_y := H * 0.935
		_place_btn(maxbet_btn, Vector2(W * 0.135, icon_y), Vector2(W * 0.18, W * 0.085))
		_place_btn(info_btn, Vector2(W * 0.40, icon_y), Vector2(W * 0.095, W * 0.095))
		_place_btn(settings_btn, Vector2(W * 0.525, icon_y), Vector2(W * 0.095, W * 0.095))
		_place_btn(sound_btn, Vector2(W * 0.65, icon_y), Vector2(W * 0.095, W * 0.095))
		_place_btn(chat_btn, Vector2(W * 0.775, icon_y), Vector2(W * 0.095, W * 0.095))
	else:
		_place_lbl(logo, Vector2(W * 0.5 - W * 0.22, H * 0.01), Vector2(W * 0.44, H * 0.10))
		_layout_jp(W, H, false)
		_place_lbl(lbl_mult, Vector2(W - W * 0.24, frame_pos.y), Vector2(W * 0.22, 60))
		lbl_mult.pivot_offset = Vector2(W * 0.11, 30)
		_place_lbl(lbl_msg, Vector2(0, frame_pos.y - 56), Vector2(W, 44))
		_place_lbl(banner, Vector2(0, _grid_center().y - 70), Vector2(W, 140))
		banner.pivot_offset = Vector2(W * 0.5, 70)

		var bar_y := H * 0.9
		var grid_bottom := frame_pos.y + frame_size.y
		_place_lbl(lbl_balance, Vector2(W * 0.04, bar_y - 28), Vector2(W * 0.28, 40)); _set_font(lbl_balance, 30)
		_place_lbl(lbl_win, Vector2(0, grid_bottom + 8), Vector2(W, 56)); _set_font(lbl_win, 44)
		_place_btn(bet_minus_btn, Vector2(W * 0.36, bar_y), Vector2(96, 96))
		lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_place_lbl(lbl_bet, Vector2(W * 0.42, bar_y - 22), Vector2(W * 0.1, 44)); _set_font(lbl_bet, 32)
		_place_btn(bet_plus_btn, Vector2(W * 0.55, bar_y), Vector2(96, 96))
		_place_btn(maxbet_btn, Vector2(W * 0.65, bar_y), Vector2(120, 76))
		_place_btn(autoplay_btn, Vector2(W * 0.74, bar_y), Vector2(96, 96))
		_place_btn(spin_btn, Vector2(W * 0.88, bar_y), Vector2(150, 150))
		_place_btn(info_btn, Vector2(W * 0.05, H * 0.12), Vector2(72, 72))
		_place_btn(settings_btn, Vector2(W * 0.05, H * 0.20), Vector2(72, 72))
		_place_btn(sound_btn, Vector2(W * 0.95, H * 0.12), Vector2(72, 72))
		_place_btn(chat_btn, Vector2(W * 0.95, H * 0.20), Vector2(72, 72))

func _layout_jp(W: float, H: float, is_portrait: bool) -> void:
	# Four jackpot plates stacked between the logo and the reels (portrait) / down the left
	# (landscape), each with its climbing display value centred on the plate.
	if is_portrait:
		var top := H * 0.088
		var pw := W * 0.66
		var ph := H * 0.030
		var gap := ph * 1.08
		var i := 0
		for tier in JP_TIERS:
			var y := top + i * gap
			_place_lbl(_jp_plate[tier], Vector2(W * 0.5 - pw * 0.5, y), Vector2(pw, ph))
			_place_lbl(_jp_label[tier], Vector2(W * 0.5 - pw * 0.16, y), Vector2(pw * 0.60, ph))
			_set_font(_jp_label[tier], int(ph * 0.52))
			i += 1
	else:
		var pw2 := W * 0.26
		var ph2 := H * 0.07
		var i2 := 0
		for tier in JP_TIERS:
			var y2 := H * 0.16 + i2 * (ph2 * 1.08)
			_place_lbl(_jp_plate[tier], Vector2(W * 0.02, y2), Vector2(pw2, ph2))
			_place_lbl(_jp_label[tier], Vector2(W * 0.02 + pw2 * 0.2, y2), Vector2(pw2 * 0.62, ph2))
			_set_font(_jp_label[tier], int(ph2 * 0.42))
			i2 += 1

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

func _btn_feedback(b: Control) -> void:
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	b.scale = Vector2(0.92, 0.92)
	t.tween_property(b, "scale", Vector2(1, 1), 0.18)

var _muted := false
func _toggle_sound() -> void:
	_muted = not _muted
	AudioServer.set_bus_mute(AudioServer.get_bus_index("Master"), _muted)
	sound_btn.modulate = Color(0.55, 0.55, 0.6) if _muted else Color(1, 1, 1)

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
	var c := EMBER if _autospin else Color(1, 1, 1)
	if autoplay_btn: autoplay_btn.modulate = c
	if autobet_btn: autobet_btn.modulate = c

func _maybe_autospin() -> void:
	if not _autospin: return
	_autospin_left -= 1
	if _autospin_left <= 0:
		_autospin = false
		_update_autospin_visual()
		return
	await get_tree().create_timer(0.5).timeout
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
	lbl_balance.text = "Balance  %s" % _fmt(float(balance_minor) / 1000.0)
	lbl_bet.text = "Bet %s" % _fmt(float(bet_minor) / 1000.0)

func _flash(msg: String) -> void:
	if lbl_msg: lbl_msg.text = msg

# ----------------------------------------------------- offline screenshot hook
func _run_shots() -> void:
	var dir := OS.get_environment("FK_SHOT")
	await get_tree().create_timer(1.0).timeout
	await _save_shot(dir + "/01_idle.png")
	request_spin()
	for i in range(1, 14):
		await get_tree().create_timer(0.45).timeout
		await _save_shot(dir + "/seq_%02d.png" % i)
	get_tree().quit()

func _save_shot(path: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img: img.save_png(path)

# --------------------------------------------------------------------- bridge
func _connect_bridge() -> void:
	if not OS.has_feature("web"): return
	if not JavaScriptBridge.has_method("get_interface"): return
	var ok = JavaScriptBridge.eval("typeof window.FlamingKirinGodot === 'object'", true)
	if ok:
		bridge = JavaScriptBridge.get_interface("FlamingKirinGodot")
		var init_json: String = str(JavaScriptBridge.eval("JSON.stringify(window.FlamingKirinGodot.getInit())", true))
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
	var j: String = str(JavaScriptBridge.eval("JSON.stringify(window.FlamingKirinGodot.getInit())", true))
	var d = JSON.parse_string(j)
	if typeof(d) == TYPE_DICTIONARY:
		var b := int(str(d.get("balanceMinor", balance_minor)))
		if b != balance_minor:
			balance_minor = b
			_update_hud()

# ----------------------------------------------------------------------- mock
func _eval_lines(grid: Array) -> Array:
	var wins := []
	for li in PAYLINES.size():
		var rows: Array = PAYLINES[li]
		var target: String = grid[0][rows[0]]
		if target == WILD or target == SCATTER or target == BONUS: continue
		var run := 0
		var cells := []
		for reel in COLS:
			var c: String = grid[reel][rows[reel]]
			if c == target or c == WILD:
				run += 1
				cells.append([reel, rows[reel]])
			else:
				break
		if run >= 3 and MOCK_PAY.has(target):
			var pay := int(MOCK_PAY[target].get(run, 0))
			if pay > 0:
				wins.append({"line": li, "symbol": target, "count": run, "payBps": pay, "cells": cells})
	return wins

func _mock_spin_result(multiplier: int) -> Dictionary:
	var grid := []
	for col in COLS:
		var column := []
		for row in ROWS:
			column.append(_rand_sym(col))
		grid.append(column)
	var wins := _eval_lines(grid)
	var line_bps := 0
	for w in wins: line_bps += int(w.payBps)
	var scatter := 0
	var bonus := 0
	for col in COLS:
		for row in ROWS:
			if grid[col][row] == SCATTER: scatter += 1
			if grid[col][row] == BONUS: bonus += 1
	var scatter_pay := 0
	if scatter == 3: scatter_pay = 50000
	elif scatter == 4: scatter_pay = 250000
	elif scatter >= 5: scatter_pay = 1250000
	var spin_bps := (line_bps + scatter_pay) * multiplier
	return {
		"grid": grid, "lineWins": wins, "scatterCount": scatter, "scatterPayBps": scatter_pay,
		"bonusCount": bonus, "bonusPayBps": 0, "multiplier": multiplier, "spinWinBps": spin_bps,
	}

var _demo_n := 0
func _mock_outcome() -> Dictionary:
	_demo_n += 1
	var base := _mock_spin_result(1)
	if _demo_n % 5 == 0:
		base = _force_special_grid(BONUS, 3)
	elif _demo_n % 5 == 3:
		base = _force_special_grid(SCATTER, 3)
	var total_bps := int(base.spinWinBps)
	var bonus = null
	var bonus_count := int(base.bonusCount)
	if bonus_count >= 3:
		var award: int = MOCK_BONUS.get(min(bonus_count, 5), 200000)
		base.bonusPayBps = award
		total_bps += award
		bonus = {"triggered": true, "bonusCount": bonus_count, "awardBps": award}
	var fs = null
	if int(base.scatterCount) >= 3:
		var spins := []
		var awarded := 8
		var fs_total := 0
		for i in awarded:
			var m: int = min(i + 1, 10)
			var sr := _mock_spin_result(m)
			spins.append(sr)
			fs_total += int(sr.spinWinBps)
		fs = {"triggered": true, "spins": spins, "totalSpins": awarded, "endMultiplier": min(awarded, 10), "totalBps": fs_total}
		total_bps += fs_total
	var jackpot = null
	if _demo_n % 7 == 0:
		jackpot = {"tier": "MINOR", "awardBps": 500000}
		total_bps += 500000
	return {
		"kind": "flaming-kirin", "win": total_bps > 0,
		"base": base, "freeSpins": fs, "bonus": bonus, "jackpot": jackpot, "totalWinBps": total_bps,
	}

func _force_special_grid(sym: String, n: int) -> Dictionary:
	var grid := []
	for col in COLS:
		var column := []
		for row in ROWS:
			column.append(_rand_sym(col))
		grid.append(column)
	for col in min(n, COLS):
		grid[col][randi() % ROWS] = sym
	var count := 0
	for col in COLS:
		for row in ROWS:
			if grid[col][row] == sym: count += 1
	return {
		"grid": grid, "lineWins": [], "scatterCount": (count if sym == SCATTER else 0),
		"scatterPayBps": 0, "bonusCount": (count if sym == BONUS else 0), "bonusPayBps": 0,
		"multiplier": 1, "spinWinBps": 0,
	}
