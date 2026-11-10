import { beforeEach, describe, expect, it } from "vitest";
import { dispatch, type Ctx } from "../../src/plugin/dispatch.ts";
import "../../src/plugin/commands/read.ts";
import { summarize } from "../../src/plugin/summarize.ts";
import { installFakeFigma, type FakeFigma } from "../fake-figma.ts";
import type { NodeSummary } from "../../src/shared/summary.ts";

const ctx: Ctx = { confirm: async () => true };
let fake: FakeFigma;
const run = (name: any, args: unknown = {}) => dispatch({ id: "t", name, args }, ctx);
const rgb = (r: number, g: number, b: number) => ({ type: "SOLID", color: { r, g, b }, opacity: 1 });
const totalOmitted = (s: NodeSummary): number => (s.omitted ?? 0) + (s.children ?? []).reduce((a, c) => a + totalOmitted(c), 0);
const count = (s: NodeSummary): number => 1 + (s.children ?? []).reduce((a, c) => a + count(c), 0);

beforeEach(() => {
  fake = installFakeFigma({ fileName: "Design File" });
});

describe("summarize", () => {
  it("summarizes a bound fill as a variable name", async () => {
    const v = fake.figma.variables.createVariable("color/bg/default", fake.figma.variables.createVariableCollection("c"), "COLOR");
    const f = fake.figma.createFrame() as any;
    f.fills = [rgb(1, 1, 1)];
    f.boundVariables = { fills: [{ type: "VARIABLE_ALIAS", id: v.id }] };
    const s = await summarize(f, { maxDepth: 4, maxNodes: 300 });
    expect(s.fills).toEqual([{ var: "color/bg/default" }]);
  });

  it("summarizes a raw fill as uppercase hex, with alpha when below 1", async () => {
    const f = fake.figma.createFrame() as any;
    f.fills = [rgb(0x4f / 255, 0x46 / 255, 0xe5 / 255), { ...rgb(0, 0, 0), opacity: 0.5 }];
    const s = await summarize(f, { maxDepth: 4, maxNodes: 300 });
    expect(s.fills).toEqual([{ raw: "#4F46E5" }, { raw: "#00000080" }]);
  });

  it("always emits layout for frames, with mode NONE when there is no auto layout", async () => {
    const f = fake.figma.createFrame() as any;
    expect((await summarize(f, { maxDepth: 4, maxNodes: 300 })).layout).toEqual({ mode: "NONE" });
    f.layoutMode = "VERTICAL";
    f.itemSpacing = 8;
    f.paddingTop = 4;
    f.paddingRight = 5;
    f.paddingBottom = 6;
    f.paddingLeft = 7;
    const s = await summarize(f, { maxDepth: 4, maxNodes: 300 });
    expect(s.layout).toMatchObject({ mode: "VERTICAL", gap: { raw: 8 }, padding: [{ raw: 4 }, { raw: 5 }, { raw: 6 }, { raw: 7 }] });
  });

  it("reports per-field exceptions from plugin data, and a legacy string as *", async () => {
    const f = fake.figma.createFrame();
    f.setPluginData("fsm.exception", JSON.stringify({ fill: "brand", gap: "legacy spec" }));
    expect((await summarize(f as any, { maxDepth: 4, maxNodes: 300 })).exceptions).toEqual({ fill: "brand", gap: "legacy spec" });
    f.setPluginData("fsm.exception", "legacy banner");
    expect((await summarize(f as any, { maxDepth: 4, maxNodes: 300 })).exceptions).toEqual({ "*": "legacy banner" });
    f.setPluginData("fsm.exception", "");
    expect((await summarize(f as any, { maxDepth: 4, maxNodes: 300 })).exceptions).toBeUndefined();
  });

  it("caps nodes at maxNodes and reports 100 omitted for a 400-node tree", async () => {
    const root = fake.figma.createFrame();
    for (let i = 0; i < 399; i++) root.appendChild(fake.figma.createFrame());
    const s = await summarize(root as any, { maxDepth: 4, maxNodes: 300 });
    expect(count(s)).toBe(300);
    expect(totalOmitted(s)).toBe(100);
  });

  it("counts nodes below maxDepth as omitted", async () => {
    const a = fake.figma.createFrame();
    const b = fake.figma.createFrame();
    b.appendChild(fake.figma.createFrame());
    a.appendChild(b);
    const s = await summarize(a as any, { maxDepth: 1, maxNodes: 300 });
    expect(s.children).toHaveLength(1);
    expect(totalOmitted(s)).toBe(1);
  });

  it("summarizes an instance with component name and props, without #id key suffixes", async () => {
    const comp = fake.figma.createComponent();
    comp.name = "Button";
    const inst = fake.figma.createFrame() as any;
    inst.type = "INSTANCE";
    inst.getMainComponentAsync = async () => comp;
    inst.componentProperties = { "Label#1:0": { type: "TEXT", value: "Go" }, "Disabled#1:1": { type: "BOOLEAN", value: false } };
    const s = await summarize(inst, { maxDepth: 4, maxNodes: 300 });
    expect(s.component).toEqual({ name: "Button", props: { Label: "Go", Disabled: false } });
  });

  it("names a variant instance after its component set, with variant values as props", async () => {
    const large = fake.figma.createComponent() as any;
    large.name = "size=large, tone=primary";
    large.addComponentProperty("label", "TEXT", "Go");
    const small = fake.figma.createComponent() as any;
    small.name = "size=small, tone=primary";
    const set = (fake.figma as any).combineAsVariants([large, small], fake.page);
    set.name = "Button";
    const inst = large.createInstance();
    const s = await summarize(inst, { maxDepth: 4, maxNodes: 300 });
    expect(s.component).toEqual({ name: "Button", props: { size: "large", tone: "primary", label: "Go" } });
  });

  it("summarizes text with its content, style and size", async () => {
    await fake.figma.loadFontAsync({ family: "Inter", style: "Regular" });
    const t = fake.figma.createText() as any;
    t.characters = "Hello";
    t.fontSize = 16;
    const s = await summarize(t, { maxDepth: 4, maxNodes: 300 });
    expect(s).toMatchObject({ type: "TEXT", text: "Hello", fontSize: { raw: 16 } });
  });
});

describe("read commands", () => {
  it("status returns file, page and selection count", async () => {
    fake.page.selection = [fake.figma.createFrame()];
    expect(await run("status")).toMatchObject({ ok: true, data: { fileName: "Design File", pageName: "Page 1", selectionCount: 1 } });
  });

  it("read_selection summarizes the selection with defaults", async () => {
    const f = fake.figma.createFrame();
    f.name = "Card";
    fake.page.selection = [f];
    const res: any = await run("read_selection");
    expect(res.data).toMatchObject([{ id: f.id, name: "Card", type: "FRAME" }]);
  });

  it("read_nodes fails with NODE_NOT_FOUND naming the id and the file", async () => {
    const res: any = await run("read_nodes", { ids: ["9:9"] });
    expect(res).toMatchObject({ ok: false, code: "NODE_NOT_FOUND" });
    expect(res.message).toContain("9:9");
    expect(res.message).toContain("Design File");
  });

  it("read_nodes and read_page summarize nodes", async () => {
    const f = fake.figma.createFrame();
    expect(((await run("read_nodes", { ids: [f.id] })) as any).data[0].id).toBe(f.id);
    const page: any = await run("read_page");
    expect(page.data).toMatchObject({ type: "PAGE", name: "Page 1" });
    expect(page.data.children[0].id).toBe(f.id);
  });

  it("list_variables groups variables by collection and mode", async () => {
    const c = fake.figma.variables.createVariableCollection("Colors");
    const v = fake.figma.variables.createVariable("color/bg/default", c, "COLOR");
    v.setValueForMode(c.modes[0].modeId, { r: 1, g: 0, b: 0, a: 1 });
    const res: any = await run("list_variables");
    expect(res.data).toEqual({
      collections: [
        {
          name: "Colors",
          modes: ["Mode 1"],
          variables: [{ name: "color/bg/default", type: "COLOR", valuesByMode: { "Mode 1": "#FF0000" } }],
        },
      ],
    });
  });

  it("list_styles returns text styles", async () => {
    const s: any = fake.figma.createTextStyle();
    await fake.figma.loadFontAsync({ family: "Inter", style: "Regular" });
    s.name = "body/md";
    s.fontName = { family: "Inter", style: "Regular" };
    s.fontSize = 16;
    const res: any = await run("list_styles");
    expect(res.data.textStyles).toEqual([{ id: s.id, name: "body/md", fontFamily: "Inter", fontStyle: "Regular", fontSize: 16 }]);
  });

  it("list_components returns name, id and property definitions", async () => {
    const c = fake.figma.createComponent() as any;
    c.name = "Button";
    c.componentPropertyDefinitions = { "Label#1:0": { type: "TEXT", defaultValue: "Go" } };
    const res: any = await run("list_components");
    expect(res.data.components).toEqual([{ id: c.id, name: "Button", properties: { "Label#1:0": { type: "TEXT", defaultValue: "Go" } } }]);
  });

  it("export_node returns base64 and defaults to scale 2", async () => {
    const f = fake.figma.createFrame() as any;
    let seen: any;
    f.exportAsync = async (o: unknown) => {
      seen = o;
      return new Uint8Array([72, 105]);
    };
    const res: any = await run("export_node", { id: f.id, format: "PNG" });
    expect(res.data).toEqual({ format: "PNG", base64: "SGk=" });
    expect(seen).toEqual({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
    f.exportAsync = async (o: unknown) => ((seen = o), new Uint8Array([60]));
    await run("export_node", { id: f.id, format: "SVG" });
    expect(seen).toEqual({ format: "SVG" });
  });

  it("export_node on a missing id is NODE_NOT_FOUND", async () => {
    expect(await run("export_node", { id: "0:0", format: "PNG" })).toMatchObject({ ok: false, code: "NODE_NOT_FOUND" });
  });

  it("read commands add no extra undo commits beyond dispatch's one", async () => {
    await run("status");
    expect(fake.commitUndoCalls).toBe(1);
  });
});
