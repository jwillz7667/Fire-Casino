extends Node2D

## Inferno Link board — the reel grid inside the ornate fire frame. In the base game it is a
## 5×4 grid inside the landscape frame; when the hold-and-spin triggers it TRANSFORMS into a
## taller 5×6 grid inside the portrait bonus frame. Pure presentation: it renders the server
## grid, spins reels in, flashes line wins, and rains the flaming balls into the bonus board.

const REELS := 5
const ROWS_BASE := 4
const ROWS_BONUS := 8
const MAX_ROWS := 8
const GOLD := Color(0.97, 0.8, 0.36)
const EMBER := Color(1.0, 0.55, 0.15)

var sym_tex := {}            # {"SEVEN":Texture2D, ...}
var frame_tex: Texture2D
var bonus_frame_tex: Texture2D
var active_rows := ROWS_BASE
var font: Font

## Emitted as the not-yet-revealed reels slow into the one-to-go anticipation drumroll, so the
## machine can fire its tension SFX/music duck without the board needing the audio players.
signal anticipation_started

# geometry
var origin := Vector2.ZERO   # top-left of the grid window
var cell := Vector2(180, 180)
var gap := 8.0

var frame_spr: Sprite2D
var reel_bg: Panel           # dark reel layer BEHIND the symbols, shows through the frame hole
var clip: Control            # clip_contents window so symbols are masked while they drop in
var fx                       # inferno_fx.gd — clipped ember/flame glows
var cells := []              # cells[reel][row] = {root:Node2D, spr:Sprite2D, lbl:Label, slot, locked}

# WIN FLASH: the cells that PAID (base payline symbols, or every locked fireball in the
# hold-and-spin) pulse + brighten + bloom, cycling one-by-one then all together, looped until
# the next spin clears it. Driven from _process (like inferno_fx) so a stop is a single flag
# flip with no dangling tweens — and it stays on the reel layer, under the HUD/banner canvas.
var _flash_cells := []       # Array[Vector2i] of paying cells (board-local reel,row)
var _flashing := false
var _flash_t := 0.0
var _flash_last_idx := -1
var _flash_all_glowed := false

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
## Reveal the reels one column at a time, left→right (the credit balls drop in showing their
## values). `fire_labels` maps "reel,row" → the credit string to print on a FIREBALL cell.
## ANTICIPATION: drive the one-to-go suspense from the server's feel hint when given
## (`anticipate_from_reel` = feel.anticipation.fromReel), else self-count the credit balls one
## short of the trigger (offline mock). Once anticipating, every remaining reel is held back into
## a drumroll — longer stop delay, an ember pulse, an ENLARGE, and the `anticipation_started`
## tension hook — before it finally drops.
func spin_to(grid: Array, fire_labels: Dictionary = {}, anticipate_at: int = 3,
		anticipate_from_reel: int = -1) -> void:
	for reel in range(REELS):
		for row in range(active_rows):
			cells[reel][row].locked = false
	var drop := cell.y * (MAX_ROWS + 1)
	var balls := 0
	var anticipating := false
	# fromReel == 0 means anticipate from the very first reel, so arm it before the loop.
	if anticipate_from_reel == 0:
		anticipating = true
		_set_anticipation(0, true)
	for reel in range(REELS):
		# DRUMROLL: hold each one-to-go reel back for suspense before it drops in.
		if anticipating:
			anticipation_started.emit()
			if fx: fx.add(_cell_local(reel, active_rows / 2), EMBER, cell.x * 0.9)
			await get_tree().create_timer(0.4).timeout
		# drop this reel's column in together
		var t := create_tween().set_parallel(true).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		for row in range(active_rows):
			var c = cells[reel][row]
			var sym: String = grid[reel][row]
			var label: String = fire_labels.get("%d,%d" % [reel, row], "")
			_set_cell(reel, row, sym, label)
			c.root.scale = Vector2.ONE
			var final_local := _cell_local(reel, row)
			c.root.position = Vector2(final_local.x, final_local.y - drop)
			t.tween_property(c.root, "position", final_local, 0.34).set_delay(row * 0.05)
			if sym == "FIREBALL" and label != "":
				if fx: fx.add(final_local, EMBER, cell.x * 0.5)
		await t.finished
		# decide whether the reels still to come should drumroll. Prefer the server's explicit
		# fromReel; otherwise self-count the credit balls one short of the trigger.
		if anticipate_from_reel >= 0:
			if not anticipating and reel == anticipate_from_reel - 1 and anticipate_from_reel < REELS:
				anticipating = true
				_set_anticipation(anticipate_from_reel, true)
		else:
			for row in range(active_rows):
				if grid[reel][row] == "FIREBALL":
					balls += 1
			if not anticipating and balls >= anticipate_at and reel < REELS - 1:
				anticipating = true
				_set_anticipation(reel + 1, true)
	if anticipating:
		_set_anticipation(0, false)  # restore all
	await get_tree().create_timer(0.05).timeout

## Enlarge + pulse every cell on reels >= from_reel (anticipation), or restore all when off.
func _set_anticipation(from_reel: int, on: bool) -> void:
	for reel in range(REELS):
		var target: float = 1.18 if (on and reel >= from_reel) else 1.0
		for row in range(active_rows):
			var c = cells[reel][row]
			var tw := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
			tw.tween_property(c.root, "scale", Vector2(target, target), 0.2)
		if on and reel >= from_reel and fx:
			fx.add(_cell_local(reel, active_rows / 2), Color(1.0, 0.55, 0.15), cell.x * 0.9)

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

## Looped paying-cell flash (see the _flash_* state above). Each frame it lights the cells in
## sequence — a chasing pulse left-to-right through the win — then a unison flash of the whole
## set, repeating. Glows reuse the fx ember bloom + _cell_local coord math; the cells animate
## their own scale/modulate, so the effect always renders on the reel layer below the HUD.
func _process(delta: float) -> void:
	if not _flashing:
		return
	_flash_t += delta
	var n := _flash_cells.size()
	if n == 0:
		return
	# Chase one cell at a time, but bound the whole sweep so a big hold-and-spin board (up to 40
	# paid cells) still reaches the "all together" climax inside the win-presentation window —
	# small payline sets (3-5 cells) keep the original 0.15s per-cell beat.
	var step: float = clampf(2.0 / float(n), 0.05, 0.15)
	var indiv := float(n) * step
	var all_dur := 0.55
	var period := indiv + all_dur
	var p: float = fmod(_flash_t, period)
	var in_all := p >= indiv
	# one-shot ember bloom as each cell, then the whole set, lights up
	if in_all:
		if not _flash_all_glowed:
			_flash_all_glowed = true
			_flash_last_idx = -1
			for ac in _flash_cells:
				if fx: fx.add(_cell_local(ac.x, ac.y), EMBER, cell.x * 0.7)
	else:
		_flash_all_glowed = false
		var idx := int(p / step)
		if idx != _flash_last_idx and idx >= 0 and idx < n:
			_flash_last_idx = idx
			var gc: Vector2i = _flash_cells[idx]
			if fx: fx.add(_cell_local(gc.x, gc.y), GOLD, cell.x * 0.55)
	for i in n:
		var rc: Vector2i = _flash_cells[i]
		if rc.x < 0 or rc.x >= REELS or rc.y < 0 or rc.y >= active_rows:
			continue
		var amt := 0.0
		if in_all:
			amt = sin(((p - indiv) / all_dur) * PI)
		else:
			var local := p - float(i) * step
			if local >= 0.0 and local < step:
				amt = sin((local / step) * PI)
		var c = cells[rc.x][rc.y]
		var sc := 1.0 + 0.22 * amt
		c.root.scale = Vector2(sc, sc)
		c.spr.modulate = Color(1, 1, 1, 1).lerp(Color(1.8, 1.45, 0.9, 1), amt)

## Start (or restart) the looped win flash on the given paying cells. Dedupes + range-checks
## against the active board so the same pool serves the 5×4 base grid and the 5×8 bonus board.
func start_win_flash(win_cells: Array) -> void:
	stop_win_flash()
	_flash_cells = []
	for rc in win_cells:
		if rc.x >= 0 and rc.x < REELS and rc.y >= 0 and rc.y < active_rows and not _flash_cells.has(rc):
			_flash_cells.append(rc)
	if _flash_cells.is_empty():
		return
	_flash_t = 0.0
	_flash_last_idx = -1
	_flash_all_glowed = false
	_flashing = true

## Clear the flash (next spin / bonus exit): stop the loop and restore the flashed cells to rest.
func stop_win_flash() -> void:
	if not _flashing:
		return
	_flashing = false
	for rc in _flash_cells:
		if rc.x >= 0 and rc.x < REELS and rc.y >= 0 and rc.y < active_rows:
			var c = cells[rc.x][rc.y]
			c.root.scale = Vector2.ONE
			c.spr.modulate = Color(1, 1, 1, 1)
	_flash_cells = []

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
