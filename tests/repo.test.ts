import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { expect, test } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const PIN = `v${JSON.parse(read("package.json")).version}`;
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f && existsSync(f));
const binary = new Set([".png", ".ico", ".jpg", ".jpeg", ".gif", ".woff", ".woff2"]);
const textFiles = tracked.filter((f) => !binary.has(extname(f)) && f !== "package-lock.json");

test("no em dash, en dash or horizontal bar in tracked text files", () => {
  const bad = textFiles.filter((f) => /[\u2013\u2014\u2015]/.test(read(f)));
  expect(bad).toEqual([]);
});

test("src/ has no Figma REST API or token strings", () => {
  const bad = tracked
    .filter((f) => f.startsWith("src/"))
    .filter((f) => /api\.figma\.com|figd_|X-Figma-Token/i.test(read(f)));
  expect(bad).toEqual([]);
});

test("manifest devAllowedDomains is exactly the localhost WebSocket origin", () => {
  const manifest = JSON.parse(read("src/plugin/manifest.json"));
  expect(manifest.networkAccess.devAllowedDomains).toEqual(["ws://localhost:39917"]);
});

test(".mcp.json and gemini-extension.json register the same command", () => {
  const mcp = JSON.parse(read(".mcp.json")).mcpServers["figma-starter"];
  const gemini = JSON.parse(read("gemini-extension.json")).mcpServers["figma-starter"];
  expect(mcp).toEqual({ command: "npx", args: ["-y", `github:java-jaydev/figma-starter-mcp#${PIN}`] });
  expect(gemini).toEqual(mcp);
});

test("every install command is pinned to the release tag", () => {
  const files = tracked.filter(
    (f) => /^README.*\.md$/.test(f) || f.startsWith("docs/install/") || f.startsWith("skills/") || f === ".mcp.json" || f === "gemini-extension.json",
  );
  const unpinned = files.filter((f) => /github:java-jaydev\/figma-starter-mcp(?!#)/.test(read(f)) || /npx figma-starter-mcp/.test(read(f)));
  expect(unpinned).toEqual([]);
  const pinned = files.filter((f) => read(f).includes(`github:java-jaydev/figma-starter-mcp#${PIN}`));
  expect(pinned).toEqual(expect.arrayContaining(["README.md", "README.en.md", ".mcp.json", "skills/figma-build/SKILL.md", "skills/figma-to-code/SKILL.md"]));
  const others = [...read("README.md").matchAll(/figma-starter-mcp#(v[0-9.]+)/g)].map((m) => m[1]);
  expect(new Set(others)).toEqual(new Set([PIN]));
});

test("package.json requires Node 20 or later", () => {
  expect(JSON.parse(read("package.json")).engines).toEqual({ node: ">=20" });
});

test("plugin and marketplace names", () => {
  expect(JSON.parse(read(".claude-plugin/plugin.json")).name).toBe("figma-starter");
  expect(JSON.parse(read(".claude-plugin/marketplace.json")).name).toBe("figma-starter-mcp");
  expect(JSON.parse(read("gemini-extension.json")).name).toBe("figma-starter");
});

test("all relative links in README and docs resolve", () => {
  const docs = tracked.filter(
    (f) =>
      f.endsWith(".md") &&
      (/^README.*\.md$/.test(f) || f.startsWith("docs/")) &&
      !f.startsWith("docs/superpowers/") &&
      !f.startsWith("docs/research/"),
  );
  expect(docs).toContain("README.md");
  const broken: string[] = [];
  for (const f of docs) {
    const text = read(f).replace(/```[\s\S]*?```/g, "");
    const targets = [
      ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/(?:src|srcset|href)="([^"]+)"/g)].map((m) => m[1]),
    ];
    for (const t of targets) {
      if (/^(https?:|mailto:|#)/.test(t)) continue;
      const path = decodeURIComponent(t.split("#")[0]);
      if (path && !existsSync(join(dirname(f), path))) broken.push(`${f} -> ${t}`);
    }
  }
  expect(broken).toEqual([]);
});

test("README anchors are shared across languages", () => {
  const ids = (f: string) => [...read(f).matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]);
  const ko = ids("README.md");
  expect(ko.length).toBeGreaterThan(5);
  for (const f of ["README.en.md", "README.ja.md", "README.zh.md"]) expect(ids(f), f).toEqual(ko);
});
