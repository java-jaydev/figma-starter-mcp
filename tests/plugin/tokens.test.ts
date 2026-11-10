import { beforeEach, describe, expect, it } from "vitest";
import { dispatch, type Ctx } from "../../src/plugin/dispatch.ts";
import "../../src/plugin/commands/tokens.ts";
import { resolveColor, resolveNumber } from "../../src/plugin/resolve.ts";
import { installFakeFigma, type FakeFigma } from "../fake-figma.ts";

const ctx: Ctx = { confirm: async () => true };
let fake: FakeFigma;
const run = (name: any, args: unknown = {}) => dispatch({ id: "t", name, args }, ctx);

beforeEach(() => {
  fake = installFakeFigma();
});

const vars = (collection = "Color") => ({
  collection,
  variables: [
    { name: "color/bg/default", type: "COLOR", value: "#FFFFFF" },
    { name: "space/4", type: "FLOAT", value: 16 },
  ],
});

describe("upsert_variables", () => {
  it("is idempotent: running twice creates no duplicates and keeps one mode", async () => {
    expect((await run("upsert_variables", vars())).ok).toBe(true);
    const second: any = await run("upsert_variables", { collection: "Color", variables: [{ name: "color/bg/default", type: "COLOR", value: "#000000" }] });
    expect(second.data).toMatchObject({ created: 0, updated: 1 });
    await run("upsert_variables", vars());
    expect(fake.collections).toHaveLength(1);
    expect(fake.collections[0].modes).toHaveLength(1);
    expect(fake.variables.map((v) => v.name).sort()).toEqual(["color/bg/default", "space/4"]);
    const v = fake.variables.find((x) => x.name === "color/bg/default")!;
    expect(v.valuesByMode[fake.collections[0].modes[0].modeId]).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("rejects a name that is not a token name", async () => {
    const r: any = await run("upsert_variables", { collection: "Color", variables: [{ name: "Color/BG", type: "COLOR", value: "#FFF" }] });
    expect(r).toMatchObject({ ok: false, code: "RULE_VIOLATION" });
    expect(fake.variables).toHaveLength(0);
  });

  it("accepts #RGB and #RRGGBBAA and rejects other color strings", async () => {
    const ok: any = await run("upsert_variables", { collection: "C", variables: [{ name: "color/a", type: "COLOR", value: "#F00" }, { name: "color/b", type: "COLOR", value: "#00FF0080" }] });
    expect(ok.ok).toBe(true);
    for (const bad of ["red", "#GGGGGG", "#12345", "rgb(0,0,0)"]) {
      const r: any = await run("upsert_variables", { collection: "C", variables: [{ name: "color/c", type: "COLOR", value: bad }] });
      expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });

  it("rejects a FLOAT variable with a non-number value", async () => {
    const r: any = await run("upsert_variables", { collection: "C", variables: [{ name: "space/1", type: "FLOAT", value: "4" }] });
    expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("upsert_variables duplicates", () => {
  it("rejects a name given twice in one call and writes nothing", async () => {
    const r: any = await run("upsert_variables", {
      collection: "Dup",
      variables: [
        { name: "color/a", type: "COLOR", value: "#F00" },
        { name: "color/a", type: "COLOR", value: "#0F0" },
      ],
    });
    expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(r.message).toContain("color/a");
    expect(fake.collections).toHaveLength(0);
    expect(fake.variables).toHaveLength(0);
  });
});

describe("upsert_text_styles", () => {
  const style = { name: "Body/Default", family: "Inter", style: "Regular", size: { raw: 16, reason: "test" }, lineHeight: { raw: 24, reason: "test" } };

  it("is idempotent and sets font, size and line height", async () => {
    await run("upsert_text_styles", { styles: [style] });
    await run("upsert_text_styles", { styles: [{ ...style, size: { raw: 18, reason: "test" } }] });
    expect(fake.textStyles).toHaveLength(1);
    expect(fake.textStyles[0]).toMatchObject({ fontSize: 18, lineHeight: { value: 24, unit: "PIXELS" } });
  });

  it("reports a missing font with family, style and a restart hint", async () => {
    const r: any = await run("upsert_text_styles", { styles: [{ ...style, family: "Nope Sans" }] });
    expect(r).toMatchObject({ ok: false, code: "FONT_NOT_AVAILABLE" });
    expect(r.message).toContain("Nope Sans");
    expect(r.message).toContain("Regular");
    expect(r.hint).toMatch(/restart Figma after installing fonts/);
  });

  it("binds size to a FLOAT variable when given a var ref", async () => {
    await run("upsert_variables", { collection: "Type", variables: [{ name: "font/size/body", type: "FLOAT", value: 16 }] });
    await run("upsert_text_styles", { styles: [{ ...style, size: { var: "font/size/body" } }] });
    expect((fake.textStyles[0] as any).boundVariables.fontSize.id).toBe(fake.variables[0].id);
  });
});

describe("upsert_text_styles exceptions, atomicity and rebinding", () => {
  const raw = (n: number, reason: string) => ({ raw: n, reason });
  const base = { name: "Body/Default", family: "Inter", style: "Regular" };

  it("records raw reasons on the style and clears them when no raw refs remain", async () => {
    await run("upsert_text_styles", { styles: [{ ...base, size: raw(16, "legacy"), lineHeight: raw(24, "grid") }] });
    expect(JSON.parse(fake.textStyles[0].getPluginData("fsm.exception") as string)).toEqual({ fontSize: "legacy", lineHeight: "grid" });
    await run("upsert_variables", { collection: "Type", variables: [{ name: "font/size/body", type: "FLOAT", value: 16 }, { name: "font/line/body", type: "FLOAT", value: 24 }] });
    await run("upsert_text_styles", { styles: [{ ...base, size: { var: "font/size/body" }, lineHeight: raw(24, "grid") }] });
    expect(JSON.parse(fake.textStyles[0].getPluginData("fsm.exception") as string)).toEqual({ lineHeight: "grid" });
    await run("upsert_text_styles", { styles: [{ ...base, size: { var: "font/size/body" }, lineHeight: { var: "font/line/body" } }] });
    expect(fake.textStyles[0].getPluginData("fsm.exception")).toBe("");
  });

  it("writes nothing when a later style fails", async () => {
    const bad = { name: "Body/Small", family: "Inter", style: "Regular", size: { var: "font/size/none" }, lineHeight: raw(20, "x") };
    const r: any = await run("upsert_text_styles", { styles: [{ ...base, size: raw(16, "x"), lineHeight: raw(24, "x") }, bad] });
    expect(r).toMatchObject({ ok: false, code: "VARIABLE_NOT_FOUND" });
    expect(fake.textStyles).toHaveLength(0);
    const f: any = await run("upsert_text_styles", { styles: [{ ...base, size: raw(16, "x"), lineHeight: raw(24, "x") }, { ...bad, family: "Nope Sans", size: raw(1, "x") }] });
    expect(f).toMatchObject({ ok: false, code: "FONT_NOT_AVAILABLE" });
    expect(fake.textStyles).toHaveLength(0);
  });

  it("clears an old variable binding when switching to a raw value", async () => {
    await run("upsert_variables", { collection: "Type", variables: [{ name: "font/size/body", type: "FLOAT", value: 16 }] });
    await run("upsert_text_styles", { styles: [{ ...base, size: { var: "font/size/body" }, lineHeight: raw(24, "x") }] });
    expect((fake.textStyles[0] as any).boundVariables.fontSize).toBeDefined();
    await run("upsert_text_styles", { styles: [{ ...base, size: raw(18, "override"), lineHeight: raw(24, "x") }] });
    expect((fake.textStyles[0] as any).boundVariables.fontSize).toBeUndefined();
    expect(fake.textStyles[0].fontSize).toBe(18);
  });
});

describe("TokenRef resolution", () => {
  it("lists the nearest names for a misspelled variable", async () => {
    await run("upsert_variables", vars());
    const r: any = await run("upsert_text_styles", { styles: [{ name: "A/B", family: "Inter", style: "Regular", size: { var: "space/5" }, lineHeight: { raw: 1, reason: "x" } }] });
    expect(r).toMatchObject({ ok: false, code: "VARIABLE_NOT_FOUND" });
    await run("upsert_variables", { collection: "Color", variables: [{ name: "color/bg/subtle", type: "COLOR", value: "#EEE" }, { name: "color/bg/muted", type: "COLOR", value: "#DDD" }] });
    await expect(resolveColor({ var: "color/bg/defualt" })).rejects.toMatchObject({
      code: "VARIABLE_NOT_FOUND",
      hint: expect.stringContaining("color/bg/default"),
    });
    const err: any = await resolveColor({ var: "color/bg/defualt" }).catch((e) => e);
    expect(err.hint.split(": ")[1].split(", ").length).toBeLessThanOrEqual(3);
  });

  it("returns the variable for a var ref", async () => {
    await run("upsert_variables", vars());
    expect((await resolveColor({ var: "color/bg/default" })).variable?.name).toBe("color/bg/default");
    expect((await resolveNumber({ var: "space/4" })).variable?.name).toBe("space/4");
  });

  it("returns the raw value for a raw ref", async () => {
    expect((await resolveColor({ raw: "#FF0000", reason: "brand logo red" })).raw).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect((await resolveNumber({ raw: 3, reason: "hairline" })).raw).toBe(3);
  });
});

describe("bind_variable", () => {
  it("binds a fill to a color variable and a number field to a float variable", async () => {
    await run("upsert_variables", vars());
    const f = fake.figma.createFrame() as any;
    f.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
    const colorVar = fake.variables.find((v) => v.name === "color/bg/default")!;
    const spaceVar = fake.variables.find((v) => v.name === "space/4")!;
    expect((await run("bind_variable", { nodeId: f.id, field: "fills", var: "color/bg/default" })).ok).toBe(true);
    expect(f.fills[0].boundVariables.color.id).toBe(colorVar.id);
    expect((await run("bind_variable", { nodeId: f.id, field: "itemSpacing", var: "space/4" })).ok).toBe(true);
    expect(f.boundVariables.itemSpacing.id).toBe(spaceVar.id);
  });

  it("binds cornerRadius to all four corners", async () => {
    await run("upsert_variables", vars());
    const f = fake.figma.createFrame() as any;
    const radiusVar = fake.variables.find((v) => v.name === "space/4")!;
    const r: any = await run("bind_variable", { nodeId: f.id, field: "cornerRadius", var: "space/4" });
    expect(r).toMatchObject({ ok: true, data: { field: "cornerRadius" } });
    for (const c of ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"]) expect(f.boundVariables[c].id).toBe(radiusVar.id);
    expect(f.boundVariables.cornerRadius).toBeUndefined();
  });

  it("fails with NODE_NOT_FOUND and VARIABLE_NOT_FOUND", async () => {
    expect(await run("bind_variable", { nodeId: "9:9", field: "fills", var: "x/y" })).toMatchObject({ ok: false, code: "NODE_NOT_FOUND" });
    const f = fake.figma.createFrame() as any;
    expect(await run("bind_variable", { nodeId: f.id, field: "itemSpacing", var: "space/9" })).toMatchObject({ ok: false, code: "VARIABLE_NOT_FOUND" });
  });
});
