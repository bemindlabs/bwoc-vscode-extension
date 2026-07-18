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
});
