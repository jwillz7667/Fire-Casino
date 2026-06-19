extends Node2D

## Plinko board — a triangular field of 12 peg rows, 13 bucket slots, and the dropping
## ball. Pure presentation: it knows nothing about money or fairness; it just animates the
## left/right PATH the server decided and settles the ball into the server's bucket. The
## bucket multipliers are public (PLINKO_LAYOUTS), drawn here over the blank bucket art.

const ROWS := 12
const BUCKETS := 13
const GOLD := Color(0.95, 0.79, 0.36)
const TEAL := Color(0.36, 0.96, 0.92)

var peg_tex: Texture2D
var ball_tex: Texture2D
var bucket_texs := {}        # {"green":Texture2D, "gold":..., "red":...}
var font: Font
var layout: Array = []       # 13 multipliers for the current risk

# geometry (recomputed in configure)
var bsize := Vector2(800.0, 1000.0)
var cx := 400.0
var top_y := 80.0
var dx := 56.0
var dy := 62.0
var peg_draw := 16.0
var bucket_w := 54.0
var bucket_h := 40.0
var bucket_y := 940.0

var _pegs: Array[Vector2] = []
var _buckets: Array = []     # [{spr:Sprite2D, lbl:Label}]
var ball: Sprite2D
var _ball_base := Vector2.ONE  # ball's resting scale (squash/stretch animates around it)
var _sparks: Array = []      # [{pos:Vector2, t:float}]
# Per-hop ballistic state: y(p) = _seg_ay + _seg_c1·p + _seg_c2·p² (a gravity parabola),
# x linear from _seg_ax→_seg_bx. _seg_spin0/_seg_spin1 roll the ball across the hop.
var _seg_ax := 0.0
var _seg_bx := 0.0
var _seg_ay := 0.0
var _seg_c1 := 0.0
var _seg_c2 := 0.0
var _seg_spin0 := 0.0
var _seg_spin1 := 0.0

func _ready() -> void:
	ball = Sprite2D.new()
	ball.visible = false
	ball.z_index = 12
	add_child(ball)
	set_process(true)

func configure(size: Vector2, _layout: Array, peg: Texture2D, ballt: Texture2D,
		buckets: Dictionary, f: Font) -> void:
	bsize = size
	layout = _layout
	peg_tex = peg
	ball_tex = ballt
	bucket_texs = buckets
	font = f
	if ball_tex:
		ball.texture = ball_tex
	_relayout()
	_ensure_buckets()
	_layout_buckets()
	queue_redraw()

func set_risk_layout(_layout: Array) -> void:
	layout = _layout
	_layout_buckets()
	queue_redraw()

func _relayout() -> void:
	var usable_w := bsize.x * 0.94
	dx = usable_w / float(BUCKETS)
	cx = bsize.x * 0.5
	bucket_w = dx * 0.92
	bucket_h = bucket_w * 0.62
	bucket_y = bsize.y - bucket_h * 0.6 - 6.0
	top_y = bsize.y * 0.07
	var board_bottom := bucket_y - bucket_h * 0.75
	dy = (board_bottom - top_y) / float(ROWS + 0.5)
	peg_draw = clamp(dx * 0.32, 8.0, 24.0)
	if ball_tex and ball_tex.get_width() > 0:
		ball.scale = Vector2.ONE * (dx * 0.52 / ball_tex.get_width())
	_ball_base = ball.scale
	_pegs.clear()
	for i in range(1, ROWS + 1):
		for j in range(i + 1):
			_pegs.append(Vector2(cx + (float(j) - i * 0.5) * dx, top_y + i * dy))

func _bucket_x(k: int) -> float:
	return cx + (float(k) - ROWS * 0.5) * dx

func _bucket_color(m: float) -> String:
	if m < 1.0:
		return "green"
	if m < 5.0:
		return "gold"
	return "red"

func _ensure_buckets() -> void:
	if _buckets.size() == BUCKETS:
		return
	for b in _buckets:
		b.spr.queue_free()
		b.lbl.queue_free()
	_buckets.clear()
	for k in range(BUCKETS):
		var spr := Sprite2D.new()
		spr.centered = true
		spr.z_index = 4
		add_child(spr)
		var lbl := Label.new()
		lbl.z_index = 6
		lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		if font:
			lbl.add_theme_font_override("font", font)
		lbl.add_theme_color_override("font_color", Color(1, 1, 1))
		lbl.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
		lbl.add_theme_constant_override("outline_size", 4)
		add_child(lbl)
		_buckets.append({"spr": spr, "lbl": lbl})

func _layout_buckets() -> void:
	if _buckets.size() != BUCKETS:
		return
	var fs := int(clamp(dx * 0.30, 13.0, 28.0))
	for k in range(BUCKETS):
		var b = _buckets[k]
		var m: float = float(layout[k]) if k < layout.size() else 0.0
		var tex = bucket_texs.get(_bucket_color(m), null)
		b.spr.texture = tex
		if tex and tex.get_width() > 0:
			b.spr.scale = Vector2.ONE * (bucket_w / tex.get_width())
		b.spr.position = Vector2(_bucket_x(k), bucket_y)
		b.spr.scale = b.spr.scale  # keep base for highlight tween
		b.lbl.add_theme_font_size_override("font_size", fs)
		b.lbl.text = _fmt_mult(m)
		b.lbl.size = Vector2(bucket_w, bucket_h)
		b.lbl.position = Vector2(_bucket_x(k) - bucket_w * 0.5, bucket_y - bucket_h * 0.5)

func _fmt_mult(m: float) -> String:
	if m == floor(m):
		return "%dx" % int(m)
	var s := "%.2f" % m
	s = s.trim_suffix("0").trim_suffix(".")
	return s + "x"

## Animate the ball through the path (Array of 0/1, top row first) into `bucket`.
## Awaitable — the caller awaits the full drop before presenting the win.
func drop_ball(path: Array, bucket: int) -> void:
	# Rest the ball tangent ON TOP of each peg it bounces off (never overlapping the peg
	# centre) and hop between peg-tops, so it reads as a real Plinko bounce.
	var ball_r := dx * 0.26
	if ball_tex and ball_tex.get_width() > 0:
		ball_r = ball_tex.get_width() * ball.scale.x * 0.5
	var rest := peg_draw + ball_r
	var pts: Array[Vector2] = []   # ball rest points (above the pegs)
	var hit: Array = []            # peg centre bounced on at each point (null = start/bucket)
	pts.append(Vector2(cx, top_y - dy * 0.9)); hit.append(null)
	var c := 0
	for i in range(1, ROWS + 1):
		if i - 1 < path.size():
			c += int(path[i - 1])
		var pc := Vector2(cx + (float(c) - i * 0.5) * dx, top_y + i * dy)
		pts.append(pc - Vector2(0.0, rest)); hit.append(pc)
	pts.append(Vector2(_bucket_x(bucket), bucket_y - bucket_h * 0.12)); hit.append(null)

	ball.position = pts[0]
	ball.scale = _ball_base
	ball.rotation = 0.0
	ball.visible = true
	ball.modulate = Color(1, 1, 1, 1)
	var spin := 0.0
	for idx in range(1, pts.size()):
		var first := idx == 1
		var last := idx == pts.size() - 1
		var a: Vector2 = pts[idx - 1]
		var b: Vector2 = pts[idx]
		# Rebound height the ball pops UP off this peg before gravity pulls it to the next.
		# First hop is the entry fall (no pop); middle hops bounce hard; last drops into the cup.
		var pop := 0.0 if first else (dy * 0.16 if last else dy * 0.5)
		var dur := 0.30 if last else (0.24 if first else 0.26)
		# Roll the ball the way it's travelling — a little extra english sells the bounce.
		var spin_next: float = spin + signf(b.x - a.x) * 0.9 + 0.25
		await _bounce(a, b, pop, dur, spin, spin_next)
		spin = spin_next
		if hit[idx] != null:
			_sparks.append({"pos": hit[idx], "t": 1.0})
	# settle bounce inside the cup
	var rest_pos := pts[pts.size() - 1]
	await _bounce(rest_pos, rest_pos + Vector2(0, bucket_h * 0.16), dy * 0.18, 0.22, spin, spin + 0.4)
	await _bounce(rest_pos + Vector2(0, bucket_h * 0.16), rest_pos, dy * 0.06, 0.16, spin + 0.4, spin + 0.5)
	ball.scale = _ball_base

## One ballistic hop: y is a GRAVITY parabola (pops `pop` above `a`, then accelerates down
## to `b`), x is linear, the ball rolls from spin0→spin1. Driving position + spin + squash
## from the single parameter `p` keeps one source of truth for the transform (no tween war).
func _bounce(a: Vector2, b: Vector2, pop: float, dur: float, spin0: float, spin1: float) -> void:
	var d := b.y - a.y
	# Solve y(p)=ay+c1·p+c2·p² s.t. y(0)=ay, y(1)=b.y, and the vertex sits `pop` above a
	# (c1<0 = launched upward, c2>0 = gravity). u = √pop + √(pop+max(d,0)).
	var u := sqrt(pop) + sqrt(pop + maxf(d, 0.0))
	_seg_c2 = u * u
	_seg_c1 = -2.0 * sqrt(pop) * u if pop > 0.0 else d   # pop==0 → straight accelerating fall
	if pop <= 0.0:
		_seg_c2 = 0.0
		_seg_c1 = d
	_seg_ay = a.y
	_seg_ax = a.x
	_seg_bx = b.x
	_seg_spin0 = spin0
	_seg_spin1 = spin1
	var t := create_tween().set_trans(Tween.TRANS_LINEAR)
	t.tween_method(_set_ballistic, 0.0, 1.0, dur)
	await t.finished

func _set_ballistic(p: float) -> void:
	var x := lerpf(_seg_ax, _seg_bx, p)
	var y := _seg_ay + _seg_c1 * p + _seg_c2 * p * p
	ball.position = Vector2(x, y)
	ball.rotation = lerpf(_seg_spin0, _seg_spin1, p)
	# Stretch along the fall from vertical SPEED (fast = elongated), squash hard right at the
	# two peg contacts (p→0 leaving, p→1 landing) — that contact-squash IS the bounce pop.
	var vy: float = _seg_c1 + 2.0 * _seg_c2 * p
	var stretch: float = clampf(absf(vy) / (dy * 2.2), 0.0, 1.0)
	var contact: float = maxf(
		pow(maxf(0.0, 1.0 - p / 0.16), 2.0),
		pow(maxf(0.0, 1.0 - absf(p - 1.0) / 0.16), 2.0),
	)
	ball.scale = Vector2(
		_ball_base.x * (1.0 - 0.12 * stretch + 0.5 * contact),
		_ball_base.y * (1.0 + 0.16 * stretch - 0.45 * contact),
	)

func hide_ball() -> void:
	ball.visible = false

func highlight_bucket(k: int) -> void:
	if k < 0 or k >= _buckets.size():
		return
	var spr: Sprite2D = _buckets[k].spr
	var base: Vector2 = spr.scale
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(spr, "scale", base * 1.22, 0.15)
	t.parallel().tween_property(spr, "modulate", Color(1.6, 1.5, 1.15), 0.15)
	t.tween_property(spr, "scale", base, 0.35)
	t.parallel().tween_property(spr, "modulate", Color(1, 1, 1), 0.45)

func _process(delta: float) -> void:
	if _sparks.is_empty():
		return
	for s in _sparks:
		s.t -= delta * 2.2
	_sparks = _sparks.filter(func(s): return s.t > 0.0)
	queue_redraw()

func _draw() -> void:
	if peg_tex:
		var r := peg_draw
		for p in _pegs:
			draw_texture_rect(peg_tex, Rect2(p - Vector2(r, r), Vector2(r * 2.0, r * 2.0)), false)
	else:
		for p in _pegs:
			draw_circle(p, peg_draw * 0.5, GOLD)
	for s in _sparks:
		var a: float = clampf(s.t, 0.0, 1.0)
		draw_circle(s.pos, peg_draw * (1.0 + (1.0 - a) * 0.9), Color(TEAL.r, TEAL.g, TEAL.b, a * 0.5))
