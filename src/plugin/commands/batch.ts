// batch: run many commands in one round trip, with one confirmation and one undo step.
import { PluginError, getHandler, register, type Ctx } from "../dispatch.ts";
import type { CommandName } from "../../shared/protocol.ts";
import { CONFIRM_DELETE_THRESHOLD, CONFIRM_DESCENDANT_THRESHOLD } from "../../shared/protocol.ts";
import { deletePlan, type DeletePlan } from "./edit.ts";

const MAX_ITEMS = 100;

type Item = { name: string; args: unknown };
type ItemResult =
  | { index: number; name: string; ok: true; data: unknown }
  | { index: number; name: string; ok: false; code: string; message: string; hint?: string }
  | { index: number; name: string; ok: false; notRun: true };

register("batch", async (args, ctx) => {
  const items = args.commands as Item[];
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    throw new PluginError("INVALID_INPUT", `commands must be an array of 1 to ${MAX_ITEMS} items`, "Nothing ran.");
  }
  const nested = items.findIndex((c) => c.name === "batch");
  if (nested >= 0) throw new PluginError("INVALID_INPUT", `Item ${nested} is a batch; batches cannot be nested`, "Nothing ran.");
  const idsOf = (c: Item, i: number): string[] => {
    const ids = (c.args as { ids?: unknown } | undefined)?.ids;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
      throw new PluginError("INVALID_INPUT", `Item ${i} (delete_nodes) needs ids: string[]`, "Nothing ran.");
    }
    return ids as string[];
  };

  // Pre-flight: one plan over the union of every delete target that resolves now. Ids that do not exist
  // yet (created earlier in the batch) are checked again at run time.
  const unionIds: string[] = [];
  items.forEach((c, i) => {
    if (c.name === "delete_nodes") unionIds.push(...idsOf(c, i));
  });
  const approved = new Set<string>();
  let preflight: DeletePlan | undefined;
  if (unionIds.length) {
    try {
      preflight = await deletePlan(unionIds, { allowMissing: true });
    } catch (e) {
      if (!(e instanceof PluginError)) throw e;
      // Unsupported targets (PAGE/DOCUMENT) fail when that item runs, in order.
    }
  }
  if (preflight) {
    for (const n of preflight.nodes) approved.add(n.id);
    for (const id of preflight.nestedComponentIds) approved.add(id);
    if (preflight.needsConfirm) {
      const ok = await ctx.confirm(`Run ${items.length} commands including destructive items:\n${preflight.summary}`);
      if (!ok) throw new PluginError("USER_DECLINED", "The user declined the batch", "Nothing ran.");
    }
  }
  const approvedSize = preflight ? preflight.nodes.length : 0;
  const approvedLayers = preflight ? preflight.layerCount : 0;
  let deletedSoFar = 0;
  let layersSoFar = 0;

  // Handlers inside the batch never ask themselves; delete items are guarded below.
  const quiet: Ctx = { confirm: async () => true };
  const results: ItemResult[] = [];
  let failed = false;
  for (let i = 0; i < items.length; i++) {
    const { name } = items[i];
    if (failed) {
      results.push({ index: i, name, ok: false, notRun: true });
      continue;
    }
    const h = getHandler(name as CommandName);
    try {
      if (!h) throw new PluginError("INVALID_INPUT", `Unknown command: ${name}`);
      if (name === "delete_nodes") {
        const plan = await deletePlan(idsOf(items[i], i));
        const total = deletedSoFar + plan.nodes.length;
        const layers = layersSoFar + plan.layerCount;
        const covered =
          plan.nodes.every((n) => approved.has(n.id)) &&
          plan.nestedComponentIds.every((id) => approved.has(id)) &&
          total <= approvedSize &&
          layers <= approvedLayers;
        if (!covered && (total >= CONFIRM_DELETE_THRESHOLD || layers >= CONFIRM_DESCENDANT_THRESHOLD || plan.hasComponent)) {
          const ok = await ctx.confirm(`${plan.summary} (${total} nodes, ${layers} layers deleted in this batch so far, including this item)`);
          if (!ok) throw new PluginError("USER_DECLINED", "The user declined the delete", "Nothing from this item or later items ran.");
        }
        deletedSoFar = total;
        layersSoFar = layers;
      }
      results.push({ index: i, name, ok: true, data: await h(items[i].args, quiet) });
    } catch (e) {
      failed = true;
      if (e instanceof PluginError) {
        results.push(e.hint === undefined ? { index: i, name, ok: false, code: e.code, message: e.message } : { index: i, name, ok: false, code: e.code, message: e.message, hint: e.hint });
      } else {
        results.push({ index: i, name, ok: false, code: "INVALID_INPUT", message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  // dispatch commits the single undo step after this handler returns.
  return { ok: !failed, results };
});
