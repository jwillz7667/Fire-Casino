import base from "@aureus/config/eslint-next";

/**
 * Arcade ESLint: the shared Next config, plus a global ignore for the committed
 * Godot/WASM game builds staged under public/ (vendored JS bundles + bridge shims —
 * generated artifacts, not source, and not parseable by the typed lint project service).
 */
export default [{ ignores: ["public/**"] }, ...base];
