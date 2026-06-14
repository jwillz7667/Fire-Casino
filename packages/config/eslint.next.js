import base from "./eslint.config.js";
import globals from "globals";

/**
 * ESLint config for the Next.js apps (console, arcade). Extends the base and
 * adds browser globals. React/Next-specific plugins are layered in when the
 * frontends are built out (Phases 11-12).
 */
export default [
  ...base,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Event handlers commonly pass async functions to JSX props.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
];
