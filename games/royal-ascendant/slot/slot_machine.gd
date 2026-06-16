extends Node2D

## Royal Ascendant — landscape web slot client (1280×720).
##
## SERVER-AUTHORITATIVE: this scene never decides an outcome. On spin it asks the host
## page (window.RoyalGodot bridge) to place the bet; the page calls the Aureus API and
## hands back the authoritative RoyalOutcome, which this scene animates. Standalone
## (no bridge — desktop/editor or a directly-opened export) a local mock drives the
## visuals so the presentation can be built and QA'd offline.
##
## Self-contained: every texture/sound is loaded from this repo (res://art, res://audio),
## with no dependency on the external asset pipeline.

const VIEW := Vector2(1280, 720)
const COLS := 5
const ROWS := 3

# Reel frame placement (the ornate 5×3 grid art) and the symbol grid that sits inside
# its opening. Insets are fractions of the frame rect — calibrated to reel_frame.png.
const FRAME_POS := Vector2(196, 96)
const FRAME_SIZE := Vector2(888, 494)
const INSET_LEFT := 0.064
const INSET_RIGHT := 0.064
const INSET_TOP := 0.10
const INSET_BOTTOM := 0.088

const SYMBOL_IDS := ["QUEEN", "CASTLE", "SHIELD", "A", "K", "Q", "J", "TEN", "JOKER", "CHEST"]
const HIGH := ["QUEEN", "CASTLE", "SHIELD"]
const WILD := "JOKER"
const SCATTER := "CHEST"

const SPIN_SPEED := 2400.0      # px/sec scroll while spinning
const REEL_STOP_STAGGER := 0.15
const GOLD := Color(0.96, 0.82, 0.42)

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
var fx_layer: Node2D
var hud: CanvasLayer

var textures := {}             # id -> Texture2D (sharp)
var blur_tex := {}             # id -> Texture2D (motion-blurred)
var _add_mat: CanvasItemMaterial   # additive blend for symbol-glow halos

# reel state: [{window, sprites:[Sprite2D x5], symbols:[id x5], scroll, state}]
var reels := []
var spinning := false

# HUD
var lbl_balance: Label
var lbl_bet: Label
var lbl_win: Label
var lbl_msg: Label
var lbl_mult: Label
var spin_btn: TextureButton
var banner: Label

# audio
var _audio := {}               # name -> AudioStreamPlayer (one-shot)
var _music: AudioStreamPlayer
var _ambience: AudioStreamPlayer

# session (from bridge)
var balance_minor := 0
var bet_minor := 100000
var min_bet := 1000
var max_bet := 2000000
var currency := "CREDIT"
var busy := false
var bridge = null

var BET_STEPS := [1000, 5000, 10000, 50000, 100000, 250000, 500000, 1000000]

func _ready() -> void:
	randomize()
	if not OS.has_feature("web"):
		get_window().size = VIEW
	_compute_geometry()
	_load_textures()
	_load_audio()

	bg_layer = CanvasLayer.new(); bg_layer.layer = -10; add_child(bg_layer)
	_set_bg(false)
	board = Node2D.new(); board.name = "Board"; add_child(board)
	fx_layer = Node2D.new(); fx_layer.name = "Fx"; fx_layer.z_index = 60; add_child(fx_layer)

	_build_frame()
	_build_reels()
	_build_hud()
	_connect_bridge()
	_idle_fill()
	_start_music()
	set_process(true)
	if OS.get_environment("RAS_SHOT") != "":
		_run_shots()

# ----------------------------------------------------------------- geometry
func _compute_geometry() -> void:
	_ix = FRAME_POS.x + INSET_LEFT * FRAME_SIZE.x
	_iy = FRAME_POS.y + INSET_TOP * FRAME_SIZE.y
	var iw := (1.0 - INSET_LEFT - INSET_RIGHT) * FRAME_SIZE.x
	var ih := (1.0 - INSET_TOP - INSET_BOTTOM) * FRAME_SIZE.y
	_cell_w = iw / COLS
	_cell_h = ih / ROWS
	_sym_px = min(_cell_w, _cell_h) * 0.82

func _reel_x(col: int) -> float:
	return _ix + (col + 0.5) * _cell_w

func _row_y(row: int) -> float:
	return _iy + (row + 0.5) * _cell_h

# ----------------------------------------------------------------- assets
func _load_textures() -> void:
	for id in SYMBOL_IDS:
		var p := "res://art/symbols/%s.png" % id
		if ResourceLoader.exists(p):
			textures[id] = load(p)
		var b := "res://art/symbols_blur/%s.png" % id
		if ResourceLoader.exists(b):
			blur_tex[id] = load(b)

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

func _start_music() -> void:
	if _ambience: _ambience.play()
	if _music: _music.play()

func _swap_freespins_music(on: bool) -> void:
	# Free-spins uses its own bed; reuse the looped track at a brighter level.
	if _music:
		_music.volume_db = -4.0 if on else -8.0

# ----------------------------------------------------------------- background
func _set_bg(fs: bool) -> void:
	var path := "res://art/bg/%s.jpg" % ("bg_freespins" if fs else "bg_base")
	if not ResourceLoader.exists(path): return
	if cur_bg == null:
		cur_bg = TextureRect.new()
		cur_bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		cur_bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		cur_bg.position = Vector2.ZERO
		cur_bg.size = VIEW
		bg_layer.add_child(cur_bg)
	var tex: Texture2D = load(path)
	if cur_bg.texture == null:
		cur_bg.texture = tex
	else:
		# crossfade
		var old := cur_bg.texture
		var fade := TextureRect.new()
		fade.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		fade.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		fade.position = Vector2.ZERO; fade.size = VIEW; fade.texture = old
		bg_layer.add_child(fade)
		cur_bg.texture = tex
		cur_bg.modulate = Color(1, 1, 1, 0)
		var t := create_tween()
		t.tween_property(cur_bg, "modulate", Color(1, 1, 1, 1), 0.5)
		t.parallel().tween_property(fade, "modulate", Color(1, 1, 1, 0), 0.5)
		t.tween_callback(fade.queue_free)

# ----------------------------------------------------------------- frame + reels
func _build_frame() -> void:
	var frame_path := "res://art/ui/reel_frame.png"
	if ResourceLoader.exists(frame_path):
		var frame := TextureRect.new()
		frame.texture = load(frame_path)
		frame.position = FRAME_POS
		frame.size = FRAME_SIZE
		frame.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		frame.stretch_mode = TextureRect.STRETCH_SCALE
		frame.z_index = 2   # backdrop: opaque maroon cells sit BEHIND the symbols
		board.add_child(frame)

func _build_reels() -> void:
	var win_w := _cell_w
	var win_h := _cell_h * ROWS
	for col in COLS:
		var window := Control.new()
		window.clip_contents = true
		window.position = Vector2(_reel_x(col) - win_w * 0.5, _iy)
		window.size = Vector2(win_w, win_h)
		window.z_index = 10
		board.add_child(window)
		var sprites := []
		for idx in 5:
			var sp := Sprite2D.new()
			sp.centered = true
			sp.position = Vector2(win_w * 0.5, (idx - 1) * _cell_h + _cell_h * 0.5)
			window.add_child(sp)
			sprites.append(sp)
		reels.append({
			"window": window, "sprites": sprites,
			"symbols": ["TEN", "J", "Q", "K", "A"],
			"scroll": 0.0, "state": "idle",
		})
	_paint_reels()

func _paint_reels() -> void:
	for col in COLS:
		var reel: Dictionary = reels[col]
		var sprites: Array = reel.sprites
		var syms: Array = reel.symbols
		for idx in 5:
			_apply_symbol(sprites[idx], syms[idx], false)
			sprites[idx].position.y = (idx - 1) * _cell_h + _cell_h * 0.5 + reel.scroll

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
	_reset_dim()
	play("spin_start")
	spinning = true
	for col in COLS:
		reels[col].state = "spin"
	if bridge != null:
		var cb := JavaScriptBridge.create_callback(_on_bridge_result)
		bridge.placeBet(bet_minor, cb)
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
	await _present_win(base, int(outcome.get("totalWinBps", 0)))
	if outcome.get("freeSpins", null) != null:
		await _run_free_spins(outcome.freeSpins)
	_update_hud()
	busy = false
	spinning = false
	spin_btn.disabled = false

func _stop_reels(grid: Array) -> void:
	# Pre-compute how many scatters will be visible to drive near-miss anticipation.
	var scatters_so_far := 0
	for col in COLS:
		var final_col: Array = grid[col] if col < grid.size() else [_rand_sym(col), _rand_sym(col), _rand_sym(col)]
		var anticipate := scatters_so_far >= 2 and _col_has(final_col, SCATTER)
		if anticipate:
			play("anticipation_riser")
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

# ----------------------------------------------------------------- win present
func _reset_dim() -> void:
	for col in COLS:
		for sp in reels[col].sprites:
			sp.modulate = Color(1, 1, 1, 1)

func _winning_cells(base: Dictionary) -> Dictionary:
	var cells := {}
	var grid: Array = base.get("grid", [])
	for w in base.get("waysWins", []):
		var sym: String = w.get("symbol", "")
		var count := int(w.get("count", 0))
		for col in range(min(count, COLS)):
			if col >= grid.size(): continue
			var column: Array = grid[col]
			for row in column.size():
				if column[row] == sym or column[row] == WILD:
					cells["%d:%d" % [col, row]] = sym
	if int(base.get("scatterCount", 0)) >= 3:
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

	# Dim everything, then light + pop the winners.
	for col in COLS:
		for sp in reels[col].sprites:
			sp.modulate = Color(1, 1, 1, 0.34)
	var any_high := false
	for key in cells.keys():
		var parts: Array = key.split(":")
		var col := int(parts[0]); var row := int(parts[1])
		var sp: Sprite2D = reels[col].sprites[row + 1]   # visible rows = sprite idx 1..3
		sp.modulate = Color(1, 1, 1, 1)
		var base_s := _sym_scale(sp.texture) if sp.texture else Vector2.ONE
		var t := create_tween().set_loops(3).set_trans(Tween.TRANS_SINE)
		t.tween_property(sp, "scale", base_s * 1.18, 0.16)
		t.tween_property(sp, "scale", base_s, 0.16)
		var sym: String = cells[key]
		if sym in HIGH or sym == SCATTER: any_high = true
		if sym == WILD: play("wild_expand")
		_glow_cell(col, row, sym, sym in HIGH or sym == SCATTER)

	var mult := float(total_bps) / 10000.0
	if mult >= 50.0:
		await _mega_win(total_bps)
	elif mult >= 8.0:
		await _big_win(total_bps)
	else:
		play("win_big" if any_high else ("win_medium" if mult >= 2.0 else "win_small"))
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

func _big_win(total_bps: int) -> void:
	play("bigwin_fanfare")
	_shake(7.0, 0.4)
	_show_banner("BIG WIN")
	await get_tree().create_timer(1.4).timeout

func _mega_win(total_bps: int) -> void:
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
		spinning = true
		for col in COLS:
			reels[col].state = "spin"
		await get_tree().create_timer(0.4).timeout
		await _stop_reels(sp.get("grid", []))
		spinning = false
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

	var title := _styled_label(40, GOLD)
	title.text = "ROYAL ASCENDANT"
	title.position = Vector2(0, 14); title.size = Vector2(VIEW.x, 48)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(title)

	lbl_mult = _styled_label(56, GOLD)
	lbl_mult.position = Vector2(VIEW.x - 230, 70); lbl_mult.size = Vector2(210, 64)
	lbl_mult.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	lbl_mult.pivot_offset = Vector2(210, 32)
	lbl_mult.visible = false
	hud.add_child(lbl_mult)

	lbl_msg = _styled_label(30, GOLD)
	lbl_msg.position = Vector2(0, 60); lbl_msg.size = Vector2(VIEW.x, 40)
	lbl_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_msg)

	# big-win banner (center over the reels)
	banner = _styled_label(96, GOLD)
	banner.text = "BIG WIN"
	banner.position = Vector2(0, FRAME_POS.y + FRAME_SIZE.y * 0.5 - 70); banner.size = Vector2(VIEW.x, 140)
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.pivot_offset = Vector2(VIEW.x * 0.5, 70)
	banner.z_index = 5
	banner.visible = false
	hud.add_child(banner)

	# ---- bottom control bar ----
	var bar_y := 612.0
	lbl_balance = _styled_label(28, Color(0.92, 0.96, 1.0))
	lbl_balance.position = Vector2(28, bar_y); lbl_balance.size = Vector2(320, 36)
	hud.add_child(lbl_balance)

	lbl_win = _styled_label(40, GOLD)
	lbl_win.position = Vector2(0, bar_y + 44); lbl_win.size = Vector2(VIEW.x, 52)
	lbl_win.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_win)

	var minus := _tex_btn("res://art/ui/btn_bet_minus.png", Vector2(28, bar_y + 50), Vector2(120, 50))
	minus.pressed.connect(func(): _change_bet(-1))
	hud.add_child(minus)

	lbl_bet = _styled_label(30, Color.WHITE)
	lbl_bet.position = Vector2(154, bar_y + 58); lbl_bet.size = Vector2(150, 40)
	lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_bet)

	var plus := _tex_btn("res://art/ui/btn_bet_plus.png", Vector2(310, bar_y + 50), Vector2(120, 50))
	plus.pressed.connect(func(): _change_bet(1))
	hud.add_child(plus)

	var maxbet := _tex_btn("res://art/ui/btn_maxbet.png", Vector2(905, bar_y + 6), Vector2(150, 42))
	maxbet.pressed.connect(_max_bet)
	hud.add_child(maxbet)

	spin_btn = _tex_btn("res://art/ui/btn_spin.png", Vector2(1086, bar_y - 10), Vector2(112, 112))
	spin_btn.pressed.connect(func(): play("spin_press"); request_spin())
	hud.add_child(spin_btn)

	# top-right icons
	var sound := _tex_btn("res://art/ui/btn_sound.png", Vector2(VIEW.x - 64, 12), Vector2(48, 48))
	sound.pressed.connect(_toggle_sound)
	hud.add_child(sound)
	var info := _tex_btn("res://art/ui/btn_info.png", Vector2(16, 12), Vector2(48, 48))
	info.pressed.connect(func(): play("button_tap"))
	hud.add_child(info)

	_update_hud()

func _tex_btn(path: String, pos: Vector2, size: Vector2) -> TextureButton:
	var b := TextureButton.new()
	if ResourceLoader.exists(path):
		b.texture_normal = load(path)
	b.ignore_texture_size = true
	b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	b.custom_minimum_size = size
	b.size = size
	b.position = pos
	b.pivot_offset = size * 0.5
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
	if c == floor(c): return "%d" % int(c)
	return "%.2f" % c

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
