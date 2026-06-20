extends Node2D

## Inferno Link board — the reel grid inside the ornate fire frame. In the base game it is a
## 5×4 grid inside the landscape frame; when the hold-and-spin triggers it TRANSFORMS into a
## taller 5×6 grid inside the portrait bonus frame. Pure presentation: it renders the server
## grid, spins reels in, flashes line wins, and rains the flaming balls into the bonus board.

const REELS := 5
const ROWS_BASE := 4
const ROWS_BONUS := 6
const MAX_ROWS := 6
const GOLD := Color(0.97, 0.8, 0.36)
const EMBER := Color(1.0, 0.55, 0.15)

var sym_tex := {}            # {"SEVEN":Texture2D, ...}
var frame_tex: Texture2D
var bonus_frame_tex: Texture2D
var active_rows := ROWS_BASE
var font: Font

# geometry
var origin := Vector2.ZERO   # top-left of the grid window
var cell := Vector2(180, 180)
var gap := 8.0

var frame_spr: Sprite2D
var reel_bg: Panel           # dark reel layer BEHIND the symbols, shows through the frame hole
var clip: Control            # clip_contents window so symbols are masked while they drop in
var fx                       # inferno_fx.gd — clipped ember/flame glows
var cells := []              # cells[reel][row] = {root:Node2D, spr:Sprite2D, lbl:Label, slot, locked}

func _ready() -> void:
	set_process(true)

func configure(frame: Texture2D, bonus_frame: Texture2D, symbols: Dictionary, f: Font) -> void:
	frame_tex = frame
	bonus_frame_tex = bonus_frame
	sym_tex = symbols
	font = f
	# Layering inside the clip (back→front): reel_bg (z-2) → slot panels (z0) → fx (z1) →
	# symbols (z2). The frame cutout sits ABOVE the clip (z5) with a transparent centre, so the
	# dark reel_bg shows through the hole and the gold border overlaps the symbols. Everything
	# in the reel area is MASKED to the window, so nothing can spill onto the rest of the page.
	if clip == null:
		clip = Control.new()
		clip.clip_contents = true
		clip.mouse_filter = Control.MOUSE_FILTER_IGNORE
		clip.z_index = 2
		add_child(clip)
	if reel_bg == null:
		reel_bg = Panel.new()
		reel_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
		reel_bg.z_index = -2
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.03, 0.015, 0.02, 1.0)
		reel_bg.add_theme_stylebox_override("panel", sb)
		clip.add_child(reel_bg)
	if frame_spr == null:
		frame_spr = Sprite2D.new(); frame_spr.centered = false; frame_spr.z_index = 5
		add_child(frame_spr)
	frame_spr.texture = frame_tex
	if fx == null:
		fx = load("res://slot/inferno_fx.gd").new()
		fx.z_index = 1              # above the slot panels (z=0), below the symbols (z=2)
		clip.add_child(fx)
	_ensure_cells()

func _ensure_cells() -> void:
	if cells.size() == REELS:
		return
	for reel in range(REELS):
		var col := []
		for row in range(MAX_ROWS):
			# static dark slot the symbol sits in (a visible reel cell), behind the symbol
			var slot := Panel.new()
			slot.mouse_filter = Control.MOUSE_FILTER_IGNORE
			slot.z_index = 0
			var sb := StyleBoxFlat.new()
			sb.bg_color = Color(0.05, 0.03, 0.04, 0.55)
			sb.set_corner_radius_all(14)
			sb.set_border_width_all(2)
			sb.border_color = Color(0.55, 0.32, 0.12, 0.45)
			slot.add_theme_stylebox_override("panel", sb)
			clip.add_child(slot)
			var root := Node2D.new(); root.z_index = 2; clip.add_child(root)
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
			col.append({"root": root, "spr": spr, "lbl": lbl, "slot": slot, "locked": false})
		cells.append(col)

## Place the frame + grid for `rows` rows inside the given window/frame. SQUARE cell pitch
## (symbols never distort), grid centered in the window. Rows beyond `rows` are hidden, so the
## same cell pool serves the 4-row base grid and the 6-row bonus board.
func layout(rows: int, window_pos: Vector2, window_size: Vector2, frame_pos: Vector2,
		frame_size: Vector2, frame_texture: Texture2D) -> void:
	active_rows = rows
	if frame_spr and frame_texture:
		frame_spr.texture = frame_texture
	var pitch: float = min((window_size.x - gap * (REELS - 1)) / REELS,
		(window_size.y - gap * (rows - 1)) / rows)
	cell = Vector2(pitch, pitch)
	var grid_w := pitch * REELS + gap * (REELS - 1)
	var grid_h := pitch * rows + gap * (rows - 1)
	origin = window_pos + (window_size - Vector2(grid_w, grid_h)) * 0.5
	if clip:
		clip.position = window_pos
		clip.size = window_size
	if reel_bg:
		# fills the clip exactly (clip-local) and is masked to the window — its edges tuck
		# under the frame border, and it can never extend past the reel area.
		reel_bg.position = Vector2.ZERO
		reel_bg.size = window_size
	if frame_spr and frame_spr.texture:
		frame_spr.position = frame_pos
		frame_spr.scale = Vector2(frame_size.x / frame_spr.texture.get_width(),
			frame_size.y / frame_spr.texture.get_height())
	var fs := int(clamp(cell.x * 0.26, 16.0, 40.0))
	for reel in range(REELS):
		for row in range(MAX_ROWS):
			var c = cells[reel][row]
			var shown := row < rows
			c.root.visible = shown
			c.slot.visible = shown
			if not shown:
				continue
			var center := _cell_local(reel, row)
			c.root.position = center
			c.slot.size = cell * 0.98
			c.slot.position = center - cell * 0.49
			c.lbl.add_theme_font_size_override("font_size", fs)
			c.lbl.size = cell
			c.lbl.position = -cell * 0.5
			_fit_sprite(c.spr)

func _cell_center(reel: int, row: int) -> Vector2:
	return origin + Vector2(reel * (cell.x + gap) + cell.x * 0.5, row * (cell.y + gap) + cell.y * 0.5)

## Cell centre in clip-local space (cell roots are children of the clip window).
func _cell_local(reel: int, row: int) -> Vector2:
	return _cell_center(reel, row) - (clip.position if clip else Vector2.ZERO)

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
		for row in range(active_rows):
			cells[reel][row].locked = false
			_set_cell(reel, row, "")

## Fill the grid with a calm random board (no fireballs) so idle isn't empty.
func show_idle() -> void:
	var pool := ["SEVEN", "BELL", "COIN", "RED", "PURPLE", "BLUE", "GREEN"]
	for reel in range(REELS):
		for row in range(active_rows):
			cells[reel][row].locked = false
			_set_cell(reel, row, pool[(reel * 7 + row * 3) % pool.size()])

## Spin the reels in: each symbol DROPS in from above the frame and falls into its slot,
## staggered left→right and top→bottom, landing with a small bounce. The clip window masks
## the travel above the grid, so they read as reels falling from the top of the frame.
func spin_to(grid: Array) -> void:
	for reel in range(REELS):
		for row in range(active_rows):
			cells[reel][row].locked = false
	var t := create_tween().set_parallel(true).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	var drop := cell.y * (MAX_ROWS + 1)   # start well above the clip top so it enters from the top
	for reel in range(REELS):
		for row in range(active_rows):
			var c = cells[reel][row]
			_set_cell(reel, row, grid[reel][row], "")  # _set_cell fits the sprite to the cell
			c.root.scale = Vector2.ONE                  # root scale is the pop only — never the sprite
			var final_local := _cell_local(reel, row)
			c.root.position = Vector2(final_local.x, final_local.y - drop)
			var delay := reel * 0.09 + row * 0.06
			t.tween_property(c.root, "position", final_local, 0.4).set_delay(delay)
	await t.finished
	await get_tree().create_timer(0.05).timeout

func _pop(reel: int, row: int) -> void:
	var c = cells[reel][row]
	c.root.scale = Vector2(0.7, 0.7)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(c.root, "scale", Vector2.ONE, 0.2)

func flash_line(line_cells: Array, color: Color) -> void:
	for rc in line_cells:
		var c = cells[rc.x][rc.y]
		if fx: fx.add(_cell_local(rc.x, rc.y), color, cell.x * 0.55)
		var t := create_tween()
		t.tween_property(c.root, "scale", Vector2(1.12, 1.12), 0.12)
		t.tween_property(c.root, "scale", Vector2.ONE, 0.18)

## A flaming ball DROPS in from the top of the frame and locks into its cell (the Fire Link
## feel). The clip masks the travel above the grid; it lands with a bounce + ember bloom.
## Awaitable so the machine can rain the balls down in sequence.
func drop_fireball(reel: int, row: int, text: String, jackpot: bool) -> void:
	var c = cells[reel][row]
	c.locked = true
	c.spr.texture = sym_tex.get("FIREBALL", null)
	c.spr.modulate = Color(1, 1, 1, 1)
	c.root.scale = Vector2.ONE
	_fit_sprite(c.spr)
	c.lbl.text = text
	c.lbl.add_theme_color_override("font_color", GOLD if jackpot else Color(1, 0.97, 0.86))
	var final_local := _cell_local(reel, row)
	c.root.position = Vector2(final_local.x, final_local.y - cell.y * (MAX_ROWS + 1))  # above the window
	# ember trail as it falls, brighter bloom on impact
	if fx: fx.add(final_local, EMBER, cell.x * 0.45)
	var t := create_tween().set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)  # accelerate down
	t.tween_property(c.root, "position", final_local, 0.34)
	t.tween_callback(_impact_flash.bind(final_local))
	t.tween_property(c.root, "scale", Vector2(1.22, 0.82), 0.06)  # squash
	t.tween_property(c.root, "scale", Vector2.ONE, 0.14).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	await t.finished

func _impact_flash(pos: Vector2) -> void:
	if fx: fx.add(pos, Color(1.0, 0.6, 0.2), cell.x * 0.8)

## Light up a fireball cell instantly (the initial trigger locks, no drop animation).
func set_fireball(reel: int, row: int, text: String, jackpot: bool) -> void:
	var c = cells[reel][row]
	c.locked = true
	c.spr.texture = sym_tex.get("FIREBALL", null)
	c.spr.modulate = Color(1, 1, 1, 1)
	_fit_sprite(c.spr)
	c.lbl.text = text
	c.lbl.add_theme_color_override("font_color", GOLD if jackpot else Color(1, 0.97, 0.86))
	if fx: fx.add(_cell_local(reel, row), EMBER, cell.x * 0.6)
	c.root.scale = Vector2(1.3, 1.3)
	var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_property(c.root, "scale", Vector2.ONE, 0.25)

## Dim every non-locked cell during the hold-and-spin so the fireballs read.
func dim_unlocked(dim: bool) -> void:
	for reel in range(REELS):
		for row in range(active_rows):
			var c = cells[reel][row]
			if not c.locked:
				c.spr.modulate = Color(0.4, 0.4, 0.45, 1) if dim else Color(1, 1, 1, 1)

## Redraw the non-locked cells to a dark blank between respins.
func blank_unlocked() -> void:
	for reel in range(REELS):
		for row in range(active_rows):
			if not cells[reel][row].locked:
				_set_cell(reel, row, "")
				cells[reel][row].spr.modulate = Color(0.4, 0.4, 0.45, 1)
