import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = path.join(process.cwd(), "src", "app");

describe("[E04] colours come from design tokens", () => {
  it("CSS outside theme.css uses no literal colours except in token definitions and shadows", () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(app).filter((name) => name.endsWith(".css") && name !== "theme.css")) {
      const css = fs.readFileSync(path.join(app, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [, property, value] of css.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+)/g)) {
        if (property.startsWith("--") || ["box-shadow", "text-shadow", "filter"].includes(property)) continue;
        if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(value)) offenders.push(`${file}: ${property}: ${value.trim().slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("[D04] rendering errors have a fallback page", () => {
  it("app/error.tsx exists and offers a retry", () => {
    const source = fs.readFileSync(path.join(app, "error.tsx"), "utf8");
    expect(source).toMatch(/"use client"/);
    expect(source).toMatch(/onClick=\{reset\}/);
  });
});
