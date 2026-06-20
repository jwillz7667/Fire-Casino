extends Node2D

## Inferno Link board — the 5×4 reel grid inside the ornate fire frame. Pure presentation:
## it renders the server's base grid, spins reels in, flashes line wins, and plays out the
## hold-and-spin (lock fireballs with their values, respin the empty cells). The fireball
## VALUE / jackpot label is drawn in code over the blank-center fireball art.

const REELS := 5
const ROWS := 4
const GOLD := Color(0.97, 0.8, 0.36)
const EMBER := Color(1.0, 0.55, 0.15)

var sym_tex := {}            # {"SEVEN":Texture2D, ...}
var frame_tex: Texture2D
var font: Font

# geometry
var origin := Vector2.ZERO   # top-left of the grid window
var cell := Vector2(180, 180)
var gap := 8.0

var frame_spr: Sprite2D
var cells := []              # cells[reel][row] = {root:Node2D, spr:Sprite2D, lbl:Label, locked:bool}
var _glow := []              # transient win/lock glows [{rect, t, color}]

func _ready() -> void:
	set_process(true)

func configure(frame: Texture2D, symbols: Dictionary, f: Font) -> void:
	frame_tex = frame
	sym_tex = symbols
	font = f
	if frame_spr == null:
		frame_spr = Sprite2D.new(); frame_spr.centered = false; frame_spr.z_index = 2
		add_child(frame_spr)
	frame_spr.texture = frame_tex
	_ensure_cells()

func _ensure_cells() -> void:
	if cells.size() == REELS:
		return
	for reel in range(REELS):
		var col := []
		for row in range(ROWS):
			var root := Node2D.new(); root.z_index = 4; add_child(root)
			var spr := Sprite2D.new(); spr.centered = true; root.add_child(spr)
			var lbl := Label.new()
			lbl.z_index = 6
			lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			if font: lbl.add_theme_font_override("font", font)
			lbl.add_theme_color_override("font_color", Color(1, 0.96, 0.85))
			lbl.add_theme_color_override("font_outline_color", Color(0.2, 0.02, 0.0, 0.95))
			lbl.add_theme_constant_override("outline_size", 6)
			root.add_child(lbl)
			col.append({"root": root, "spr": spr, "lbl": lbl, "locked": false})
		cells.append(col)

## Place the frame + grid for the given window rect (top-left origin + size). Uses a single
## SQUARE cell pitch (so symbols never distort) and centers the 5×4 block in the window.
func layout(window_pos: Vector2, window_size: Vector2, frame_pos: Vector2, frame_size: Vector2) -> void:
	var pitch: float = min((window_size.x - gap * (REELS - 1)) / REELS,
		(window_size.y - gap * (ROWS - 1)) / ROWS)
	cell = Vector2(pitch, pitch)
	var grid_w := pitch * REELS + gap * (REELS - 1)
	var grid_h := pitch * ROWS + gap * (ROWS - 1)
	origin = window_pos + (window_size - Vector2(grid_w, grid_h)) * 0.5
	if frame_spr and frame_spr.texture:
		frame_spr.position = frame_pos
		frame_spr.scale = Vector2(frame_size.x / frame_spr.texture.get_width(),
			frame_size.y / frame_spr.texture.get_height())
	for reel in range(REELS):
		for row in range(ROWS):
			var c = cells[reel][row]
			c.root.position = _cell_center(reel, row)
			var fs := int(clamp(cell.x * 0.26, 16.0, 40.0))
			c.lbl.add_theme_font_size_override("font_size", fs)
			c.lbl.size = cell
			c.lbl.position = -cell * 0.5
			_fit_sprite(c.spr)

func _cell_center(reel: int, row: int) -> Vector2:
	return origin + Vector2(reel * (cell.x + gap) + cell.x * 0.5, row * (cell.y + gap) + cell.y * 0.5)

func _fit_sprite(spr: Sprite2D) -> void:
	if spr.texture == null: return
	var s: float = min(cell.x, cell.y) * 0.92 / float(spr.texture.get_width())
	spr.scale = Vector2.ONE * s

func _set_cell(reel: int, row: int, sym: String, value_text := "") -> void:
	var c = cells[reel][row]
	c.spr.texture = sym_tex.get(sym, null)
	c.spr.modulate = Color(1, 1, 1, 1)
	c.spr.scale = Vector2.ONE
	_fit_sprite(c.spr)
	c.lbl.text = value_text

func clear_all() -> void:
	for reel in range(REELS):
		for row in range(ROWS):
			cells[reel][row].locked = false
			_set_cell(reel, row, "")

## Fill the grid with a calm random board (no fireballs) so idle isn't empty.
func show_idle() -> void:
	var pool := ["SEVEN", "BELL", "COIN", "RED", "PURPLE", "BLUE", "GREEN"]
	for reel in range(REELS):
		for row in range(ROWS):
			cells[reel][row].locked = false
			_set_cell(reel, row, pool[(reel * 7 + row * 3) % pool.size()])

## Spin the reels in: each reel blurs through random symbols then snaps to the final column.
func spin_to(grid: Array) -> void:
	for reel in range(REELS):
		for row in range(ROWS):
			cells[reel][row].locked = false
	var pool := ["SEVEN", "BELL", "COIN", "RED", "PURPLE", "BLUE", "GREEN", "FIREBALL"]
	for reel in range(REELS):
		var t := create_tween()
		var spins := 6 + reel * 2
		for s in range(spins):
			var rr := reel
			for row in range(ROWS):
				var sym: String = pool[(s + row * 3 + reel) % pool.size()]
				t.parallel().tween_callback(_set_cell.bind(rr, row, sym, "")).set_delay(s * 0.035)
		# snap to final
		for row in range(ROWS):
			var fr := reel; var frow := row
			var fsym: String = grid[reel][row]
			t.tween_callback(func(): _set_cell(fr, frow, fsym, ""); _pop(fr, frow)).set_delay(0.02)
		if reel == REELS - 1:
			await t.finished
		else:
			t.play()
	await get_tree().create_timer(0.15).timeout

func _pop(reel: int, row: int) -> void:
	var c = cells[reel][row]
	c.root.scale = Vector2(0.7, 0.7)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(c.root, "scale", Vector2.ONE, 0.2)

func flash_line(line_cells: Array, color: Color) -> void:
	for rc in line_cells:
		var c = cells[rc.x][rc.y]
		_glow.append({"pos": _cell_center(rc.x, rc.y), "t": 1.0, "color": color})
		var t := create_tween()
		t.tween_property(c.root, "scale", Vector2(1.12, 1.12), 0.12)
		t.tween_property(c.root, "scale", Vector2.ONE, 0.18)

## Light up a fireball cell with its value/jackpot label (used as locks land).
func set_fireball(reel: int, row: int, text: String, jackpot: bool) -> void:
	var c = cells[reel][row]
	c.locked = true
	c.spr.texture = sym_tex.get("FIREBALL", null)
	_fit_sprite(c.spr)
	c.lbl.text = text
	c.lbl.add_theme_color_override("font_color", GOLD if jackpot else Color(1, 0.97, 0.86))
	# lock pop + ember glow
	_glow.append({"pos": _cell_center(reel, row), "t": 1.0, "color": EMBER})
	c.root.scale = Vector2(1.3, 1.3)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(c.root, "scale", Vector2.ONE, 0.25)

## Dim every non-locked cell during the hold-and-spin so the fireballs read.
func dim_unlocked(dim: bool) -> void:
	for reel in range(REELS):
		for row in range(ROWS):
			var c = cells[reel][row]
			if not c.locked:
				c.spr.modulate = Color(0.4, 0.4, 0.45, 1) if dim else Color(1, 1, 1, 1)

## Redraw the non-locked cells to a dark blank between respins.
func blank_unlocked() -> void:
	for reel in range(REELS):
		for row in range(ROWS):
			if not cells[reel][row].locked:
				_set_cell(reel, row, "")
				cells[reel][row].spr.modulate = Color(0.4, 0.4, 0.45, 1)

func _process(delta: float) -> void:
	if _glow.is_empty(): return
	for g in _glow: g.t -= delta * 1.8
	_glow = _glow.filter(func(g): return g.t > 0.0)
	queue_redraw()

func _draw() -> void:
	for g in _glow:
		var a: float = clampf(g.t, 0.0, 1.0)
		var r: float = min(cell.x, cell.y) * (0.55 + (1.0 - a) * 0.25)
		draw_circle(g.pos, r, Color(g.color.r, g.color.g, g.color.b, a * 0.33))
