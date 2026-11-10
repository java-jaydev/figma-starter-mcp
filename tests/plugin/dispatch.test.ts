import { beforeEach, describe, expect, it } from "vitest";
import type { CommandName } from "../../src/shared/protocol.ts";
import { installFakeFigma, type FakeFigma } from "../fake-figma.ts";
import { PluginError, dispatch, register, type Ctx } from "../../src/plugin/dispatch.ts";

const ctx: Ctx = { confirm: async () => true };
let fake: FakeFigma;

beforeEach(() => {
  fake = installFakeFigma();
});

describe("dispatch", () => {
  it("answers an unknown command with INVALID_INPUT", async () => {
    const res = await dispatch({ id: "1", name: "no_such_command" as CommandName, args: {} }, ctx);
    expect(res).toMatchObject({ id: "1", ok: false, code: "INVALID_INPUT" });
    expect(res.ok === false && res.message).toContain("no_such_command");
    expect(fake.commitUndoCalls).toBe(0);
  });

  it("maps a PluginError to the same code, message and hint", async () => {
    register("rename", async () => {
      throw new PluginError("NODE_NOT_FOUND", "Node 9:9 not found in Test File", "Read the page again");
    });
    const res = await dispatch({ id: "2", name: "rename", args: {} }, ctx);
    expect(res).toEqual({
      id: "2",
      ok: false,
      code: "NODE_NOT_FOUND",
      message: "Node 9:9 not found in Test File",
      hint: "Read the page again",
    });
    expect(fake.commitUndoCalls).toBe(0);
  });

  it("calls commitUndo once after a successful handler and returns its data", async () => {
    register("move", async (args) => ({ moved: args }));
    const res = await dispatch({ id: "3", name: "move", args: { x: 1 } }, ctx);
    expect(res).toEqual({ id: "3", ok: true, data: { moved: { x: 1 } } });
    expect(fake.commitUndoCalls).toBe(1);
  });

  it("reports an unexpected throw without crashing", async () => {
    register("resize", async () => {
      throw new TypeError("boom");
    });
    const res = await dispatch({ id: "4", name: "resize", args: {} }, ctx);
    expect(res).toMatchObject({ id: "4", ok: false, code: "INVALID_INPUT", message: "boom" });
  });

  it("passes ctx through so a handler can ask for confirmation", async () => {
    register("delete_nodes", async (_args, c) => {
      if (!(await c.confirm("Delete 6 nodes"))) throw new PluginError("USER_DECLINED", "Declined in Figma");
      return { deleted: 6 };
    });
    const no = await dispatch({ id: "5", name: "delete_nodes", args: {} }, { confirm: async () => false });
    expect(no).toMatchObject({ ok: false, code: "USER_DECLINED" });
  });
});
