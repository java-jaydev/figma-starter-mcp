// code.ts wires figma.ui messages to clientStorage, dispatch and the confirm dialog.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIRM_TIMEOUT_MS } from "../../src/shared/protocol.ts";
import { installFakeFigma, type FakeFigma } from "../fake-figma.ts";
import { PluginError, register } from "../../src/plugin/dispatch.ts";
import { SECRET_KEY } from "../../src/plugin/messages.ts";

let fake: FakeFigma;
let code: typeof import("../../src/plugin/code.ts");

beforeAll(async () => {
  fake = installFakeFigma({ fileName: "Design System" });
  fake.storage.set(SECRET_KEY, "s3cret");
  // code.ts runs its startup on import, so the fake must be in place first.
  code = await import("../../src/plugin/code.ts");
});

const last = () => fake.posted[fake.posted.length - 1];

describe("plugin main thread", () => {
  it("answers ready with the stored secret and the file name", async () => {
    await fake.fromUi({ type: "ready" });
    expect(last()).toEqual({ type: "init", secret: "s3cret", fileName: "Design System" });
  });

  it("stores a new secret and forgets it on unpair", async () => {
    await fake.fromUi({ type: "save-secret", secret: "fresh" });
    expect(fake.storage.get(SECRET_KEY)).toBe("fresh");
    await fake.fromUi({ type: "unpair" });
    expect(fake.storage.has(SECRET_KEY)).toBe(false);
    await fake.fromUi({ type: "ready" });
    expect(last()).toEqual({ type: "init", fileName: "Design System" });
  });

  it("runs a verified command and posts the result back", async () => {
    register("rename", async (args) => ({ renamed: args.name }));
    await fake.fromUi({ type: "cmd", cmd: { id: "c1", name: "rename", args: { name: "Card" } } });
    expect(last()).toEqual({ type: "res", res: { id: "c1", ok: true, data: { renamed: "Card" } } });
  });

  it("drives ctx.confirm through the UI dialog; Decline resolves false", async () => {
    register("delete_nodes", async (_args, ctx) => {
      if (!(await ctx.confirm("Delete 6 nodes"))) throw new PluginError("USER_DECLINED", "Declined in Figma");
      return { deleted: 6 };
    });
    const running = fake.fromUi({ type: "cmd", cmd: { id: "c2", name: "delete_nodes", args: {} } });
    await new Promise((r) => setTimeout(r, 0));
    const ask = last();
    expect(ask).toMatchObject({ type: "confirm", summary: "Delete 6 nodes" });
    await fake.fromUi({ type: "confirm-reply", id: ask.id, ok: false });
    await running;
    expect(last()).toMatchObject({ type: "res", res: { id: "c2", ok: false, code: "USER_DECLINED" } });

    const again = fake.fromUi({ type: "cmd", cmd: { id: "c3", name: "delete_nodes", args: {} } });
    await new Promise((r) => setTimeout(r, 0));
    await fake.fromUi({ type: "confirm-reply", id: last().id, ok: true });
    await again;
    expect(last()).toEqual({ type: "res", res: { id: "c3", ok: true, data: { deleted: 6 } } });
  });

  describe("confirm expiry", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("expires a confirm before the hub timeout; a late Approve does not run the write", async () => {
      vi.useFakeTimers();
      expect(code.CONFIRM_EXPIRY_MS).toBeLessThan(CONFIRM_TIMEOUT_MS);
      let writes = 0;
      register("delete_nodes", async (_args, ctx) => {
        if (!(await ctx.confirm("Delete 6 nodes"))) throw new PluginError("USER_DECLINED", "Declined in Figma");
        writes++;
        return { deleted: 6 };
      });
      const undoBefore = fake.commitUndoCalls;
      const running = fake.fromUi({ type: "cmd", cmd: { id: "c4", name: "delete_nodes", args: {} } });
      await vi.advanceTimersByTimeAsync(0);
      const ask = last();
      expect(ask).toMatchObject({ type: "confirm" });

      await vi.advanceTimersByTimeAsync(code.CONFIRM_EXPIRY_MS);
      await running;
      const tail = fake.posted.slice(-2);
      expect(tail[0]).toEqual({ type: "confirm-cancel", id: ask.id });
      expect(tail[1]).toMatchObject({ type: "res", res: { id: "c4", ok: false, code: "USER_DECLINED" } });

      const count = fake.posted.length;
      await fake.fromUi({ type: "confirm-reply", id: ask.id, ok: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.posted.length).toBe(count);
      expect(writes).toBe(0);
      expect(fake.commitUndoCalls).toBe(undoBefore);
    });

    it("a later confirm in the same command cannot outlive the command deadline", async () => {
      vi.useFakeTimers();
      let writes = 0;
      register("batch", async (_args, ctx) => {
        if (!(await ctx.confirm("Run 3 commands"))) throw new PluginError("USER_DECLINED", "first");
        if (!(await ctx.confirm("Delete 6 more nodes"))) throw new PluginError("USER_DECLINED", "second");
        if (!(await ctx.confirm("Delete a component"))) throw new PluginError("USER_DECLINED", "third");
        writes++;
        return {};
      });
      const running = fake.fromUi({ type: "cmd", cmd: { id: "c6", name: "batch", args: {} } });
      await vi.advanceTimersByTimeAsync(0);
      // Approve the first ask just before the command deadline.
      await vi.advanceTimersByTimeAsync(code.CONFIRM_EXPIRY_MS - 1000);
      await fake.fromUi({ type: "confirm-reply", id: last().id, ok: true });
      await vi.advanceTimersByTimeAsync(0);
      const second = last();
      expect(second).toMatchObject({ type: "confirm", summary: "Delete 6 more nodes" });

      // The second ask expires with the command deadline, not a full CONFIRM_EXPIRY_MS later.
      await vi.advanceTimersByTimeAsync(1000);
      await running;
      const tail = fake.posted.slice(-2);
      expect(tail[0]).toEqual({ type: "confirm-cancel", id: second.id });
      expect(tail[1]).toMatchObject({ type: "res", res: { id: "c6", ok: false, code: "USER_DECLINED", message: "second" } });
      expect(writes).toBe(0);
    });

    it("does not ask at all once the command deadline has passed", async () => {
      vi.useFakeTimers();
      register("batch", async (_args, ctx) => {
        await new Promise((r) => setTimeout(r, code.CONFIRM_EXPIRY_MS + 10));
        return { ok: await ctx.confirm("Delete") };
      });
      const running = fake.fromUi({ type: "cmd", cmd: { id: "c7", name: "batch", args: {} } });
      await vi.advanceTimersByTimeAsync(code.CONFIRM_EXPIRY_MS + 10);
      await running;
      expect(last()).toEqual({ type: "res", res: { id: "c7", ok: true, data: { ok: false } } });
      expect(fake.posted.slice(-2)[0]).not.toMatchObject({ type: "confirm" });
    });

    it("an answered confirm does not expire later", async () => {
      vi.useFakeTimers();
      register("delete_nodes", async (_args, ctx) => ({ ok: await ctx.confirm("Delete") }));
      const running = fake.fromUi({ type: "cmd", cmd: { id: "c5", name: "delete_nodes", args: {} } });
      await vi.advanceTimersByTimeAsync(0);
      await fake.fromUi({ type: "confirm-reply", id: last().id, ok: true });
      await running;
      const count = fake.posted.length;
      await vi.advanceTimersByTimeAsync(code.CONFIRM_EXPIRY_MS);
      expect(fake.posted.length).toBe(count);
    });
  });
});
