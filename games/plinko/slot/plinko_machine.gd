extends Node2D

## Plinko — responsive web client.
##
## SERVER-AUTHORITATIVE: never decides an outcome. On drop it asks the host page
## (window.PlinkoGodot) to place the bet WITH the selected risk; the host calls the Aureus
## API and returns the authoritative outcome {risk, path, bucket, multiplier, totalWinBps},
## which this scene animates by dropping the ball along `path` into `bucket`. Standalone
## (no bridge) a local mock drives the visuals for offline QA.
##
## The 13 bucket multipliers are PUBLIC (PLINKO_LAYOUTS, mirrored from
## packages/shared/src/schemas/plinko.ts) and drawn on the board; the landing + payout
## always come from the server outcome.

const DESIGN := Vector2(1080, 1920)
const ROWS := 12
const GOLD := Color(0.93, 0.78, 0.36)

# Public payout curves — MUST match packages/shared/src/schemas/plinko.ts (binomial mean 0.96).
const LAYOUTS := {
	"LOW": [9.9, 3.3, 1.8, 1.3, 1.1, 0.9, 0.55, 0.9, 1.1, 1.3, 1.8, 3.3, 9.9],
	"MEDIUM": [45, 11, 3.2, 1.7, 1.0, 0.7, 0.33, 0.7, 1.0, 1.7, 3.2, 11, 45],
	"HIGH": [200, 28, 7, 1.8, 0.4, 0.3, 0.3, 0.3, 0.4, 1.8, 7, 28, 200],
}
const RISKS := ["LOW", "MEDIUM", "HIGH"]

# layout
var view := DESIGN
var portrait := true
var board_top := 0.0
var board_height := 0.0

# nodes
var bg_layer: CanvasLayer
var cur_bg: TextureRect
var grad_overlay: TextureRect
var board_holder: Node2D
var board                    # plinko_board.gd instance
var fx_layer: Node2D
var burst_spr: Sprite2D
var hud: CanvasLayer

var title_font: Font
var textures := {}

# HUD
var title_logo: TextureRect
var title_lbl: Label
var lbl_msg: Label
var banner: Label
var lbl_win: Label
var lbl_balance: Label
var lbl_bet: Label
var drop_btn: TextureButton
var bet_minus_btn: TextureButton
var bet_plus_btn: TextureButton
var sound_btn: TextureButton
var info_btn: TextureButton
var menu_btn: TextureButton
var risk_btns := []
var risk_pill: TextureRect
var bal_pill: TextureRect
var bet_pill: TextureRect

# session
var balance_minor := 0
var bet_minor := 100000
var min_bet := 1000
var max_bet := 2000000
var currency := "CREDIT"
var risk := "MEDIUM"
var busy := false
var bridge = null
var _bet_cb = null
var _bal_timer: Timer
var BET_STEPS := [1000, 5000, 10000, 50000, 100000, 250000, 500000, 1000000]

func _ready() -> void:
	randomize()
	_apply_window_size()
	view = get_viewport().get_visible_rect().size
	_load_textures()
	_load_fonts()

	bg_layer = CanvasLayer.new(); bg_layer.layer = -10; add_child(bg_layer)
	_build_bg()
	board_holder = Node2D.new(); board_holder.name = "Board"; add_child(board_holder)
	board = load("res://slot/plinko_board.gd").new()
	board_holder.add_child(board)
	fx_layer = Node2D.new(); fx_layer.z_index = 60; add_child(fx_layer)
	_build_fx()
	_build_hud()
	_apply_layout()
	_connect_bridge()
	get_viewport().size_changed.connect(_on_resize)
	if OS.get_environment("PK_SHOT") != "":
		_run_shots()

func _apply_window_size() -> void:
	if OS.has_feature("web"):
		return
	var sz := DESIGN
	var env := OS.get_environment("PK_SIZE")
	if env.find("x") > 0:
		var p := env.split("x")
		sz = Vector2(float(p[0]), float(p[1]))
	get_window().size = sz

func _on_resize() -> void:
	var v := get_viewport().get_visible_rect().size
	if v.x < 1.0 or v.y < 1.0:
		return
	view = v
	_apply_layout()

# ----------------------------------------------------------------- assets
func _load_textures() -> void:
	for name in ["peg", "ball", "bucket_green", "bucket_gold", "bucket_red", "win_burst",
			"title_logo", "btn_action", "btn_minus", "btn_plus", "btn_sound", "btn_info",
			"btn_menu", "toggle_pill", "readout_pill"]:
		var p := "res://art/ui/%s.png" % name
		if ResourceLoader.exists(p):
			textures[name] = load(p)

func _load_fonts() -> void:
	for p in ["res://fonts/CinzelDecorative-Bold.ttf", "res://fonts/CinzelDecorative-Black.ttf"]:
		if ResourceLoader.exists(p):
			title_font = load(p)
			return

# ----------------------------------------------------------------- background
func _build_bg() -> void:
	cur_bg = TextureRect.new()
	cur_bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	cur_bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	if ResourceLoader.exists("res://art/bg/bg_plinko.jpg"):
		cur_bg.texture = load("res://art/bg/bg_plinko.jpg")
	cur_bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg_layer.add_child(cur_bg)
	grad_overlay = TextureRect.new()
	grad_overlay.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	grad_overlay.stretch_mode = TextureRect.STRETCH_SCALE
	grad_overlay.texture = _vignette()
	grad_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg_layer.add_child(grad_overlay)

func _vignette() -> GradientTexture2D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.25, 0.7, 1.0])
	g.colors = PackedColorArray([
		Color(0.02, 0.01, 0.04, 0.55), Color(0.02, 0.01, 0.04, 0.0),
		Color(0.02, 0.01, 0.04, 0.05), Color(0.02, 0.01, 0.04, 0.6),
	])
	var tex := GradientTexture2D.new()
	tex.gradient = g; tex.fill_from = Vector2(0, 0); tex.fill_to = Vector2(0, 1)
	tex.width = 8; tex.height = 256
	return tex

func _build_fx() -> void:
	burst_spr = Sprite2D.new()
	burst_spr.centered = true
	burst_spr.visible = false
	burst_spr.z_index = 70
	if textures.has("win_burst"):
		burst_spr.texture = textures["win_burst"]
	fx_layer.add_child(burst_spr)

# ----------------------------------------------------------------- layout
func _apply_layout() -> void:
	var W := view.x
	var H := view.y
	portrait = H >= W
	if cur_bg:
		cur_bg.size = view; cur_bg.position = Vector2.ZERO
	if grad_overlay:
		grad_overlay.size = view; grad_overlay.position = Vector2.ZERO
	board_top = H * 0.13
	board_height = H * 0.66
	var board_w: float = min(W, H * 0.62)
	board_holder.position = Vector2((W - board_w) * 0.5, board_top)
	if board:
		board.configure(
			Vector2(board_w, board_height),
			LAYOUTS[risk],
			textures.get("peg", null),
			textures.get("ball", null),
			{
				"green": textures.get("bucket_green", null),
				"gold": textures.get("bucket_gold", null),
				"red": textures.get("bucket_red", null),
			},
			title_font,
		)
	_layout_hud()

# ------------------------------------------------------------------------ HUD
func _styled_label(size: int, color: Color) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.78))
	l.add_theme_constant_override("outline_size", 6)
	if title_font:
		l.add_theme_font_override("font", title_font)
	return l

func _tex_rect(name: String) -> TextureRect:
	var tr := TextureRect.new()
	if textures.has(name):
		tr.texture = textures[name]
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return tr

func _tex_btn(name: String) -> TextureButton:
	var b := TextureButton.new()
	if textures.has(name):
		b.texture_normal = textures[name]
	b.ignore_texture_size = true
	b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	b.pressed.connect(func(): _btn_feedback(b))
	return b

func _btn_feedback(b: Control) -> void:
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	b.scale = Vector2(0.9, 0.9)
	t.tween_property(b, "scale", Vector2(1, 1), 0.18)

func _build_hud() -> void:
	hud = CanvasLayer.new(); hud.layer = 30; add_child(hud)

	title_logo = _tex_rect("title_logo")
	if not textures.has("title_logo"):
		title_lbl = _styled_label(64, GOLD)
		title_lbl.text = "PLINKO"
		title_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		hud.add_child(title_lbl)
	else:
		hud.add_child(title_logo)

	lbl_msg = _styled_label(32, GOLD)
	lbl_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_msg)

	banner = _styled_label(100, GOLD)
	banner.text = "BIG WIN"; banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.visible = false; banner.z_index = 5
	hud.add_child(banner)

	lbl_win = _styled_label(48, GOLD)
	lbl_win.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_win)

	bal_pill = _tex_rect("readout_pill"); hud.add_child(bal_pill)
	lbl_balance = _styled_label(30, Color(0.95, 0.97, 1.0))
	lbl_balance.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_balance)

	bet_pill = _tex_rect("readout_pill"); hud.add_child(bet_pill)
	lbl_bet = _styled_label(30, Color.WHITE)
	lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_bet)

	risk_pill = _tex_rect("toggle_pill"); hud.add_child(risk_pill)
	for r in RISKS:
		var b := Button.new()
		b.text = r
		b.flat = true
		b.focus_mode = Control.FOCUS_NONE
		b.add_theme_font_size_override("font_size", 22)
		if title_font:
			b.add_theme_font_override("font", title_font)
		b.pressed.connect(func(): _set_risk(r))
		hud.add_child(b)
		risk_btns.append(b)

	bet_minus_btn = _tex_btn("btn_minus")
	bet_minus_btn.pressed.connect(func(): _change_bet(-1))
	hud.add_child(bet_minus_btn)
	bet_plus_btn = _tex_btn("btn_plus")
	bet_plus_btn.pressed.connect(func(): _change_bet(1))
	hud.add_child(bet_plus_btn)

	drop_btn = _tex_btn("btn_action")
	drop_btn.pressed.connect(func(): request_drop())
	hud.add_child(drop_btn)

	sound_btn = _tex_btn("btn_sound"); sound_btn.pressed.connect(_toggle_sound); hud.add_child(sound_btn)
	info_btn = _tex_btn("btn_info"); hud.add_child(info_btn)
	menu_btn = _tex_btn("btn_menu"); hud.add_child(menu_btn)

	_update_risk_visual()
	_update_hud()

func _place_lbl(l: Label, pos: Vector2, size: Vector2) -> void:
	l.position = pos; l.size = size

func _place_rect(tr: Control, center: Vector2, box: Vector2) -> void:
	tr.size = box; tr.position = center - box * 0.5; tr.pivot_offset = box * 0.5

func _place_btn(b: TextureButton, center: Vector2, size: Vector2) -> void:
	b.custom_minimum_size = size; b.size = size; b.position = center - size * 0.5; b.pivot_offset = size * 0.5

func _layout_hud() -> void:
	var W := view.x
	var H := view.y

	if title_logo and title_logo.texture:
		var lw: float = min(W * 0.62, 560.0)
		var lh := lw * float(title_logo.texture.get_height()) / float(title_logo.texture.get_width())
		_place_rect(title_logo, Vector2(W * 0.5, H * 0.06), Vector2(lw, lh))
	elif title_lbl:
		_place_lbl(title_lbl, Vector2(0, H * 0.03), Vector2(W, 80))
		title_lbl.add_theme_font_size_override("font_size", int(min(W, H) * 0.06))

	# risk selector just under the title
	var rpw: float = min(W * 0.86, 560.0)
	var ry := H * 0.115
	_place_rect(risk_pill, Vector2(W * 0.5, ry), Vector2(rpw, rpw * 0.16))
	for i in risk_btns.size():
		var bx := W * 0.5 + (i - 1) * (rpw / 3.0)
		_place_rect(risk_btns[i], Vector2(bx, ry), Vector2(rpw / 3.0, rpw * 0.16))

	var below := board_top + board_height
	_place_lbl(lbl_msg, Vector2(0, below + H * 0.004), Vector2(W, 40))
	_place_lbl(lbl_win, Vector2(0, below + H * 0.032), Vector2(W, 56)); lbl_win.add_theme_font_size_override("font_size", 46)
	_place_lbl(banner, Vector2(0, H * 0.4), Vector2(W, 150)); banner.pivot_offset = Vector2(W * 0.5, 75)

	# bottom control deck
	var rdy := H * 0.86
	_place_rect(bal_pill, Vector2(W * 0.29, rdy), Vector2(W * 0.42, 60))
	_place_lbl(lbl_balance, Vector2(W * 0.08, rdy - 18), Vector2(W * 0.42, 40)); lbl_balance.add_theme_font_size_override("font_size", 28)
	_place_rect(bet_pill, Vector2(W * 0.71, rdy), Vector2(W * 0.42, 60))
	_place_lbl(lbl_bet, Vector2(W * 0.5, rdy - 18), Vector2(W * 0.42, 40)); lbl_bet.add_theme_font_size_override("font_size", 28)

	var by := H * 0.93
	_place_btn(drop_btn, Vector2(W * 0.5, by), Vector2(W * 0.24, W * 0.24))
	_place_btn(bet_minus_btn, Vector2(W * 0.18, by), Vector2(W * 0.16, W * 0.16))
	_place_btn(bet_plus_btn, Vector2(W * 0.82, by), Vector2(W * 0.16, W * 0.16))

	_place_btn(info_btn, Vector2(W * 0.09, H * 0.05), Vector2(56, 56))
	_place_btn(sound_btn, Vector2(W * 0.91, H * 0.05), Vector2(56, 56))
	_place_btn(menu_btn, Vector2(W * 0.91, H * 0.10), Vector2(50, 50))

func _update_risk_visual() -> void:
	for i in risk_btns.size():
		var active: bool = RISKS[i] == risk
		risk_btns[i].add_theme_color_override("font_color", GOLD if active else Color(0.6, 0.62, 0.7))
		risk_btns[i].add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
		risk_btns[i].add_theme_constant_override("outline_size", 5 if active else 3)

func _set_risk(r: String) -> void:
	if busy or r == risk:
		return
	risk = r
	_update_risk_visual()
	if board:
		board.set_risk_layout(LAYOUTS[risk])

func _change_bet(dir: int) -> void:
	if busy:
		return
	var idx := BET_STEPS.find(bet_minor)
	if idx == -1:
		idx = 4
	idx = clamp(idx + dir, 0, BET_STEPS.size() - 1)
	bet_minor = clamp(BET_STEPS[idx], min_bet, max_bet)
	_update_hud()

var _muted := false
func _toggle_sound() -> void:
	_muted = not _muted
	AudioServer.set_bus_mute(AudioServer.get_bus_index("Master"), _muted)

func _fmt(c: float) -> String:
	if c == floor(c):
		return "%d" % int(c)
	return "%.2f" % c

func _update_hud() -> void:
	lbl_balance.text = "Balance  %s" % _fmt(float(balance_minor) / 1000.0)
	lbl_bet.text = "Bet  %s" % _fmt(float(bet_minor) / 1000.0)

func _flash(msg: String) -> void:
	if lbl_msg:
		lbl_msg.text = msg

# ----------------------------------------------------------------- drop
func request_drop() -> void:
	if busy:
		return
	busy = true
	drop_btn.disabled = true
	lbl_win.text = ""
	_flash("")
	if bridge != null:
		_bet_cb = JavaScriptBridge.create_callback(_on_bridge_result)
		bridge.placeBet(bet_minor, JSON.stringify({"risk": risk}), _bet_cb)
	else:
		await get_tree().create_timer(0.35).timeout
		_resolve(_mock_outcome())

func _on_bridge_result(args: Array) -> void:
	var raw: String = String(args[0]) if args.size() > 0 else ""
	var data = JSON.parse_string(raw)
	if typeof(data) != TYPE_DICTIONARY:
		_flash("Network error"); _finish_idle(); return
	if data.has("error"):
		_flash(str(data.get("error"))); _finish_idle(); return
	if data.has("balanceAfterMinor"):
		balance_minor = int(str(data.balanceAfterMinor))
	_resolve(data.get("outcome", {}))

func _finish_idle() -> void:
	busy = false
	drop_btn.disabled = false

func _resolve(outcome: Dictionary) -> void:
	var path := _to_int_array(outcome.get("path", []))
	var bucket := int(outcome.get("bucket", _sum(path)))
	var total_bps := int(outcome.get("totalWinBps", 0))
	var mult := float(outcome.get("multiplier", 0.0))
	if path.is_empty():
		path = _mock_path_to(bucket)
	await board.drop_ball(path, bucket)
	board.highlight_bucket(bucket)
	await _present_win(total_bps, mult)
	_update_hud()
	busy = false
	drop_btn.disabled = false

func _present_win(total_bps: int, multiplier: float) -> void:
	if total_bps <= 0:
		_flash("No win — drop again")
		return
	_flash("x%s" % _fmt(multiplier))
	if multiplier >= 10.0:
		_play_burst()
		_show_banner("MEGA WIN" if multiplier >= 50.0 else "BIG WIN")
		_shake(10.0, 0.55)
	_count_up(total_bps)
	await get_tree().create_timer(0.6).timeout

func _count_up(total_bps: int) -> void:
	var credits := float(total_bps) / 10000.0 * float(bet_minor) / 1000.0
	if credits <= 0:
		lbl_win.text = ""; return
	var t := create_tween()
	for i in range(1, 19):
		var v := credits * float(i) / 18.0
		t.tween_callback(func(): lbl_win.text = "WIN  %s" % _fmt(v)).set_delay(0.03)

func _play_burst() -> void:
	if burst_spr == null or burst_spr.texture == null:
		return
	burst_spr.position = Vector2(view.x * 0.5, board_top + board_height * 0.5)
	burst_spr.visible = true
	burst_spr.modulate = Color(1, 1, 1, 0)
	burst_spr.scale = Vector2(0.4, 0.4)
	var t := create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	t.tween_property(burst_spr, "modulate", Color(1, 1, 1, 1), 0.18)
	t.parallel().tween_property(burst_spr, "scale", Vector2(1.2, 1.2), 0.4)
	t.tween_property(burst_spr, "modulate", Color(1, 1, 1, 0), 0.5)
	t.tween_callback(func(): burst_spr.visible = false)

func _show_banner(text: String) -> void:
	banner.text = text; banner.visible = true
	banner.modulate = Color(1, 1, 1, 0); banner.scale = Vector2(0.6, 0.6)
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
		t.tween_property(board_holder, "position:x", board_holder.position.x + randf_range(-m, m), 0.04)
	t.tween_property(board_holder, "position:x", board_holder.position.x, 0.06)

# --------------------------------------------------------------------- bridge
func _connect_bridge() -> void:
	if not OS.has_feature("web"):
		return
	if not JavaScriptBridge.has_method("get_interface"):
		return
	var ok = JavaScriptBridge.eval("typeof window.PlinkoGodot === 'object'", true)
	if ok:
		bridge = JavaScriptBridge.get_interface("PlinkoGodot")
		var init_json: String = str(JavaScriptBridge.eval("JSON.stringify(window.PlinkoGodot.getInit())", true))
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
	var j: String = str(JavaScriptBridge.eval("JSON.stringify(window.PlinkoGodot.getInit())", true))
	var d = JSON.parse_string(j)
	if typeof(d) == TYPE_DICTIONARY:
		var b := int(str(d.get("balanceMinor", balance_minor)))
		if b != balance_minor:
			balance_minor = b
			_update_hud()

# ----------------------------------------------------------------------- mock
func _to_int_array(a) -> Array:
	var out: Array = []
	if a is Array:
		for v in a:
			out.append(int(v))
	return out

func _sum(a: Array) -> int:
	var s := 0
	for v in a:
		s += int(v)
	return s

func _mock_path_to(bucket: int) -> Array:
	# Build any 12-step path with `bucket` rights (used only when a path is missing).
	var path: Array = []
	for i in range(ROWS):
		path.append(1 if i < bucket else 0)
	path.shuffle()
	return path

func _mock_outcome() -> Dictionary:
	var layout: Array = LAYOUTS[risk]
	var path: Array = []
	var bucket := 0
	for i in range(ROWS):
		var r := 0 if randf() < 0.5 else 1
		path.append(r)
		bucket += r
	var m: float = float(layout[bucket])
	var bps := int(round(m * 10000.0))
	return {"kind": "plinko", "win": bps > 0, "risk": risk, "path": path, "bucket": bucket, "multiplier": m, "totalWinBps": bps}

# ----------------------------------------------------- offline screenshot hook
func _run_shots() -> void:
	var dir := OS.get_environment("PK_SHOT")
	await get_tree().create_timer(0.8).timeout
	await _save_shot(dir + "/01_idle.png")
	request_drop()
	await get_tree().create_timer(3.2).timeout
	await _save_shot(dir + "/02_drop.png")
	get_tree().quit()

func _save_shot(path: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img:
		img.save_png(path)
