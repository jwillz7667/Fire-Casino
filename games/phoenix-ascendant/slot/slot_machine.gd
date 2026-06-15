extends Node2D

## Phoenix Ascendant — web slot client.
##
## SERVER-AUTHORITATIVE: this scene never decides an outcome. On spin it asks the
## host page (JS bridge) to place the bet; the page calls the Aureus API and hands
## back the authoritative result, which this scene animates. In the editor / on
## desktop (no bridge) a local mock drives the visuals so the presentation can be
## built and screenshot-tested offline.

const VIEW := Vector2(720, 1280)
const COLS := 5
const ROWS := 3
const CELL := 120.0
const PITCH_X := 132.0
const PITCH_Y := 128.0
const GRID_TOP := 372.0
const SYMBOL_IDS := ["CREST","TALON","EGG","FEATHER","GOLD","EMBER","TEAL","VIOLET","SCATTER","ORB"]
const HIGH := ["CREST","TALON","EGG","FEATHER"]
const SPIN_SPEED := 2600.0     # px/sec scroll while spinning
const REEL_STOP_STAGGER := 0.16

var db
var audio
var bg_layer: CanvasLayer
var fx_layer: Node2D
var cur_bg: Node
var hud: CanvasLayer
var textures := {}             # id -> Texture2D

# reel state
var reels := []                # [{window, sprites:[Sprite2D x5], symbols:[id x5], scroll, state, final}]
var spinning := false

# HUD nodes
var lbl_balance: Label
var lbl_bet: Label
var lbl_win: Label
var lbl_msg: Label
var lbl_mult: Label
var spin_btn: TextureButton
var banner: TextureRect

# session state (from bridge)
var balance_minor := 0
var bet_minor := 100000        # 100 credits default
var min_bet := 1000
var max_bet := 2000000
var currency := "CREDIT"
var busy := false
var bridge = null              # window.PhoenixGodot (web) or null

func _ready() -> void:
	randomize()
	get_window().size = VIEW
	db = load("res://data/symbol_database.tres")
	for id in SYMBOL_IDS:
		var fname: String = "orb" if String(id) == "ORB" else String(id)
		var path: String = "res://art/symbols/%s.png" % fname
		if ResourceLoader.exists(path):
			textures[id] = load(path)

	bg_layer = CanvasLayer.new(); bg_layer.layer = -10; add_child(bg_layer)
	_set_bg(false)
	fx_layer = Node2D.new(); fx_layer.name = "Fx"; fx_layer.z_index = 50; add_child(fx_layer)
	audio = load("res://scenes/audio_manager.tscn").instantiate(); add_child(audio)

	_build_frame()
	_build_reels()
	_build_hud()
	_connect_bridge()
	_idle_fill()
	set_process(true)
	if OS.get_environment("PHX_SHOT") != "":
		_run_shots()

# ---------------------------------------------------------------- backgrounds
func _set_bg(fs: bool) -> void:
	if cur_bg: cur_bg.queue_free()
	var scene = db.bg_freespins if fs else db.bg_base
	if scene == null: return
	cur_bg = scene.instantiate()
	cur_bg.scale = Vector2(VIEW.x / 1080.0, VIEW.y / 1920.0)
	bg_layer.add_child(cur_bg)

# ------------------------------------------------------------------ reel build
func _reel_x(col: int) -> float:
	return 96.0 + col * PITCH_X

func _build_frame() -> void:
	# A translucent panel behind the reels for contrast.
	var panel := ColorRect.new()
	panel.color = Color(0.02, 0.04, 0.08, 0.55)
	panel.position = Vector2(_reel_x(0) - CELL * 0.5 - 18, GRID_TOP - PITCH_Y * 0.5 - 18)
	panel.size = Vector2((COLS - 1) * PITCH_X + CELL + 36, ROWS * PITCH_Y + 36)
	panel.z_index = 5
	add_child(panel)
	var hud_frame := "res://art/ui/hud_frame.png"
	if ResourceLoader.exists(hud_frame):
		var frame := TextureRect.new()
		frame.texture = load(hud_frame)
		frame.position = Vector2(0, GRID_TOP - PITCH_Y * 0.5 - 40)
		frame.size = Vector2(VIEW.x, ROWS * PITCH_Y + 80)
		frame.stretch_mode = TextureRect.STRETCH_SCALE
		frame.modulate = Color(1, 1, 1, 0.6)
		frame.z_index = 6
		add_child(frame)

func _build_reels() -> void:
	var s := CELL * 0.92 / 512.0
	var win_w := CELL + 8.0
	var win_h := PITCH_Y * ROWS
	for col in COLS:
		var window := Control.new()
		window.clip_contents = true
		window.position = Vector2(_reel_x(col) - win_w * 0.5, GRID_TOP - PITCH_Y * 0.5)
		window.size = Vector2(win_w, win_h)
		window.z_index = 10
		add_child(window)
		var sprites := []
		for idx in 5:
			var sp := Sprite2D.new()
			sp.centered = true
			sp.scale = Vector2(s, s)
			sp.position = Vector2(win_w * 0.5, (idx - 1) * PITCH_Y + PITCH_Y * 0.5)
			window.add_child(sp)
			sprites.append(sp)
		reels.append({
			"window": window, "sprites": sprites,
			"symbols": ["GOLD","EMBER","TEAL","VIOLET","CREST"],
			"scroll": 0.0, "state": "idle", "final": [],
		})
	_paint_reels()

func _paint_reels() -> void:
	for reel in reels:
		var sprites: Array = reel.sprites
		var syms: Array = reel.symbols
		for idx in 5:
			var sp: Sprite2D = sprites[idx]
			sp.texture = textures.get(syms[idx], null)
			sp.position.y = (idx - 1) * PITCH_Y + PITCH_Y * 0.5 + reel.scroll

func _idle_fill() -> void:
	for reel in reels:
		reel.symbols = [_rand_sym(), _rand_sym(), _rand_sym(), _rand_sym(), _rand_sym()]
	_paint_reels()

func _rand_sym() -> String:
	# Idle/scroll cosmetic only — ORB is free-spins-only so keep it out of the base strip.
	var pool := ["CREST","TALON","EGG","FEATHER","GOLD","EMBER","TEAL","VIOLET","SCATTER"]
	return pool[randi() % pool.size()]

# --------------------------------------------------------------------- process
func _process(dt: float) -> void:
	if not spinning: return
	for reel in reels:
		if reel.state != "spin": continue
		reel.scroll += SPIN_SPEED * dt
		while reel.scroll >= PITCH_Y:
			reel.scroll -= PITCH_Y
			reel.symbols.push_front(reel.symbols.pop_back())
			reel.symbols[0] = _rand_sym()
		_position_reel(reel)

func _position_reel(reel: Dictionary) -> void:
	var sprites: Array = reel.sprites
	var syms: Array = reel.symbols
	for idx in 5:
		var sp: Sprite2D = sprites[idx]
		sp.texture = textures.get(syms[idx], null)
		sp.position.y = (idx - 1) * PITCH_Y + PITCH_Y * 0.5 + reel.scroll

# ----------------------------------------------------------------- spin / round
func request_spin() -> void:
	if busy: return
	# No client-side balance gate: the server is authoritative and rejects an
	# unaffordable bet (delivered back as betError). The bridge-supplied balance can
	# also still be its initial 0 right after boot, so gating here would wrongly
	# block the first spins.
	busy = true
	spin_btn.disabled = true
	lbl_win.text = ""
	_flash_message("")
	_reset_dim()
	audio.play("spin_start")
	spinning = true
	for reel in reels:
		reel.state = "spin"
	if bridge != null:
		var cb := JavaScriptBridge.create_callback(_on_bridge_result)
		bridge.placeBet(bet_minor, cb)
	else:
		# desktop/editor mock — settle after a short, realistic spin
		await get_tree().create_timer(0.9).timeout
		_resolve(_mock_outcome())

func _on_bridge_result(args: Array) -> void:
	var raw: String = String(args[0]) if args.size() > 0 else ""
	var data = JSON.parse_string(raw)
	if typeof(data) != TYPE_DICTIONARY:
		_flash_message("Network error")
		_force_stop()
		return
	if data.has("error"):
		_flash_message(str(data.get("error")))
		_force_stop()
		return
	if data.has("balanceAfterMinor"):
		balance_minor = int(str(data.balanceAfterMinor))
	_resolve(data.get("outcome", {}))

func _resolve(outcome: Dictionary) -> void:
	var base: Dictionary = outcome.get("base", {})
	var grid: Array = base.get("grid", [])
	await _stop_reels(grid)
	await _present_win(base, outcome)
	if outcome.get("freeSpins", null) != null:
		await _run_free_spins(outcome.freeSpins)
	_update_hud()
	busy = false
	spinning = false
	spin_btn.disabled = false

func _stop_reels(grid: Array) -> void:
	for col in COLS:
		var final_col: Array = grid[col] if col < grid.size() else [_rand_sym(),_rand_sym(),_rand_sym()]
		await get_tree().create_timer(REEL_STOP_STAGGER).timeout
		_land_reel(reels[col], final_col)
		audio.play("reel_land")
	await get_tree().create_timer(0.28).timeout

func _land_reel(reel: Dictionary, col: Array) -> void:
	reel.state = "stopped"
	# Place the authoritative column into the visible slots (idx 1,2,3) with buffers.
	reel.symbols = [_rand_sym(), col[0], col[1], col[2], _rand_sym()]
	reel.scroll = 0.0
	_position_reel(reel)
	# Landing bounce.
	var win: Control = reel.window
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	win.position.y -= 10.0
	t.tween_property(win, "position:y", GRID_TOP - PITCH_Y * 0.5, 0.22).from(GRID_TOP - PITCH_Y * 0.5 - 10.0)

func _force_stop() -> void:
	for reel in reels:
		reel.state = "stopped"
		reel.scroll = 0.0
		_position_reel(reel)
	spinning = false
	busy = false
	spin_btn.disabled = false

# ----------------------------------------------------------------- win present
func _cell_world(col: int, row: int) -> Vector2:
	return Vector2(_reel_x(col), GRID_TOP + row * PITCH_Y)

func _reset_dim() -> void:
	for reel in reels:
		for sp in reel.sprites:
			sp.modulate = Color(1, 1, 1, 1)
			sp.scale = Vector2(CELL * 0.92 / 512.0, CELL * 0.92 / 512.0)

func _present_win(base: Dictionary, outcome: Dictionary) -> void:
	var ways: Array = base.get("waysWins", [])
	var scatter_count := int(base.get("scatterCount", 0))
	var win_cells := {}
	for w in ways:
		var sym: String = w.get("symbol", "")
		var count := int(w.get("count", 0))
		for col in min(count, COLS):
			var column: Array = base.get("grid", [])[col] if col < base.get("grid", []).size() else []
			for row in column.size():
				if column[row] == sym:
					win_cells["%d:%d" % [col, row]] = sym
	if scatter_count >= 3:
		var grid2: Array = base.get("grid", [])
		for col in grid2.size():
			for row in (grid2[col] as Array).size():
				if grid2[col][row] == "SCATTER":
					win_cells["%d:%d" % [col, row]] = "SCATTER"

	var total_bps := int(outcome.get("totalWinBps", 0))
	if win_cells.is_empty() and total_bps == 0:
		_flash_message("")
		return

	# Dim losers, pop + glow winners, fire particles.
	for reel in reels:
		for sp in reel.sprites:
			sp.modulate = Color(1, 1, 1, 0.35)
	var any_high := false
	for key in win_cells.keys():
		var parts: Array = key.split(":")
		var col := int(parts[0]); var row := int(parts[1])
		var sp: Sprite2D = reels[col].sprites[row + 1]   # visible rows are sprite idx 1..3
		sp.modulate = Color(1, 1, 1, 1)
		var base_s := CELL * 0.92 / 512.0
		var t := create_tween().set_loops(3).set_trans(Tween.TRANS_SINE)
		t.tween_property(sp, "scale", Vector2(base_s * 1.18, base_s * 1.18), 0.18)
		t.tween_property(sp, "scale", Vector2(base_s, base_s), 0.18)
		var sym: String = win_cells[key]
		if sym in HIGH or sym == "SCATTER": any_high = true
		_spawn_fx(db.win_high_fx if (sym in HIGH or sym == "SCATTER") else db.win_low_fx, _cell_world(col, row))

	var mult: float = float(total_bps) / 10000.0
	if mult >= 20.0:
		await _big_win(total_bps)
	else:
		audio.play("win_big" if any_high else "win_small")
	_count_up_win(total_bps)
	await get_tree().create_timer(0.5).timeout

func _big_win(total_bps: int) -> void:
	audio.play("bigwin_fanfare")
	_spawn_fx(db.bigwin_fx, Vector2(VIEW.x * 0.5, GRID_TOP + PITCH_Y))
	if banner:
		banner.visible = true
		banner.modulate = Color(1, 1, 1, 0)
		var t := create_tween()
		t.tween_property(banner, "modulate", Color(1, 1, 1, 1), 0.3)
		await get_tree().create_timer(1.8).timeout
		var t2 := create_tween()
		t2.tween_property(banner, "modulate", Color(1, 1, 1, 0), 0.4)
		await t2.finished
		banner.visible = false

func _count_up_win(total_bps: int) -> void:
	var credits := float(total_bps) / 10000.0 * float(bet_minor) / 1000.0
	lbl_win.text = "WIN  %s" % _fmt_credits(credits)

# --------------------------------------------------------------- free spins
func _run_free_spins(fs: Dictionary) -> void:
	_set_bg(true)
	audio.play("freespins_enter")
	audio.play("freespins_loop")
	lbl_mult.visible = true
	var spins: Array = fs.get("spins", [])
	var running_mult := 1
	for i in spins.size():
		var sp: Dictionary = spins[i]
		_flash_message("FREE SPIN  %d / %d" % [i + 1, spins.size()])
		# quick re-spin
		spinning = true
		for reel in reels:
			reel.state = "spin"
		await get_tree().create_timer(0.45).timeout
		await _stop_reels(sp.get("grid", []))
		spinning = false
		var orbs: Array = sp.get("orbValues", [])
		if orbs.size() > 0:
			audio.play("orb_ignite")
			_spawn_fx(db.orb_fx, Vector2(VIEW.x * 0.5, GRID_TOP + PITCH_Y))
			running_mult = int(sp.get("multiplier", running_mult))
			audio.play("multiplier_apply")
		lbl_mult.text = "x%d" % int(sp.get("multiplier", running_mult))
		await _present_win(sp, {"totalWinBps": sp.get("spinWinBps", 0)})
		await get_tree().create_timer(0.25).timeout
	lbl_mult.visible = false
	_flash_message("")
	_set_bg(false)
	audio.stop_music()

# ------------------------------------------------------------------------- FX
func _spawn_fx(scene, pos: Vector2) -> void:
	if scene == null: return
	var fx = scene.instantiate()
	fx.position = pos
	fx_layer.add_child(fx)
	for child in fx.get_children():
		if child is GPUParticles2D:
			child.restart()
	get_tree().create_timer(2.5).timeout.connect(fx.queue_free)

# ------------------------------------------------------------------------ HUD
func _styled_label(size: int, color: Color) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	l.add_theme_constant_override("outline_size", 4)
	return l

func _build_hud() -> void:
	hud = CanvasLayer.new(); hud.layer = 30; add_child(hud)

	var gold := Color(0.96, 0.79, 0.36)
	var title := _styled_label(46, gold)
	title.text = "PHOENIX ASCENDANT"
	title.position = Vector2(60, 120); title.size = Vector2(600, 60)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(title)

	lbl_balance = _styled_label(30, Color(0.9, 0.95, 1.0))
	lbl_balance.position = Vector2(40, 210); lbl_balance.size = Vector2(360, 40)
	hud.add_child(lbl_balance)

	lbl_mult = _styled_label(54, gold)
	lbl_mult.position = Vector2(VIEW.x - 200, 300); lbl_mult.size = Vector2(180, 60)
	lbl_mult.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	lbl_mult.visible = false
	hud.add_child(lbl_mult)

	lbl_msg = _styled_label(34, gold)
	lbl_msg.position = Vector2(60, 300); lbl_msg.size = Vector2(600, 44)
	lbl_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_msg)

	lbl_win = _styled_label(52, gold)
	lbl_win.position = Vector2(60, 800); lbl_win.size = Vector2(600, 64)
	lbl_win.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_win)

	# Banner (big win)
	banner = TextureRect.new()
	if ResourceLoader.exists("res://art/ui/banner.png"):
		banner.texture = load("res://art/ui/banner.png")
	banner.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	banner.position = Vector2(60, 560); banner.size = Vector2(600, 200)
	banner.visible = false
	hud.add_child(banner)

	# Bottom controls
	var y := 1120.0
	var minus := _texture_button("res://art/ui/btn_bet_minus.png", Vector2(70, y), 0.5)
	minus.pressed.connect(func(): _change_bet(-1))
	hud.add_child(minus)

	lbl_bet = _styled_label(34, Color.WHITE)
	lbl_bet.position = Vector2(150, y + 10); lbl_bet.size = Vector2(180, 44)
	lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_bet)

	var plus := _texture_button("res://art/ui/btn_bet_plus.png", Vector2(330, y), 0.5)
	plus.pressed.connect(func(): _change_bet(1))
	hud.add_child(plus)

	spin_btn = _texture_button("res://art/ui/btn_spin.png", Vector2(470, y - 30), 0.62)
	spin_btn.pressed.connect(func(): audio.play("button_tap"); request_spin())
	hud.add_child(spin_btn)

	_update_hud()

func _texture_button(path: String, pos: Vector2, scale: float) -> TextureButton:
	var b := TextureButton.new()
	if ResourceLoader.exists(path):
		var tex = load(path)
		b.texture_normal = tex
		b.ignore_texture_size = true
		b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
		b.custom_minimum_size = Vector2(tex.get_width() * scale, tex.get_height() * scale)
		b.size = b.custom_minimum_size
	b.position = pos
	return b

var BET_STEPS := [1000, 5000, 10000, 50000, 100000, 250000, 500000, 1000000]

func _change_bet(dir: int) -> void:
	audio.play("button_tap")
	var idx := BET_STEPS.find(bet_minor)
	if idx == -1: idx = 4
	idx = clamp(idx + dir, 0, BET_STEPS.size() - 1)
	bet_minor = clamp(BET_STEPS[idx], min_bet, max_bet)
	_update_hud()

func _fmt_credits(c: float) -> String:
	if c == floor(c): return "%d" % int(c)
	return "%.2f" % c

func _update_hud() -> void:
	lbl_balance.text = "Balance  %s" % _fmt_credits(float(balance_minor) / 1000.0)
	lbl_bet.text = "Bet %s" % _fmt_credits(float(bet_minor) / 1000.0)

func _flash_message(msg: String) -> void:
	if lbl_msg: lbl_msg.text = msg

# --------------------------------------------------------------------- bridge
func _connect_bridge() -> void:
	if not OS.has_feature("web"):
		return
	if not JavaScriptBridge.has_method("get_interface"):
		return
	var ok = JavaScriptBridge.eval("typeof window.PhoenixGodot === 'object'", true)
	if ok:
		bridge = JavaScriptBridge.get_interface("PhoenixGodot")
		var init_json: String = str(JavaScriptBridge.eval("JSON.stringify(window.PhoenixGodot.getInit())", true))
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
			column.append(_rand_sym())
		grid.append(column)
	# light win detection so the highlight path is exercised
	var ways := []
	var total_bps := 0
	for sym in ["CREST","TALON","GOLD","TEAL","VIOLET"]:
		var run := 0
		for col in COLS:
			if sym in grid[col]: run += 1
			else: break
		if run >= 3:
			var pay := 4000 if sym in HIGH else 800
			ways.append({"symbol": sym, "count": run, "ways": 1, "payBps": pay})
			total_bps += pay
	var scatter := 0
	for col in COLS:
		for row in ROWS:
			if grid[col][row] == "SCATTER": scatter += 1
	var fs = null
	if scatter >= 3:
		var spins := []
		for i in 8:
			var g2 := []
			for col in COLS:
				var c2 := []
				for row in ROWS: c2.append(_rand_sym())
				g2.append(c2)
			spins.append({"grid": g2, "waysWins": [], "scatterCount": 0, "orbValues": ([2] if i % 3 == 0 else []), "multiplier": 1 + i / 3, "spinWinBps": 5000 * i})
		fs = {"triggered": true, "spins": spins, "totalSpins": 8, "endMultiplier": 3, "totalBps": 40000}
		total_bps += 40000
	return {"kind": "phoenix-ascendant", "demo": true, "win": total_bps > 0,
		"base": {"grid": grid, "waysWins": ways, "scatterCount": scatter, "scatterPayBps": 0, "orbValues": [], "multiplier": 1, "spinWinBps": total_bps},
		"freeSpins": fs, "totalWinBps": total_bps}

# ------------------------------------------------------ offline screenshot hook
func _run_shots() -> void:
	var dir := OS.get_environment("PHX_SHOT")
	await get_tree().create_timer(1.2).timeout
	await _save_shot(dir + "/01_idle.png")
	request_spin()
	await get_tree().create_timer(4.0).timeout
	await _save_shot(dir + "/02_spin.png")
	request_spin()
	await get_tree().create_timer(4.0).timeout
	await _save_shot(dir + "/03_spin2.png")
	get_tree().quit()

func _save_shot(path: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img: img.save_png(path)
