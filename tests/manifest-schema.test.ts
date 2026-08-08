import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// vitest runs from the package root; read the shipped files from there.
const read = (rel: string) => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

describe("config.manifest.json schema", () => {
  const schema = read("schemas/config.manifest.schema.json");
  const pkg = read("package.json");

  it("is a lenient draft-07 object schema keyed on identity", () => {
    expect(schema.$schema).toContain("draft-07");
    expect(schema.type).toBe("object");
    // Lenient so extra sections (e.g. `skills`) don't false-flag valid files.
    expect(schema.additionalProperties).toBe(true);
    expect(schema.required).toEqual(["agentId", "name", "primaryModel"]);
  });

  it("types the fields that are easy to get wrong when hand-editing", () => {
    const p = schema.properties;
    expect(p.maxTokens.type).toBe("integer");
    expect(p.thinking.type).toBe("boolean");
    expect(p.promptCache.type).toBe("boolean");
    expect(p.autoModels.type).toBe("array");
    expect(p.autoModels.items.type).toBe("string");
    expect(p.trust.properties.mode.enum).toEqual(["off", "warn", "refuse"]);
  });

  it("is wired via package.json jsonValidation to incarnated manifests", () => {
    const jv = pkg.contributes.jsonValidation;
    expect(Array.isArray(jv)).toBe(true);
    const entry = jv.find((e: { url: string }) => e.url.includes("config.manifest.schema.json"));
    expect(entry, "jsonValidation entry for the manifest schema").toBeTruthy();
    expect(entry.fileMatch).toContain("**/agents/**/config.manifest.json");
  });
});
