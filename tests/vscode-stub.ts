// Minimal stand-in for the `vscode` module so vscode-importing sources can be
// loaded in vitest (Node) to unit-test their PURE functions. Only the runtime
// API surface actually touched at import time needs to exist here — the pure
// formatters/arg-builders under test never call into `vscode`.
export {};
