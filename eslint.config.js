// Flat ESLint config. tsc (strict, noUnused*) already covers types + dead code,
// so this layers on the recommended JS + typescript-eslint best-practice rules.
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "*.vsix"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The webview reducer is a string; a few any/console spots are pragmatic.
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
      // `_`-prefixed params are intentionally-unused interface conformers.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Noisy on the mock-closure reassignment pattern used in the tests.
      "no-useless-assignment": "off",
    },
  },
);
