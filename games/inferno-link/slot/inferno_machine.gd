extends Node2D

## Inferno Link — responsive web slot client.
##
## SERVER-AUTHORITATIVE: never decides an outcome. On spin it asks the host page
## (window.InfernoGodot) to place the bet; the host calls the Aureus API and returns the
## authoritative outcome {grid, lineWins, holdSpin, totalWinBps}, which this scene animates:
## reels spin in, line wins flash, and on 6+ fireballs the hold-and-spin plays out (lock the
## fireballs with their values, respin the empties, award jackpots/GRAND). Standalone (no
## bridge) a local mock drives the visuals for offline QA.
##
## The four jackpot tiers + fireball values are PUBLIC (mirrored from
## packages/shared/src/schemas/inferno.ts) and shown exactly; payouts come from the server.

const DESIGN := Vector2(1080, 1920)
const REELS := 5
const ROWS := 4
# Cut-window opening as fractions of the frame art (printed by tools/prep-assets.py).
const WIN_L := 0.0966
const WIN_T := 0.1378
const WIN_R := 0.9030
const WIN_B := 0.8635
# Same, for the tall bonus frame (5×6 hold-and-spin board).
const BWIN_L := 0.1715
const BWIN_T := 0.1215
const BWIN_R := 0.8271
const BWIN_B := 0.8756
const BONUS_ROWS := 8
const GOLD := Color(0.97, 0.8, 0.36)
const EMBER := Color(1.0, 0.5, 0.12)

# 25 paylines — MUST match apps/api/src/games/engines/inferno/math.ts PAYLINES.
const PAYLINES := [
	[1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [3, 3, 3, 3, 3],
	[0, 1, 2, 1, 0], [3, 2, 1, 2, 3], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2],
	[0, 0, 1, 0, 0], [3, 3, 2, 3, 3], [1, 0, 0, 0, 1], [2, 3, 3, 3, 2],
	[0, 1, 1, 1, 0], [3, 2, 2, 2, 3], [1, 2, 2, 2, 1], [2, 1, 1, 1, 2],
	[0, 1, 0, 1, 0], [3, 2, 3, 2, 3], [1, 0, 1, 0, 1], [2, 3, 2, 3, 2],
	[0, 2, 0, 2, 0], [3, 1, 3, 1, 3], [1, 3, 1, 3, 1], [2, 0, 2, 0, 2],
	[0, 3, 0, 3, 0],
]
# Jackpot tiers shown in the HUD (multiplier of bet) — mirror INFERNO_JACKPOTS.
const JACKPOTS := [
	{"name": "GRAND", "mult": 1000, "color": Color(1.0, 0.85, 0.4)},
	{"name": "MAJOR", "mult": 200, "color": Color(0.85, 0.5, 1.0)},
	{"name": "MINOR", "mult": 50, "color": Color(0.5, 0.85, 1.0)},
	{"name": "MINI", "mult": 20, "color": Color(0.6, 1.0, 0.6)},
]

var view := DESIGN
var portrait := true
var frame_rect := Rect2()
# base (5×4) + bonus (5×6) layout rects, computed in _apply_layout
var base_win := Rect2()
var base_frame := Rect2()
var bonus_win := Rect2()
var bonus_frame := Rect2()

var bg_layer: CanvasLayer
var cur_bg: TextureRect
var grad_overlay: TextureRect
var board                       # inferno_board.gd
var fx_layer: Node2D
var hud: CanvasLayer

var title_font: Font
var textures := {}
var sym_tex := {}
var _audio := {}
var _music: AudioStreamPlayer
var _spin_loop: AudioStreamPlayer

# HUD
var title_logo: TextureRect
var jp_pills := []              # [{rect:TextureRect, name:Label, val:Label}]
var lbl_msg: Label
var banner: Label
var lbl_win: Label
var lbl_balance: Label
var lbl_bet: Label
var lbl_respin: Label
var spin_btn: TextureButton
var bet_minus_btn: TextureButton
var bet_plus_btn: TextureButton
var sound_btn: TextureButton
var info_btn: TextureButton
var menu_btn: TextureButton
var bal_pill: TextureRect
var bet_pill: TextureRect

# session
var balance_minor := 0
var bet_minor := 1000
var min_bet := 50
var max_bet := 10000
var currency := "CREDIT"
var busy := false
var bridge = null
var _bet_cb = null
var _bal_timer: Timer
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
	board = load("res://slot/inferno_board.gd").new()
	add_child(board)
	board.configure(textures.get("reel_frame", null), textures.get("bonus_frame", null), sym_tex, title_font)
	fx_layer = Node2D.new(); fx_layer.z_index = 60; add_child(fx_layer)
	_build_hud()
	_apply_layout()
	board.show_idle()
	_connect_bridge()
	_start_music()
	get_viewport().size_changed.connect(_on_resize)
	if OS.get_environment("IL_SHOT") != "":
		_run_shots()

func _apply_window_size() -> void:
	if OS.has_feature("web"): return
	var sz := DESIGN
	var env := OS.get_environment("IL_SIZE")
	if env.find("x") > 0:
		var p := env.split("x"); sz = Vector2(float(p[0]), float(p[1]))
	get_window().size = sz

func _on_resize() -> void:
	var v := get_viewport().get_visible_rect().size
	if v.x < 1.0 or v.y < 1.0: return
	view = v
	_apply_layout()

# ----------------------------------------------------------------- assets
func _load_textures() -> void:
	for name in ["reel_frame", "bonus_frame", "title_logo", "btn_action", "btn_minus", "btn_plus",
			"btn_sound", "btn_info", "btn_menu", "readout_pill"]:
		var p := "res://art/ui/%s.png" % name
		if ResourceLoader.exists(p): textures[name] = load(p)
	for name in ["SEVEN", "BELL", "COIN", "RED", "PURPLE", "BLUE", "GREEN", "WILD", "FIREBALL"]:
		var f := "res://art/symbols/%s.png" % _sym_file(name)
		if ResourceLoader.exists(f): sym_tex[name] = load(f)

func _sym_file(sym: String) -> String:
	match sym:
		"SEVEN": return "seven"
		"BELL": return "bell"
		"COIN": return "coin"
		"RED": return "gem_red"
		"PURPLE": return "gem_purple"
		"BLUE": return "gem_blue"
		"GREEN": return "gem_green"
		"WILD": return "wild"
		"FIREBALL": return "fireball"
	return sym.to_lower()

func _load_fonts() -> void:
	for p in ["res://fonts/CinzelDecorative-Bold.ttf", "res://fonts/CinzelDecorative-Black.ttf"]:
		if ResourceLoader.exists(p):
			title_font = load(p); return

# ----------------------------------------------------------------- audio
func _cue_stream(name: String) -> AudioStream:
	for ext in [".ogg", ".wav"]:
		var p := "res://audio/cues/%s%s" % [name, ext]
		if ResourceLoader.exists(p):
			return load(p)
	return null

func _load_audio() -> void:
	for name in [
		"spin_press", "spin_start", "reel_land", "reel_land_b", "reel_land_c",
		"win_small", "win_medium", "win_big", "bigwin_fanfare", "megawin_fanfare",
		"fireball_land", "holdspin_enter", "holdspin_respin", "grand_jackpot",
		"coin_tick", "coin_shower", "button_tap", "bet_change", "error_blip",
	]:
		var st := _cue_stream(name)
		if st == null: continue
		var pl := AudioStreamPlayer.new(); pl.stream = st; add_child(pl); _audio[name] = pl
	_spin_loop = _make_loop("spin_loop", -12.0)
	_music = _make_loop("music_base_loop", -11.0)

func _make_loop(name: String, db: float) -> AudioStreamPlayer:
	var st := _cue_stream(name)
	if st == null: return null
	if st is AudioStreamOggVorbis: st.loop = true
	elif st is AudioStreamWAV: st.loop_mode = AudioStreamWAV.LOOP_FORWARD
	var pl := AudioStreamPlayer.new(); pl.stream = st; pl.volume_db = db; add_child(pl)
	return pl

func play(name: String) -> void:
	var pl = _audio.get(name, null)
	if pl: pl.play()

func _start_music() -> void:
	if _music: _music.play()

func _duck_music(on: bool) -> void:
	if _music: _music.volume_db = -18.0 if on else -11.0

func _spin_whir(on: bool) -> void:
	if _spin_loop == null: return
	var t := create_tween()
	if on:
		_spin_loop.volume_db = -28.0
		if not _spin_loop.playing: _spin_loop.play()
		t.tween_property(_spin_loop, "volume_db", -12.0, 0.18)
	else:
		t.tween_property(_spin_loop, "volume_db", -34.0, 0.3)
		t.tween_callback(_spin_loop.stop)

# ----------------------------------------------------------------- background
func _build_bg() -> void:
	cur_bg = TextureRect.new()
	cur_bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	cur_bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	if ResourceLoader.exists("res://art/bg/bg_inferno.jpg"):
		cur_bg.texture = load("res://art/bg/bg_inferno.jpg")
	bg_layer.add_child(cur_bg)
	grad_overlay = TextureRect.new()
	grad_overlay.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	grad_overlay.stretch_mode = TextureRect.STRETCH_SCALE
	grad_overlay.texture = _vignette()
	bg_layer.add_child(grad_overlay)

func _vignette() -> GradientTexture2D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.3, 0.7, 1.0])
	g.colors = PackedColorArray([
		Color(0.05, 0.01, 0.0, 0.5), Color(0.05, 0.01, 0.0, 0.0),
		Color(0.05, 0.01, 0.0, 0.08), Color(0.05, 0.01, 0.0, 0.62),
	])
	var tex := GradientTexture2D.new()
	tex.gradient = g; tex.fill_from = Vector2(0, 0); tex.fill_to = Vector2(0, 1)
	tex.width = 8; tex.height = 256
	return tex

# ------------------------------------------------------------------------ HUD
func _styled_label(size: int, color: Color) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0.15, 0.01, 0.0, 0.85))
	l.add_theme_constant_override("outline_size", 6)
	if title_font: l.add_theme_font_override("font", title_font)
	return l

func _tex_rect(name: String) -> TextureRect:
	var tr := TextureRect.new()
	if textures.has(name): tr.texture = textures[name]
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return tr

func _tex_btn(name: String) -> TextureButton:
	var b := TextureButton.new()
	if textures.has(name): b.texture_normal = textures[name]
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
	hud.add_child(title_logo)

	# four jackpot pills
	for jp in JACKPOTS:
		var rect := _tex_rect("readout_pill")
		hud.add_child(rect)
		var nm := _styled_label(22, jp.color)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		nm.text = jp.name
		hud.add_child(nm)
		var val := _styled_label(24, Color(1, 0.97, 0.88))
		val.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		hud.add_child(val)
		jp_pills.append({"rect": rect, "name": nm, "val": val})

	lbl_msg = _styled_label(30, GOLD)
	lbl_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_msg)

	lbl_respin = _styled_label(30, EMBER)
	lbl_respin.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl_respin.visible = false
	hud.add_child(lbl_respin)

	banner = _styled_label(96, GOLD)
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.visible = false; banner.z_index = 5
	hud.add_child(banner)

	lbl_win = _styled_label(46, GOLD)
	lbl_win.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_win)

	bal_pill = _tex_rect("readout_pill"); hud.add_child(bal_pill)
	lbl_balance = _styled_label(28, Color(0.96, 0.97, 1.0))
	lbl_balance.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_balance)
	bet_pill = _tex_rect("readout_pill"); hud.add_child(bet_pill)
	lbl_bet = _styled_label(28, Color.WHITE)
	lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_bet)

	bet_minus_btn = _tex_btn("btn_minus"); bet_minus_btn.pressed.connect(func(): _change_bet(-1)); hud.add_child(bet_minus_btn)
	bet_plus_btn = _tex_btn("btn_plus"); bet_plus_btn.pressed.connect(func(): _change_bet(1)); hud.add_child(bet_plus_btn)
	spin_btn = _tex_btn("btn_action"); spin_btn.pressed.connect(func(): request_spin()); hud.add_child(spin_btn)
	sound_btn = _tex_btn("btn_sound"); sound_btn.pressed.connect(_toggle_sound); hud.add_child(sound_btn)
	info_btn = _tex_btn("btn_info"); info_btn.pressed.connect(func(): play("button_tap")); hud.add_child(info_btn)
	menu_btn = _tex_btn("btn_menu"); menu_btn.pressed.connect(func(): play("button_tap")); hud.add_child(menu_btn)

	_update_hud()
	_update_jackpots()

func _place_lbl(l: Label, pos: Vector2, size: Vector2) -> void:
	l.position = pos; l.size = size

func _place_rect(tr: Control, center: Vector2, box: Vector2) -> void:
	tr.size = box; tr.position = center - box * 0.5; tr.pivot_offset = box * 0.5

func _place_btn(b: TextureButton, center: Vector2, size: Vector2) -> void:
	b.custom_minimum_size = size; b.size = size; b.position = center - size * 0.5; b.pivot_offset = size * 0.5

func _apply_layout() -> void:
	var W := view.x
	var H := view.y
	portrait = H >= W
	cur_bg.size = view; cur_bg.position = Vector2.ZERO
	grad_overlay.size = view; grad_overlay.position = Vector2.ZERO

	# frame occupies the central band; the grid window sits inside its border. Height comes
	# from the frame texture's native aspect so the ornate border never distorts.
	var frame_tex = textures.get("reel_frame", null)
	var aspect := (float(frame_tex.get_height()) / float(frame_tex.get_width())) if frame_tex else 0.66
	var fw: float = min(W * 0.97, (H * 0.46) / aspect)
	var fh := fw * aspect
	var fx := (W - fw) * 0.5
	var fy := H * 0.27
	frame_rect = Rect2(fx, fy, fw, fh)
	# The cut window opening, measured from the frame art by prep-assets.py (l,t,r,b fractions),
	# so the reel grid lines up exactly inside the ornate border.
	base_frame = Rect2(fx, fy, fw, fh)
	base_win = Rect2(fx + WIN_L * fw, fy + WIN_T * fh, (WIN_R - WIN_L) * fw, (WIN_B - WIN_T) * fh)

	# Bonus board: the TALL portrait frame — sits below the jackpot pills, above the control
	# deck, and is clearly taller than the base frame ("transform into a taller board").
	var btex = textures.get("bonus_frame", null)
	var basp := (float(btex.get_height()) / float(btex.get_width())) if btex else 1.45
	var bfh: float = min(H * 0.585, (W * 0.94) * basp)
	var bfw := bfh / basp
	var bfx := (W - bfw) * 0.5
	var bfy := H * 0.235
	bonus_frame = Rect2(bfx, bfy, bfw, bfh)
	bonus_win = Rect2(bfx + BWIN_L * bfw, bfy + BWIN_T * bfh, (BWIN_R - BWIN_L) * bfw, (BWIN_B - BWIN_T) * bfh)

	# (re)apply whichever board mode is active so a resize mid-feature stays correct
	if board.active_rows == ROWS:
		board.layout(ROWS, base_win.position, base_win.size, base_frame.position, base_frame.size, textures.get("reel_frame", null))
	else:
		board.layout(board.active_rows, bonus_win.position, bonus_win.size, bonus_frame.position, bonus_frame.size, textures.get("bonus_frame", null))

	if title_logo and title_logo.texture:
		var lw: float = min(W * 0.7, 620.0)
		var lh := lw * float(title_logo.texture.get_height()) / float(title_logo.texture.get_width())
		_place_rect(title_logo, Vector2(W * 0.5, H * 0.058), Vector2(lw, lh))

	# jackpot pills: 2×2 above the frame
	var pj_w: float = min(W * 0.46, 300.0)
	var pj_h := pj_w * 0.26
	var jy0 := H * 0.135
	var order := [0, 1, 2, 3] # GRAND, MAJOR, MINOR, MINI
	for i in 4:
		var col := i % 2
		var rowi := i / 2
		var cx := W * (0.275 if col == 0 else 0.725)
		var cy := jy0 + rowi * (pj_h + 8.0)
		var jp = jp_pills[i]
		var fs := int(pj_h * 0.36)
		_place_rect(jp.rect, Vector2(cx, cy), Vector2(pj_w, pj_h))
		# name on the left half, value on the right half — no overlap.
		jp.name.position = Vector2(cx - pj_w * 0.5 + pj_w * 0.1, cy - pj_h * 0.5)
		jp.name.size = Vector2(pj_w * 0.42, pj_h)
		jp.name.add_theme_font_size_override("font_size", fs)
		jp.name.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		jp.name.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		jp.val.position = Vector2(cx - pj_w * 0.02, cy - pj_h * 0.5)
		jp.val.size = Vector2(pj_w * 0.42, pj_h)
		jp.val.add_theme_font_size_override("font_size", fs)
		jp.val.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		jp.val.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT

	var below := frame_rect.position.y + frame_rect.size.y
	_place_lbl(lbl_msg, Vector2(0, below + H * 0.004), Vector2(W, 40))
	_place_lbl(lbl_respin, Vector2(0, frame_rect.position.y - H * 0.012), Vector2(W, 40))
	_place_lbl(lbl_win, Vector2(0, below + H * 0.034), Vector2(W, 54)); lbl_win.add_theme_font_size_override("font_size", 44)
	_place_lbl(banner, Vector2(0, H * 0.42), Vector2(W, 150)); banner.pivot_offset = Vector2(W * 0.5, 75)

	var rdy := H * 0.84
	_place_rect(bal_pill, Vector2(W * 0.29, rdy), Vector2(W * 0.42, 58))
	_place_lbl(lbl_balance, Vector2(W * 0.08, rdy - 17), Vector2(W * 0.42, 38)); lbl_balance.add_theme_font_size_override("font_size", 26)
	_place_rect(bet_pill, Vector2(W * 0.71, rdy), Vector2(W * 0.42, 58))
	_place_lbl(lbl_bet, Vector2(W * 0.5, rdy - 17), Vector2(W * 0.42, 38)); lbl_bet.add_theme_font_size_override("font_size", 26)

	var by := H * 0.91
	_place_btn(spin_btn, Vector2(W * 0.5, by), Vector2(W * 0.23, W * 0.23))
	_place_btn(bet_minus_btn, Vector2(W * 0.18, by), Vector2(W * 0.155, W * 0.155))
	_place_btn(bet_plus_btn, Vector2(W * 0.82, by), Vector2(W * 0.155, W * 0.155))
	_place_btn(info_btn, Vector2(W * 0.09, H * 0.05), Vector2(54, 54))
	_place_btn(sound_btn, Vector2(W * 0.91, H * 0.05), Vector2(54, 54))
	_place_btn(menu_btn, Vector2(W * 0.91, H * 0.10), Vector2(48, 48))

func _change_bet(dir: int) -> void:
	if busy: return
	play("bet_change")
	var idx := BET_STEPS.find(bet_minor)
	if idx == -1: idx = 4
	idx = clamp(idx + dir, 0, BET_STEPS.size() - 1)
	bet_minor = clamp(BET_STEPS[idx], min_bet, max_bet)
	_update_hud(); _update_jackpots()

var _muted := false
func _toggle_sound() -> void:
	_muted = not _muted
	AudioServer.set_bus_mute(AudioServer.get_bus_index("Master"), _muted)

func _fmt(c: float) -> String:
	return "$%.2f" % c

func _update_hud() -> void:
	lbl_balance.text = "Balance  %s" % _fmt(float(balance_minor) / 1000.0)
	lbl_bet.text = "Bet  %s" % _fmt(float(bet_minor) / 1000.0)

func _update_jackpots() -> void:
	# Jackpot value shown as credits = mult × bet (bet is in minor units, 1000 = 1 credit),
	# compacted with K/M so it fits the pill.
	for i in jp_pills.size():
		var mult: int = JACKPOTS[i].mult
		var credits := float(mult) * float(bet_minor) / 1000.0
		jp_pills[i].val.text = _fmt_compact(credits)

func _fmt_compact(v: float) -> String:
	if v >= 1_000_000.0:
		return "$%.1fM" % (v / 1_000_000.0)
	if v >= 1000.0:
		var k := v / 1000.0
		return ("$%.0fK" % k) if k == floor(k) else ("$%.1fK" % k)
	return _fmt(v)

func _flash(msg: String) -> void:
	if lbl_msg: lbl_msg.text = msg

# ----------------------------------------------------------------- spin
func request_spin() -> void:
	if busy: return
	busy = true
	spin_btn.disabled = true
	lbl_win.text = ""
	_flash("")
	board.dim_unlocked(false)
	play("spin_press"); play("spin_start"); _spin_whir(true)
	if bridge != null:
		_bet_cb = JavaScriptBridge.create_callback(_on_bridge_result)
		bridge.placeBet(bet_minor, JSON.stringify({}), _bet_cb)
	else:
		await get_tree().create_timer(0.2).timeout
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
	_spin_whir(false)
	play("error_blip")
	busy = false
	spin_btn.disabled = false

func _resolve(outcome: Dictionary) -> void:
	var grid = outcome.get("grid", [])
	if typeof(grid) != TYPE_ARRAY or grid.size() != REELS:
		_flash("Bad outcome"); _finish_idle(); return
	await board.spin_to(grid)
	_spin_whir(false)
	play("reel_land")

	# line wins
	var line_list = outcome.get("lineWins", [])
	for w in line_list:
		var line := int(w.get("line", 0))
		var count := int(w.get("count", 0))
		board.flash_line(_line_cells(line, count), GOLD)
	if not line_list.is_empty():
		play("win_small")
		await get_tree().create_timer(0.35).timeout

	var hs = outcome.get("holdSpin", null)
	var in_bonus := typeof(hs) == TYPE_DICTIONARY
	if in_bonus:
		await _run_hold_spin(hs)

	await _present_total(int(outcome.get("totalWinBps", 0)))
	if in_bonus:
		await get_tree().create_timer(0.4).timeout
		_duck_music(false)
		await _exit_bonus()   # transform back to the base reels after the total is shown
	_update_hud()
	busy = false
	spin_btn.disabled = false

func _line_cells(line: int, count: int) -> Array:
	var out := []
	if line < 0 or line >= PAYLINES.size(): return out
	var rows = PAYLINES[line]
	for reel in range(min(count, REELS)):
		out.append(Vector2i(reel, int(rows[reel])))
	return out

func _fire_label(f: Dictionary) -> String:
	# Show the actual CREDIT value (multiplier × bet), so the balls grow with the bet size.
	var tier := str(f.get("tier", "CREDIT"))
	var credits := float(f.get("valueBps", 0)) / 10000.0 * float(bet_minor) / 1000.0
	if tier == "CREDIT":
		return _fmt_compact(credits)
	return tier  # MINI / MINOR / MAJOR — the tier's credit value is shown in the HUD pills

func _run_hold_spin(hs: Dictionary) -> void:
	_flash("FIRE LINK!")
	play("holdspin_enter"); _duck_music(true)
	_show_banner("HOLD & SPIN")
	# TRANSFORM: the reels grow into the taller 5×6 bonus board (more spots to fill).
	await _enter_bonus()
	lbl_respin.visible = true
	var spins := 3
	_set_spins(spins)
	# the trigger fireballs RAIN DOWN and lock into the bonus board
	for f in hs.get("initial", []):
		play("fireball_land")
		await board.drop_fireball(int(f.reel), int(f.row), _fire_label(f), str(f.get("tier")) != "CREDIT")
	await get_tree().create_timer(0.25).timeout
	# respin rounds — 3 chances; every ball that drops into a space RECHARGES to 3,
	# the feature ends after 3 consecutive spins with no new ball.
	for round_data in hs.get("rounds", []):
		var locks = round_data.get("newLocks", [])
		if locks.is_empty():
			spins -= 1
			_set_spins(spins)
		play("holdspin_respin")
		await get_tree().create_timer(0.3).timeout
		for f in locks:
			play("fireball_land")
			await board.drop_fireball(int(f.reel), int(f.row), _fire_label(f), str(f.get("tier")) != "CREDIT")
		if not locks.is_empty():
			spins = 3
			_set_spins(spins, true)
			await get_tree().create_timer(0.2).timeout
	lbl_respin.visible = false
	if bool(hs.get("filledAll", false)):
		play("grand_jackpot")
		_show_banner("GRAND JACKPOT")
		await get_tree().create_timer(1.2).timeout

func _set_spins(n: int, recharged := false) -> void:
	lbl_respin.text = ("RECHARGED!  SPINS  %d" % n) if recharged else ("SPINS LEFT  %d" % max(n, 0))

func _enter_bonus() -> void:
	# spins counter sits just below the taller bonus board, clear of the control deck
	lbl_respin.position = Vector2(0, bonus_frame.position.y + bonus_frame.size.y - view.y * 0.005)
	lbl_respin.size = Vector2(view.x, 40)
	lbl_respin.add_theme_font_size_override("font_size", int(view.x * 0.04))
	var t1 := create_tween()
	t1.tween_property(board, "modulate:a", 0.0, 0.14)
	await t1.finished
	board.layout(BONUS_ROWS, bonus_win.position, bonus_win.size, bonus_frame.position, bonus_frame.size, textures.get("bonus_frame", null))
	board.clear_all()
	var t2 := create_tween()
	t2.tween_property(board, "modulate:a", 1.0, 0.22)
	await t2.finished

func _exit_bonus() -> void:
	var t1 := create_tween()
	t1.tween_property(board, "modulate:a", 0.0, 0.14)
	await t1.finished
	board.layout(ROWS, base_win.position, base_win.size, base_frame.position, base_frame.size, textures.get("reel_frame", null))
	board.show_idle()
	var t2 := create_tween()
	t2.tween_property(board, "modulate:a", 1.0, 0.22)
	await t2.finished

func _present_total(total_bps: int) -> void:
	if total_bps <= 0:
		_flash("No win — spin again")
		return
	var credits := float(total_bps) / 10000.0 * float(bet_minor) / 1000.0
	var mult := float(total_bps) / 10000.0
	if mult >= 100.0:
		play("megawin_fanfare"); play("coin_shower"); _show_banner("MEGA WIN")
	elif mult >= 20.0:
		play("bigwin_fanfare"); play("coin_shower"); _show_banner("BIG WIN")
	elif mult >= 5.0:
		play("win_big")
	else:
		play("win_medium")
	var t := create_tween()
	for i in range(1, 19):
		var v := credits * float(i) / 18.0
		t.tween_callback(func(): lbl_win.text = "WIN  %s" % _fmt(v)).set_delay(0.03)
	await get_tree().create_timer(0.7).timeout

func _show_banner(text: String) -> void:
	banner.text = text; banner.visible = true
	banner.modulate = Color(1, 1, 1, 0); banner.scale = Vector2(0.6, 0.6)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(banner, "modulate", Color(1, 1, 1, 1), 0.25)
	t.parallel().tween_property(banner, "scale", Vector2(1, 1), 0.35)
	t.tween_interval(1.0)
	t.tween_property(banner, "modulate", Color(1, 1, 1, 0), 0.4)
	t.tween_callback(func(): banner.visible = false)

# --------------------------------------------------------------------- bridge
func _connect_bridge() -> void:
	if not OS.has_feature("web"): return
	if not JavaScriptBridge.has_method("get_interface"): return
	var ok = JavaScriptBridge.eval("typeof window.InfernoGodot === 'object'", true)
	if ok:
		bridge = JavaScriptBridge.get_interface("InfernoGodot")
		var init_json: String = str(JavaScriptBridge.eval("JSON.stringify(window.InfernoGodot.getInit())", true))
		var init = JSON.parse_string(init_json)
		if typeof(init) == TYPE_DICTIONARY:
			balance_minor = int(str(init.get("balanceMinor", 0)))
			min_bet = int(str(init.get("minBetMinor", 1000)))
			max_bet = int(str(init.get("maxBetMinor", 2000000)))
			currency = str(init.get("currency", "CREDIT"))
			bet_minor = clamp(bet_minor, min_bet, max_bet)
		_update_hud(); _update_jackpots()
		_bal_timer = Timer.new()
		_bal_timer.wait_time = 1.5
		_bal_timer.timeout.connect(_poll_balance)
		add_child(_bal_timer)
		_bal_timer.start()

func _poll_balance() -> void:
	if bridge == null or busy: return
	var j: String = str(JavaScriptBridge.eval("JSON.stringify(window.InfernoGodot.getInit())", true))
	var d = JSON.parse_string(j)
	if typeof(d) == TYPE_DICTIONARY:
		var b := int(str(d.get("balanceMinor", balance_minor)))
		if b != balance_minor:
			balance_minor = b
			_update_hud()

# ----------------------------------------------------------------------- mock
func _mock_outcome() -> Dictionary:
	var pool := ["SEVEN", "BELL", "COIN", "RED", "PURPLE", "BLUE", "GREEN", "WILD", "FIREBALL"]
	var grid := []
	var fb := 0
	for reel in range(REELS):
		var col := []
		for row in range(ROWS):
			var s: String = pool[randi() % pool.size()]
			if s == "WILD" and (reel == 0 or reel == REELS - 1): s = "GREEN"
			if s == "FIREBALL": fb += 1
			col.append(s)
		grid.append(col)
	# force a hold-spin demo ~1 in 3 so offline QA sees the feature
	var force := randi() % 3 == 0
	var hs = null
	if force or fb >= 6:
		grid = _mock_fire_grid()
		hs = _mock_hold_spin(grid)
	return {"kind": "inferno-link", "win": true, "grid": grid, "lineWins": [],
		"baseFireballCount": _count_fb(grid), "holdSpin": hs,
		"totalWinBps": (hs.bonusBps if hs != null else 0)}

func _mock_fire_grid() -> Array:
	var pool := ["SEVEN", "BELL", "COIN", "RED", "PURPLE", "BLUE", "GREEN"]
	var grid := []
	for reel in range(REELS):
		var col := []
		for row in range(ROWS): col.append(pool[randi() % pool.size()])
		grid.append(col)
	var placed := 0
	while placed < 6:
		var r := randi() % REELS; var rw := randi() % ROWS
		if grid[r][rw] != "FIREBALL": grid[r][rw] = "FIREBALL"; placed += 1
	return grid

func _count_fb(grid: Array) -> int:
	var n := 0
	for col in grid:
		for c in col:
			if c == "FIREBALL":
				n += 1
	return n

func _mock_hold_spin(grid: Array) -> Dictionary:
	var vals := [10000, 20000, 30000, 50000, 100000, 200000]
	var occupied := {}
	var initial := []
	for reel in range(REELS):
		for row in range(ROWS):
			if grid[reel][row] == "FIREBALL":
				initial.append({"reel": reel, "row": row, "valueBps": vals[randi() % vals.size()], "tier": "CREDIT"})
				occupied[reel * BONUS_ROWS + row] = true
	var rounds := []
	var bonus := 0
	for f in initial: bonus += int(f.valueBps)
	# respin rounds drop balls anywhere on the taller 5×6 board (rows 0..5)
	var dry := 0
	while dry < 3:
		var nl := []
		var drops := randi() % 3  # 0..2 new balls this spin
		for d in range(drops):
			var reel := randi() % REELS
			var row := randi() % BONUS_ROWS
			var idx := reel * BONUS_ROWS + row
			if occupied.has(idx): continue
			occupied[idx] = true
			var jp: bool = randi() % 5 == 0
			nl.append({"reel": reel, "row": row, "valueBps": (200000 if jp else vals[randi() % vals.size()]), "tier": ("MINI" if jp else "CREDIT")})
			bonus += int(nl[nl.size() - 1].valueBps)
		rounds.append({"newLocks": nl})
		if nl.is_empty(): dry += 1
		else: dry = 0
	var locked := initial.duplicate()
	for r in rounds: locked.append_array(r.newLocks)
	return {"triggered": true, "initial": initial, "rounds": rounds, "locked": locked, "filledAll": false, "bonusBps": bonus}

# ----------------------------------------------------- offline screenshot hook
func _run_shots() -> void:
	var dir := OS.get_environment("IL_SHOT")
	await get_tree().create_timer(1.0).timeout
	await _save_shot(dir + "/01_idle.png")
	request_spin()
	await get_tree().create_timer(0.45).timeout
	await _save_shot(dir + "/02_drop.png")
	# capture the transformed taller bonus board mid-feature
	await get_tree().create_timer(2.0).timeout
	await _save_shot(dir + "/03_bonus.png")
	await get_tree().create_timer(2.5).timeout
	await _save_shot(dir + "/04_bonus2.png")
	get_tree().quit()

func _save_shot(path: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img: img.save_png(path)
