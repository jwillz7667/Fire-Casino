extends Node2D

## The spinning wheel face: 30 colored wedges + multiplier labels, drawn in code inside
## the ornate rim texture. This whole node is rotated by the parent on a spin; the wedges
## and labels rotate with it. The win highlight lightens the landed wedge.

var layout: Array = []      # segment multipliers (length 30), index 0 starts at angle 0
var radius := 300.0
var label_font: Font = null
var highlight := -1         # landed segment to emphasize, -1 = none

func setup(new_layout: Array, new_radius: float, font: Font) -> void:
	layout = new_layout
	radius = new_radius
	label_font = font
	queue_redraw()

func set_highlight(idx: int) -> void:
	highlight = idx
	queue_redraw()

func _draw() -> void:
	var n := layout.size()
	if n == 0:
		return
	var seg := TAU / n
	for i in n:
		var a0 := i * seg
		var a1 := (i + 1) * seg
		var col := _wedge_color(float(layout[i]), i)
		if i == highlight:
			col = col.lightened(0.4)
		# Filled fan polygon for the wedge.
		var pts := PackedVector2Array()
		pts.append(Vector2.ZERO)
		var steps := 8
		for s in steps + 1:
			var a := a0 + (a1 - a0) * float(s) / steps
			pts.append(Vector2(cos(a), sin(a)) * radius)
		draw_colored_polygon(pts, col)
		# Thin gold separator on the leading edge.
		draw_line(Vector2.ZERO, Vector2(cos(a0), sin(a0)) * radius, Color(0.93, 0.78, 0.36, 0.45), 2.0)
		# Radial multiplier label.
		if label_font:
			var mid := a0 + seg * 0.5
			var txt := _fmt(float(layout[i]))
			var fs := int(radius * 0.092)
			var size := label_font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
			draw_set_transform(Vector2(cos(mid), sin(mid)) * radius * 0.64, mid, Vector2.ONE)
			var pos := Vector2(-size.x * 0.5, size.y * 0.32)
			draw_string_outline(label_font, pos, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 6, Color(0, 0, 0, 0.85))
			draw_string(label_font, pos, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, _label_color(float(layout[i])))
			draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _fmt(m: float) -> String:
	if m == 0.0:
		return "0"
	if m == floor(m):
		return "%dx" % int(m)
	return "%.1fx" % m

func _wedge_color(m: float, i: int) -> Color:
	var base: Color
	if m == 0.0:
		base = Color(0.13, 0.14, 0.21)
	elif m <= 1.5:
		base = Color(0.10, 0.50, 0.52)   # teal — low
	elif m <= 2.0:
		base = Color(0.86, 0.66, 0.26)   # gold — mid
	elif m <= 4.0:
		base = Color(0.88, 0.45, 0.16)   # orange — high
	else:
		base = Color(0.82, 0.20, 0.20)   # red — jackpot
	if i % 2 == 1:
		base = base.darkened(0.08)
	return base

func _label_color(m: float) -> Color:
	return Color(0.78, 0.82, 0.9) if m == 0.0 else Color(1.0, 0.96, 0.85)
