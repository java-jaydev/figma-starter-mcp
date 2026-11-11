import { beforeEach, describe, expect, it } from "vitest";
import { dispatch, type Ctx } from "../../src/plugin/dispatch.ts";
import "../../src/plugin/commands/tokens.ts";
import "../../src/plugin/commands/structure.ts";
import "../../src/plugin/commands/lint.ts";
import { installFakeFigma, type FakeFigma } from "../fake-figma.ts";

let fake: FakeFigma;
const ctx: Ctx = { confirm: async () => true };
const run = (name: any, args: unknown = {}) => dispatch({ id: "t", name, args }, ctx);

beforeEach(() => {
  fake = installFakeFigma();
});

describe("lint", () => {
  it("finds hardcoded values and default names on the page", async () => {
    const a: any = await run("create_frame", { name: "Frame 1" });
    const n: any = fake.nodes.get(a.data.id);
    n.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    const r: any = await run("lint", { scope: "page" });
    expect(r.ok).toBe(true);
    const rules = r.data.findings.map((f: any) => f.rule);
    expect(rules).toContain("hardcoded-value");
    expect(rules).toContain("default-layer-name");
    expect(r.data.checked).toBeGreaterThanOrEqual(1);
    expect(r.data.truncated).toBeUndefined();
  });

  it("does not flag a section's default look", async () => {
    await run("create_section", { name: "Onboarding" });
    const r: any = await run("lint", { scope: "page" });
    expect(r.data.findings).toEqual([]);
  });

  it("does not flag the font size of text that uses a text style", async () => {
    await run("upsert_variables", { collection: "Tokens", variables: [{ name: "color/text/default", type: "COLOR", value: "#111111" }] });
    await run("upsert_text_styles", { styles: [{ name: "body/md", family: "Inter", style: "Regular", size: { raw: 14, reason: "r" }, lineHeight: { raw: 20, reason: "r" } }] });
    const f: any = await run("create_frame", { name: "Card" });
    await run("create_text", { parentId: f.data.id, text: "Hi", textStyle: "body/md", fill: { var: "color/text/default" } });
    const r: any = await run("lint", { scope: "page" });
    expect(r.data.findings).toEqual([]);
  });

  it("reports nothing for a plain frame created with defaults", async () => {
    await run("create_frame", { name: "Card" });
    const r: any = await run("lint", { scope: "page" });
    expect(r.data.findings).toEqual([]);
  });

  it("an exception on one field does not hide findings on another", async () => {
    const a: any = await run("create_frame", { name: "Card", radius: { raw: 3, reason: "hairline" } });
    fake.nodes.get(a.data.id)!.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
    const r: any = await run("lint", { scope: "page" });
    expect(r.data.findings.map((f: any) => f.message)).toEqual(["strokes[0] uses hardcoded value #000000"]);
  });

  it("does not flag a real-shaped variant instance with #id property keys", async () => {
    const screen: any = await run("create_frame", { name: "Screen" });
    const a = fake.figma.createComponent() as any;
    a.name = "size=large";
    a.addComponentProperty("label", "TEXT", "Go");
    const b = fake.figma.createComponent() as any;
    b.name = "size=small";
    const set = (fake.figma as any).combineAsVariants([a, b], fake.page);
    set.name = "Button";
    const inst = a.createInstance();
    fake.nodes.get(screen.data.id)!.appendChild(inst);
    const r: any = await run("lint", { scope: "page", includeExcepted: true });
    const naming = r.data.findings.filter((f: any) => f.rule === "component-name" || f.rule === "prop-name");
    expect(naming).toEqual([]);
  });

  it("hides excepted findings unless includeExcepted", async () => {
    await run("create_frame", { name: "Card", fill: { raw: "#123456", reason: "brand" } });
    const hidden: any = await run("lint", { scope: "page" });
    expect(hidden.data.findings.filter((f: any) => f.rule === "hardcoded-value")).toEqual([]);
    const shown: any = await run("lint", { scope: "page", includeExcepted: true });
    expect(shown.data.findings.some((f: any) => f.rule === "hardcoded-value" && f.excepted)).toBe(true);
  });

  it("reports theme mismatch between Color / Light and Color / Dark", async () => {
    await run("upsert_variables", { collection: "Color / Light", variables: [{ name: "color/bg/default", type: "COLOR", value: "#FFFFFF" }, { name: "color/fg/default", type: "COLOR", value: "#000000" }] });
    await run("upsert_variables", { collection: "Color / Dark", variables: [{ name: "color/bg/default", type: "COLOR", value: "#000000" }] });
    const r: any = await run("lint", { scope: "page" });
    const f = r.data.findings.filter((x: any) => x.rule === "theme-mismatch");
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain("color/fg/default");
  });

  it("lints only the selection for scope selection", async () => {
    const a: any = await run("create_frame", { name: "Frame 1" });
    await run("create_frame", { name: "Frame 2" });
    (fake.page as any).selection = [fake.nodes.get(a.data.id)];
    const r: any = await run("lint", { scope: "selection" });
    expect(r.data.findings.every((f: any) => f.nodeId === a.data.id)).toBe(true);
    expect(r.data.checked).toBe(1);
  });
});
