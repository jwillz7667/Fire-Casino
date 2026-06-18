extends Node2D

## Cosmic Slots — responsive web slot client.
##
## SERVER-AUTHORITATIVE: this scene never decides an outcome. On spin it asks the host
## page (window.CosmicGodot bridge) to place the bet; the page calls the Aureus API and
## hands back the authoritative CosmicOutcome, which this scene animates. Standalone (no
## bridge — desktop/editor or a directly-opened export) a local mock drives the visuals so
## the presentation can be built and QA'd offline.
##
## HEADLINE FEATURE — the BONUS anticipation: BONUS symbols can land on any reel. The
## moment two have landed and reels remain, the board ZOOMS IN slightly and the remaining
## reels do a slowed, suspenseful "special spin" under a rising riser; if a third BONUS
## lands, a JACKPOT SIREN/bell alarm fires and the cosmic bonus award is revealed.
##
## RESPONSIVE: canvas_items + aspect="expand"; every position is recomputed in
## _apply_layout() and re-run on viewport resize. PORTRAIT (phones) is primary — reels in
## the upper-middle, a thumb control deck below; LANDSCAPE (desktop) centres the grid.
##
## Unlike Dragon (frame drawn in code), Cosmic ships neon ART: a reel-window texture
## (art/reel_bg.png) sits behind the symbols and a bezel texture (art/frame.png) sits over
## the edges (its centre is transparent). The 5×3 grid uses NON-SQUARE cells matched to the
## reel-window art's aspect so symbols sit dead-centre in the art's cells.

const DESIGN := Vector2(1080, 1920)   # portrait design reference
const COLS := 5
const ROWS := 3

const SYMBOL_IDS := [
	"CORE", "CRYSTAL", "ORB", "SATELLITE", "ENERGY", "TABLET",
	"A", "K", "Q", "J", "TEN", "NINE",
	"WILD", "SCATTER", "BONUS",
]
const HIGH := ["CORE", "CRYSTAL", "ORB"]
const WILD := "WILD"
const SCATTER := "SCATTER"
const BONUS := "BONUS"

## Reel-window + frame art aspect ratios (w/h). Used to size the 5×3 grid so symbols align
## to the art's cells, and to size the bezel just outside the play area. Measured from the
## shipped art; _load_textures() refines them from the real texture sizes at boot.
var REEL_ASPECT := 1074.0 / 810.0          # reel_bg.png  (cells are taller than wide)
var FRAME_OVER_REEL_W := 1195.0 / 1074.0   # frame.png width  / reel_bg width
var FRAME_OVER_REEL_H := 997.0 / 810.0     # frame.png height / reel_bg height

## The 25 fixed paylines (row per reel, 0=top..2=bottom). Mirrors the server's PAYLINES
## (engines/cosmic/math.ts) so the offline mock highlights the same cells the server would;
## live play uses the server's authoritative `cells`.
const PAYLINES := [
	[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
	[1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
	[1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
	[1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [0, 2, 0, 2, 0],
	[2, 0, 2, 0, 2], [1, 0, 2, 0, 1], [1, 2, 0, 2, 1], [0, 1, 2, 2, 1], [2, 1, 0, 0, 1],
]

## Mock-only paytable (display values for offline demo); the server is authoritative live.
const MOCK_PAY := {
	"CORE": {3: 3750, 4: 19000, 5: 94000},
	"CRYSTAL": {3: 1900, 4: 9500, 5: 47000},
	"ORB": {3: 1400, 4: 7000, 5: 37500},
	"SATELLITE": {3: 940, 4: 3800, 5: 14000},
	"ENERGY": {3: 750, 4: 2800, 5: 11200},
	"TABLET": {3: 560, 4: 2300, 5: 9400},
	"A": {3: 380, 4: 1400, 5: 5600},
	"K": {3: 280, 4: 1100, 5: 4700},
	"Q": {3: 240, 4: 940, 5: 3800},
	"J": {3: 190, 4: 750, 5: 2800},
	"TEN": {3: 160, 4: 620, 5: 2400},
	"NINE": {3: 140, 4: 560, 5: 2200},
}
## BONUS instant award in bps of total bet (mirror engine: 3→20×, 4→100×, 5→500×).
const MOCK_BONUS := {3: 200000, 4: 1000000, 5: 5000000}

const SPIN_SPEED := 2700.0      # px/sec scroll while spinning
const REEL_STOP_STAGGER := 0.14
const ANTICIPATE_STAGGER := 0.62
const CYAN := Color(0.40, 0.86, 1.0)       # primary neon accent
const MAGENTA := Color(0.86, 0.42, 1.0)
const GREEN := Color(0.45, 1.0, 0.7)

# ---- live layout (recomputed every _apply_layout) ----
var view := DESIGN
var portrait := true
var grid_pos := Vector2(120, 360)  # top-left of the 5×3 cell area
var cell_w := 180.0
var cell_h := 226.0
var frame_pos := Vector2.ZERO
var frame_size := Vector2.ZERO

# ---- nodes ----
var board: Node2D              # reel_bg + frame + reels (zoomed on anticipation, shaken on big wins)
var bg_layer: CanvasLayer
var cur_bg: TextureRect
var grad_overlay: TextureRect
var reel_panel: Panel          # code backdrop behind the reel-window art (always present)
var reel_art: TextureRect      # art/reel_bg.png window behind symbols
var frame_art: TextureRect     # art/frame.png neon bezel over the edges (transparent centre)
var sep_layer: Node2D          # thin neon column separators aligned to the grid
var fx_layer: Node2D
var hud: CanvasLayer

var textures := {}             # id -> Texture2D
var _add_mat: CanvasItemMaterial

# reel state: [{window, sprites:[Sprite2D x5], symbols:[id x5], scroll, state}]
var reels := []
var spinning := false

# HUD
var lbl_balance: Label
var lbl_bet: Label
var lbl_win: Label
var lbl_msg: Label
var lbl_mult: Label
var banner: Label
var title_lbl: Label
var spin_btn: TextureButton          # provided art (art/ui/btn_spin.png)
var bet_minus_btn: TextureButton     # provided art (art/ui/btn_bet_minus.png)
var bet_plus_btn: TextureButton      # provided art (art/ui/btn_bet_plus.png)
var sound_btn: TextureButton         # provided art (art/ui/btn_sound.png)
var info_btn: TextureButton          # provided art (art/ui/btn_info.png)
var autospin_btn: Button             # no art provided → subtle code neon pill

# audio
var _audio := {}
var _spin_loop: AudioStreamPlayer
var _music: AudioStreamPlayer

# session (from bridge)
var balance_minor := 0
var bet_minor := 100000
var min_bet := 1000
var max_bet := 2000000
var currency := "CREDIT"
var busy := false
var bridge = null
var _bet_cb = null             # MUST stay referenced or Godot GCs the JS callback
var _bal_timer: Timer

var _autospin := false
var _autospin_left := 0
var _zoomed := false

var BET_STEPS := [1000, 5000, 10000, 50000, 100000, 250000, 500000, 1000000]

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
	_apply_layout()
	_idle_fill()
	_connect_bridge()
	_start_music()
	set_process(true)
	get_viewport().size_changed.connect(_on_resize)
	if OS.get_environment("CSL_SHOT") != "":
		_run_shots()

# Desktop/editor: honour CSL_SIZE=WxH (for layout QA) else the portrait design.
func _apply_window_size() -> void:
	if OS.has_feature("web"):
		return
	var sz := DESIGN
	var env := OS.get_environment("CSL_SIZE")
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

## Decide orientation and the grid rect. Cells are NON-SQUARE, matched to the reel-window
## art aspect (REEL_ASPECT = grid_w/grid_h), so symbols sit centred in the art's cells.
func _layout_metrics() -> void:
	var W := view.x
	var H := view.y
	portrait = H >= W
	# Width- and height-budget the grid, honouring the reel-window aspect ratio.
	var max_gw := W * (0.95 if portrait else 0.62)
	var max_gh := H * (0.42 if portrait else 0.64)
	var gw := max_gw
	var gh := gw / REEL_ASPECT
	if gh > max_gh:
		gh = max_gh
		gw = gh * REEL_ASPECT
	cell_w = gw / COLS
	cell_h = gh / ROWS
	var cy := H * (0.36 if portrait else 0.50)
	grid_pos = Vector2(W * 0.5 - gw * 0.5, cy - gh * 0.5)
	# Bezel sits just outside the play area, scaled by the frame/reel art ratio.
	var fw := gw * FRAME_OVER_REEL_W
	var fh := gh * FRAME_OVER_REEL_H
	frame_size = Vector2(fw, fh)
	frame_pos = Vector2(W * 0.5 - fw * 0.5, cy - fh * 0.5)

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
		for idx in 5:
			reel.sprites[idx].position.x = win_w * 0.5
		_position_reel(reel, false)

# ----------------------------------------------------------------- assets
func _load_textures() -> void:
	for id in SYMBOL_IDS:
		var p := "res://art/symbols/%s.png" % id
		if ResourceLoader.exists(p):
			textures[id] = load(p)
	# Refine the art ratios from the real texture sizes (so geometry tracks the shipped art).
	var rb := "res://art/reel_bg.png"
	var fr := "res://art/frame.png"
	if ResourceLoader.exists(rb):
		var t: Texture2D = load(rb)
		if t and t.get_height() > 0:
			REEL_ASPECT = float(t.get_width()) / float(t.get_height())
		if ResourceLoader.exists(fr):
			var f: Texture2D = load(fr)
			if f and t and t.get_width() > 0:
				FRAME_OVER_REEL_W = float(f.get_width()) / float(t.get_width())
				FRAME_OVER_REEL_H = float(f.get_height()) / float(t.get_height())

func _sym_scale(tex: Texture2D) -> Vector2:
	# Fit the symbol within the cell (cells are taller than wide → fit to width).
	var target: float = min(cell_w, cell_h) * 0.84
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
		"spin_start", "reel_stop", "reel_stop_b", "reel_stop_c",
		"anticipation_riser", "bonus_alarm", "bonus_reveal",
		"scatter_land", "scatter_trigger", "wild_land",
		"win_small", "win_medium", "win_big", "bigwin_fanfare",
		"coin_tick", "button_tap", "bet_change", "error_blip",
	]:
		var st := _cue_stream(name)
		if st == null: continue
		var pl := AudioStreamPlayer.new()
		pl.stream = st
		add_child(pl)
		_audio[name] = pl
	_spin_loop = _make_loop("spin_loop", -11.0)
	_music = _make_loop("music_base_loop", -10.0)

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
		t.tween_property(_spin_loop, "volume_db", -11.0, 0.18)
	else:
		t.tween_property(_spin_loop, "volume_db", -34.0, 0.28)
		t.tween_callback(_spin_loop.stop)

func _start_music() -> void:
	if _music: _music.play()

func _duck_music(on: bool) -> void:
	if _music:
		_music.volume_db = -16.0 if on else -10.0

# ----------------------------------------------------------------- background
func _build_bg() -> void:
	cur_bg = TextureRect.new()
	cur_bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	cur_bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	cur_bg.position = Vector2.ZERO
	cur_bg.size = view
	if ResourceLoader.exists("res://art/bg/space.png"):
		cur_bg.texture = load("res://art/bg/space.png")
	bg_layer.add_child(cur_bg)
	grad_overlay = TextureRect.new()
	grad_overlay.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	grad_overlay.stretch_mode = TextureRect.STRETCH_SCALE
	grad_overlay.texture = _make_vertical_vignette()
	grad_overlay.position = Vector2.ZERO
	grad_overlay.size = view
	bg_layer.add_child(grad_overlay)

func _make_vertical_vignette() -> GradientTexture2D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.20, 0.62, 1.0])
	g.colors = PackedColorArray([
		Color(0.02, 0.01, 0.06, 0.74),
		Color(0.02, 0.01, 0.06, 0.06),
		Color(0.02, 0.01, 0.06, 0.10),
		Color(0.02, 0.01, 0.06, 0.80),
	])
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.fill_from = Vector2(0, 0)
	tex.fill_to = Vector2(0, 1)
	tex.width = 8
	tex.height = 256
	return tex

func _layout_bg() -> void:
	if cur_bg:
		cur_bg.position = Vector2.ZERO
		cur_bg.size = view
	if grad_overlay:
		grad_overlay.position = Vector2.ZERO
		grad_overlay.size = view

# ----------------------------------------------------------------- reel surfaces
func _build_reel_surfaces() -> void:
	# Code backdrop (always present, also covers any reel-window art transparency).
	reel_panel = Panel.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.04, 0.05, 0.13, 0.92)
	sb.border_color = Color(CYAN.r, CYAN.g, CYAN.b, 0.30)
	sb.set_border_width_all(3)
	sb.set_corner_radius_all(20)
	reel_panel.add_theme_stylebox_override("panel", sb)
	reel_panel.z_index = 0
	board.add_child(reel_panel)

	reel_art = TextureRect.new()
	reel_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	reel_art.stretch_mode = TextureRect.STRETCH_SCALE
	reel_art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	reel_art.z_index = 1
	if ResourceLoader.exists("res://art/reel_bg.png"):
		reel_art.texture = load("res://art/reel_bg.png")
	board.add_child(reel_art)

	# Thin neon separators aligned EXACTLY to the symbol grid (independent of any art lines).
	sep_layer = Node2D.new()
	sep_layer.z_index = 4
	board.add_child(sep_layer)

	# Bezel art on top (its centre is transparent so symbols show through).
	frame_art = TextureRect.new()
	frame_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	frame_art.stretch_mode = TextureRect.STRETCH_SCALE
	frame_art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame_art.z_index = 40
	if ResourceLoader.exists("res://art/frame.png"):
		frame_art.texture = load("res://art/frame.png")
	board.add_child(frame_art)

func _layout_reel_surfaces() -> void:
	var gw := cell_w * COLS
	var gh := cell_h * ROWS
	# Code backdrop matches the play area with a tiny outset.
	var pad: float = min(cell_w, cell_h) * 0.06
	reel_panel.position = grid_pos - Vector2(pad, pad)
	reel_panel.size = Vector2(gw + 2 * pad, gh + 2 * pad)
	# Reel-window art exactly covers the play area (its aspect == grid aspect).
	reel_art.position = grid_pos
	reel_art.size = Vector2(gw, gh)
	# Bezel centred on the grid, sized by the frame/reel ratio.
	frame_art.position = frame_pos
	frame_art.size = frame_size
	sep_layer.queue_redraw()
	sep_layer.position = Vector2.ZERO

func _build_reels() -> void:
	for col in COLS:
		var window := Control.new()
		window.clip_contents = true
		window.z_index = 10
		board.add_child(window)
		var sprites := []
		for idx in 5:
			var sp := Sprite2D.new()
			sp.centered = true
			window.add_child(sp)
			sprites.append(sp)
		reels.append({
			"window": window, "sprites": sprites,
			"symbols": ["J", "Q", "K", "A", "TEN"],
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
		reels[col].symbols = [_rand_sym(col), _rand_sym(col), _rand_sym(col), _rand_sym(col), _rand_sym(col)]
	_paint_reels()

func _rand_sym(col: int) -> String:
	# Cosmetic strip. WILD only lives on interior reels (matches the engine); weight toward
	# lows/mids so idle/scroll reads like a base game.
	var pool := [
		"CORE", "CRYSTAL", "ORB",
		"SATELLITE", "SATELLITE", "ENERGY", "ENERGY", "TABLET", "TABLET",
		"A", "A", "K", "K", "Q", "Q", "J", "J", "TEN", "TEN", "NINE", "NINE",
		"SCATTER", "BONUS",
	]
	if col != 0 and col != COLS - 1:
		pool.append("WILD")
	return pool[randi() % pool.size()]

# ----------------------------------------------------------------- process
func _process(dt: float) -> void:
	if not spinning: return
	for col in COLS:
		var reel: Dictionary = reels[col]
		if reel.state != "spin": continue
		reel.scroll += SPIN_SPEED * dt
		while reel.scroll >= cell_h:
			reel.scroll -= cell_h
			reel.symbols.push_front(reel.symbols.pop_back())
			reel.symbols[0] = _rand_sym(col)
		_position_reel(reel, true)

func _position_reel(reel: Dictionary, _blurred: bool) -> void:
	var sprites: Array = reel.sprites
	var syms: Array = reel.symbols
	for idx in 5:
		_apply_symbol(sprites[idx], syms[idx])
		sprites[idx].position.y = (idx - 1) * cell_h + cell_h * 0.5 + reel.scroll

# ----------------------------------------------------------------- spin / round
func request_spin() -> void:
	if busy: return
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
		var final_col: Array = grid[col] if col < grid.size() else [_rand_sym(col), _rand_sym(col), _rand_sym(col)]
		# Two BONUS already landed and reels remain → ZOOM IN + slowed "special spin" hunting
		# the third (the headline anticipation). Scatter near-miss also slows (less drama).
		if not anticipating and bonus_so_far == 2:
			anticipating = true
			_enter_anticipation()
		var scatter_anticipate := not anticipating and scatters_so_far >= 2 and _col_has(final_col, SCATTER)
		if anticipating:
			play("anticipation_riser")
			await get_tree().create_timer(ANTICIPATE_STAGGER).timeout
		elif scatter_anticipate:
			play("anticipation_riser")
			await get_tree().create_timer(0.5).timeout
		else:
			await get_tree().create_timer(REEL_STOP_STAGGER).timeout
		_land_reel(col, final_col)
		_play_stop(col)
		if _col_has(final_col, SCATTER): play("scatter_land")
		if _col_has(final_col, WILD): play("wild_land")
		scatters_so_far += _count_in_col(final_col, SCATTER)
		var bonus_here := _count_in_col(final_col, BONUS)
		if bonus_here > 0:
			play("scatter_land")
			_pulse_bonus_cells(col, final_col)
			bonus_so_far += bonus_here
			if bonus_so_far >= 3:
				# THE THIRD BONUS — jackpot siren / bell alarm.
				play("bonus_alarm")
				_flash("BONUS!")
				_shake(9.0, 0.5)
				anticipating = false   # stop slowing; the reveal takes over
	await get_tree().create_timer(0.20).timeout

func _enter_anticipation() -> void:
	_zoom_board(1.08, 0.35)
	_flash("BONUS HUNT…")
	_shake(3.0, 0.25)

func _zoom_board(factor: float, dur: float) -> void:
	_zoomed = factor != 1.0
	var center := _grid_center()
	var t := create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	t.tween_property(board, "scale", Vector2(factor, factor), dur)
	t.parallel().tween_property(board, "position", center * (1.0 - factor), dur)

func _pulse_bonus_cells(col: int, column: Array) -> void:
	for row in min(column.size(), ROWS):
		if column[row] == BONUS:
			var sp: Sprite2D = reels[col].sprites[row + 1]
			if sp.texture == null: continue
			var base_s := _sym_scale(sp.texture)
			var t := create_tween().set_loops(2).set_trans(Tween.TRANS_SINE)
			t.tween_property(sp, "scale", base_s * 1.22, 0.18)
			t.tween_property(sp, "scale", base_s, 0.18)

func _col_has(col: Array, sym: String) -> bool:
	return col.has(sym)

func _count_in_col(col: Array, sym: String) -> int:
	var n := 0
	for c in col:
		if c == sym: n += 1
	return n

func _play_stop(col: int) -> void:
	var v := ["reel_stop", "reel_stop_b", "reel_stop_c"]
	play(v[col % v.size()])

func _land_reel(col: int, column: Array) -> void:
	var reel: Dictionary = reels[col]
	reel.state = "stopped"
	var c0 = column[0] if column.size() > 0 else _rand_sym(col)
	var c1 = column[1] if column.size() > 1 else _rand_sym(col)
	var c2 = column[2] if column.size() > 2 else _rand_sym(col)
	reel.symbols = [_rand_sym(col), c0, c1, c2, _rand_sym(col)]
	reel.scroll = 0.0
	_position_reel(reel, false)
	# Landing overshoot bounce.
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
	# The cosmic bonus award: the siren already rang as the third symbol landed; now reveal.
	var count := int(bonus.get("bonusCount", 3))
	var award_bps := int(bonus.get("awardBps", 0))
	_duck_music(true)
	play("bonus_reveal")
	_show_banner("COSMIC BONUS")
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
	var tint := MAGENTA if sym == BONUS else (CYAN if strong else GREEN)
	g.modulate = Color(tint.r, tint.g, tint.b, 0.0)
	g.material = _additive_mat()
	g.z_index = 55
	fx_layer.add_child(g)
	var peak := 0.8 if strong else 0.5
	var grow := 1.34 if strong else 1.2
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
	play("bigwin_fanfare")
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
	var t := create_tween()
	var steps := 18
	for i in range(1, steps + 1):
		var v := credits * float(i) / steps
		t.tween_callback(func(): lbl_win.text = "WIN  %s" % _fmt(v)).set_delay(0.03)

# --------------------------------------------------------------- free spins
func _run_free_spins(fs: Dictionary) -> void:
	_duck_music(true)
	play("scatter_trigger")
	play("freespins_enter" if _audio.has("freespins_enter") else "scatter_trigger")
	lbl_mult.visible = true
	var spins: Array = fs.get("spins", [])
	for i in spins.size():
		var sp: Dictionary = spins[i]
		_flash("FREE SPIN  %d / %d" % [i + 1, spins.size()])
		var mult := int(sp.get("multiplier", 1))
		lbl_mult.text = "x%d" % mult
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
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.82))
	l.add_theme_constant_override("outline_size", 6)
	return l

func _build_hud() -> void:
	hud = CanvasLayer.new(); hud.layer = 30; add_child(hud)

	title_lbl = _styled_label(64, CYAN)
	title_lbl.text = "COSMIC SLOTS"
	title_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(title_lbl)

	lbl_mult = _styled_label(60, MAGENTA)
	lbl_mult.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl_mult.visible = false
	hud.add_child(lbl_mult)

	lbl_msg = _styled_label(34, CYAN)
	lbl_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_msg)

	banner = _styled_label(104, MAGENTA)
	banner.text = "BIG WIN"
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.z_index = 5
	banner.visible = false
	hud.add_child(banner)

	lbl_balance = _styled_label(32, Color(0.92, 0.96, 1.0))
	hud.add_child(lbl_balance)

	lbl_win = _styled_label(46, GREEN)
	lbl_win.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_win)

	lbl_bet = _styled_label(34, Color.WHITE)
	lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_bet)

	bet_minus_btn = _tex_button("res://art/ui/btn_bet_minus.png")
	bet_minus_btn.pressed.connect(func(): _change_bet(-1))
	hud.add_child(bet_minus_btn)

	bet_plus_btn = _tex_button("res://art/ui/btn_bet_plus.png")
	bet_plus_btn.pressed.connect(func(): _change_bet(1))
	hud.add_child(bet_plus_btn)

	autospin_btn = _neon_button("AUTO", MAGENTA)
	autospin_btn.pressed.connect(_toggle_autospin)
	hud.add_child(autospin_btn)

	spin_btn = _tex_button("res://art/ui/btn_spin.png")
	spin_btn.pressed.connect(func(): play("button_tap"); request_spin())
	hud.add_child(spin_btn)

	sound_btn = _tex_button("res://art/ui/btn_sound.png")
	sound_btn.pressed.connect(_toggle_sound)
	hud.add_child(sound_btn)

	info_btn = _tex_button("res://art/ui/btn_info.png")
	info_btn.pressed.connect(func(): play("button_tap"))
	hud.add_child(info_btn)

	_update_hud()

func _layout_hud() -> void:
	var W := view.x
	var H := view.y
	if portrait:
		_place_lbl(title_lbl, Vector2(0, H * 0.045), Vector2(W, 78)); _set_font(title_lbl, 64)
		_place_btn(info_btn, Vector2(W * 0.10, H * 0.05), Vector2(84, 84))
		_place_btn(sound_btn, Vector2(W * 0.90, H * 0.05), Vector2(84, 84))

		var grid_bottom := frame_pos.y + frame_size.y
		_place_lbl(lbl_mult, Vector2(0, frame_pos.y - H * 0.05), Vector2(W, 76))
		lbl_mult.pivot_offset = Vector2(W * 0.5, 38)
		_place_lbl(lbl_msg, Vector2(0, grid_bottom + H * 0.012), Vector2(W, 46))
		_place_lbl(banner, Vector2(0, _grid_center().y - 72), Vector2(W, 150))
		banner.pivot_offset = Vector2(W * 0.5, 75)

		_place_lbl(lbl_win, Vector2(0, grid_bottom + H * 0.05), Vector2(W, 64)); _set_font(lbl_win, 52)
		_place_lbl(lbl_balance, Vector2(W * 0.08, H * 0.665), Vector2(W * 0.5, 44)); _set_font(lbl_balance, 34)
		lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		_place_lbl(lbl_bet, Vector2(W * 0.42, H * 0.665), Vector2(W * 0.5, 44)); _set_font(lbl_bet, 34)

		var spin_y := H * 0.862
		_place_btn(spin_btn, Vector2(W * 0.5, spin_y), Vector2(W * 0.34, W * 0.34))
		_place_btn(bet_minus_btn, Vector2(W * 0.18, spin_y), Vector2(W * 0.29, W * 0.165))
		_place_btn(bet_plus_btn, Vector2(W * 0.82, spin_y), Vector2(W * 0.29, W * 0.165))
		_place_btn(autospin_btn, Vector2(W * 0.5, H * 0.742), Vector2(W * 0.22, W * 0.085))
	else:
		_place_lbl(title_lbl, Vector2(0, H * 0.04), Vector2(W, 70)); _set_font(title_lbl, 52)
		_place_btn(info_btn, Vector2(W * 0.05, H * 0.07), Vector2(76, 76))
		_place_btn(sound_btn, Vector2(W * 0.95, H * 0.07), Vector2(76, 76))

		var grid_bottom := frame_pos.y + frame_size.y
		_place_lbl(lbl_mult, Vector2(W - W * 0.22, frame_pos.y), Vector2(W * 0.2, 70))
		lbl_mult.pivot_offset = Vector2(W * 0.1, 35)
		_place_lbl(lbl_msg, Vector2(0, frame_pos.y - 58), Vector2(W, 44))
		_place_lbl(banner, Vector2(0, _grid_center().y - 70), Vector2(W, 140))
		banner.pivot_offset = Vector2(W * 0.5, 70)

		var bar_y := H * 0.9
		_place_lbl(lbl_balance, Vector2(W * 0.04, bar_y - 28), Vector2(W * 0.28, 40)); _set_font(lbl_balance, 30)
		_place_lbl(lbl_win, Vector2(0, grid_bottom + 8), Vector2(W, 56)); _set_font(lbl_win, 44)
		_place_btn(bet_minus_btn, Vector2(W * 0.38, bar_y), Vector2(150, 86))
		lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_place_lbl(lbl_bet, Vector2(W * 0.45, bar_y - 22), Vector2(W * 0.1, 44)); _set_font(lbl_bet, 32)
		_place_btn(bet_plus_btn, Vector2(W * 0.58, bar_y), Vector2(150, 86))
		_place_btn(autospin_btn, Vector2(W * 0.73, bar_y), Vector2(120, 76))
		_place_btn(spin_btn, Vector2(W * 0.88, bar_y), Vector2(150, 150))

func _set_font(l: Control, size: int) -> void:
	l.add_theme_font_size_override("font_size", size)

func _place_lbl(l: Label, pos: Vector2, size: Vector2) -> void:
	l.position = pos
	l.size = size

func _place_btn(b: Control, center: Vector2, size: Vector2) -> void:
	b.custom_minimum_size = size
	b.size = size
	b.position = center - size * 0.5
	b.pivot_offset = size * 0.5

## Button rendered from the OWNER-PROVIDED art (art/ui/btn_*.png); the texture scales to
## fit its box keeping aspect, so the neon SPIN hexagon / BET pills / SOUND+INFO read crisp.
func _tex_button(path: String) -> TextureButton:
	var b := TextureButton.new()
	if ResourceLoader.exists(path):
		b.texture_normal = load(path)
	b.ignore_texture_size = true
	b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	b.pressed.connect(func(): _btn_feedback(b))
	return b

func _neon_button(text: String, accent: Color) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 36)
	b.add_theme_color_override("font_color", Color(0.95, 0.99, 1.0))
	b.add_theme_color_override("font_hover_color", Color(1, 1, 1))
	b.add_theme_color_override("font_pressed_color", accent)
	var normal := StyleBoxFlat.new()
	normal.bg_color = Color(0.05, 0.06, 0.16, 0.85)
	normal.border_color = accent
	normal.set_border_width_all(3)
	normal.set_corner_radius_all(18)
	normal.shadow_color = Color(accent.r, accent.g, accent.b, 0.45)
	normal.shadow_size = 10
	b.add_theme_stylebox_override("normal", normal)
	var hover := normal.duplicate()
	hover.bg_color = Color(0.09, 0.11, 0.24, 0.92)
	b.add_theme_stylebox_override("hover", hover)
	var pressed := normal.duplicate()
	pressed.bg_color = Color(accent.r * 0.3, accent.g * 0.3, accent.b * 0.4, 0.95)
	b.add_theme_stylebox_override("pressed", pressed)
	b.add_theme_stylebox_override("focus", normal)
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
	# No text on the art button — dim it to show the muted state.
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
	if autospin_btn:
		autospin_btn.modulate = MAGENTA if _autospin else Color(1, 1, 1)

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

func _fmt(c: float) -> String:
	if c == floor(c): return "%d" % int(c)
	return "%.2f" % c

func _update_hud() -> void:
	lbl_balance.text = "Balance  %s" % _fmt(float(balance_minor) / 1000.0)
	lbl_bet.text = "Bet %s" % _fmt(float(bet_minor) / 1000.0)

func _flash(msg: String) -> void:
	if lbl_msg: lbl_msg.text = msg

# ----------------------------------------------------- offline screenshot hook
func _run_shots() -> void:
	var dir := OS.get_environment("CSL_SHOT")
	await get_tree().create_timer(1.0).timeout
	await _save_shot(dir + "/01_idle.png")
	if OS.get_environment("CSL_FORCE_BONUS") == "1":
		# Capture the BONUS anticipation: dense frames through the zoom + siren + reveal.
		request_spin()
		for i in range(1, 20):
			await get_tree().create_timer(0.35).timeout
			await _save_shot(dir + "/seq_%02d.png" % i)
		get_tree().quit()
		return
	request_spin()
	await get_tree().create_timer(2.4).timeout
	await _save_shot(dir + "/02_spin.png")
	await get_tree().create_timer(2.2).timeout
	await _save_shot(dir + "/03_result.png")
	get_tree().quit()

func _save_shot(path: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img: img.save_png(path)

# --------------------------------------------------------------------- bridge
func _connect_bridge() -> void:
	if not OS.has_feature("web"): return
	if not JavaScriptBridge.has_method("get_interface"): return
	var ok = JavaScriptBridge.eval("typeof window.CosmicGodot === 'object'", true)
	if ok:
		bridge = JavaScriptBridge.get_interface("CosmicGodot")
		var init_json: String = str(JavaScriptBridge.eval("JSON.stringify(window.CosmicGodot.getInit())", true))
		var init = JSON.parse_string(init_json)
		if typeof(init) == TYPE_DICTIONARY:
			balance_minor = int(str(init.get("balanceMinor", 0)))
			min_bet = int(str(init.get("minBetMinor", 1000)))
			max_bet = int(str(init.get("maxBetMinor", 2000000)))
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
	var j: String = str(JavaScriptBridge.eval("JSON.stringify(window.CosmicGodot.getInit())", true))
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
	if scatter == 3: scatter_pay = 56000
	elif scatter == 4: scatter_pay = 280000
	elif scatter >= 5: scatter_pay = 1400000
	var spin_bps := (line_bps + scatter_pay) * multiplier
	return {
		"grid": grid, "lineWins": wins, "scatterCount": scatter, "scatterPayBps": scatter_pay,
		"bonusCount": bonus, "bonusPayBps": 0, "multiplier": multiplier, "spinWinBps": spin_bps,
	}

## Force a guaranteed BONUS-anticipation demo every ~4th spin so offline QA exercises the
## zoom + siren without waiting on RNG. Live play is fully server-decided.
var _demo_n := 0
func _mock_outcome() -> Dictionary:
	_demo_n += 1
	var base := _mock_spin_result(1)
	if _demo_n % 4 == 0 or OS.get_environment("CSL_FORCE_BONUS") == "1":
		base = _force_bonus_grid(3)
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
	return {
		"kind": "cosmic-slots", "win": total_bps > 0,
		"base": base, "freeSpins": fs, "bonus": bonus, "totalWinBps": total_bps,
	}

func _force_bonus_grid(n: int) -> Dictionary:
	# Place exactly n BONUS on distinct reels (left to right) for the demo anticipation.
	var grid := []
	for col in COLS:
		var column := []
		for row in ROWS:
			column.append(_rand_sym(col))
		grid.append(column)
	for col in min(n, COLS):
		grid[col][randi() % ROWS] = BONUS
	var bonus := 0
	for col in COLS:
		for row in ROWS:
			if grid[col][row] == BONUS: bonus += 1
	return {
		"grid": grid, "lineWins": [], "scatterCount": 0, "scatterPayBps": 0,
		"bonusCount": bonus, "bonusPayBps": 0, "multiplier": 1, "spinWinBps": 0,
	}
