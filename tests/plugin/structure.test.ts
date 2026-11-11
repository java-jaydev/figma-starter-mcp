import { beforeEach, describe, expect, it } from "vitest";
import { dispatch, type Ctx } from "../../src/plugin/dispatch.ts";
import "../../src/plugin/commands/tokens.ts";
import "../../src/plugin/commands/structure.ts";
import { EXCEPTION_KEY } from "../../src/plugin/resolve.ts";
import { installFakeFigma, type FakeFigma } from "../fake-figma.ts";

const ctx: Ctx = { confirm: async () => true };
let fake: FakeFigma;
const run = (name: any, args: unknown = {}) => dispatch({ id: "t", name, args }, ctx);

beforeEach(async () => {
  fake = installFakeFigma();
  await run("upsert_variables", {
    collection: "Tokens",
    variables: [
      { name: "color/bg/default", type: "COLOR", value: "#FFFFFF" },
      { name: "space/4", type: "FLOAT", value: 16 },
      { name: "radius/md", type: "FLOAT", value: 8 },
    ],
  });
  await run("upsert_text_styles", {
    styles: [{ name: "body/md", family: "Inter", style: "Regular", size: { raw: 14, reason: "r" }, lineHeight: { raw: 20, reason: "r" } }],
  });
});

const spacing = { gap: { var: "space/4" }, padding: { var: "space/4" } };

describe("create_section", () => {
  it("creates a named section with position and size", async () => {
    const r: any = await run("create_section", { name: "Onboarding", x: 10, y: 20, width: 800, height: 600 });
    expect(r.ok).toBe(true);
    const n = fake.nodes.get(r.data.id)!;
    expect(n).toMatchObject({ type: "SECTION", name: "Onboarding", x: 10, y: 20, width: 800, height: 600 });
  });
});

describe("create_frame", () => {
  it("defaults to VERTICAL auto layout when layout is omitted", async () => {
    const r: any = await run("create_frame", { name: "Card" });
    expect(r.ok).toBe(true);
    expect(fake.nodes.get(r.data.id)).toMatchObject({ name: "Card", layoutMode: "VERTICAL" });
  });

  it("defaults mode to VERTICAL when layout has no mode, and binds gap and padding variables", async () => {
    const r: any = await run("create_frame", { name: "Card", layout: spacing });
    const n: any = fake.nodes.get(r.data.id);
    expect(n.layoutMode).toBe("VERTICAL");
    expect(n.boundVariables.itemSpacing).toBeDefined();
    for (const f of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) expect(n.boundVariables[f]).toBeDefined();
  });

  it("rejects FILL sizing without an auto layout parent and creates nothing", async () => {
    const before = fake.nodes.size;
    const r: any = await run("create_frame", { name: "A", layout: { sizing: { horizontal: "FILL" } } });
    expect(r).toMatchObject({ ok: false, code: "RULE_VIOLATION" });
    expect(r.hint).toContain("auto layout parent");
    expect(fake.nodes.size).toBe(before);
    const p: any = await run("create_frame", { name: "P" });
    const ok: any = await run("create_frame", { name: "A", parentId: p.data.id, layout: { sizing: { horizontal: "FILL" } } });
    expect(ok.ok).toBe(true);
  });

  it("accepts four paddings, alignment and sizing", async () => {
    const p = { var: "space/4" };
    const parent: any = await run("create_frame", { name: "Host" });
    const r: any = await run("create_frame", {
      parentId: parent.data.id,
      name: "Row",
      layout: { mode: "HORIZONTAL", gap: p, padding: [p, { raw: 3, reason: "optical" }, p, p], primaryAlign: "SPACE_BETWEEN", counterAlign: "CENTER", sizing: { horizontal: "FILL", vertical: "HUG" } },
    });
    const n: any = fake.nodes.get(r.data.id);
    expect(n).toMatchObject({ layoutMode: "HORIZONTAL", primaryAxisAlignItems: "SPACE_BETWEEN", counterAxisAlignItems: "CENTER", paddingRight: 3 });
    expect(n.layoutSizingHorizontal).toBe("FILL");
    expect(n.layoutSizingVertical).toBe("HUG");
  });

  it("binds fill and radius variables", async () => {
    const r: any = await run("create_frame", { name: "Card", fill: { var: "color/bg/default" }, radius: { var: "radius/md" } });
    const n: any = fake.nodes.get(r.data.id);
    expect(n.fills[0].boundVariables.color).toBeDefined();
    expect(n.boundVariables.topLeftRadius).toBeDefined();
  });

  it("records raw reasons per field as JSON", async () => {
    const r: any = await run("create_frame", {
      name: "Card",
      fill: { raw: "#123456", reason: "brand gradient stop" },
      layout: { gap: { raw: 5, reason: "legacy spec" }, padding: [{ var: "space/4" }, { raw: 3, reason: "optical" }, { var: "space/4" }, { raw: 3, reason: "optical" }] },
    });
    const n = fake.nodes.get(r.data.id)!;
    expect(JSON.parse(n.getPluginData(EXCEPTION_KEY))).toEqual({ gap: "legacy spec", padding: "optical", fill: "brand gradient stop" });
    expect((n as any).itemSpacing).toBe(5);
  });

  it("leaves no fill when fill is omitted (Figma's default white is removed)", async () => {
    const r: any = await run("create_frame", { name: "Card" });
    expect(fake.nodes.get(r.data.id)!.fills).toEqual([]);
  });

  it("accepts a layout with only a mode (gap and padding optional)", async () => {
    const r: any = await run("create_frame", { name: "Row", layout: { mode: "HORIZONTAL" } });
    expect(r.ok).toBe(true);
    expect(fake.nodes.get(r.data.id)!.getPluginData(EXCEPTION_KEY)).toBe("");
  });

  it("rejects layout.mode NONE without absolute.reason and creates nothing", async () => {
    const before = fake.page.children.length;
    const r: any = await run("create_frame", { name: "Free", layout: { mode: "NONE", ...spacing } });
    expect(r).toMatchObject({ ok: false, code: "RULE_VIOLATION" });
    expect(fake.page.children.length).toBe(before);
  });

  it("allows NONE with a reason and stores it as the exception", async () => {
    const r: any = await run("create_frame", { name: "Free", layout: { mode: "NONE", ...spacing }, absolute: { reason: "overlay badge" } });
    const n = fake.nodes.get(r.data.id)!;
    expect((n as any).layoutMode).toBe("NONE");
    expect(JSON.parse(n.getPluginData(EXCEPTION_KEY))).toEqual({ absolute: "overlay badge" });
  });

  it("puts the frame into parentId, and fails on a missing variable without leaving a node", async () => {
    const s: any = await run("create_section", { name: "S" });
    const ok: any = await run("create_frame", { name: "In", parentId: s.data.id });
    expect(fake.nodes.get(ok.data.id)!.parent!.id).toBe(s.data.id);
    const count = fake.nodes.size;
    const bad: any = await run("create_frame", { name: "Bad", fill: { var: "color/nope" } });
    expect(bad).toMatchObject({ ok: false, code: "VARIABLE_NOT_FOUND" });
    expect(fake.nodes.size).toBe(count);
    const nf: any = await run("create_frame", { name: "X", parentId: "9:9" });
    expect(nf.code).toBe("NODE_NOT_FOUND");
  });
});

describe("create_text", () => {
  it("applies the named text style and characters", async () => {
    const f: any = await run("create_frame", { name: "Card" });
    const r: any = await run("create_text", { parentId: f.data.id, text: "Hello", textStyle: "body/md" });
    expect(r.ok).toBe(true);
    const n: any = fake.nodes.get(r.data.id);
    expect(n.characters).toBe("Hello");
    expect(n.textStyleId).toBe(fake.textStyles[0].id);
    expect(n.parent.id).toBe(f.data.id);
  });

  it("keeps Figma's default black fill when fill is omitted", async () => {
    const f: any = await run("create_frame", { name: "Card" });
    const r: any = await run("create_text", { parentId: f.data.id, text: "Hello", textStyle: "body/md" });
    expect(fake.nodes.get(r.data.id)!.fills).toEqual([{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }]);
  });

  it("binds a fill variable, or records a raw fill reason", async () => {
    const f: any = await run("create_frame", { name: "Card" });
    const a: any = await run("create_text", { parentId: f.data.id, text: "A", textStyle: "body/md", fill: { var: "color/bg/default" } });
    const na: any = fake.nodes.get(a.data.id);
    expect(na.fills[0].boundVariables.color).toBeDefined();
    expect(na.getPluginData(EXCEPTION_KEY)).toBe("");
    const b: any = await run("create_text", { parentId: f.data.id, text: "B", textStyle: "body/md", fill: { raw: "#FF0000", reason: "brand logo red" } });
    const nb: any = fake.nodes.get(b.data.id);
    expect(nb.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 }]);
    expect(JSON.parse(nb.getPluginData(EXCEPTION_KEY))).toEqual({ fill: "brand logo red" });
    const count = fake.nodes.size;
    const bad: any = await run("create_text", { parentId: f.data.id, text: "C", textStyle: "body/md", fill: { var: "color/nope" } });
    expect(bad).toMatchObject({ ok: false, code: "VARIABLE_NOT_FOUND" });
    expect(fake.nodes.size).toBe(count);
  });

  it("rejects missing textStyle with INVALID_INPUT", async () => {
    const f: any = await run("create_frame", { name: "Card" });
    const r: any = await run("create_text", { parentId: f.data.id, text: "Hello" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("reports STYLE_NOT_FOUND with nearest names", async () => {
    const f: any = await run("create_frame", { name: "Card" });
    const r: any = await run("create_text", { parentId: f.data.id, text: "Hi", textStyle: "body/mdd" });
    expect(r).toMatchObject({ ok: false, code: "STYLE_NOT_FOUND" });
    expect(r.hint).toContain("body/md");
  });

  it("reports FONT_NOT_AVAILABLE when the style font cannot load", async () => {
    fake.textStyles[0].fontName = { family: "Inter", style: "Regular" };
    // Simulate a font removed after the style was made.
    (fake.figma as any).loadFontAsync = async () => {
      throw new Error("missing");
    };
    const f: any = await run("create_frame", { name: "Card" });
    const r: any = await run("create_text", { parentId: f.data.id, text: "Hi", textStyle: "body/md" });
    expect(r).toMatchObject({ ok: false, code: "FONT_NOT_AVAILABLE" });
    expect(r.hint).toContain("restart");
  });
});

describe("create_component and properties", () => {
  it("rejects a non PascalCase name", async () => {
    const r: any = await run("create_component", { name: "button" });
    expect(r).toMatchObject({ ok: false, code: "RULE_VIOLATION" });
    expect(r.hint).toContain("Button");
  });

  it("creates a component and adds a camelCase property", async () => {
    const c: any = await run("create_component", { name: "Button/Primary" });
    expect(c.ok).toBe(true);
    const p: any = await run("add_component_property", { componentId: c.data.id, name: "isDisabled", type: "BOOLEAN", default: false });
    expect(p.ok).toBe(true);
    const bad: any = await run("add_component_property", { componentId: c.data.id, name: "Disabled", type: "BOOLEAN", default: false });
    expect(bad).toMatchObject({ ok: false, code: "RULE_VIOLATION" });
  });

  it("rejects VARIANT: variants are made by hand in Figma for v1", async () => {
    const c: any = await run("create_component", { name: "Button" });
    const r: any = await run("add_component_property", { componentId: c.data.id, name: "size", type: "VARIANT", default: "large" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(r.hint).toContain("Combine as variants");
    expect(fake.nodes.get(c.data.id)!.componentPropertyDefinitions).toEqual({});
  });

  it("rejects a property default of the wrong type", async () => {
    const c: any = await run("create_component", { name: "Button" });
    const r: any = await run("add_component_property", { componentId: c.data.id, name: "disabled", type: "BOOLEAN", default: "no" });
    expect(r.code).toBe("INVALID_INPUT");
  });
});

describe("add_component_property links the property to a layer", () => {
  const refs = (id: string) => (fake.nodes.get(id) as any).componentPropertyReferences;

  it("links a TEXT property to the only text layer", async () => {
    const c: any = await run("create_component", { name: "Button" });
    const t: any = await run("create_text", { parentId: c.data.id, text: "Go", textStyle: "body/md" });
    const p: any = await run("add_component_property", { componentId: c.data.id, name: "label", type: "TEXT", default: "Go" });
    expect(p.data).toEqual({ id: c.data.id, key: p.data.key, linkedLayerId: t.data.id });
    expect(refs(t.data.id)).toEqual({ characters: p.data.key });
  });

  it("asks for layerId when there are several text layers, before adding anything", async () => {
    const c: any = await run("create_component", { name: "Card" });
    const a: any = await run("create_text", { parentId: c.data.id, text: "Title", textStyle: "body/md" });
    const b: any = await run("create_text", { parentId: c.data.id, text: "Body", textStyle: "body/md" });
    const r: any = await run("add_component_property", { componentId: c.data.id, name: "title", type: "TEXT", default: "Title" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(r.hint).toContain(a.data.id);
    expect(r.hint).toContain(b.data.id);
    expect(fake.nodes.get(c.data.id)!.componentPropertyDefinitions).toEqual({});
    const ok: any = await run("add_component_property", { componentId: c.data.id, name: "title", type: "TEXT", default: "Title", layerId: a.data.id });
    expect(ok.data.linkedLayerId).toBe(a.data.id);
    expect(refs(a.data.id)).toEqual({ characters: ok.data.key });
    expect(refs(b.data.id)).toBeUndefined();
  });

  it("refuses a TEXT property when the component has no text layer", async () => {
    const c: any = await run("create_component", { name: "Icon" });
    const r: any = await run("add_component_property", { componentId: c.data.id, name: "label", type: "TEXT", default: "Go" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(r.hint).toContain("create_text");
  });

  it("links BOOLEAN to visibility and INSTANCE_SWAP to the instance only when layerId is given", async () => {
    const icon: any = await run("create_component", { name: "Icon" });
    const c: any = await run("create_component", { name: "Button" });
    const i: any = await run("create_instance", { componentName: "Icon", parentId: c.data.id });
    const b: any = await run("add_component_property", { componentId: c.data.id, name: "hasIcon", type: "BOOLEAN", default: true, layerId: i.data.id });
    const s: any = await run("add_component_property", { componentId: c.data.id, name: "icon", type: "INSTANCE_SWAP", default: icon.data.id, layerId: i.data.id });
    expect(refs(i.data.id)).toEqual({ visible: b.data.key, mainComponent: s.data.key });
    const plain: any = await run("add_component_property", { componentId: c.data.id, name: "isActive", type: "BOOLEAN", default: false });
    expect(plain.data).toEqual({ id: c.data.id, key: plain.data.key });
  });

  it("rejects a layerId outside the component or of the wrong type", async () => {
    const c: any = await run("create_component", { name: "Button" });
    const inside: any = await run("create_text", { parentId: c.data.id, text: "Go", textStyle: "body/md" });
    const f: any = await run("create_frame", { name: "Elsewhere" });
    const outside: any = await run("create_text", { parentId: f.data.id, text: "x", textStyle: "body/md" });
    const r1: any = await run("add_component_property", { componentId: c.data.id, name: "label", type: "TEXT", default: "Go", layerId: outside.data.id });
    expect(r1).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const r2: any = await run("add_component_property", { componentId: c.data.id, name: "icon", type: "INSTANCE_SWAP", default: c.data.id, layerId: inside.data.id });
    expect(r2).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(fake.nodes.get(c.data.id)!.componentPropertyDefinitions).toEqual({});
  });
});

describe("create_instance and set_instance_properties", () => {
  it("instantiates by component name and sets properties by plain name", async () => {
    const c: any = await run("create_component", { name: "Button" });
    await run("create_text", { parentId: c.data.id, text: "Go", textStyle: "body/md" });
    await run("add_component_property", { componentId: c.data.id, name: "label", type: "TEXT", default: "Go" });
    const f: any = await run("create_frame", { name: "Card" });
    const i: any = await run("create_instance", { componentName: "Button", parentId: f.data.id });
    expect(i.ok).toBe(true);
    expect(fake.nodes.get(i.data.id)!.parent!.id).toBe(f.data.id);
    const s: any = await run("set_instance_properties", { id: i.data.id, props: { label: "Save" } });
    expect(s.ok).toBe(true);
    const props = (fake.nodes.get(i.data.id) as any).componentProperties;
    expect(Object.values(props).map((p: any) => p.value)).toContain("Save");
    const bad: any = await run("set_instance_properties", { id: i.data.id, props: { nope: "x" } });
    expect(bad.code).toBe("INVALID_INPUT");
  });

  it("reports NODE_NOT_FOUND with nearest names for an unknown component", async () => {
    await run("create_component", { name: "Button" });
    const f: any = await run("create_frame", { name: "Card" });
    const r: any = await run("create_instance", { componentName: "Buton", parentId: f.data.id });
    expect(r).toMatchObject({ ok: false, code: "NODE_NOT_FOUND" });
    expect(r.hint).toContain("Button");
  });
});

describe("create_instance page loading", () => {
  it("loads all pages before searching the document", async () => {
    await run("create_component", { name: "Button" });
    const f: any = await run("create_frame", { name: "Card" });
    expect(() => fake.figma.root.findAllWithCriteria({ types: ["COMPONENT"] })).toThrow();
    const i: any = await run("create_instance", { componentName: "Button", parentId: f.data.id });
    expect(i.ok).toBe(true);
  });
});
