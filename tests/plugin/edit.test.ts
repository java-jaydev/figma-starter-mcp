import { beforeEach, describe, expect, it } from "vitest";
import { dispatch, type Ctx } from "../../src/plugin/dispatch.ts";
import "../../src/plugin/commands/tokens.ts";
import "../../src/plugin/commands/structure.ts";
import "../../src/plugin/commands/edit.ts";
import { EXCEPTION_KEY } from "../../src/plugin/resolve.ts";
import { installFakeFigma, type FakeFigma } from "../fake-figma.ts";

let fake: FakeFigma;
let confirms: string[];
let answer: boolean;
const ctx: Ctx = {
  confirm: async (s) => {
    confirms.push(s);
    return answer;
  },
};
const run = (name: any, args: unknown = {}) => dispatch({ id: "t", name, args }, ctx);
const frame = async (name: string, parentId?: string): Promise<string> => ((await run("create_frame", { name, parentId })) as any).data.id;

beforeEach(async () => {
  fake = installFakeFigma();
  confirms = [];
  answer = true;
  await run("upsert_variables", { collection: "T", variables: [{ name: "space/4", type: "FLOAT", value: 16 }] });
});

describe("rename", () => {
  it("renames, and rejects default layer names", async () => {
    const id = await frame("Card");
    expect(((await run("rename", { id, name: "Hero" })) as any).ok).toBe(true);
    expect(fake.nodes.get(id)!.name).toBe("Hero");
    const r: any = await run("rename", { id, name: "Frame 12" });
    expect(r).toMatchObject({ ok: false, code: "RULE_VIOLATION" });
    expect(fake.nodes.get(id)!.name).toBe("Hero");
    expect(((await run("rename", { id: "9:9", name: "X" })) as any).code).toBe("NODE_NOT_FOUND");
  });
});

describe("move and resize", () => {
  it("moves to a new parent at an index and sets position", async () => {
    const a = await frame("A");
    const b = await frame("B");
    const c = await frame("C", a);
    const d = await frame("D", a);
    const r: any = await run("move", { id: b, parentId: a, index: 0, x: 4, y: 5 });
    expect(r.ok).toBe(true);
    expect(fake.nodes.get(a)!.children.map((n) => n.id)).toEqual([b, c, d]);
    expect(fake.nodes.get(b)).toMatchObject({ x: 4, y: 5 });
  });

  it("resizes one dimension and keeps the other", async () => {
    const a = await frame("A");
    await run("resize", { id: a, width: 300 });
    expect(fake.nodes.get(a)).toMatchObject({ width: 300, height: 100 });
  });
});

describe("resize sizing", () => {
  it("keeps an untouched HUG axis HUG", async () => {
    const p = await frame("P");
    const r: any = await run("create_frame", { name: "A", parentId: p, layout: { sizing: { horizontal: "FILL", vertical: "HUG" } } });
    await run("resize", { id: r.data.id, width: 300 });
    const n: any = fake.nodes.get(r.data.id);
    expect(n.width).toBe(300);
    expect(n.layoutSizingVertical).toBe("HUG");
    expect(n.layoutSizingHorizontal).toBe("FIXED");
  });
});

describe("set_auto_layout", () => {
  it("applies layout to an existing frame", async () => {
    const a = await frame("A");
    const r: any = await run("set_auto_layout", { id: a, layout: { mode: "HORIZONTAL", gap: { var: "space/4" }, padding: { raw: 7, reason: "tight" } } });
    expect(r.ok).toBe(true);
    const n: any = fake.nodes.get(a);
    expect(n.layoutMode).toBe("HORIZONTAL");
    expect(n.paddingLeft).toBe(7);
    expect(JSON.parse(n.getPluginData(EXCEPTION_KEY))).toEqual({ padding: "tight" });
  });

  it("merges reasons with existing ones and clears fields it binds to variables", async () => {
    const r: any = await run("create_frame", { name: "A", fill: { raw: "#123456", reason: "brand" }, layout: { gap: { raw: 5, reason: "legacy" } } });
    const a = r.data.id;
    await run("set_auto_layout", { id: a, layout: { mode: "HORIZONTAL", gap: { var: "space/4" }, padding: { raw: 7, reason: "tight" } } });
    expect(JSON.parse(fake.nodes.get(a)!.getPluginData(EXCEPTION_KEY))).toEqual({ fill: "brand", padding: "tight" });
    await run("set_auto_layout", { id: a, layout: { mode: "NONE" }, absolute: { reason: "overlay" } });
    expect(JSON.parse(fake.nodes.get(a)!.getPluginData(EXCEPTION_KEY))).toEqual({ fill: "brand", padding: "tight", absolute: "overlay" });
    await run("set_auto_layout", { id: a, layout: { mode: "VERTICAL", padding: { var: "space/4" } } });
    expect(JSON.parse(fake.nodes.get(a)!.getPluginData(EXCEPTION_KEY))).toEqual({ fill: "brand" });
  });

  it("requires a reason for NONE", async () => {
    const a = await frame("A");
    const r: any = await run("set_auto_layout", { id: a, layout: { mode: "NONE", gap: { var: "space/4" }, padding: { var: "space/4" } } });
    expect(r.code).toBe("RULE_VIOLATION");
  });
});

describe("delete_nodes", () => {
  it("asks for confirmation at 5 nodes and deletes nothing when declined", async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await frame(`Card${i}`));
    answer = false;
    const r: any = await run("delete_nodes", { ids });
    expect(r).toMatchObject({ ok: false, code: "USER_DECLINED" });
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("5");
    expect(ids.every((id) => fake.nodes.has(id))).toBe(true);
  });

  it("deletes 5 nodes once approved", async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await frame(`Card${i}`));
    const r: any = await run("delete_nodes", { ids });
    expect(r.ok).toBe(true);
    expect(ids.some((id) => fake.nodes.has(id))).toBe(false);
  });

  it("confirms when deleting a component", async () => {
    const c: any = await run("create_component", { name: "Button" });
    await run("delete_nodes", { ids: [c.data.id] });
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("COMPONENT");
  });

  it("does not confirm for 2 frames", async () => {
    const ids = [await frame("A"), await frame("B")];
    const r: any = await run("delete_nodes", { ids });
    expect(r.ok).toBe(true);
    expect(confirms).toHaveLength(0);
  });

  it("dedupes ids and reports nodes actually removed", async () => {
    const a = await frame("A");
    const r: any = await run("delete_nodes", { ids: [a, a, a, a, a] });
    expect(r).toMatchObject({ ok: true, data: { deleted: 1 } });
    expect(confirms).toHaveLength(0);
  });

  it("rejects PAGE and DOCUMENT nodes before deleting anything", async () => {
    const a = await frame("A");
    const r: any = await run("delete_nodes", { ids: [a, fake.page.id] });
    expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(fake.nodes.has(a)).toBe(true);
  });

  it("confirms when a deleted frame contains a component", async () => {
    const a = await frame("A");
    await run("create_component", { name: "Button", parentId: a });
    const r: any = await run("delete_nodes", { ids: [a] });
    expect(r.ok).toBe(true);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("nested components");
  });

  it("is all-or-nothing when an id is missing", async () => {
    const a = await frame("A");
    const r: any = await run("delete_nodes", { ids: [a, "9:9"] });
    expect(r).toMatchObject({ ok: false, code: "NODE_NOT_FOUND" });
    expect(fake.nodes.has(a)).toBe(true);
  });

  it("confirms a single frame with 60 descendants and names the layer count", async () => {
    const a = await frame("Screen");
    const host = fake.nodes.get(a)!;
    for (let i = 0; i < 60; i++) host.appendChild(fake.figma.createFrame());
    answer = false;
    const r: any = await run("delete_nodes", { ids: [a] });
    expect(r).toMatchObject({ ok: false, code: "USER_DECLINED" });
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("61 layers");
    expect(fake.nodes.has(a)).toBe(true);
  });

  it("does not confirm a single frame with 10 descendants", async () => {
    const a = await frame("Card");
    const host = fake.nodes.get(a)!;
    for (let i = 0; i < 10; i++) host.appendChild(fake.figma.createFrame());
    const r: any = await run("delete_nodes", { ids: [a] });
    expect(r.ok).toBe(true);
    expect(confirms).toHaveLength(0);
  });

  it("tolerates a child listed together with its deleted parent", async () => {
    const a = await frame("A");
    const b = await frame("B", a);
    const r: any = await run("delete_nodes", { ids: [a, b] });
    expect(r.ok).toBe(true);
  });
});
