import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CliBackend } from "../src/bwoc/cli";

/** A stand-in `bwoc` that prints `stdout` and exits with `code`, whatever the argv. */
function fakeBwoc(stdout: string, code: number): string {
  const dir = mkdtempSync(join(tmpdir(), "bwoc-fake-"));
  const bin = join(dir, "bwoc");
  writeFileSync(bin, `#!/bin/sh\ncat <<'JSON'\n${stdout}\nJSON\nexit ${code}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe.skipIf(process.platform === "win32")("reports that come with a non-zero exit", () => {
  it("doctor: a FAIL exits 3 but the report still reaches the caller", async () => {
    const report = JSON.stringify({
      exit: 3,
      results: [{ name: ".bwoc/workspace.toml", status: "fail", detail: "parse error" }],
      summary: { fail: 1, pass: 8 },
    });
    const cli = new CliBackend({ binaryPath: fakeBwoc(report, 3), workspace: "" });
    const out = await cli.doctor();
    expect(out.exit).toBe(3);
    expect(out.results[0]).toMatchObject({ name: ".bwoc/workspace.toml", status: "fail" });
  });

  it("run: a failed agent exits 1 but its output and exit code are kept", async () => {
    const result = JSON.stringify({ agent: "agent-a", exit_code: 2, duration_ms: 40, output: "boom" });
    const cli = new CliBackend({ binaryPath: fakeBwoc(result, 1), workspace: "" });
    const out = await cli.run("agent-a", "t");
    expect(out).toMatchObject({ agent: "agent-a", exitCode: 2, output: "boom" });
  });

  it("a non-zero exit with no report is still an error", async () => {
    const cli = new CliBackend({ binaryPath: fakeBwoc("", 2), workspace: "" });
    await expect(cli.doctor()).rejects.toThrow(/bwoc doctor --json failed/);
  });
});

describe.skipIf(process.platform === "win32")("what execTolerant must NOT treat as a report", () => {
  it("a non-zero exit with non-JSON stdout (usage text) is a CLI error, not a parse error", async () => {
    const cli = new CliBackend({ binaryPath: fakeBwoc("Usage: bwoc doctor [OPTIONS]", 2), workspace: "" });
    await expect(cli.doctor()).rejects.toThrow(/bwoc doctor --json failed/);
  });

  it("a timeout kill is an error even when partial JSON-looking stdout was printed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bwoc-fake-"));
    const bin = join(dir, "bwoc");
    writeFileSync(bin, `#!/bin/sh\necho '{"agent":"a","exit_code":0}'\nexec sleep 5\n`);
    chmodSync(bin, 0o755);
    const cli = new CliBackend({ binaryPath: bin, workspace: "" });
    // Reach the private tolerant exec with a short timeout to force the kill.
    const execTolerant = (cli as unknown as {
      execTolerant: (a: string[], t: number) => Promise<string>;
    }).execTolerant.bind(cli);
    await expect(execTolerant(["run"], 200)).rejects.toThrow(/failed/);
  });

  it("names a missing workspace instead of blaming the bwoc binary", async () => {
    const cli = new CliBackend({ binaryPath: fakeBwoc("{}", 0), workspace: "/nonexistent/bwoc-ws" });
    await expect(cli.list()).rejects.toThrow(/workspace "\/nonexistent\/bwoc-ws" does not exist/);
  });
});
