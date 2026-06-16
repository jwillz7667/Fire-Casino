# Phoenix Ascendant — Godot/WASM slot client

The real game client for the `phoenix-ascendant` slot. The **game math is NOT here**
— outcomes are decided server-side by the RGS engine (`apps/api/src/games/engines/
phoenix`). This is presentation only: it asks the host page to place each bet over a
`postMessage` bridge and animates the authoritative result it receives. It never
decides a result.

## What's in this directory (authored here)

- `project.godot` — Godot 4.6 project; GL Compatibility renderer (WebGL2), portrait.
- `slot/slot_machine.gd` — the slot: scrolling reels + stagger-stop, win highlight +
  particle FX, free-spins / ORB sequence, audio, HUD, and the `window.PhoenixGodot`
  bridge (server-authoritative; mock outcomes only in the editor/desktop).
- `slot/main.tscn` — entry scene.
- `export_presets.cfg` — Web preset (nothreads → no COOP/COEP needed; no VRAM compression).
- `web/phoenix-bridge.js` — injected into the exported `index.html`; defines
  `window.PhoenixGodot` as a cross-origin `postMessage` proxy to the parent arcade.

## Assets (not committed — fetched from the upstream art pipeline)

Art, audio, FX, rigs, shaders and the symbol database come from
**github.com/jwillz7667/game** (an asset-pipeline-only repo). They're large binaries
and live there, not in this monorepo.

## Build (reproducible)

```bash
# 1. Get the assets
git clone https://github.com/jwillz7667/game.git /tmp/phoenix-assets

# 2. Assemble a Godot project: assets + the authored files here
mkdir -p /tmp/phoenix-build
cp -R /tmp/phoenix-assets/{art,audio,data,fx,rigs,scenes,shaders,symbols,fonts} /tmp/phoenix-build/
cp -R games/phoenix-ascendant/{project.godot,export_presets.cfg,slot,icon.svg} /tmp/phoenix-build/ 2>/dev/null
cp /tmp/phoenix-assets/icon.svg /tmp/phoenix-build/

GODOT=/Applications/Godot.app/Contents/MacOS/Godot   # Godot 4.6.x + Web export templates
"$GODOT" --headless --path /tmp/phoenix-build --import
"$GODOT" --headless --path /tmp/phoenix-build --export-release "Web" /tmp/phoenix-build/build/index.html

# 3. Inject the bridge into the exported shell, then host
#    (add <script src="phoenix-bridge.js"></script> before </head>)
cp games/phoenix-ascendant/web/phoenix-bridge.js /tmp/phoenix-build/build/

# 4. Upload build/* to the public R2 bucket under phoenix-ascendant/ with correct
#    Content-Types (.wasm→application/wasm, .js→text/javascript, .pck→octet-stream).
```

## Hosting

The exported build is served from a **public Cloudflare R2** bucket; the arcade
embeds `<base>/phoenix-ascendant/index.html` in an `<iframe>`. The URL is the
production default in `apps/arcade/src/components/game/PhoenixGodot.tsx` and can be
overridden with `NEXT_PUBLIC_PHOENIX_GAME_URL`.
