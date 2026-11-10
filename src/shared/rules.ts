import type { Bound, ExceptionField, NodeSummary } from "./summary.ts";

export type RuleId =
  | "hardcoded-value"
  | "token-name"
  | "theme-mismatch"
  | "missing-auto-layout"
  | "component-name"
  | "prop-name"
  | "default-layer-name";

export type Finding = { rule: RuleId; nodeId: string; message: string; fix: string; excepted: boolean };

export const isTokenName = (s: string): boolean => /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)+$/.test(s);
export const isComponentName = (s: string): boolean => /^([A-Z][A-Za-z0-9]*)(\/[A-Z][A-Za-z0-9]*)*$/.test(s);
export const isPropName = (s: string): boolean => /^[a-z][A-Za-z0-9]*$/.test(s);
export const DEFAULT_NAME = /^(Frame|Group|Rectangle|Ellipse|Text|Vector|Line|Polygon|Star|Component|Instance) \d+$/;

const LAYOUT_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET"]);

export function checkTree(root: NodeSummary): Finding[] {
  const out: Finding[] = [];
  walk(root, out);
  return out;
}

function walk(node: NodeSummary, out: Finding[]): void {
  const ex = node.exceptions ?? {};
  // A finding is excepted only when one of its fields has a reason (or the node has a legacy "*" reason).
  const has = (...fields: ExceptionField[]) => ex["*"] !== undefined || fields.some((f) => ex[f] !== undefined);
  const add = (rule: RuleId, message: string, fix: string, excepted = has()) =>
    out.push({ rule, nodeId: node.id, message, fix, excepted });

  const bounds: [string, ExceptionField, Bound | undefined][] = [
    ["radius", "radius", node.radius],
    ["fontSize", "fontSize", node.fontSize],
    ["gap", "gap", node.layout?.gap],
  ];
  node.fills?.forEach((b, i) => bounds.push([`fills[${i}]`, "fill", b]));
  node.strokes?.forEach((b, i) => bounds.push([`strokes[${i}]`, "stroke", b]));
  node.layout?.padding?.forEach((b, i) => bounds.push([`padding[${i}]`, "padding", b]));

  for (const [label, field, b] of bounds) {
    if (!b) continue;
    if ("raw" in b) {
      // Unset spacing reads as 0; that is not a hardcoded value.
      if (b.raw === 0 && (field === "gap" || field === "padding")) continue;
      add(
        "hardcoded-value",
        `${label} uses hardcoded value ${String(b.raw)}`,
        `Bind ${label} to a variable, or record an exception with a reason.`,
        has(field),
      );
    } else if (!isTokenName(b.var)) {
      add("token-name", `${label} binds to "${b.var}", which is not a token name`, "Use lowercase kebab segments joined by '/', e.g. color/bg/default.");
    }
  }

  if (LAYOUT_TYPES.has(node.type) && node.layout?.mode === "NONE") {
    add(
      "missing-auto-layout",
      `${node.type} "${node.name}" has no auto layout`,
      "Apply auto layout (set_auto_layout) with a direction and token gap/padding.",
      has("absolute", "layout"),
    );
  }

  if (DEFAULT_NAME.test(node.name)) {
    add("default-layer-name", `Layer has default name "${node.name}"`, "Rename the layer to describe its role.");
  }

  if (node.component) {
    if (!isComponentName(node.component.name)) {
      add("component-name", `Component name "${node.component.name}" is not PascalCase`, "Use PascalCase with optional '/' groups, e.g. Button/Primary.");
    }
    for (const key of Object.keys(node.component.props)) {
      if (!isPropName(key)) {
        add("prop-name", `Property name "${key}" is not camelCase`, "Rename the property to camelCase, e.g. variant.");
      }
    }
  }

  node.children?.forEach((c) => walk(c, out));
}

export function checkThemes(light: string[], dark: string[]): Finding[] {
  const out: Finding[] = [];
  const l = new Set(light);
  const d = new Set(dark);
  for (const name of light) {
    if (!d.has(name)) out.push(themeFinding(name, "dark"));
  }
  for (const name of dark) {
    if (!l.has(name)) out.push(themeFinding(name, "light"));
  }
  return out;
}

function themeFinding(name: string, missing: string): Finding {
  return {
    rule: "theme-mismatch",
    nodeId: "",
    message: `Variable "${name}" is missing in the ${missing} mode`,
    fix: `Add a ${missing} value for "${name}".`,
    excepted: false,
  };
}
