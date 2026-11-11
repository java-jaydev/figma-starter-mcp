// Structure commands: sections, frames, text, components and instances. Rules are enforced at write time:
// values come from variables/styles, frames default to auto layout, component and property names follow the naming rules.
import { PluginError, register } from "../dispatch.ts";
import { isComponentName, isPropName } from "../../shared/rules.ts";
import { nearestNames, type TokenRef } from "../../shared/tokens.ts";
import type { ExceptionField } from "../../shared/summary.ts";
import { resolveColor, resolveNumber, writeExceptions } from "../resolve.ts";

export type Layout = {
  mode?: "VERTICAL" | "HORIZONTAL" | "NONE";
  gap?: TokenRef;
  padding?: TokenRef | TokenRef[];
  primaryAlign?: string;
  counterAlign?: string;
  sizing?: { horizontal?: string; vertical?: string };
};

type NumberResolved = { field: string; key: "gap" | "padding"; ref: TokenRef; variable?: Variable; raw?: number };
// exceptions: reasons to record; cleared: fields this layout binds to variables (or makes auto), whose old reasons go.
export type LayoutPlan = {
  mode: string;
  numbers: NumberResolved[];
  layout: Layout;
  exceptions: Partial<Record<ExceptionField, string>>;
  cleared: ExceptionField[];
};

export async function getNode(id: string): Promise<SceneNode> {
  const node = await figma.getNodeByIdAsync(id);
  if (!node) throw new PluginError("NODE_NOT_FOUND", `Node ${id} not found`, "Read the selection or page again to get current ids");
  return node as SceneNode;
}

export async function getContainer(id: string): Promise<SceneNode & ChildrenMixin> {
  const node = await getNode(id);
  if (typeof (node as any).appendChild !== "function") {
    throw new PluginError("INVALID_INPUT", `Node ${id} (${node.type}) cannot have children`);
  }
  return node as SceneNode & ChildrenMixin;
}

// Resolves layout tokens and enforces the NONE rule without touching any node, so failures leave the file unchanged.
export async function planLayout(layout: Layout | undefined, absolute: { reason: string } | undefined): Promise<LayoutPlan> {
  const l: Layout = layout ?? {};
  const mode = l.mode ?? "VERTICAL";
  const exceptions: Partial<Record<ExceptionField, string>> = {};
  const cleared: ExceptionField[] = [];
  if (mode === "NONE") {
    if (!absolute?.reason) {
      throw new PluginError(
        "RULE_VIOLATION",
        "layout.mode NONE (absolute positioning) needs a reason",
        'Pass absolute: {reason: "why this frame cannot use auto layout"}, or use VERTICAL or HORIZONTAL.',
      );
    }
    exceptions.absolute = absolute.reason;
  } else cleared.push("absolute", "layout");
  const numbers: NumberResolved[] = [];
  if (mode !== "NONE") {
    const add = async (field: string, key: "gap" | "padding", ref: TokenRef) => {
      const r = await resolveNumber(ref);
      numbers.push({ field, key, ref, ...r });
    };
    if (l.gap) await add("itemSpacing", "gap", l.gap);
    if (l.padding) {
      const sides = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
      for (let i = 0; i < 4; i++) await add(sides[i], "padding", Array.isArray(l.padding) ? l.padding[i] : l.padding);
    }
  }
  for (const key of ["gap", "padding"] as const) {
    const mine = numbers.filter((n) => n.key === key);
    if (!mine.length) continue;
    const reasons = [...new Set(mine.map((n) => ("raw" in n.ref ? n.ref.reason : "")).filter((r) => r))];
    if (reasons.length) exceptions[key] = reasons.join("; ");
    else cleared.push(key);
  }
  return { mode, numbers, layout: l, exceptions, cleared };
}

// FILL only works inside an auto layout parent; Figma throws otherwise, so catch it before any write.
export function checkSizing(layout: Layout | undefined, parent: BaseNode | null): void {
  const wantsFill = layout?.sizing?.horizontal === "FILL" || layout?.sizing?.vertical === "FILL";
  if (!wantsFill) return;
  const lm = (parent as { layoutMode?: string } | null)?.layoutMode;
  if (lm === undefined || lm === "NONE") {
    throw new PluginError("RULE_VIOLATION", "FILL sizing needs an auto layout parent", "FILL needs an auto layout parent; use FIXED or HUG, or give the parent a layout.");
  }
}

export function applyLayout(node: any, plan: LayoutPlan): void {
  node.layoutMode = plan.mode;
  if (plan.mode === "NONE") return;
  for (const n of plan.numbers) {
    if (n.variable) node.setBoundVariable(n.field, n.variable);
    else {
      node.setBoundVariable(n.field, null);
      node[n.field] = n.raw;
    }
  }
  const l = plan.layout;
  if (l.primaryAlign) node.primaryAxisAlignItems = l.primaryAlign;
  if (l.counterAlign) node.counterAxisAlignItems = l.counterAlign;
  if (l.sizing?.horizontal) node.layoutSizingHorizontal = l.sizing.horizontal;
  if (l.sizing?.vertical) node.layoutSizingVertical = l.sizing.vertical;
}

// A solid paint for a resolved color, bound to its variable when there is one.
function solidPaint(fill: { variable?: Variable; raw?: RGBA }): SolidPaint {
  if (fill.variable) return figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0, g: 0, b: 0 } }, "color", fill.variable);
  return { type: "SOLID", color: { r: fill.raw!.r, g: fill.raw!.g, b: fill.raw!.b }, opacity: fill.raw!.a };
}

register("create_section", async (args) => {
  const s = figma.createSection();
  s.name = args.name;
  if (args.x !== undefined) s.x = args.x;
  if (args.y !== undefined) s.y = args.y;
  if (args.width !== undefined || args.height !== undefined) s.resizeWithoutConstraints(args.width ?? s.width, args.height ?? s.height);
  return { id: s.id, name: s.name };
});

register("create_frame", async (args) => {
  const parent = args.parentId ? await getContainer(args.parentId) : undefined;
  const plan = await planLayout(args.layout, args.absolute);
  checkSizing(args.layout, parent ?? figma.currentPage);
  const fill = args.fill ? await resolveColor(args.fill) : undefined;
  const radius = args.radius ? await resolveNumber(args.radius) : undefined;

  const f = figma.createFrame();
  try {
    f.name = args.name;
    if (parent) parent.appendChild(f);
    const exceptions = { ...plan.exceptions };
    applyLayout(f, plan);
    // Without a fill the frame stays transparent instead of Figma's default white (a hardcoded value).
    f.fills = fill ? [solidPaint(fill)] : [];
    if (fill && !fill.variable) exceptions.fill = args.fill.reason;
    if (radius) {
      const corners = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"] as const;
      if (radius.variable) for (const c of corners) f.setBoundVariable(c, radius.variable);
      else {
        f.cornerRadius = radius.raw as number;
        exceptions.radius = args.radius.reason;
      }
    }
    writeExceptions(f, exceptions);
  } catch (e) {
    f.remove();
    throw e;
  }
  return { id: f.id, name: f.name };
});

register("create_text", async (args) => {
  if (typeof args.textStyle !== "string" || !args.textStyle) {
    throw new PluginError("INVALID_INPUT", "create_text needs textStyle, the name of an existing text style", "Call list_styles to see available text styles.");
  }
  const parent = await getContainer(args.parentId);
  const styles = await figma.getLocalTextStylesAsync();
  const style = styles.find((s) => s.name === args.textStyle);
  if (!style) {
    const near = nearestNames(args.textStyle, styles.map((s) => s.name), 3);
    throw new PluginError(
      "STYLE_NOT_FOUND",
      `Text style "${args.textStyle}" not found`,
      near.length ? `Nearest names: ${near.join(", ")}` : "No text styles exist yet; create one with upsert_text_styles.",
    );
  }
  try {
    await figma.loadFontAsync(style.fontName);
  } catch {
    throw new PluginError(
      "FONT_NOT_AVAILABLE",
      `Font "${style.fontName.family}" style "${style.fontName.style}" used by "${style.name}" is not available`,
      "Install the font, then restart Figma after installing fonts so it shows up.",
    );
  }
  const fill = args.fill ? await resolveColor(args.fill) : undefined;
  const t = figma.createText();
  try {
    parent.appendChild(t);
    await t.setTextStyleIdAsync(style.id);
    t.characters = args.text;
    if (fill) {
      t.fills = [solidPaint(fill)];
      if (!fill.variable) writeExceptions(t, { fill: args.fill.reason });
    }
  } catch (e) {
    t.remove();
    throw e;
  }
  return { id: t.id, name: t.name };
});

register("create_component", async (args) => {
  if (!isComponentName(args.name)) {
    throw new PluginError("RULE_VIOLATION", `"${args.name}" is not a component name`, "Use PascalCase with optional '/' groups, e.g. Button/Primary.");
  }
  const parent = args.parentId ? await getContainer(args.parentId) : undefined;
  const c = figma.createComponent();
  c.name = args.name;
  if (parent) parent.appendChild(c);
  return { id: c.id, name: c.name };
});

// The layer a new property drives. Checked before the property is added, so a bad layerId adds nothing.
// TEXT links to the only text layer when layerId is omitted; BOOLEAN and INSTANCE_SWAP link only on request.
async function propertyLayer(component: ComponentNode, type: string, layerId: unknown): Promise<SceneNode | undefined> {
  if (typeof layerId === "string") {
    const layer = await getNode(layerId);
    let p = layer.parent;
    while (p && p !== component) p = p.parent;
    if (!p) throw new PluginError("INVALID_INPUT", `Layer ${layer.id} is not inside component ${component.id}`, "Pass the id of a layer inside this component.");
    const need = { TEXT: "TEXT", INSTANCE_SWAP: "INSTANCE" }[type];
    if (need && layer.type !== need) {
      throw new PluginError("INVALID_INPUT", `A ${type} property needs a ${need} layer, but ${layer.id} is ${layer.type}`, `Pass the id of a ${need} layer inside this component.`);
    }
    return layer;
  }
  if (type !== "TEXT") return undefined;
  const texts = component.findAllWithCriteria({ types: ["TEXT"] });
  if (texts.length === 1) return texts[0];
  if (texts.length === 0) {
    throw new PluginError("INVALID_INPUT", `Component ${component.id} has no text layer for a TEXT property`, "Add the text first with create_text, then add the property.");
  }
  throw new PluginError(
    "INVALID_INPUT",
    `Component ${component.id} has ${texts.length} text layers`,
    `Pass layerId, one of: ${texts.map((t) => `${t.id} (${t.name})`).join(", ")}`,
  );
}

register("add_component_property", async (args) => {
  if (!isPropName(args.name)) {
    throw new PluginError("RULE_VIOLATION", `"${args.name}" is not a property name`, "Use camelCase, e.g. label or isDisabled.");
  }
  const node = await getNode(args.componentId);
  if (node.type !== "COMPONENT") {
    throw new PluginError("INVALID_INPUT", `Node ${node.id} is ${node.type}, not a COMPONENT`, "Properties can only be added to a main component.");
  }
  if (!["BOOLEAN", "TEXT", "INSTANCE_SWAP"].includes(args.type)) {
    throw new PluginError(
      "INVALID_INPUT",
      `Property type ${JSON.stringify(args.type)} is not supported`,
      "Use BOOLEAN, TEXT or INSTANCE_SWAP. Variants are made by hand in Figma for v1: select the components, then Combine as variants.",
    );
  }
  const expected = { BOOLEAN: "boolean", TEXT: "string" }[args.type as string];
  if (expected && typeof args.default !== expected) {
    throw new PluginError("INVALID_INPUT", `${args.type} property "${args.name}" needs a ${expected} default, got ${JSON.stringify(args.default)}`);
  }
  const layer = await propertyLayer(node as ComponentNode, args.type, args.layerId);
  try {
    const key = (node as ComponentNode).addComponentProperty(args.name, args.type, args.default);
    if (!layer) return { id: node.id, key };
    const field = { BOOLEAN: "visible", TEXT: "characters", INSTANCE_SWAP: "mainComponent" }[args.type as string]!;
    layer.componentPropertyReferences = { ...(layer.componentPropertyReferences ?? {}), [field]: key };
    return { id: node.id, key, linkedLayerId: layer.id };
  } catch (e) {
    throw new PluginError("INVALID_INPUT", `Cannot add property: ${e instanceof Error ? e.message : String(e)}`);
  }
});

register("create_instance", async (args) => {
  const parent = await getContainer(args.parentId);
  await figma.loadAllPagesAsync();
  const comps = figma.root.findAllWithCriteria({ types: ["COMPONENT"] }) as ComponentNode[];
  const hit = comps.find((c) => c.name === args.componentName);
  if (!hit) {
    const near = nearestNames(args.componentName, comps.map((c) => c.name), 3);
    throw new PluginError(
      "NODE_NOT_FOUND",
      `Component "${args.componentName}" not found`,
      near.length ? `Nearest names: ${near.join(", ")}` : "No components exist yet; create one with create_component.",
    );
  }
  const inst = hit.createInstance();
  parent.appendChild(inst);
  return { id: inst.id, name: inst.name };
});

register("set_instance_properties", async (args) => {
  const node = await getNode(args.id);
  if (node.type !== "INSTANCE") throw new PluginError("INVALID_INPUT", `Node ${node.id} is ${node.type}, not an INSTANCE`);
  const keys = Object.keys((node as InstanceNode).componentProperties);
  const resolved: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(args.props as Record<string, string | boolean>)) {
    const key = keys.find((k) => k === name || k.startsWith(`${name}#`));
    if (!key) {
      const bare = keys.map((k) => k.split("#")[0]);
      throw new PluginError("INVALID_INPUT", `Instance has no property "${name}"`, bare.length ? `Available: ${bare.join(", ")}` : "This instance has no properties.");
    }
    resolved[key] = value;
  }
  try {
    (node as InstanceNode).setProperties(resolved);
  } catch (e) {
    throw new PluginError("INVALID_INPUT", `Cannot set properties: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { id: node.id, set: Object.keys(args.props) };
});
