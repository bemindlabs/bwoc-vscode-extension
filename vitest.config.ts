import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Alias the `vscode` module (only present in the VS Code runtime) to a stub so
// vscode-importing sources can be loaded to unit-test their pure functions.
export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL("./tests/vscode-stub.ts", import.meta.url)),
    },
  },
  test: {
    // Report-only (no failing threshold): much of the surface is vscode-coupled
    // UI glue that the stub can't exercise, so a hard gate would fail on glue,
    // not logic. This makes the covered-vs-uncovered split visible in CI.
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/**/*.ts"],
    },
  },
});
