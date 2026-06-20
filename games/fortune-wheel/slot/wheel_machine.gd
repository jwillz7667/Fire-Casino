extends Node2D

## Fortune Wheel — responsive web client.
##
## SERVER-AUTHORITATIVE: never decides an outcome. On spin it asks the host page
## (window.WheelGodot) to place the bet WITH the selected risk; the host calls the Aureus
## API and returns the authoritative outcome {risk, index, multiplier, totalWinBps}, which
## this scene animates by spinning the wheel so the landed segment stops under the pointer.
## Standalone (no bridge) a local mock drives the visuals for offline QA.
##
## The wheel face (30 colored wedges + multiplier labels) is drawn in code (wheel_face.gd)
## inside the ornate rim texture. The risk tier selects the public layout (must match the
## server's packages/shared/.../wheel.ts), but the PAYOUT always comes from the server
## outcome — the wheel face is presentation only.

const DESIGN := Vector2(1080, 1920)
const SEGMENTS := 30
const GOLD := Color(0.93, 0.78, 0.36)
# Measured from wheel_rim.png: the dark inner opening / the outer gold ring, as fractions
# of the texture width. The wedges are drawn ON TOP of the rim, filling the opening.
const RIM_OPEN_FRAC := 0.350
const RIM_OUTER_FRAC := 0.496
const WEDGE_FILL := 0.965

# Public wheel layouts — MUST match packages/shared/src/schemas/wheel.ts (mean 0.96 each).
const LAYOUTS := {
	"LOW": [
		1.2, 0.0, 1.5, 1.2, 1.7, 0.0, 1.2, 1.5, 0.0, 1.2, 2.0, 1.2,
		0.0, 1.2, 1.5, 1.2, 0.0, 1.5, 1.2, 0.0, 1.2, 1.7, 1.2, 0.0,
		1.5, 1.2, 0.0, 1.5, 1.2, 0.0,
	],
	"MEDIUM": [
		0.0, 1.5, 0.0, 2.0, 0.0, 1.5, 3.0, 0.0, 1.5, 0.0, 2.0, 0.0,
		1.8, 0.0, 1.5, 0.0, 4.0, 0.0, 2.0, 0.0, 1.5, 3.0, 0.0, 2.0,
		0.0, 1.5, 0.0, 0.0, 0.0, 0.0,
	],
	"HIGH": [
		0.0, 0.0, 1.5, 0.0, 0.0, 4.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0,
		9.8, 0.0, 0.0, 4.0, 0.0, 0.0, 2.0, 0.0, 0.0, 1.5, 0.0, 0.0,
		4.0, 0.0, 0.0, 0.0, 0.0, 0.0,
	],
}
const RISKS := ["LOW", "MEDIUM", "HIGH"]

# layout
var view := DESIGN
var portrait := true
var wheel_center := Vector2.ZERO
var wheel_radius := 320.0   # wedge radius (the drawn face)
var rim_outer_r := 360.0    # on-screen outer radius of the gold rim

# nodes
var bg_layer: CanvasLayer
var cur_bg: TextureRect
var grad_overlay: TextureRect
var board: Node2D
var fx_layer: Node2D
var wheel: Node2D          # rotated on spin (holds face + rim + hub)
var face                   # wheel_face.gd instance
var rim_spr: Sprite2D
var hub_spr: Sprite2D
var pointer_spr: Sprite2D  # fixed at top
var hud: CanvasLayer

var title_font: Font
var textures := {}
var _audio := {}
var _music: AudioStreamPlayer
var _spin_loop: AudioStreamPlayer

# HUD
var title_lbl: Label
var lbl_balance: Label
var lbl_bet: Label
var lbl_win: Label
var lbl_msg: Label
var banner: Label
var spin_btn: TextureButton
var bet_minus_btn: TextureButton
var bet_plus_btn: TextureButton
var sound_btn: TextureButton
var info_btn: TextureButton
var menu_btn: TextureButton
var risk_btns := []        # [Button x3]
var risk_pill: TextureRect
var bal_pill: TextureRect
var bet_pill: TextureRect

# session
var balance_minor := 0
var bet_minor := 1000
var min_bet := 50
var max_bet := 10000
var currency := "CREDIT"
var risk := "MEDIUM"
var busy := false
var bridge = null
var _bet_cb = null
var _bal_timer: Timer       # re-polls the bridge so a late wallet load / mid-session
                            # balance change (recharge) reaches the HUD, not just boot
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
	board = Node2D.new(); board.name = "Board"; add_child(board)
	fx_layer = Node2D.new(); fx_layer.z_index = 60; add_child(fx_layer)
	_build_wheel()
	_build_hud()
	_apply_layout()
	_connect_bridge()
	_start_music()
	get_viewport().size_changed.connect(_on_resize)
	if OS.get_environment("FW_SHOT") != "":
		_run_shots()

func _apply_window_size() -> void:
	if OS.has_feature("web"):
		return
	var sz := DESIGN
	var env := OS.get_environment("FW_SIZE")
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
	for name in ["wheel_rim", "pointer", "hub", "btn_action", "btn_minus", "btn_plus",
			"btn_sound", "btn_info", "btn_menu", "toggle_pill", "readout_pill"]:
		var p := "res://art/ui/%s.png" % name
		if ResourceLoader.exists(p):
			textures[name] = load(p)

func _load_fonts() -> void:
	for p in ["res://fonts/CinzelDecorative-Bold.ttf", "res://fonts/CinzelDecorative-Black.ttf"]:
		if ResourceLoader.exists(p):
			title_font = load(p)
			return

func _cue(name: String) -> AudioStream:
	for ext in [".ogg", ".wav"]:
		var p := "res://audio/cues/%s%s" % [name, ext]
		if ResourceLoader.exists(p):
			return load(p)
	return null

func _load_audio() -> void:
	for name in ["spin_press", "spin_start", "reel_stop", "win_small", "win_medium",
			"win_big", "bigwin_fanfare", "megawin_fanfare", "coin_tick", "coin_shower",
			"button_tap", "bet_change", "error_blip", "multiplier_apply"]:
		var st := _cue(name)
		if st == null: continue
		var pl := AudioStreamPlayer.new(); pl.stream = st; add_child(pl); _audio[name] = pl
	_spin_loop = _make_loop("spin_loop", -12.0)
	_music = _make_loop("music_base_loop", -10.0)

func _make_loop(name: String, db: float) -> AudioStreamPlayer:
	var st := _cue(name)
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

func _spin_whir(on: bool) -> void:
	if _spin_loop == null: return
	var t := create_tween()
	if on:
		_spin_loop.volume_db = -26.0
		if not _spin_loop.playing: _spin_loop.play()
		t.tween_property(_spin_loop, "volume_db", -12.0, 0.2)
	else:
		t.tween_property(_spin_loop, "volume_db", -34.0, 0.4)
		t.tween_callback(_spin_loop.stop)

# ----------------------------------------------------------------- background
func _build_bg() -> void:
	cur_bg = TextureRect.new()
	cur_bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	cur_bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	if ResourceLoader.exists("res://art/bg/bg_wheel.jpg"):
		cur_bg.texture = load("res://art/bg/bg_wheel.jpg")
	bg_layer.add_child(cur_bg)
	grad_overlay = TextureRect.new()
	grad_overlay.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	grad_overlay.stretch_mode = TextureRect.STRETCH_SCALE
	grad_overlay.texture = _vignette()
	bg_layer.add_child(grad_overlay)

func _vignette() -> GradientTexture2D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.25, 0.65, 1.0])
	g.colors = PackedColorArray([
		Color(0.02, 0.01, 0.04, 0.72), Color(0.02, 0.01, 0.04, 0.05),
		Color(0.02, 0.01, 0.04, 0.10), Color(0.02, 0.01, 0.04, 0.80),
	])
	var tex := GradientTexture2D.new()
	tex.gradient = g; tex.fill_from = Vector2(0, 0); tex.fill_to = Vector2(0, 1)
	tex.width = 8; tex.height = 256
	return tex

# ----------------------------------------------------------------- wheel
func _build_wheel() -> void:
	wheel = Node2D.new(); board.add_child(wheel)
	# Rim behind (z=2); wedges drawn ON TOP of the rim's dark center (z=5), sized to the
	# opening so the gold frame still shows around them; hub caps the middle (z=6).
	if textures.has("wheel_rim"):
		rim_spr = Sprite2D.new(); rim_spr.texture = textures["wheel_rim"]; rim_spr.centered = true
		rim_spr.z_index = 2; wheel.add_child(rim_spr)
	face = load("res://slot/wheel_face.gd").new()
	face.z_index = 5
	wheel.add_child(face)
	if textures.has("hub"):
		hub_spr = Sprite2D.new(); hub_spr.texture = textures["hub"]; hub_spr.centered = true
		hub_spr.z_index = 6; wheel.add_child(hub_spr)
	if textures.has("pointer"):
		pointer_spr = Sprite2D.new(); pointer_spr.texture = textures["pointer"]; pointer_spr.centered = true
		pointer_spr.z_index = 20; board.add_child(pointer_spr)

func _refresh_face() -> void:
	if face:
		face.setup(LAYOUTS[risk], wheel_radius, title_font)

# ----------------------------------------------------------------- layout
func _apply_layout() -> void:
	var W := view.x
	var H := view.y
	portrait = H >= W
	if portrait:
		wheel_radius = min(W * 0.305, H * 0.175)
		wheel_center = Vector2(W * 0.5, H * 0.345)
	else:
		wheel_radius = min(W * 0.22, H * 0.34)
		wheel_center = Vector2(W * 0.5, H * 0.44)

	wheel.position = wheel_center
	_refresh_face()
	if rim_spr and rim_spr.texture:
		var tw := float(rim_spr.texture.get_width())
		# Scale the rim so its dark opening matches the wedge radius (wedges fill ~96.5%).
		var scale := (wheel_radius / WEDGE_FILL) / (RIM_OPEN_FRAC * tw)
		rim_spr.scale = Vector2.ONE * scale
		rim_outer_r = RIM_OUTER_FRAC * tw * scale
	else:
		rim_outer_r = wheel_radius * 1.45
	if hub_spr and hub_spr.texture:
		hub_spr.scale = Vector2.ONE * (wheel_radius * 0.52 / hub_spr.texture.get_width())
	if pointer_spr and pointer_spr.texture:
		# Anchor the pointer's TOP at the rim's top edge and its TIP into the wedge ring,
		# so the whole pointer sits ON the wheel (no floating above) while clearly marking
		# the winning segment.
		var top_d := rim_outer_r              # pointer top = rim outer edge
		var tip_d := wheel_radius * 0.80      # pointer tip dips into the wedges
		var ph := top_d - tip_d
		pointer_spr.scale = Vector2.ONE * (ph / pointer_spr.texture.get_height())
		pointer_spr.position = Vector2(wheel_center.x, wheel_center.y - (top_d + tip_d) * 0.5)
	_layout_hud()

# ------------------------------------------------------------------------ HUD
func _styled_label(size: int, color: Color) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.78))
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

	title_lbl = _styled_label(56, GOLD)
	title_lbl.text = "FORTUNE WHEEL"
	title_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(title_lbl)

	lbl_msg = _styled_label(34, GOLD)
	lbl_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_msg)

	banner = _styled_label(100, GOLD)
	banner.text = "BIG WIN"; banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.visible = false; banner.z_index = 5
	hud.add_child(banner)

	bal_pill = _tex_rect("readout_pill"); hud.add_child(bal_pill)
	lbl_balance = _styled_label(30, Color(0.95, 0.97, 1.0))
	lbl_balance.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_balance)

	bet_pill = _tex_rect("readout_pill"); hud.add_child(bet_pill)
	lbl_bet = _styled_label(30, Color.WHITE)
	lbl_bet.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_bet)

	lbl_win = _styled_label(48, GOLD)
	lbl_win.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(lbl_win)

	# risk selector
	risk_pill = _tex_rect("toggle_pill"); hud.add_child(risk_pill)
	for r in RISKS:
		var b := Button.new()
		b.text = r
		b.flat = true
		b.focus_mode = Control.FOCUS_NONE
		b.add_theme_font_size_override("font_size", 26)
		if title_font: b.add_theme_font_override("font", title_font)
		b.pressed.connect(func(): _set_risk(r))
		hud.add_child(b)
		risk_btns.append(b)

	bet_minus_btn = _tex_btn("btn_minus")
	bet_minus_btn.pressed.connect(func(): _change_bet(-1))
	hud.add_child(bet_minus_btn)
	bet_plus_btn = _tex_btn("btn_plus")
	bet_plus_btn.pressed.connect(func(): _change_bet(1))
	hud.add_child(bet_plus_btn)

	spin_btn = _tex_btn("btn_action")
	spin_btn.pressed.connect(func(): play("spin_press"); request_spin())
	hud.add_child(spin_btn)

	sound_btn = _tex_btn("btn_sound"); sound_btn.pressed.connect(_toggle_sound); hud.add_child(sound_btn)
	info_btn = _tex_btn("btn_info"); info_btn.pressed.connect(func(): play("button_tap")); hud.add_child(info_btn)
	menu_btn = _tex_btn("btn_menu"); menu_btn.pressed.connect(func(): play("button_tap")); hud.add_child(menu_btn)

	_update_risk_visual()
	_update_hud()

func _place_lbl(l: Label, pos: Vector2, size: Vector2) -> void:
	l.position = pos; l.size = size

func _place_rect(tr: Control, center: Vector2, box: Vector2) -> void:
	tr.size = box; tr.position = center - box * 0.5; tr.pivot_offset = box * 0.5

func _layout_hud() -> void:
	var W := view.x
	var H := view.y
	_place_lbl(title_lbl, Vector2(0, H * 0.04), Vector2(W, 72)); title_lbl.add_theme_font_size_override("font_size", int(min(W, H) * 0.052))

	_place_btn(info_btn, Vector2(W * 0.09, H * 0.05), Vector2(60, 60))
	_place_btn(sound_btn, Vector2(W * 0.91, H * 0.05), Vector2(60, 60))
	_place_btn(menu_btn, Vector2(W * 0.91, H * 0.105), Vector2(54, 54))

	var below := wheel_center.y + rim_outer_r
	_place_lbl(lbl_msg, Vector2(0, below + H * 0.012), Vector2(W, 44))
	_place_lbl(banner, Vector2(0, wheel_center.y - 70), Vector2(W, 150)); banner.pivot_offset = Vector2(W * 0.5, 75)
	_place_lbl(lbl_win, Vector2(0, below + H * 0.05), Vector2(W, 60)); lbl_win.add_theme_font_size_override("font_size", 50)

	# risk selector centered under the win line
	var rpw: float = min(W * 0.86, 560.0)
	var ry := below + H * 0.105
	_place_rect(risk_pill, Vector2(W * 0.5, ry), Vector2(rpw, rpw * 0.20))
	for i in risk_btns.size():
		var bx := W * 0.5 + (i - 1) * (rpw / 3.0)
		_place_rect(risk_btns[i], Vector2(bx, ry), Vector2(rpw / 3.0, rpw * 0.20))

	# readouts
	var rdy := below + H * 0.165
	_place_rect(bal_pill, Vector2(W * 0.29, rdy), Vector2(W * 0.42, 64))
	_place_lbl(lbl_balance, Vector2(W * 0.08, rdy - 18), Vector2(W * 0.42, 40)); lbl_balance.add_theme_font_size_override("font_size", 30)
	_place_rect(bet_pill, Vector2(W * 0.71, rdy), Vector2(W * 0.42, 64))
	_place_lbl(lbl_bet, Vector2(W * 0.5, rdy - 18), Vector2(W * 0.42, 40)); lbl_bet.add_theme_font_size_override("font_size", 30)

	# bottom control deck
	var by := H * 0.88
	_place_btn(spin_btn, Vector2(W * 0.5, by), Vector2(W * 0.26, W * 0.26))
	_place_btn(bet_minus_btn, Vector2(W * 0.18, by), Vector2(W * 0.17, W * 0.17))
	_place_btn(bet_plus_btn, Vector2(W * 0.82, by), Vector2(W * 0.17, W * 0.17))

func _place_btn(b: TextureButton, center: Vector2, size: Vector2) -> void:
	b.custom_minimum_size = size; b.size = size; b.position = center - size * 0.5; b.pivot_offset = size * 0.5

func _update_risk_visual() -> void:
	for i in risk_btns.size():
		var active: bool = RISKS[i] == risk
		risk_btns[i].add_theme_color_override("font_color", GOLD if active else Color(0.6, 0.62, 0.7))
		risk_btns[i].add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
		risk_btns[i].add_theme_constant_override("outline_size", 5 if active else 3)

func _set_risk(r: String) -> void:
	if busy or r == risk: return
	play("button_tap")
	risk = r
	_update_risk_visual()
	_refresh_face()

func _change_bet(dir: int) -> void:
	if busy: return
	play("bet_change")
	var idx := BET_STEPS.find(bet_minor)
	if idx == -1: idx = 4
	idx = clamp(idx + dir, 0, BET_STEPS.size() - 1)
	bet_minor = clamp(BET_STEPS[idx], min_bet, max_bet)
	_update_hud()

var _muted := false
func _toggle_sound() -> void:
	_muted = not _muted
	AudioServer.set_bus_mute(AudioServer.get_bus_index("Master"), _muted)

func _fmt(c: float) -> String:
	return "$%.2f" % c

func _update_hud() -> void:
	lbl_balance.text = "Balance  %s" % _fmt(float(balance_minor) / 1000.0)
	lbl_bet.text = "Bet  %s" % _fmt(float(bet_minor) / 1000.0)

func _flash(msg: String) -> void:
	if lbl_msg: lbl_msg.text = msg

# ----------------------------------------------------------------- spin
func request_spin() -> void:
	if busy: return
	busy = true
	spin_btn.disabled = true
	lbl_win.text = ""
	_flash("")
	if face: face.set_highlight(-1)
	_spin_whir(true)
	play("spin_start")
	if bridge != null:
		_bet_cb = JavaScriptBridge.create_callback(_on_bridge_result)
		bridge.placeBet(bet_minor, JSON.stringify({"risk": risk}), _bet_cb)
	else:
		await get_tree().create_timer(0.5).timeout
		_resolve(_mock_outcome())

func _on_bridge_result(args: Array) -> void:
	var raw: String = String(args[0]) if args.size() > 0 else ""
	var data = JSON.parse_string(raw)
	if typeof(data) != TYPE_DICTIONARY:
		_flash("Network error"); _finish_idle(); return
	if data.has("error"):
		play("error_blip"); _flash(str(data.get("error"))); _finish_idle(); return
	if data.has("balanceAfterMinor"):
		balance_minor = int(str(data.balanceAfterMinor))
	_resolve(data.get("outcome", {}))

func _finish_idle() -> void:
	_spin_whir(false)
	busy = false
	spin_btn.disabled = false

func _resolve(outcome: Dictionary) -> void:
	var index := int(outcome.get("index", randi() % SEGMENTS))
	var total_bps := int(outcome.get("totalWinBps", 0))
	await _spin_to(index)
	_spin_whir(false)
	play("reel_stop")
	if face: face.set_highlight(index)
	await _present_win(total_bps, float(outcome.get("multiplier", 0.0)))
	_update_hud()
	busy = false
	spin_btn.disabled = false

## Rotate the wheel so segment `index` stops centered under the top pointer, after a few
## full turns with an ease-out. Pointer sits at screen angle -PI/2 (straight up).
func _spin_to(index: int) -> void:
	var seg := TAU / SEGMENTS
	var local_center := index * seg + seg * 0.5
	var base_target := -PI * 0.5 - local_center
	var cur: float = wheel.rotation
	var min_turns := 5.0
	# Smallest target >= cur + min_turns*TAU that is congruent to base_target (mod TAU).
	var target := base_target
	while target < cur + min_turns * TAU:
		target += TAU
	var dur := 4.2
	var t := create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	t.tween_property(wheel, "rotation", target, dur)
	# tick sounds easing out
	var ticks := 14
	for i in ticks:
		t.parallel().tween_callback(func(): play("coin_tick")).set_delay(dur * (1.0 - pow(1.0 - float(i) / ticks, 2.0)))
	await t.finished
	wheel.rotation = fmod(target, TAU)

func _present_win(total_bps: int, multiplier: float) -> void:
	if total_bps <= 0:
		_flash("No win — spin again")
		return
	_flash("x%s" % _fmt(multiplier))
	if multiplier >= 4.0:
		play("megawin_fanfare" if multiplier >= 8.0 else "bigwin_fanfare")
		play("coin_shower")
		_show_banner("MEGA WIN" if multiplier >= 8.0 else "BIG WIN")
		_shake(10.0, 0.6)
	else:
		play("win_big" if multiplier >= 2.0 else "win_medium")
	_count_up(total_bps)
	await get_tree().create_timer(0.6).timeout

func _count_up(total_bps: int) -> void:
	var credits := float(total_bps) / 10000.0 * float(bet_minor) / 1000.0
	if credits <= 0:
		lbl_win.text = ""; return
	play("coin_tick")
	var t := create_tween()
	for i in range(1, 19):
		var v := credits * float(i) / 18.0
		t.tween_callback(func(): lbl_win.text = "WIN  %s" % _fmt(v)).set_delay(0.03)

func _show_banner(text: String) -> void:
	banner.text = text; banner.visible = true
	banner.modulate = Color(1, 1, 1, 0); banner.scale = Vector2(0.6, 0.6)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(banner, "modulate", Color(1, 1, 1, 1), 0.25)
	t.parallel().tween_property(banner, "scale", Vector2(1, 1), 0.35)
	t.tween_interval(1.1)
	t.tween_property(banner, "modulate", Color(1, 1, 1, 0), 0.4)
	t.tween_callback(func(): banner.visible = false)

func _shake(mag: float, dur: float) -> void:
	var steps := int(dur / 0.04)
	var t := create_tween()
	for i in steps:
		var m := mag * (1.0 - float(i) / steps)
		t.tween_property(board, "position", Vector2(randf_range(-m, m), randf_range(-m, m)), 0.04)
	t.tween_property(board, "position", Vector2.ZERO, 0.06)

# --------------------------------------------------------------------- bridge
func _connect_bridge() -> void:
	if not OS.has_feature("web"): return
	if not JavaScriptBridge.has_method("get_interface"): return
	var ok = JavaScriptBridge.eval("typeof window.WheelGodot === 'object'", true)
	if ok:
		bridge = JavaScriptBridge.get_interface("WheelGodot")
		var init_json: String = str(JavaScriptBridge.eval("JSON.stringify(window.WheelGodot.getInit())", true))
		var init = JSON.parse_string(init_json)
		if typeof(init) == TYPE_DICTIONARY:
			balance_minor = int(str(init.get("balanceMinor", 0)))
			min_bet = int(str(init.get("minBetMinor", 1000)))
			max_bet = int(str(init.get("maxBetMinor", 2000000)))
			currency = str(init.get("currency", "CREDIT"))
			bet_minor = clamp(bet_minor, min_bet, max_bet)
		_update_hud()
		# The host re-pushes init when the wallet resolves / balance changes (recharge,
		# redemption, other-device play); the bridge caches it. Poll so the HUD stays live.
		_bal_timer = Timer.new()
		_bal_timer.wait_time = 1.5
		_bal_timer.timeout.connect(_poll_balance)
		add_child(_bal_timer)
		_bal_timer.start()

func _poll_balance() -> void:
	if bridge == null or busy:
		return
	var j: String = str(JavaScriptBridge.eval("JSON.stringify(window.WheelGodot.getInit())", true))
	var d = JSON.parse_string(j)
	if typeof(d) == TYPE_DICTIONARY:
		var b := int(str(d.get("balanceMinor", balance_minor)))
		if b != balance_minor:
			balance_minor = b
			_update_hud()

# ----------------------------------------------------------------------- mock
func _mock_outcome() -> Dictionary:
	var layout: Array = LAYOUTS[risk]
	var index := randi() % SEGMENTS
	var m: float = layout[index]
	var bps := int(round(m * 10000.0))
	return {"kind": "fortune-wheel", "win": bps > 0, "risk": risk, "index": index, "multiplier": m, "totalWinBps": bps}

# ----------------------------------------------------- offline screenshot hook
func _run_shots() -> void:
	var dir := OS.get_environment("FW_SHOT")
	await get_tree().create_timer(1.0).timeout
	await _save_shot(dir + "/01_idle.png")
	request_spin()
	await get_tree().create_timer(5.5).timeout
	await _save_shot(dir + "/02_result.png")
	get_tree().quit()

func _save_shot(path: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img: img.save_png(path)
