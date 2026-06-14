import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

/**
 * Shared flat ESLint config for all Aureus TypeScript packages.
 * Consumers: `import base from "@aureus/config/eslint"; export default base;`
 * Type-checked rules use the TS project service, which auto-discovers each
 * package's tsconfig.json — so this single array works across the workspace.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/src/generated/**",
      "**/next-env.d.ts",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Hard rule #1 support: no float math for money. parseFloat is the
      // classic money bug; banned outright. Money parses straight to BigInt
      // via packages/shared/money.ts (toMinor/fromMinor).
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message:
            "parseFloat is banned: money is BigInt minor units. Use toMinor/fromMinor from @aureus/shared.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    // Test files: relax a few rules that fight with test ergonomics.
    files: ["**/*.test.ts", "**/*.spec.ts", "**/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },
  eslintConfigPrettier,
);
