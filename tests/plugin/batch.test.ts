import { beforeEach, describe, expect, it } from "vitest";
import { dispatch, type Ctx } from "../../src/plugin/dispatch.ts";
import "../../src/plugin/commands/tokens.ts";
import "../../src/plugin/commands/structure.ts";
import "../../src/plugin/commands/edit.ts";
import "../../src/plugin/commands/batch.ts";
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
const frame = async (name: string): Promise<string> => ((await run("create_frame", { name })) as any).data.id;

beforeEach(() => {
  fake = installFakeFigma();
  confirms = [];
  answer = true;
});

describe("batch", () => {
  it("asks once for a 6-node delete and runs nothing on decline", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await frame(`F${i}`));
    answer = false;
    const before = fake.commitUndoCalls;
    const r: any = await run("batch", { commands: [{ name: "rename", args: { id: ids[0], name: "Renamed" } }, { name: "delete_nodes", args: { ids } }] });
    expect(r).toMatchObject({ ok: false, code: "USER_DECLINED" });
    expect(confirms).toHaveLength(1);
    expect(fake.nodes.get(ids[0])!.name).toBe("F0");
    expect(fake.nodes.get(ids[0])!.removed).not.toBe(true);
    expect(fake.commitUndoCalls).toBe(before);
  });

  it("asks once on approve, does not re-ask in the nested delete, and commits one undo step", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await frame(`F${i}`));
    const before = fake.commitUndoCalls;
    const r: any = await run("batch", { commands: [{ name: "rename", args: { id: ids[0], name: "Hero" } }, { name: "delete_nodes", args: { ids: ids.slice(1) } }] });
    expect(r.ok).toBe(true);
    expect(r.data.ok).toBe(true);
    expect(confirms).toHaveLength(1);
    expect(r.data.results.map((x: any) => x.ok)).toEqual([true, true]);
    expect(fake.commitUndoCalls).toBe(before + 1);
  });

  it("stops at the first error and marks the rest not run", async () => {
    const a = await frame("A");
    const r: any = await run("batch", {
      commands: [
        { name: "rename", args: { id: a, name: "One" } },
        { name: "rename", args: { id: "9:9", name: "Two" } },
        { name: "rename", args: { id: a, name: "Three" } },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.data.ok).toBe(false);
    const [i1, i2, i3] = r.data.results;
    expect(i1).toMatchObject({ index: 0, ok: true });
    expect(i2).toMatchObject({ index: 1, ok: false, code: "NODE_NOT_FOUND" });
    expect(i3).toMatchObject({ index: 2, ok: false, notRun: true });
    expect(fake.nodes.get(a)!.name).toBe("One");
  });

  it("rejects a nested batch", async () => {
    const r: any = await run("batch", { commands: [{ name: "batch", args: { commands: [] } }] });
    expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("confirms a mixed id list that includes a not-yet-existing id (bypass a)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await frame(`F${i}`));
    answer = false;
    const r: any = await run("batch", { commands: [{ name: "delete_nodes", args: { ids: ["9:9", ...ids] } }] });
    expect(r).toMatchObject({ ok: false, code: "USER_DECLINED" });
    expect(confirms).toHaveLength(1);
    expect(ids.every((id) => fake.nodes.has(id))).toBe(true);
  });

  it("confirms a mixed list with an existing component (bypass a, component)", async () => {
    const c: any = await run("create_component", { name: "Button" });
    answer = false;
    const r: any = await run("batch", { commands: [{ name: "delete_nodes", args: { ids: ["9:9", c.data.id] } }] });
    expect(r).toMatchObject({ ok: false, code: "USER_DECLINED" });
    expect(fake.nodes.get(c.data.id)!.removed).not.toBe(true);
  });

  it("asks at run time when an earlier item moves a component into a deleted frame (bypass b)", async () => {
    const c: any = await run("create_component", { name: "Button" });
    const x = await frame("X");
    answer = false;
    const r: any = await run("batch", { commands: [{ name: "move", args: { id: c.data.id, parentId: x } }, { name: "delete_nodes", args: { ids: [x] } }, { name: "rename", args: { id: x, name: "After" } }] });
    expect(confirms).toHaveLength(1);
    expect(r.data.results[0]).toMatchObject({ ok: true });
    expect(r.data.results[1]).toMatchObject({ ok: false, code: "USER_DECLINED" });
    expect(r.data.results[2]).toMatchObject({ notRun: true });
    expect(fake.nodes.get(x)!.removed).not.toBe(true);
  });

  it("counts deletes across items (bypass c) and asks once when approved", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await frame(`F${i}`));
    answer = false;
    const declined: any = await run("batch", { commands: [{ name: "delete_nodes", args: { ids: ids.slice(0, 3) } }, { name: "delete_nodes", args: { ids: ids.slice(3) } }] });
    expect(declined).toMatchObject({ ok: false, code: "USER_DECLINED" });
    expect(ids.every((id) => fake.nodes.has(id))).toBe(true);
    confirms.length = 0;
    answer = true;
    const r: any = await run("batch", { commands: [{ name: "delete_nodes", args: { ids: ids.slice(0, 3) } }, { name: "delete_nodes", args: { ids: ids.slice(3) } }] });
    expect(r.data.ok).toBe(true);
    expect(confirms).toHaveLength(1);
  });

  it("asks once up front for a frame with 60 descendants", async () => {
    const a = await frame("Screen");
    for (let i = 0; i < 60; i++) fake.nodes.get(a)!.appendChild(fake.figma.createFrame());
    answer = false;
    const r: any = await run("batch", { commands: [{ name: "delete_nodes", args: { ids: [a] } }] });
    expect(r).toMatchObject({ ok: false, code: "USER_DECLINED" });
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("61 layers");
  });

  it("counts layers across items and asks when an earlier item grows a deleted frame", async () => {
    const x = await frame("X");
    const y = await frame("Y");
    for (let i = 0; i < 10; i++) fake.nodes.get(x)!.appendChild(fake.figma.createFrame());
    for (let i = 0; i < 45; i++) fake.nodes.get(y)!.appendChild(fake.figma.createFrame());
    answer = false;
    const r: any = await run("batch", { commands: [{ name: "move", args: { id: y, parentId: x } }, { name: "delete_nodes", args: { ids: [x] } }] });
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("57 layers");
    expect(r.data.results[1]).toMatchObject({ ok: false, code: "USER_DECLINED" });
    expect(fake.nodes.has(x)).toBe(true);

    // Two items of 30 layers each: 60 in total, asked once before anything runs.
    const p = await frame("P");
    const q = await frame("Q");
    for (let i = 0; i < 29; i++) fake.nodes.get(p)!.appendChild(fake.figma.createFrame());
    for (let i = 0; i < 29; i++) fake.nodes.get(q)!.appendChild(fake.figma.createFrame());
    confirms.length = 0;
    answer = true;
    const ok: any = await run("batch", { commands: [{ name: "delete_nodes", args: { ids: [p] } }, { name: "delete_nodes", args: { ids: [q] } }] });
    expect(ok.data.ok).toBe(true);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("60 layers");
  });

  it("rejects malformed delete args and bad command lists", async () => {
    expect(((await run("batch", { commands: [{ name: "delete_nodes", args: {} }] })) as any).code).toBe("INVALID_INPUT");
    expect(((await run("batch", { commands: "x" })) as any).code).toBe("INVALID_INPUT");
    const many = Array.from({ length: 101 }, () => ({ name: "rename", args: { id: "1:1", name: "A" } }));
    expect(((await run("batch", { commands: many })) as any).code).toBe("INVALID_INPUT");
  });
});
