/**
 * component-isolation.test.tsx — LOAD-BEARING anti-pattern guard
 *
 * Per Cycle Q SDD §6.3 + PRD D2:
 *   This test FAILS the build if any source file in @0xhoneyjar/quests-ui imports
 *   a `.css` file or contains a JSX `style={...}` attribute.
 *
 * Why this is load-bearing:
 *   A "default skin" becomes the only one used in practice, breaks the unstyled
 *   contract, and locks visual register at the wrong layer. Each consumer
 *   (cubquests-dashboard, per-world bots, future Farcaster Mini App) ships its
 *   own skin atop these primitives.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "..", "src");

/** Recursively collect all .ts and .tsx files under a directory. */
const collectSourceFiles = (dir: string): readonly string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Strip block comments + line comments before scanning so that the
 * anti-pattern guard's own documentation (which mentions `style={...}` etc.
 * verbatim) does NOT trigger false positives.
 */
const stripComments = (source: string): string =>
  source
    // Block comments / JSDoc — non-greedy
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Line comments — preserve newlines so line numbers stay aligned
    .replace(/\/\/.*$/gm, "");

describe("@0xhoneyjar/quests-ui component isolation", () => {
  const files = collectSourceFiles(SRC_DIR);

  it("ships at least one source file (sanity)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains ZERO .css imports across all source files", () => {
    const offenders: string[] = [];
    // Match: import "./foo.css" · import "../foo.css" · import 'foo.css'
    // Match: import x from "./foo.css"
    const cssImportRegex = /import\s+(?:[^"';]*\s+from\s+)?["'][^"']*\.css["']/i;
    for (const file of files) {
      const content = stripComments(readFileSync(file, "utf8"));
      if (cssImportRegex.test(content)) {
        offenders.push(relative(SRC_DIR, file));
      }
    }
    expect(
      offenders,
      `CSS imports detected in:\n  ${offenders.join("\n  ")}\n\nPer the anti-pattern guard in README.md, this package ships SHAPE not CHROME. ` +
        `Consumers ship skins atop these primitives — never ship a default skin here.`,
    ).toEqual([]);
  });

  it("contains ZERO inline style={...} JSX attributes", () => {
    const offenders: { file: string; line: number; text: string }[] = [];
    // Match: style={ ... } in JSX. Don't match `style:` (object key) or `styles=` (string).
    // The pattern requires `style=` followed by `{` (JSX expression).
    const styleAttrRegex = /\bstyle=\{/;
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      const lines = stripped.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        if (styleAttrRegex.test(line)) {
          offenders.push({
            file: relative(SRC_DIR, file),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }
    expect(
      offenders,
      `Inline style={...} attributes detected:\n${offenders
        .map((o) => `  ${o.file}:${o.line} → ${o.text}`)
        .join(
          "\n",
        )}\n\nPer the anti-pattern guard in README.md, this package ships SHAPE not CHROME. ` +
        `Consumers pass styling via slot components — never inline style here.`,
    ).toEqual([]);
  });

  it("contains ZERO className= literals on rendered elements (slot pattern only)", () => {
    // We allow `className?: string` in props (pass-through) but FAIL on hardcoded
    // className="..." values. This protects the unstyled contract.
    const offenders: { file: string; line: number; text: string }[] = [];
    // Match: className="..." or className={'...'} but NOT className={props.className}
    const classNameLiteralRegex = /\bclassName\s*=\s*(?:"[^"]+"|'[^']+'|\{["'][^"']+["']\})/;
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      const lines = stripped.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        if (classNameLiteralRegex.test(line)) {
          offenders.push({
            file: relative(SRC_DIR, file),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }
    expect(
      offenders,
      `Hardcoded className literals detected:\n${offenders
        .map((o) => `  ${o.file}:${o.line} → ${o.text}`)
        .join(
          "\n",
        )}\n\nPer the anti-pattern guard in README.md, primitives accept className as a pass-through prop only. ` +
        `Never ship class names — consumers own visual chrome.`,
    ).toEqual([]);
  });
});
