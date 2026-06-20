extends Node2D

## Clipped FX layer (child of the board's clip window): warm ember/flame glows that bloom
## where a fireball lands or a line wins. Lives inside the clip so glows are masked to the
## grid and draw above the slot panels but below the symbols.

var _glows := []  # [{pos:Vector2, t:float, color:Color, r:float}]

func _ready() -> void:
	set_process(true)

func add(pos: Vector2, color: Color, radius: float) -> void:
	_glows.append({"pos": pos, "t": 1.0, "color": color, "r": radius})

func _process(delta: float) -> void:
	if _glows.is_empty():
		return
	for g in _glows:
		g.t -= delta * 1.7
	_glows = _glows.filter(func(g): return g.t > 0.0)
	queue_redraw()

func _draw() -> void:
	for g in _glows:
		var a: float = clampf(g.t, 0.0, 1.0)
		# layered warm bloom: a wide soft halo + a brighter hot core
		draw_circle(g.pos, g.r * (1.0 + (1.0 - a) * 0.5), Color(g.color.r, g.color.g, g.color.b, a * 0.28))
		draw_circle(g.pos, g.r * 0.55, Color(1.0, 0.85, 0.5, a * 0.35))
