// Turns Figma nodes into compact NodeSummary objects. Bound variables become {var: name}, everything
// else {raw}. Only async Plugin API getters are used (documentAccess "dynamic-page").
import type { Bound, NodeSummary } from "../shared/summary.ts";
import { EXCEPTION_KEY, readExceptions } from "./resolve.ts";

export type SummarizeOpts = { maxDepth: number; maxNodes: number };

const hex2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, "0").toUpperCase();

export function toHex(c: { r: number; g: number; b: number }, alpha = 1): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${alpha < 1 ? hex2(alpha) : ""}`;
}

async function varName(alias: unknown): Promise<string | undefined> {
  const id = (alias as { id?: string } | undefined)?.id;
  if (!id) return undefined;
  return (await figma.variables.getVariableByIdAsync(id))?.name;
}

async function bound(alias: unknown, raw: string | number): Promise<Bound> {
  const name = await varName(alias);
  return name === undefined ? { raw } : { var: name };
}

async function paints(list: unknown, aliases: unknown): Promise<Bound[] | undefined> {
  if (!Array.isArray(list)) return undefined;
  const out: Bound[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.visible === false) continue;
    const raw = p.type === "SOLID" ? toHex(p.color, p.opacity ?? 1) : String(p.type);
    out.push(await bound((aliases as unknown[] | undefined)?.[i], raw));
  }
  return out;
}

function countDescendants(n: { children?: readonly unknown[] }): number {
  let total = 0;
  for (const c of (n.children ?? []) as { children?: readonly unknown[] }[]) total += 1 + countDescendants(c);
  return total;
}

export async function summarize(node: SceneNode, opts: SummarizeOpts): Promise<NodeSummary> {
  const state = { budget: opts.maxNodes };
  return walk(node, opts.maxDepth, state);
}

async function walk(node: any, depthLeft: number, state: { budget: number }): Promise<NodeSummary> {
  state.budget--;
  const s: NodeSummary = { id: node.id, type: node.type, name: node.name };
  const bv = node.boundVariables ?? {};

  const exceptions = readExceptions(node.getPluginData?.(EXCEPTION_KEY) ?? "");
  if (exceptions) s.exceptions = exceptions;

  if (["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(node.type)) {
    const mode = node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL" ? node.layoutMode : "NONE";
    s.layout = { mode };
    if (mode !== "NONE") {
      s.layout.gap = await bound(bv.itemSpacing, node.itemSpacing);
      s.layout.padding = [
        await bound(bv.paddingTop, node.paddingTop),
        await bound(bv.paddingRight, node.paddingRight),
        await bound(bv.paddingBottom, node.paddingBottom),
        await bound(bv.paddingLeft, node.paddingLeft),
      ];
      s.layout.primaryAlign = node.primaryAxisAlignItems;
      s.layout.counterAlign = node.counterAxisAlignItems;
    }
    if (node.layoutSizingHorizontal && node.layoutSizingVertical) {
      s.layout.sizing = { h: node.layoutSizingHorizontal, v: node.layoutSizingVertical };
    }
  }

  const fills = await paints(node.fills, bv.fills);
  if (fills?.length) s.fills = fills;
  const strokes = await paints(node.strokes, bv.strokes);
  if (strokes?.length) s.strokes = strokes;

  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    s.radius = await bound(bv.topLeftRadius, node.cornerRadius);
  }

  if (node.type === "TEXT") {
    s.text = node.characters;
    if (typeof node.fontSize === "number") s.fontSize = await bound(bv.fontSize, node.fontSize);
    if (typeof node.textStyleId === "string" && node.textStyleId) {
      const style = await figma.getStyleByIdAsync(node.textStyleId);
      if (style) s.textStyle = style.name;
    }
  }

  if (node.type === "INSTANCE") {
    const main = await node.getMainComponentAsync();
    // Property keys carry a "#id" suffix (except variant keys); the code-facing name is the part before it.
    const props: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(node.componentProperties ?? {})) props[k.split("#")[0]] = (v as { value: string | boolean }).value;
    // A variant's own name is "size=large, ..."; the component is the set, and those values are already props.
    const name = main?.parent?.type === "COMPONENT_SET" ? main.parent.name : main?.name ?? "";
    s.component = { name, props };
  }

  if (node.children?.length) {
    if (depthLeft <= 0) {
      s.omitted = countDescendants(node);
    } else {
      const children: NodeSummary[] = [];
      let omitted = 0;
      for (const c of node.children) {
        if (state.budget > 0) children.push(await walk(c, depthLeft - 1, state));
        else omitted += 1 + countDescendants(c);
      }
      s.children = children;
      if (omitted) s.omitted = omitted;
    }
  }
  return s;
}
