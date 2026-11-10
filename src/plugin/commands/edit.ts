// Edit commands: rename, move, resize, auto layout and guarded delete.
import { PluginError, register } from "../dispatch.ts";
import { DEFAULT_NAME } from "../../shared/rules.ts";
import { CONFIRM_DELETE_THRESHOLD, CONFIRM_DESCENDANT_THRESHOLD } from "../../shared/protocol.ts";
import { applyLayout, checkSizing, getContainer, getNode, planLayout } from "./structure.ts";
import { writeExceptions } from "../resolve.ts";

register("rename", async (args) => {
  if (DEFAULT_NAME.test(args.name)) {
    throw new PluginError("RULE_VIOLATION", `"${args.name}" is a default layer name`, "Name the layer after its role, e.g. Card/Header.");
  }
  const node = await getNode(args.id);
  node.name = args.name;
  return { id: node.id, name: node.name };
});

register("move", async (args) => {
  const node = await getNode(args.id);
  if (args.parentId) {
    const parent = await getContainer(args.parentId);
    if (args.index !== undefined) (parent as any).insertChild(args.index, node);
    else parent.appendChild(node);
  } else if (args.index !== undefined && node.parent) {
    (node.parent as any).insertChild(args.index, node);
  }
  if (args.x !== undefined) node.x = args.x;
  if (args.y !== undefined) node.y = args.y;
  return { id: node.id, parentId: node.parent?.id, x: node.x, y: node.y };
});

register("resize", async (args) => {
  const node = await getNode(args.id);
  if (typeof (node as any).resize !== "function") throw new PluginError("INVALID_INPUT", `Node ${node.id} (${node.type}) cannot be resized`);
  const n = node as any;
  const prevH = n.layoutSizingHorizontal;
  const prevV = n.layoutSizingVertical;
  n.resize(args.width ?? node.width, args.height ?? node.height);
  // resize() forces both axes to FIXED; give back the axis the caller did not ask to change.
  if (args.width === undefined && prevH !== undefined && prevH !== "FIXED") n.layoutSizingHorizontal = prevH;
  if (args.height === undefined && prevV !== undefined && prevV !== "FIXED") n.layoutSizingVertical = prevV;
  return { id: node.id, width: node.width, height: node.height };
});

register("set_auto_layout", async (args) => {
  const node = await getNode(args.id);
  if (!["FRAME", "COMPONENT", "COMPONENT_SET"].includes(node.type)) {
    throw new PluginError("INVALID_INPUT", `Node ${node.id} is ${node.type}; auto layout applies to frames and components`);
  }
  const plan = await planLayout(args.layout, args.absolute);
  checkSizing(args.layout, node.parent);
  applyLayout(node, plan);
  writeExceptions(node, plan.exceptions, plan.cleared);
  return { id: node.id, mode: plan.mode };
});

// layerCount: the deleted nodes plus all their descendants (a node inside another deleted node counts once).
export type DeletePlan = {
  nodes: SceneNode[];
  nestedComponentIds: string[];
  hasComponent: boolean;
  layerCount: number;
  needsConfirm: boolean;
  summary: string;
};

function countLayers(n: { children?: readonly unknown[] }): number {
  let total = 1;
  for (const c of (n.children ?? []) as { children?: readonly unknown[] }[]) total += countLayers(c);
  return total;
}

// Resolves and validates a delete request and decides whether it needs the user's confirmation.
// Shared by delete_nodes and batch (which asks once for all items up front).
export async function deletePlan(rawIds: string[], opts: { allowMissing?: boolean } = {}): Promise<DeletePlan> {
  const ids = [...new Set(rawIds)];
  const nodes: SceneNode[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const n = await figma.getNodeByIdAsync(id);
    if (n) nodes.push(n as SceneNode);
    else missing.push(id);
  }
  if (missing.length && !opts.allowMissing) {
    throw new PluginError("NODE_NOT_FOUND", `Nodes not found: ${missing.join(", ")}`, "Nothing was deleted. Read the page again to get current ids.");
  }
  const unsupported = nodes.filter((n) => (n.type as string) === "PAGE" || (n.type as string) === "DOCUMENT");
  if (unsupported.length) {
    throw new PluginError("INVALID_INPUT", `Cannot delete ${unsupported.map((n) => `${n.type} ${n.id}`).join(", ")}`, "Only layers can be deleted. Nothing was deleted.");
  }
  const isComp = (n: { type: string }) => n.type === "COMPONENT" || n.type === "COMPONENT_SET";
  const nestedComponentIds: string[] = [];
  for (const n of nodes) {
    const find = (n as any).findAllWithCriteria;
    if (typeof find === "function") for (const c of find.call(n, { types: ["COMPONENT", "COMPONENT_SET"] })) nestedComponentIds.push(c.id);
  }
  const nested = nestedComponentIds.length;
  const hasComponent = nodes.some(isComp) || nested > 0;
  const picked = new Set<BaseNode>(nodes);
  let layerCount = 0;
  for (const n of nodes) {
    let p = n.parent;
    while (p && !picked.has(p)) p = p.parent;
    if (!p) layerCount += countLayers(n as { children?: readonly unknown[] });
  }
  const needsConfirm = nodes.length >= CONFIRM_DELETE_THRESHOLD || layerCount >= CONFIRM_DESCENDANT_THRESHOLD || hasComponent;
  const counts: Record<string, number> = {};
  for (const n of nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;
  const byType = Object.entries(counts).map(([t, c]) => `${c} ${t}`).join(", ");
  const names = nodes.slice(0, 5).map((n) => `"${n.name}"`).join(", ");
  const more = nodes.length > 5 ? `, and ${nodes.length - 5} more` : "";
  const inside = nested > 0 ? `; contains ${nested} nested components` : "";
  return {
    nodes,
    nestedComponentIds,
    hasComponent,
    layerCount,
    needsConfirm,
    summary: `Delete ${nodes.length} nodes, ${layerCount} layers in total (${byType}): ${names}${more}${inside}`,
  };
}

register("delete_nodes", async (args, ctx) => {
  const { nodes, needsConfirm, summary } = await deletePlan(args.ids as string[]);
  if (needsConfirm) {
    const ok = await ctx.confirm(summary);
    if (!ok) throw new PluginError("USER_DECLINED", "The user declined the delete", "Nothing was deleted.");
  }
  // A node inside another deleted node goes away with its ancestor.
  const picked = new Set(nodes);
  let deleted = 0;
  for (const n of nodes) {
    let p = n.parent as BaseNode | null;
    let covered = false;
    while (p) {
      if (picked.has(p as SceneNode)) covered = true;
      p = p.parent;
    }
    if (!covered) {
      n.remove();
      deleted++;
    }
  }
  return { deleted };
});
