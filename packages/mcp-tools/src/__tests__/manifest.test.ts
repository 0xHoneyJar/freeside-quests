/**
 * T2.10 acceptance — manifest.json validates · each tool spec validates ·
 * imports protocol schemas (referenced via $ref).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateMCPManifest } from "../manifest.js";

const manifestPath = join(__dirname, "..", "..", "manifest.json");
const toolsDir = join(__dirname, "..", "..", "tools");

const toolSpecFiles = [
  "get-active-activities.json",
  "get-progress.json",
  "get-badges.json",
  "get-raffle-entries.json",
  "list-kinds.json",
];

describe("MCP manifest + tool specs", () => {
  it("manifest.json exists and validates against MCPManifest schema", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const validated = validateMCPManifest(raw);
    expect(validated.name).toContain("freeside-activities-mcp-tools");
    expect(validated.tools.length).toBe(5);
  });

  it("each declared tool exists at the referenced path", () => {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      tools: Array<{ name: string; spec: string }>;
    };
    for (const tool of raw.tools) {
      const specPath = join(toolsDir, tool.spec.replace("./tools/", ""));
      expect(existsSync(specPath)).toBe(true);
    }
  });

  it.each(toolSpecFiles)("tool spec %s parses as JSON Schema 2020-12", (file) => {
    const raw = JSON.parse(readFileSync(join(toolsDir, file), "utf8")) as {
      $schema: string;
      $id: string;
      type: string;
      properties: { input: unknown; output: unknown };
    };
    expect(raw.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(raw.$id).toMatch(/^https:\/\/schemas\.freeside\.thj\/mcp\//);
    expect(raw.type).toBe("object");
    expect(raw.properties.input).toBeTruthy();
    expect(raw.properties.output).toBeTruthy();
  });

  it("gateway validation contract: every tool name matches its declared spec basename", () => {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      tools: Array<{ name: string; spec: string }>;
    };
    for (const tool of raw.tools) {
      const basename = tool.spec.replace("./tools/", "").replace(".json", "");
      expect(tool.name).toBe(basename);
    }
  });
});
