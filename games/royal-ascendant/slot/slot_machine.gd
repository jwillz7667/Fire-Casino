extends Node2D

## Royal Ascendant — responsive web slot client.
##
## SERVER-AUTHORITATIVE: this scene never decides an outcome. On spin it asks the host
## page (window.RoyalGodot bridge) to place the bet; the page calls the Aureus API and
## hands back the authoritative RoyalOutcome, which this scene animates. Standalone
## (no bridge — desktop/editor or a directly-opened export) a local mock drives the
## visuals so the presentation can be built and QA'd offline.
##
## RESPONSIVE: the project uses canvas_items + aspect="expand", so the 2D logical
## viewport grows in the device's long axis. We read the real viewport every layout and
## branch PORTRAIT (mobile, reels upper-centre + a bottom thumb-deck of controls) vs
## LANDSCAPE (desktop, the classic wide layout). Nothing is hard-pinned to 1280×720;
## every position is recomputed in _apply_layout() and re-run on viewport resize.
##
## Self-contained: every texture/sound is loaded from this repo (res://art, res://audio).

const DESIGN := Vector2(1280, 720)   # landscape design reference
const COLS := 5
const ROWS := 3

# Landscape reel-frame placement (the ornate 5×3 grid art) as design coordinates.
const LAND_FRAME_POS := Vector2(196, 96)
const LAND_FRAME_SIZE := Vector2(888, 494)
# Frame art aspect (inner opening shares it): used to size the frame width-bound.
const FRAME_ASPECT := 494.0 / 888.0
# Measured from reel_frame.png: the maroon cells (gold-divider midpoints) as insets
# of the frame rect. Orientation-independent — they scale with the frame.
const INSET_LEFT := 0.086
const INSET_RIGHT := 0.093
const INSET_TOP := 0.125
const INSET_BOTTOM := 0.093

const SYMBOL_IDS := ["QUEEN", "CASTLE", "SHIELD", "A", "K", "Q", "J", "TEN", "JOKER", "CHEST"]
const HIGH := ["QUEEN", "CASTLE", "SHIELD"]
const WILD := "JOKER"
const SCATTER := "CHEST"

const SPIN_SPEED := 2400.0      # px/sec scroll while spinning
const REEL_STOP_STAGGER := 0.15
const GOLD := Color(0.96, 0.82, 0.42)

# ---- live layout (recomputed every _apply_layout) ----
var view := Vector2(1280, 720)     # real logical viewport size
var portrait := false
var frame_pos := LAND_FRAME_POS
var frame_size := LAND_FRAME_SIZE

# ---- derived grid geometry ----
var _ix := 0.0
var _iy := 0.0
var _cell_w := 0.0
var _cell_h := 0.0
var _sym_px := 0.0

# ---- nodes ----
var board: Node2D              # reels + frame (shaken on big wins)
var bg_layer: CanvasLayer
var cur_bg: TextureRect
var grad_overlay: TextureRect  # portrait: darkens top/bottom over the stretched bg
var frame_spr: Sprite2D
var fx_layer: Node2D
var hud: CanvasLayer

var textures := {}             # id -> Texture2D (sharp)
var blur_tex := {}             # id -> Texture2D (motion-blurred)
var _add_mat: CanvasItemMaterial   # additive blend for symbol-glow halos
var title_font: Font           # Cinzel Decorative (OFL) — medieval/regal display

# reel state: [{window, sprites:[Sprite2D x5], symbols:[id x5], scroll, state}]
var reels := []
var spinning := false

# Server-sent SlotFeel render hints for the current spin (winTier/anticipation/nearMiss).
# Set in _resolve from the authoritative outcome; reset to {} for auto-played free spins so the
# base-spin hints never bleed across rounds. Empty ⇒ fall back to the local heuristics.
var _feel := {}
var _coin_texture: Texture2D    # lazy radial gold token reused by the win-tier coin shower
var _glow_texture: Texture2D    # lazy radial gold glow reused by the anticipation column pulse

# ---- winning-symbol flash (WAYS) state ----
var _win_groups := []          # per winning symbol: {sym, cells:[{col,row,sym}], strong}
var _win_has_wild := false     # any contributing cell is a wild substitute (→ wild_expand cue)
var _flash_gen := 0            # generation token; a new spin bumps it to kill the running loop
var _flash_nodes := []         # Line2D connectors to free between phases / on clear
var _flash_tweens := []        # active pulse tweens; killed + cleared per phase and on clear

# HUD (all stored so _layout_hud can reposition them per orientation)
var title_lbl: Label
var lbl_balance: Label
var lbl_bet: Label
var lbl_win: Label
var lbl_msg: Label
var lbl_mult: Label
var spin_btn: TextureButton
var bet_minus_btn: TextureButton
var bet_plus_btn: TextureButton
var maxbet_btn: TextureButton
var sound_btn: TextureButton
var info_btn: TextureButton
var banner: Label

# audio
var _audio := {}               # name -> AudioStreamPlayer (one-shot)
var _spin_loop: AudioStreamPlayer  # looped hypnotic reel whir (faded in/out)
var _music: AudioStreamPlayer
var _ambience: AudioStreamPlayer

# session (from bridge)
var balance_minor := 0
var bet_minor := 1000
var min_bet := 50
var max_bet := 10000
var currency := "CREDIT"
var busy := false
var bridge = null
var _bet_cb = null             # MUST stay referenced or Godot GCs the JS callback
                               # before the bet reply fires (→ reels spin forever)

var BET_STEPS := [50, 100, 250, 500, 1000, 2000, 5000, 10000]  # $0.05 .. $10.00

func _ready() -> void:
	randomize()
	_apply_window_size()
	view = get_viewport().get_visible_rect().size
	_load_textures()
	_load_fonts()
	_load_audio()

	bg_layer = CanvasLayer.new(); bg_layer.layer = -10; add_child(bg_layer)
	_build_bg()
	_set_bg(false)
	board = Node2D.new(); board.name = "Board"; add_child(board)
	fx_layer = Node2D.new(); fx_layer.name = "Fx"; fx_layer.z_index = 60; add_child(fx_layer)

	_build_frame()
	_build_reels()
	_build_hud()
	_apply_layout()
	_idle_fill()
	_connect_bridge()
	_start_music()
	set_process(true)
	get_viewport().size_changed.connect(_on_resize)
	if OS.get_environment("RAS_SHOT") != "":
		_run_shots()

# Desktop/editor: honour RAS_SIZE=WxH (for portrait QA) else the landscape design.
func _apply_window_size() -> void:
	if OS.has_feature("web"):
		return
	var sz := DESIGN
	var env := OS.get_environment("RAS_SIZE")
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
	_compute_geometry()
	if frame_spr and frame_spr.texture:
		frame_spr.position = frame_pos + frame_size * 0.5
		frame_spr.scale = frame_size / frame_spr.texture.get_size()
	_position_all_reels()
	_layout_bg()
	_layout_hud()

## Decide orientation and the reel-frame rect. Portrait: the frame is width-bound to
## ~94% of the screen and vertically centred in the upper reel zone (0.09–0.49 H), so
## the reels stay large and the lower half is free for the control deck. Landscape: the
## classic design rect, centred if the viewport is wider/taller than the 1280×720 base.
func _layout_metrics() -> void:
	var W := view.x
	var H := view.y
	portrait = H > W
	if portrait:
		var avail_w := W * 0.94
		var avail_h := H * 0.42
		var fw: float = min(avail_w, avail_h / FRAME_ASPECT)
		var fh := fw * FRAME_ASPECT
		frame_size = Vector2(fw, fh)
		# Sit the reels in the lower-middle: frame bottom ~0.53H (just above the win
		# readout), leaving the medieval title + a bg expanse above and the control
		# deck below. (Previously centred at 0.29H — the reels sat too high.)
		var center := Vector2(W * 0.5, H * 0.53 - fh * 0.5)
		frame_pos = center - frame_size * 0.5
	else:
		frame_size = LAND_FRAME_SIZE
		var ox: float = max(0.0, (W - DESIGN.x) * 0.5)
		var oy: float = max(0.0, (H - DESIGN.y) * 0.5)
		frame_pos = LAND_FRAME_POS + Vector2(ox, oy)

func _compute_geometry() -> void:
	_ix = frame_pos.x + INSET_LEFT * frame_size.x
	_iy = frame_pos.y + INSET_TOP * frame_size.y
	var iw := (1.0 - INSET_LEFT - INSET_RIGHT) * frame_size.x
	var ih := (1.0 - INSET_TOP - INSET_BOTTOM) * frame_size.y
	_cell_w = iw / COLS
	_cell_h = ih / ROWS
	_sym_px = min(_cell_w, _cell_h) * 0.88

func _reel_x(col: int) -> float:
	return _ix + (col + 0.5) * _cell_w

func _row_y(row: int) -> float:
	return _iy + (row + 0.5) * _cell_h

func _position_all_reels() -> void:
	if reels.is_empty():
		return
	var win_w := _cell_w
	var win_h := _cell_h * ROWS
	for col in COLS:
		var reel: Dictionary = reels[col]
		var window: Control = reel.window
		window.position = Vector2(_reel_x(col) - win_w * 0.5, _iy)
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
		var b := "res://art/symbols_blur/%s.png" % id
		if ResourceLoader.exists(b):
			blur_tex[id] = load(b)

func _load_fonts() -> void:
	for p in ["res://fonts/CinzelDecorative-Bold.ttf", "res://fonts/CinzelDecorative-Black.ttf"]:
		if ResourceLoader.exists(p):
			title_font = load(p)
			return

func _sym_scale(tex: Texture2D) -> Vector2:
	var s := _sym_px / float(tex.get_width())
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
		"spin_start", "spin_press", "reel_stop", "reel_stop_b", "reel_stop_c",
		"anticipation_riser", "nearmiss_hold", "win_small", "win_medium", "win_big",
		"bigwin_fanfare", "megawin_fanfare", "coin_tick", "coin_shower", "wild_land",
		"wild_expand", "scatter_land", "scatter_trigger", "chest_open", "freespins_enter",
		"multiplier_apply", "button_tap", "bet_change", "autospin_toggle", "error_blip",
	]:
		var st := _cue_stream(name)
		if st == null: continue
		var pl := AudioStreamPlayer.new()
		pl.stream = st
		add_child(pl)
		_audio[name] = pl
	# The hypnotic spinning-reel whir: looped, started on spin, faded out as reels stop.
	_spin_loop = _make_loop("spin_loop", -10.0)
	_music = _make_loop("music_base_loop", -8.0)
	_ambience = _make_loop("ambient_castle", -16.0)

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

# Fade the looped reel whir in (spin start) or out (reels settled).
func _spin_whir(on: bool) -> void:
	if _spin_loop == null: return
	var t := create_tween()
	if on:
		_spin_loop.volume_db = -28.0
		if not _spin_loop.playing: _spin_loop.play()
		t.tween_property(_spin_loop, "volume_db", -10.0, 0.18)
	else:
		t.tween_property(_spin_loop, "volume_db", -34.0, 0.28)
		t.tween_callback(_spin_loop.stop)

func _start_music() -> void:
	if _ambience: _ambience.play()
	if _music: _music.play()

func _swap_freespins_music(on: bool) -> void:
	if _music:
		_music.volume_db = -4.0 if on else -8.0

# ----------------------------------------------------------------- background
func _build_bg() -> void:
	cur_bg = TextureRect.new()
	cur_bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	cur_bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	cur_bg.position = Vector2.ZERO
	cur_bg.size = view
	bg_layer.add_child(cur_bg)
	# Vertical darkening so a center-cropped landscape bg reads as a deliberate portrait
	# backdrop and the HUD text stays legible over the top/bottom thirds.
	grad_overlay = TextureRect.new()
	grad_overlay.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	grad_overlay.stretch_mode = TextureRect.STRETCH_SCALE
	grad_overlay.texture = _make_vertical_vignette()
	grad_overlay.position = Vector2.ZERO
	grad_overlay.size = view
	grad_overlay.visible = false
	bg_layer.add_child(grad_overlay)

func _make_vertical_vignette() -> GradientTexture2D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.30, 0.62, 1.0])
	g.colors = PackedColorArray([
		Color(0.02, 0.01, 0.03, 0.82),
		Color(0.02, 0.01, 0.03, 0.10),
		Color(0.02, 0.01, 0.03, 0.18),
		Color(0.02, 0.01, 0.03, 0.86),
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
		grad_overlay.visible = portrait

func _set_bg(fs: bool) -> void:
	var path := "res://art/bg/%s.jpg" % ("bg_freespins" if fs else "bg_base")
	if not ResourceLoader.exists(path) or cur_bg == null: return
	var tex: Texture2D = load(path)
	if cur_bg.texture == null:
		cur_bg.texture = tex
		return
	# crossfade
	var old := cur_bg.texture
	var fade := TextureRect.new()
	fade.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	fade.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	fade.position = Vector2.ZERO; fade.size = view; fade.texture = old
	bg_layer.add_child(fade)
	bg_layer.move_child(fade, cur_bg.get_index())
	cur_bg.texture = tex
	cur_bg.modulate = Color(1, 1, 1, 0)
	var t := create_tween()
	t.tween_property(cur_bg, "modulate", Color(1, 1, 1, 1), 0.5)
	t.parallel().tween_property(fade, "modulate", Color(1, 1, 1, 0), 0.5)
	t.tween_callback(fade.queue_free)

# ----------------------------------------------------------------- frame + reels
func _build_frame() -> void:
	var frame_path := "res://art/ui/reel_frame.png"
	if not ResourceLoader.exists(frame_path): return
	# Sprite2D (NOT TextureRect): a Control's texture min-size/anchor handling rendered
	# the frame at the wrong rect under the web canvas stretch, so the frame and the
	# Sprite2D symbols diverged. A Sprite2D shares the exact same canvas transform as the
	# symbols, so they can never misalign. Positioned/scaled in _apply_layout().
	frame_spr = Sprite2D.new()
	frame_spr.texture = load(frame_path)
	frame_spr.centered = true
	frame_spr.z_index = 2   # backdrop: opaque maroon cells sit BEHIND the symbols
	board.add_child(frame_spr)

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
			"symbols": ["TEN", "J", "Q", "K", "A"],
			"scroll": 0.0, "state": "idle",
		})

func _paint_reels() -> void:
	for col in COLS:
		var reel: Dictionary = reels[col]
		_position_reel(reel, false)

func _apply_symbol(sp: Sprite2D, id: String, blurred: bool) -> void:
	var tex = (blur_tex.get(id, null) if blurred else null)
	if tex == null: tex = textures.get(id, null)
	sp.texture = tex
	sp.modulate = Color(1, 1, 1, 1)
	if tex: sp.scale = _sym_scale(tex)

func _idle_fill() -> void:
	for col in COLS:
		var reel: Dictionary = reels[col]
		reel.symbols = [_rand_sym(col), _rand_sym(col), _rand_sym(col), _rand_sym(col), _rand_sym(col)]
	_paint_reels()

func _rand_sym(col: int) -> String:
	# Cosmetic strip. The wild only lives on interior reels (matches the engine);
	# weight toward lows so idle/scroll reads like a base game.
	var pool := ["QUEEN", "CASTLE", "SHIELD", "A", "A", "K", "K", "Q", "Q", "J", "J", "TEN", "TEN", "CHEST"]
	if col != 0 and col != COLS - 1:
		pool.append("JOKER")
	return pool[randi() % pool.size()]

# ----------------------------------------------------------------- process
func _process(dt: float) -> void:
	if not spinning: return
	for col in COLS:
		var reel: Dictionary = reels[col]
		if reel.state != "spin": continue
		reel.scroll += SPIN_SPEED * dt
		while reel.scroll >= _cell_h:
			reel.scroll -= _cell_h
			reel.symbols.push_front(reel.symbols.pop_back())
			reel.symbols[0] = _rand_sym(col)
		_position_reel(reel, true)

func _position_reel(reel: Dictionary, blurred: bool) -> void:
	var sprites: Array = reel.sprites
	var syms: Array = reel.symbols
	for idx in 5:
		_apply_symbol(sprites[idx], syms[idx], blurred)
		sprites[idx].position.y = (idx - 1) * _cell_h + _cell_h * 0.5 + reel.scroll

# ----------------------------------------------------------------- spin / round
func request_spin() -> void:
	if busy: return
	busy = true
	spin_btn.disabled = true
	lbl_win.text = ""
	_flash("")
	_clear_win_flash()
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
	_feel = _parse_feel(outcome)
	var base: Dictionary = outcome.get("base", {})
	var grid: Array = base.get("grid", [])
	var total_bps := int(outcome.get("totalWinBps", 0))
	await _stop_reels(grid)
	_spin_whir(false)
	await _present_win(base, total_bps)
	# A teased trigger that fell short is a near-miss — sting only on a dead spin so it never
	# steps on a win fanfare (a small line win can still co-occur with a missed feature). Run it
	# AFTER _present_win so the "SO CLOSE" flash isn't wiped by its no-win message reset.
	if total_bps <= 0:
		_play_near_miss()
	if outcome.get("freeSpins", null) != null:
		await _run_free_spins(outcome.freeSpins)
	_update_hud()
	busy = false
	spinning = false
	spin_btn.disabled = false

func _stop_reels(grid: Array) -> void:
	# The server "feel" decides the drumroll: feel.anticipation reports the earliest reel a
	# trigger symbol reached its "one-to-go" state. From that reel on, the still-spinning reels
	# slow into a glowing suspense stop (longer delay + riser + a gold column pulse). With no
	# feel (offline mock / free spins) fall back to the local 2-scatters-seen heuristic.
	var anticipate_from := _anticipation_from_reel()
	var scatters_so_far := 0
	for col in COLS:
		var final_col: Array = grid[col] if col < grid.size() else [_rand_sym(col), _rand_sym(col), _rand_sym(col)]
		var anticipate := (col >= anticipate_from) if anticipate_from >= 0 else (scatters_so_far >= 2 and _col_has(final_col, SCATTER))
		if anticipate:
			play("anticipation_riser")
			_anticipate_glow(col)
			await get_tree().create_timer(0.55).timeout
		else:
			await get_tree().create_timer(REEL_STOP_STAGGER).timeout
		_land_reel(col, final_col)
		_play_stop(col)
		if _col_has(final_col, SCATTER): play("scatter_land")
		if _col_has(final_col, WILD): play("wild_land")
		scatters_so_far += _count_in_col(final_col, SCATTER)
	await get_tree().create_timer(0.22).timeout

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
	# Authoritative 3 rows land in the visible slots (sprite idx 1,2,3); idx 0,4 buffers.
	reel.symbols = [_rand_sym(col), column[0], column[1], column[2], _rand_sym(col)]
	reel.scroll = 0.0
	_position_reel(reel, false)
	# Landing overshoot bounce.
	var win: Control = reel.window
	var base_y := _iy
	win.position.y = base_y - 14.0
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(win, "position:y", base_y, 0.26)

func _force_stop() -> void:
	for col in COLS:
		reels[col].state = "stopped"
		reels[col].scroll = 0.0
		_position_reel(reels[col], false)
	spinning = false
	busy = false
	spin_btn.disabled = false
	_spin_whir(false)
	_clear_win_flash()

# ----------------------------------------------------------------- win present
func _reset_dim() -> void:
	for col in COLS:
		for sp in reels[col].sprites:
			sp.modulate = Color(1, 1, 1, 1)

# Server payload carries no explicit cells for a ways win — only the symbol and how many reels
# matched from the left. Reconstruct the contributing cells the same way the math does: in reels
# 0..count-1, every cell that is the win symbol OR a wild substitute. Scatters (3+) are their own
# group, lit wherever they landed. One group per winning symbol so the flash can cycle them.
func _build_win_groups(base: Dictionary) -> void:
	_win_groups = []
	_win_has_wild = false
	var grid: Array = base.get("grid", [])
	for w in base.get("waysWins", []):
		var sym: String = w.get("symbol", "")
		var count := int(w.get("count", 0))
		var cells := []
		for col in range(min(count, COLS)):
			if col >= grid.size(): continue
			var column: Array = grid[col]
			for row in column.size():
				if column[row] == sym or column[row] == WILD:
					cells.append({"col": col, "row": row, "sym": column[row]})
					if column[row] == WILD: _win_has_wild = true
		if not cells.is_empty():
			_win_groups.append({"sym": sym, "cells": cells, "strong": sym in HIGH})
	if int(base.get("scatterCount", 0)) >= 3:
		var scatters := []
		for col in grid.size():
			var column: Array = grid[col]
			for row in column.size():
				if column[row] == SCATTER:
					scatters.append({"col": col, "row": row, "sym": SCATTER})
		if not scatters.is_empty():
			_win_groups.append({"sym": SCATTER, "cells": scatters, "strong": true})

func _present_win(base: Dictionary, total_bps: int) -> void:
	_build_win_groups(base)
	if _win_groups.is_empty() and total_bps == 0:
		_clear_win_flash(); _flash(""); return

	var any_high := false
	for group in _win_groups:
		if group.sym in HIGH or group.sym == SCATTER:
			any_high = true
	if _win_has_wild:
		play("wild_expand")

	# The persistent winning-symbol flash: lights all winners, then cycles each symbol's
	# contributing cells (dim the rest, pulse + glow + a soft left→right connector) and loops
	# until the next spin. Runs detached so the win-tier banners/coin-shower below — on the HUD
	# layer, above this — still play and stay legible.
	_start_win_flash()

	# Escalating celebration ladder, driven by the server's feel.winTier (NICE→JACKPOT).
	match _win_tier(total_bps):
		"JACKPOT":
			await _jackpot_win(total_bps)
		"EPIC":
			await _epic_win(total_bps)
		"MEGA":
			await _mega_win(total_bps)
		"BIG":
			await _big_win(total_bps)
		"NICE":
			var mult := float(total_bps) / 10000.0
			play("win_big" if any_high else ("win_medium" if mult >= 2.0 else "win_small"))
		_:
			pass
	_count_up(total_bps)
	await get_tree().create_timer(0.5).timeout

func _cell_world(col: int, row: int) -> Vector2:
	return board.position + Vector2(_reel_x(col), _row_y(row))

## Win highlight built from the symbol's OWN art: an additive, gold-tinted copy of
## the winning symbol blooms and fades behind it — a glow halo, not generic particles.
func _glow_cell(col: int, row: int, sym: String, strong: bool) -> void:
	var tex = textures.get(sym, null)
	if tex == null: return
	var base_s := _sym_scale(tex)
	var g := Sprite2D.new()
	g.texture = tex
	g.centered = true
	g.position = _cell_world(col, row)
	g.scale = base_s * 1.02
	g.modulate = Color(1.0, 0.86, 0.45, 0.0)
	g.material = _additive_mat()
	g.z_index = 55
	fx_layer.add_child(g)
	var peak := 0.75 if strong else 0.5
	var grow := 1.32 if strong else 1.2
	var t := create_tween().set_trans(Tween.TRANS_SINE)
	t.tween_property(g, "modulate:a", peak, 0.18)
	t.parallel().tween_property(g, "scale", base_s * grow, 0.18)
	t.tween_property(g, "modulate:a", 0.0, 0.55)
	t.tween_callback(g.queue_free)

# ----------------------------------------------------- winning-symbol flash (WAYS)
## Persistent flash that shows WHICH cells paid — the core "what won" cue for a ways game.
## The server sends no cell list; _build_win_groups reconstructed the contributing cells per
## winning symbol (plus the scatter group). This dims the board, then cycles each winning symbol
## on its own — pulse + scale + a gold glow bloom on its cells, joined by a soft left→right
## Line2D — then lights every winner together, and loops until the next spin clears it. It runs
## detached (not awaited) so the win-tier banner + coin shower on the HUD layer play over it and
## stay legible: the flash lives in fx_layer / on the reel sprites, above the reels, below the HUD.
func _start_win_flash() -> void:
	_kill_flash()
	if _win_groups.is_empty():
		_reset_dim()
		return
	_run_win_flash(_flash_gen)

func _run_win_flash(gen: int) -> void:
	while gen == _flash_gen:
		# Cycle each winning symbol so the player reads exactly what paid...
		if _win_groups.size() > 1:
			for group in _win_groups:
				_flash_phase([group])
				await get_tree().create_timer(0.6).timeout
				if gen != _flash_gen:
					return
		# ...then light every winner together, and loop until the next spin.
		_flash_phase(_win_groups)
		await get_tree().create_timer(0.7).timeout
		if gen != _flash_gen:
			return

# One flash beat: dim the whole board, then pop the passed groups' cells and strand each win.
func _flash_phase(groups: Array) -> void:
	_clear_connectors()
	_reset_flash_tweens()
	_dim_all(0.32)
	var seen := {}
	for group in groups:
		for cell in group.cells:
			var key := "%d:%d" % [int(cell.col), int(cell.row)]
			if seen.has(key):
				continue
			seen[key] = true
			_pulse_cell(cell, group.strong)
		_draw_connector(group.cells, group.strong)

func _dim_all(alpha: float) -> void:
	for col in COLS:
		var sprites: Array = reels[col].sprites
		for idx in [1, 2, 3]:   # visible rows land in sprite idx 1..3 (0,4 are buffers)
			sprites[idx].modulate = Color(1, 1, 1, alpha)

# Pop one winning cell: a scale + brightness flash on its sprite, plus the reusable gold glow.
func _pulse_cell(cell: Dictionary, strong: bool) -> void:
	var col := int(cell.col)
	var row := int(cell.row)
	var sp: Sprite2D = reels[col].sprites[row + 1]
	if sp.texture == null:
		return
	var base_s := _sym_scale(sp.texture)
	var grow := 1.22 if strong else 1.14
	var t := create_tween().set_trans(Tween.TRANS_SINE)
	t.tween_property(sp, "scale", base_s * grow, 0.18)
	t.parallel().tween_property(sp, "modulate", Color(1.3, 1.22, 1.0, 1.0), 0.18)
	t.tween_property(sp, "scale", base_s, 0.24)
	t.parallel().tween_property(sp, "modulate", Color(1, 1, 1, 1), 0.24)
	_flash_tweens.append(t)
	_glow_cell(col, row, str(cell.sym), strong)

# Soft gold strand through a win: one averaged point per matched column, left→right.
func _draw_connector(cells: Array, strong: bool) -> void:
	if cells.size() < 2:
		return
	var by_col := {}
	for cell in cells:
		var c := int(cell.col)
		if not by_col.has(c):
			by_col[c] = []
		by_col[c].append(int(cell.row))
	var cols_sorted: Array = by_col.keys()
	cols_sorted.sort()
	if cols_sorted.size() < 2:
		return
	var line := Line2D.new()
	line.width = max(3.0, _cell_w * 0.05)
	line.joint_mode = Line2D.LINE_JOINT_ROUND
	line.begin_cap_mode = Line2D.LINE_CAP_ROUND
	line.end_cap_mode = Line2D.LINE_CAP_ROUND
	line.default_color = Color(1.0, 0.88, 0.5, 0.0)
	for c in cols_sorted:
		var rows: Array = by_col[c]
		var avg := 0.0
		for r in rows:
			avg += float(r)
		avg /= float(rows.size())
		var y := _iy + (avg + 0.5) * _cell_h
		line.add_point(board.position + Vector2(_reel_x(int(c)), y))
	fx_layer.add_child(line)
	_flash_nodes.append(line)
	var peak := 0.62 if strong else 0.42
	var t := create_tween()
	t.tween_property(line, "default_color:a", peak, 0.2)
	_flash_tweens.append(t)

func _clear_connectors() -> void:
	for n in _flash_nodes:
		if is_instance_valid(n):
			n.queue_free()
	_flash_nodes.clear()

func _reset_flash_tweens() -> void:
	for t in _flash_tweens:
		if is_instance_valid(t):
			t.kill()
	_flash_tweens.clear()

# Bump the generation (kills the running loop next await) and drop its transient visuals.
func _kill_flash() -> void:
	_flash_gen += 1
	_reset_flash_tweens()
	_clear_connectors()

# Full reset for a new spin / forced stop: kill the loop, restore every cell to its resting look.
func _clear_win_flash() -> void:
	_kill_flash()
	_win_groups = []
	_win_has_wild = false
	_reset_dim()
	_restore_cell_scale()

func _restore_cell_scale() -> void:
	for col in COLS:
		var sprites: Array = reels[col].sprites
		for idx in [1, 2, 3]:
			var sp: Sprite2D = sprites[idx]
			if sp.texture:
				sp.scale = _sym_scale(sp.texture)

func _big_win(total_bps: int) -> void:
	play("bigwin_fanfare")
	play("coin_shower")
	_shake(7.0, 0.4)
	_show_banner("BIG WIN")
	_coin_shower(14, 1.0)
	await get_tree().create_timer(1.4).timeout

func _mega_win(total_bps: int) -> void:
	play("megawin_fanfare")
	play("coin_shower")
	_shake(13.0, 0.7)
	_show_banner("MEGA WIN", 1.1)
	_coin_shower(26, 1.15)
	await get_tree().create_timer(2.0).timeout

func _epic_win(total_bps: int) -> void:
	play("megawin_fanfare")
	play("scatter_trigger")
	play("coin_shower")
	_shake(18.0, 0.95)
	_show_banner("EPIC WIN", 1.22)
	_coin_shower(42, 1.3)
	await get_tree().create_timer(2.4).timeout

# The crown celebration: chest burst, max shake, the largest banner and the longest coin rain.
func _jackpot_win(total_bps: int) -> void:
	play("megawin_fanfare")
	play("chest_open")
	play("coin_shower")
	_shake(24.0, 1.25)
	_show_banner("JACKPOT", 1.4)
	_coin_shower(72, 1.5)
	await get_tree().create_timer(3.0).timeout

func _show_banner(text: String, peak := 1.0) -> void:
	banner.text = text
	banner.visible = true
	banner.modulate = Color(1, 1, 1, 0)
	banner.scale = Vector2(0.6, 0.6)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(banner, "modulate", Color(1, 1, 1, 1), 0.25)
	t.parallel().tween_property(banner, "scale", Vector2(peak, peak), 0.35)
	t.tween_interval(1.0)
	t.tween_property(banner, "modulate", Color(1, 1, 1, 0), 0.4)
	t.tween_callback(func(): banner.visible = false)

# --------------------------------------------------------------- feel (server render hints)
func _parse_feel(outcome: Dictionary) -> Dictionary:
	var f = outcome.get("feel", null)
	return f if typeof(f) == TYPE_DICTIONARY else {}

## The win-celebration tier. Prefer the server's feel.winTier; with no feel (offline mock / the
## auto-played free spins) fall back to the same bps thresholds the engine uses (BIG 10×, MEGA
## 25×, EPIC 50×). JACKPOT is only ever flagged by the server.
func _win_tier(total_bps: int) -> String:
	if typeof(_feel) == TYPE_DICTIONARY:
		var t = _feel.get("winTier", "")
		if typeof(t) == TYPE_STRING and t != "":
			return t
	if total_bps <= 0: return "NONE"
	if total_bps >= 500000: return "EPIC"
	if total_bps >= 250000: return "MEGA"
	if total_bps >= 100000: return "BIG"
	return "NICE"

## Earliest reel (0-based) at which any trigger symbol reached its "one-to-go" state this spin,
## or -1 if the server sent no anticipation. feel.anticipation only ever carries teasing entries
## (fromReel != null), so any entry present is a reel we should start the drumroll from.
func _anticipation_from_reel() -> int:
	if typeof(_feel) != TYPE_DICTIONARY: return -1
	var arr = _feel.get("anticipation", [])
	if typeof(arr) != TYPE_ARRAY: return -1
	var from := -1
	for a in arr:
		if typeof(a) != TYPE_DICTIONARY: continue
		var fr = a.get("fromReel", null)
		if fr == null: continue
		var f := int(fr)
		if from < 0 or f < from: from = f
	return from

func _play_near_miss() -> void:
	if typeof(_feel) != TYPE_DICTIONARY: return
	var nm = _feel.get("nearMiss", [])
	if typeof(nm) == TYPE_ARRAY and nm.size() > 0:
		play("nearmiss_hold")
		_flash("SO CLOSE")

# --------------------------------------------------------------- feel visuals
## Soft gold column glow that breathes over the still-spinning reel — the "one to go" tell. A
## stretched additive radial Sprite2D in the fx layer, the same pattern as _glow_cell.
func _anticipate_glow(col: int) -> void:
	var win_h := _cell_h * ROWS
	var g := Sprite2D.new()
	g.texture = _glow_tex()
	g.centered = true
	g.position = board.position + Vector2(_reel_x(col), _iy + win_h * 0.5)
	g.material = _additive_mat()
	g.z_index = 58
	var sz := float(g.texture.get_width())
	var full := Vector2(_cell_w * 1.25 / sz, win_h * 1.08 / sz)
	g.scale = full * 0.82
	g.modulate = Color(1, 1, 1, 0.0)
	fx_layer.add_child(g)
	var t := create_tween().set_trans(Tween.TRANS_SINE)
	t.tween_property(g, "modulate:a", 0.55, 0.16)
	t.parallel().tween_property(g, "scale", full, 0.16)
	t.tween_property(g, "modulate:a", 0.22, 0.18)
	t.parallel().tween_property(g, "scale", full * 0.9, 0.18)
	t.tween_property(g, "modulate:a", 0.5, 0.14)
	t.tween_property(g, "modulate:a", 0.0, 0.14)
	t.tween_callback(g.queue_free)

## Gold coins rain from above the viewport and fall past the bottom, fading as they go. Length
## scales with the win tier (more coins + slower fall on bigger wins).
func _coin_shower(amount: int, spread: float) -> void:
	var tex := _coin_tex()
	var sz := float(tex.get_width())
	for i in amount:
		var c := Sprite2D.new()
		c.texture = tex
		c.centered = true
		var s := _cell_w / sz * randf_range(0.28, 0.5)
		c.scale = Vector2(s, s)
		c.position = Vector2(view.x * randf_range(0.06, 0.94), randf_range(-120.0, -20.0))
		c.modulate = Color(1, 1, 1, randf_range(0.85, 1.0))
		c.z_index = 70
		fx_layer.add_child(c)
		var dur := randf_range(0.9, 1.5) * spread
		var t := create_tween()
		t.tween_property(c, "position:y", view.y + 80.0, dur).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		t.parallel().tween_property(c, "rotation", randf_range(-5.0, 5.0), dur)
		t.parallel().tween_property(c, "modulate:a", 0.0, dur).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		t.tween_callback(c.queue_free)

# Code-drawn radial sprite (core→transparent edge) — no extra art needed for coins/glow.
func _radial_tex(core: Color, edge: Color, size: int) -> Texture2D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.6, 1.0])
	g.colors = PackedColorArray([core, core, edge])
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	tex.width = size
	tex.height = size
	return tex

func _coin_tex() -> Texture2D:
	if _coin_texture == null:
		_coin_texture = _radial_tex(Color(1.0, 0.93, 0.6, 1.0), Color(0.74, 0.46, 0.1, 0.0), 40)
	return _coin_texture

func _glow_tex() -> Texture2D:
	if _glow_texture == null:
		_glow_texture = _radial_tex(Color(1.0, 0.85, 0.42, 0.85), Color(1.0, 0.82, 0.4, 0.0), 64)
	return _glow_texture

func _shake(mag: float, dur: float) -> void:
	var steps := int(dur / 0.04)
	var t := create_tween()
	for i in steps:
		var m := mag * (1.0 - float(i) / steps)
		t.tween_property(board, "position", Vector2(randf_range(-m, m), randf_range(-m, m)), 0.04)
	t.tween_property(board, "position", Vector2.ZERO, 0.06)

func _count_up(total_bps: int) -> void:
	var credits := float(total_bps) / 10000.0 * float(bet_minor) / 1000.0
	if credits <= 0:
		lbl_win.text = ""
		return
	play("coin_tick")
	var t := create_tween()
	var steps := 18
	for i in range(1, steps + 1):
		var v := credits * float(i) / steps
		t.tween_callback(func(): lbl_win.text = "WIN  %s" % _fmt(v)).set_delay(0.03)

# --------------------------------------------------------------- free spins
func _run_free_spins(fs: Dictionary) -> void:
	# Free spins carry no per-spin feel; clear it so the base-spin hints don't leak into the
	# auto-play and the reveal/celebration fall back to the win-amount heuristics.
	_feel = {}
	_set_bg(true)
	_swap_freespins_music(true)
	play("freespins_enter")
	lbl_mult.visible = true
	var spins: Array = fs.get("spins", [])
	for i in spins.size():
		var sp: Dictionary = spins[i]
		_flash("FREE SPIN  %d / %d" % [i + 1, spins.size()])
		var mult := int(sp.get("multiplier", 1))
		lbl_mult.text = "x%d" % mult
		_pulse(lbl_mult)
		if i > 0: play("multiplier_apply")
		_spin_whir(true)
		spinning = true
		for col in COLS:
			reels[col].state = "spin"
		await get_tree().create_timer(0.4).timeout
		await _stop_reels(sp.get("grid", []))
		spinning = false
		_spin_whir(false)
		await _present_win(sp, int(sp.get("spinWinBps", 0)))
		await get_tree().create_timer(0.2).timeout
	lbl_mult.visible = false
	_flash("")
	_set_bg(false)
	_swap_freespins_music(false)

func _pulse(node: CanvasItem) -> void:
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	node.scale = Vector2(1.4, 1.4)
	t.tween_property(node, "scale", Vector2(1, 1), 0.3)

# ------------------------------------------------------------------------ HUD
func _styled_label(size: int, color: Color) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.75))
	l.add_theme_constant_override("outline_size", 5)
	return l

func _build_hud() -> void:
	hud = CanvasLayer.new(); hud.layer = 30; add_child(hud)

	title_lbl = _styled_label(40, GOLD)
	title_lbl.text = "ROYAL ASCENDANT"
	title_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	if title_font: title_lbl.add_theme_font_override("font", title_font)
	hud.add_child(title_lbl)

	lbl_mult = _styled_label(56, GOLD)
	lbl_mult.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	lbl_mult.visible = false
	hud.add_child(lbl_mult)

	lbl_msg = _styled_label(30, GOLD)
	lbl_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_msg)

	banner = _styled_label(96, GOLD)
	banner.text = "BIG WIN"
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	if title_font: banner.add_theme_font_override("font", title_font)
	banner.z_index = 5
	banner.visible = false
	hud.add_child(banner)

	lbl_balance = _styled_label(28, Color(0.92, 0.96, 1.0))
	hud.add_child(lbl_balance)

	lbl_win = _styled_label(40, GOLD)
	lbl_win.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_win)

	bet_minus_btn = _tex_btn("res://art/ui/btn_bet_minus.png")
	bet_minus_btn.pressed.connect(func(): _change_bet(-1))
	hud.add_child(bet_minus_btn)

	lbl_bet = _styled_label(30, Color.WHITE)
	lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_bet)

	bet_plus_btn = _tex_btn("res://art/ui/btn_bet_plus.png")
	bet_plus_btn.pressed.connect(func(): _change_bet(1))
	hud.add_child(bet_plus_btn)

	maxbet_btn = _tex_btn("res://art/ui/btn_maxbet.png")
	maxbet_btn.pressed.connect(_max_bet)
	hud.add_child(maxbet_btn)

	spin_btn = _tex_btn("res://art/ui/btn_spin.png")
	spin_btn.pressed.connect(func(): play("spin_press"); request_spin())
	hud.add_child(spin_btn)

	sound_btn = _tex_btn("res://art/ui/btn_sound.png")
	sound_btn.pressed.connect(_toggle_sound)
	hud.add_child(sound_btn)

	info_btn = _tex_btn("res://art/ui/btn_info.png")
	info_btn.pressed.connect(func(): play("button_tap"))
	hud.add_child(info_btn)

	_update_hud()

## Position every HUD element for the current orientation. Portrait stacks a bottom
## thumb-deck (win / balance / bet ± / max / a big spin) under the reels; landscape
## restores the classic wide control bar.
func _layout_hud() -> void:
	var W := view.x
	var H := view.y
	if portrait:
		_place_lbl(title_lbl, Vector2(0, H * 0.035), Vector2(W, 84))
		_set_font(title_lbl, 56)
		_place_btn(info_btn, Vector2(W * 0.07, H * 0.06), Vector2(60, 60))
		_place_btn(sound_btn, Vector2(W * 0.93, H * 0.06), Vector2(60, 60))

		_place_lbl(lbl_mult, Vector2(W * 0.5, frame_pos.y - 84), Vector2(W, 72))
		lbl_mult.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lbl_mult.pivot_offset = Vector2(W * 0.5, 36)
		_place_lbl(lbl_msg, Vector2(0, frame_pos.y - 60), Vector2(W, 44))

		_place_lbl(banner, Vector2(0, frame_pos.y + frame_size.y * 0.5 - 70), Vector2(W, 140))
		banner.pivot_offset = Vector2(W * 0.5, 70)

		_place_lbl(lbl_win, Vector2(0, H * 0.555), Vector2(W, 60))
		_set_font(lbl_win, 50)
		_place_lbl(lbl_balance, Vector2(W * 0.07, H * 0.64), Vector2(W * 0.6, 40))
		_set_font(lbl_balance, 32)

		var by := H * 0.74
		_place_btn(bet_minus_btn, Vector2(W * 0.13, by), Vector2(150, 78))
		_place_lbl(lbl_bet, Vector2(W * 0.31 - W * 0.16, by - 28), Vector2(W * 0.32, 56))
		_set_font(lbl_bet, 36)
		_place_btn(bet_plus_btn, Vector2(W * 0.49, by), Vector2(150, 78))
		_place_btn(maxbet_btn, Vector2(W * 0.79, by), Vector2(200, 70))

		_place_btn(spin_btn, Vector2(W * 0.5, H * 0.885), Vector2(264, 264))
	else:
		var ox: float = max(0.0, (W - DESIGN.x) * 0.5)
		var oy: float = max(0.0, (H - DESIGN.y) * 0.5)
		_place_lbl(title_lbl, Vector2(ox, 14 + oy), Vector2(DESIGN.x, 48))
		_set_font(title_lbl, 40)
		_place_btn(info_btn, Vector2(16 + ox + 24, 12 + oy + 24), Vector2(48, 48))
		_place_btn(sound_btn, Vector2(W - 64 + 24 - ox, 12 + oy + 24), Vector2(48, 48))

		_place_lbl(lbl_mult, Vector2(W - 230 - ox, 70 + oy), Vector2(210, 64))
		lbl_mult.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		lbl_mult.pivot_offset = Vector2(210, 32)
		_place_lbl(lbl_msg, Vector2(ox, 60 + oy), Vector2(DESIGN.x, 40))

		_place_lbl(banner, Vector2(ox, frame_pos.y + frame_size.y * 0.5 - 70), Vector2(DESIGN.x, 140))
		banner.pivot_offset = Vector2(DESIGN.x * 0.5, 70)

		var bar_y := 612.0 + oy
		_place_lbl(lbl_balance, Vector2(28 + ox, bar_y), Vector2(320, 36))
		_set_font(lbl_balance, 28)
		_place_lbl(lbl_win, Vector2(ox, bar_y + 44), Vector2(DESIGN.x, 52))
		_set_font(lbl_win, 40)
		_place_btn(bet_minus_btn, Vector2(28 + ox + 60, bar_y + 50 + 25), Vector2(120, 50))
		_place_lbl(lbl_bet, Vector2(154 + ox, bar_y + 58), Vector2(150, 40))
		_set_font(lbl_bet, 30)
		_place_btn(bet_plus_btn, Vector2(310 + ox + 60, bar_y + 50 + 25), Vector2(120, 50))
		_place_btn(maxbet_btn, Vector2(905 + ox + 75, bar_y + 6 + 21), Vector2(150, 42))
		_place_btn(spin_btn, Vector2(1086 + 56 - ox, bar_y - 10 + 56), Vector2(112, 112))

func _set_font(l: Label, size: int) -> void:
	l.add_theme_font_size_override("font_size", size)

func _place_lbl(l: Label, pos: Vector2, size: Vector2) -> void:
	l.position = pos
	l.size = size

func _place_btn(b: TextureButton, center: Vector2, size: Vector2) -> void:
	b.custom_minimum_size = size
	b.size = size
	b.position = center - size * 0.5
	b.pivot_offset = size * 0.5

func _tex_btn(path: String) -> TextureButton:
	var b := TextureButton.new()
	if ResourceLoader.exists(path):
		b.texture_normal = load(path)
	b.ignore_texture_size = true
	b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	b.pressed.connect(func(): _btn_feedback(b))
	return b

func _btn_feedback(b: TextureButton) -> void:
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	b.scale = Vector2(0.9, 0.9)
	t.tween_property(b, "scale", Vector2(1, 1), 0.18)

var _muted := false
func _toggle_sound() -> void:
	_muted = not _muted
	AudioServer.set_bus_mute(AudioServer.get_bus_index("Master"), _muted)

func _change_bet(dir: int) -> void:
	play("bet_change")
	var idx := BET_STEPS.find(bet_minor)
	if idx == -1: idx = 4
	idx = clamp(idx + dir, 0, BET_STEPS.size() - 1)
	bet_minor = clamp(BET_STEPS[idx], min_bet, max_bet)
	_update_hud()

func _max_bet() -> void:
	play("bet_change")
	bet_minor = clamp(max_bet, min_bet, max_bet)
	# snap to the nearest step <= max
	for i in range(BET_STEPS.size() - 1, -1, -1):
		if BET_STEPS[i] <= max_bet:
			bet_minor = BET_STEPS[i]; break
	_update_hud()

func _fmt(c: float) -> String:
	return "$%.2f" % c

func _update_hud() -> void:
	lbl_balance.text = "Balance  %s" % _fmt(float(balance_minor) / 1000.0)
	lbl_bet.text = "Bet %s" % _fmt(float(bet_minor) / 1000.0)

func _flash(msg: String) -> void:
	if lbl_msg: lbl_msg.text = msg

# ----------------------------------------------------- offline screenshot hook
func _run_shots() -> void:
	var dir := OS.get_environment("RAS_SHOT")
	await get_tree().create_timer(1.0).timeout
	await _save_shot(dir + "/01_idle.png")
	request_spin()
	await get_tree().create_timer(2.0).timeout
	await _save_shot(dir + "/02_spin.png")
	await get_tree().create_timer(2.0).timeout
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
	var ok = JavaScriptBridge.eval("typeof window.RoyalGodot === 'object'", true)
	if ok:
		bridge = JavaScriptBridge.get_interface("RoyalGodot")
		var init_json: String = str(JavaScriptBridge.eval("JSON.stringify(window.RoyalGodot.getInit())", true))
		var init = JSON.parse_string(init_json)
		if typeof(init) == TYPE_DICTIONARY:
			balance_minor = int(str(init.get("balanceMinor", 0)))
			min_bet = int(str(init.get("minBetMinor", 1000)))
			max_bet = int(str(init.get("maxBetMinor", 2000000)))
			currency = str(init.get("currency", "CREDIT"))
			bet_minor = clamp(bet_minor, min_bet, max_bet)
		_update_hud()

# ----------------------------------------------------------------------- mock
func _mock_outcome() -> Dictionary:
	var grid := []
	for col in COLS:
		var column := []
		for row in ROWS:
			column.append(_rand_sym(col))
		grid.append(column)

	var ways := []
	var total_bps := 0
	var pay := {"QUEEN": 5000, "CASTLE": 4000, "SHIELD": 3000, "A": 1500, "K": 1200, "Q": 1000, "J": 800, "TEN": 600}
	for sym in pay.keys():
		var run := 0
		var n := 1
		for col in COLS:
			var c := 0
			for cell in grid[col]:
				if cell == sym or cell == WILD: c += 1
			if c == 0: break
			run += 1; n *= c
		if run >= 3:
			var p: int = pay[sym] * n
			ways.append({"symbol": sym, "count": run, "ways": n, "payBps": p})
			total_bps += p

	var scatter := 0
	for col in COLS:
		for row in ROWS:
			if grid[col][row] == SCATTER: scatter += 1

	var fs = null
	if scatter >= 3:
		var spins := []
		var awarded := 10
		for i in awarded:
			var g2 := []
			for col in COLS:
				var c2 := []
				for row in ROWS: c2.append(_rand_sym(col))
				g2.append(c2)
			var m := min(i + 1, 10)
			spins.append({"grid": g2, "waysWins": [], "scatterCount": 0, "scatterPayBps": 0, "multiplier": m, "spinWinBps": 4000 * (i + 1)})
		fs = {"triggered": true, "spins": spins, "totalSpins": awarded, "endMultiplier": min(awarded, 10), "totalBps": 60000}
		total_bps += 60000

	return {
		"kind": "royal-ascendant", "win": total_bps > 0,
		"base": {"grid": grid, "waysWins": ways, "scatterCount": scatter, "scatterPayBps": 0, "multiplier": 1, "spinWinBps": total_bps},
		"freeSpins": fs, "totalWinBps": total_bps,
	}
