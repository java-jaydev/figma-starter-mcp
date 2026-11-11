// `node scripts/build-plugin.mjs` must produce a loadable dev plugin in dist/plugin.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(`dist/plugin/${f}`, "utf8");

beforeAll(() => {
  execFileSync(process.execPath, ["scripts/build-plugin.mjs"], { stdio: "pipe" });
}, 30_000);

describe("plugin build", () => {
  it("copies the manifest with localhost-only network access", () => {
    const m = JSON.parse(read("manifest.json"));
    expect(m).toMatchObject({ name: "figma-starter", id: "figma-starter-dev", main: "code.js", ui: "ui.html" });
    expect(m.networkAccess).toEqual({
      allowedDomains: ["none"],
      devAllowedDomains: ["ws://localhost:39917"],
      reasoning: "Connects to the figma-starter-mcp server running on this computer.",
    });
  });

  it("inlines the UI script into ui.html", () => {
    const html = read("ui.html");
    expect(html).not.toContain("UI_SCRIPT");
    expect(html).toContain("ws://localhost:");
    expect(html).not.toContain("crypto.subtle");
    expect(html.match(/<script>/g)).toHaveLength(1);
    // Room for a pasted code with spaces; the client trims and checks the length.
    expect(html).toContain('maxlength="16"');
    expect(html).not.toContain("e.source !== parent");
  });

  it("emits ES2017 code without newer syntax", () => {
    for (const f of ["code.js", "ui.html"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\?\?|\?\.[a-zA-Z_$(\[]/);
    }
    expect(read("code.js")).toContain("figma.showUI");
  });
});
