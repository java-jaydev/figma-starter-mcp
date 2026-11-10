// Read-only commands: summaries of nodes, variables, styles and components, and node export.
import { PluginError, register } from "../dispatch.ts";
import { summarize, toHex } from "../summarize.ts";

async function nodeOrThrow(id: string): Promise<SceneNode> {
  const n = await figma.getNodeByIdAsync(id);
  if (!n) throw new PluginError("NODE_NOT_FOUND", `Node ${id} not found in ${figma.root.name}`, "Read the selection or page again to get current ids");
  return n as SceneNode;
}

register("status", async () => ({
  fileName: figma.root.name,
  pageName: figma.currentPage.name,
  selectionCount: figma.currentPage.selection.length,
}));

register("read_selection", async (args) => {
  const opts = { maxDepth: args?.maxDepth ?? 4, maxNodes: args?.maxNodes ?? 300 };
  const out = [];
  for (const n of figma.currentPage.selection) out.push(await summarize(n, opts));
  return out;
});

register("read_nodes", async (args) => {
  const out = [];
  for (const id of args.ids as string[]) out.push(await summarize(await nodeOrThrow(id), { maxDepth: 4, maxNodes: 300 }));
  return out;
});

register("read_page", async () => summarize(figma.currentPage as unknown as SceneNode, { maxDepth: 4, maxNodes: 300 }));

async function variableValue(v: unknown): Promise<unknown> {
  const x = v as { type?: string; id?: string; r?: number; g?: number; b?: number; a?: number } | string | number | boolean;
  if (typeof x !== "object" || x === null) return x;
  if (x.type === "VARIABLE_ALIAS" && x.id) {
    const target = await figma.variables.getVariableByIdAsync(x.id);
    return { var: target?.name ?? x.id };
  }
  return toHex(x as { r: number; g: number; b: number }, (x as { a?: number }).a ?? 1);
}

register("list_variables", async () => {
  const collections = [];
  for (const c of await figma.variables.getLocalVariableCollectionsAsync()) {
    const variables = [];
    for (const id of c.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) continue;
      const valuesByMode: Record<string, unknown> = {};
      for (const m of c.modes) valuesByMode[m.name] = await variableValue(v.valuesByMode[m.modeId]);
      variables.push({ name: v.name, type: v.resolvedType, valuesByMode });
    }
    collections.push({ name: c.name, modes: c.modes.map((m) => m.name), variables });
  }
  return { collections };
});

register("list_styles", async () => ({
  textStyles: (await figma.getLocalTextStylesAsync()).map((s) => ({
    id: s.id,
    name: s.name,
    fontFamily: s.fontName.family,
    fontStyle: s.fontName.style,
    fontSize: s.fontSize,
  })),
}));

register("list_components", async () => {
  await figma.loadAllPagesAsync();
  const found = figma.root.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] });
  return {
    components: found
      .filter((n) => !(n.type === "COMPONENT" && n.parent?.type === "COMPONENT_SET"))
      .map((n) => ({ id: n.id, name: n.name, properties: (n as ComponentNode | ComponentSetNode).componentPropertyDefinitions })),
  };
});

register("export_node", async (args) => {
  const node = (await nodeOrThrow(args.id)) as SceneNode & ExportMixin;
  const format = args.format as "PNG" | "SVG";
  const bytes = await node.exportAsync(
    format === "PNG" ? { format, constraint: { type: "SCALE", value: args.scale ?? 2 } } : { format },
  );
  return { format, base64: figma.base64Encode(bytes) };
});
