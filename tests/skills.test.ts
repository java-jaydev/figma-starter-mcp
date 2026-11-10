import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const ruleIds = [...read("src/shared/rules.ts").matchAll(/\| "([a-z-]+)"/g)].map((m) => m[1]);

test("rules.ts exposes the seven rule ids", () => {
  expect(ruleIds).toHaveLength(7);
});

test("every RuleId appears in rules.md", () => {
  const rules = read("skills/figma-build/references/rules.md");
  for (const id of ruleIds) expect(rules, id).toContain(`\`${id}\``);
});

test.each(["figma-build", "figma-to-code"])("%s SKILL.md name equals its folder", (dir) => {
  const path = `skills/${dir}/SKILL.md`;
  expect(existsSync(path)).toBe(true);
  const name = /^name:\s*(\S+)\s*$/m.exec(read(path))?.[1];
  expect(name).toBe(dir);
});

test("no em or en dash in skills", () => {
  for (const f of ["figma-build/SKILL.md", "figma-build/references/rules.md", "figma-to-code/SKILL.md"]) {
    expect(read(`skills/${f}`), f).not.toMatch(/[\u2013\u2014]/);
  }
});

// Old name is built from parts so this file does not match itself.
const OLD_NAME = ["figma", "free", "design", "system"].join("-");
// Excluded: history, research and plans.
const EXCLUDE = [":(exclude)docs/research", ":(exclude)docs/superpowers"];

test("old plugin name is gone from the repo", () => {
  let out = "";
  try {
    out = execFileSync("git", ["grep", "-l", "-I", OLD_NAME, "--", ".", ...EXCLUDE], { encoding: "utf8" });
  } catch {
    out = ""; // git grep exits 1 when nothing matches
  }
  expect(out.trim()).toBe("");
});
