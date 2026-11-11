// Token write commands: variables, text styles and variable binding. Upserts are idempotent by name.
import { PluginError, register } from "../dispatch.ts";
import { isTokenName } from "../../shared/rules.ts";
import { EXCEPTION_KEY, parseHex, resolveColor, resolveNumber } from "../resolve.ts";

type VarDef = { name: string; type: "COLOR" | "FLOAT"; value: string | number };

function parseValue(d: VarDef): RGBA | number {
  if (d.type === "COLOR") return parseHex(d.value);
  if (typeof d.value !== "number" || !isFinite(d.value)) {
    throw new PluginError("INVALID_INPUT", `FLOAT variable "${d.name}" needs a number value, got ${JSON.stringify(d.value)}`);
  }
  return d.value;
}

register("upsert_variables", async (args) => {
  const defs = args.variables as VarDef[];
  // Validate everything first so a bad entry leaves the file untouched.
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.name)) {
      throw new PluginError("INVALID_INPUT", `"${d.name}" appears more than once in variables`, "Give each name once per call. Nothing was written.");
    }
    seen.add(d.name);
  }
  for (const d of defs) {
    if (!isTokenName(d.name)) {
      throw new PluginError("RULE_VIOLATION", `"${d.name}" is not a token name`, "Use lowercase kebab segments joined by '/', e.g. color/bg/default.");
    }
  }
  const values = defs.map(parseValue);

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collection = collections.find((c) => c.name === args.collection) ?? figma.variables.createVariableCollection(args.collection);
  const existing = await figma.variables.getLocalVariablesAsync();
  const inCollection = existing.filter((v) => v.variableCollectionId === collection.id);
  for (const d of defs) {
    const prior = inCollection.find((v) => v.name === d.name);
    if (prior && prior.resolvedType !== d.type) {
      throw new PluginError("INVALID_INPUT", `"${d.name}" already exists as ${prior.resolvedType}, not ${d.type}`, "Rename the token or delete the existing variable.");
    }
  }

  // Starter has one mode per collection; write the default one.
  const modeId = collection.modes[0].modeId;
  let created = 0;
  let updated = 0;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    let v = inCollection.find((x) => x.name === d.name);
    if (v) updated++;
    else {
      v = figma.variables.createVariable(d.name, collection, d.type);
      inCollection.push(v);
      created++;
    }
    v.setValueForMode(modeId, values[i]);
  }
  return { collection: collection.name, created, updated };
});

type StyleDef = { name: string; family: string; style: string; size: any; lineHeight: any };

register("upsert_text_styles", async (args) => {
  const defs = args.styles as StyleDef[];
  // Resolve fonts and refs for every style before the first write, so a failure leaves the file untouched.
  const fontsLoaded = new Set<string>();
  const resolved = [];
  for (const d of defs) {
    const fontName = { family: d.family, style: d.style };
    const key = `${d.family}/${d.style}`;
    if (!fontsLoaded.has(key)) {
      try {
        await figma.loadFontAsync(fontName);
      } catch {
        throw new PluginError(
          "FONT_NOT_AVAILABLE",
          `Font "${d.family}" style "${d.style}" is not available`,
          "Install the font, then restart Figma after installing fonts so it shows up, and check the style name (for example Semi Bold).",
        );
      }
      fontsLoaded.add(key);
    }
    const size = await resolveNumber(d.size);
    const line = await resolveNumber(d.lineHeight);
    const reasons: Record<string, string> = {};
    if (!size.variable) reasons.fontSize = d.size.reason;
    if (!line.variable) reasons.lineHeight = d.lineHeight.reason;
    resolved.push({ d, fontName, size, line, exception: Object.keys(reasons).length ? JSON.stringify(reasons) : "" });
  }

  const existing = await figma.getLocalTextStylesAsync();
  let created = 0;
  let updated = 0;
  for (const { d, fontName, size, line, exception } of resolved) {
    let style = existing.find((s) => s.name === d.name);
    if (style) updated++;
    else {
      style = figma.createTextStyle();
      existing.push(style);
      created++;
    }
    style.name = d.name;
    style.fontName = fontName;
    if (size.variable) style.setBoundVariable("fontSize", size.variable);
    else {
      style.setBoundVariable("fontSize", null);
      style.fontSize = size.raw as number;
    }
    if (line.variable) style.setBoundVariable("lineHeight", line.variable);
    else {
      style.setBoundVariable("lineHeight", null);
      style.lineHeight = { value: line.raw as number, unit: "PIXELS" };
    }
    style.setPluginData(EXCEPTION_KEY, exception);
  }
  return { created, updated };
});

register("bind_variable", async (args) => {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw new PluginError("NODE_NOT_FOUND", `Node ${args.nodeId} not found`, "Read the selection or page again to get current ids");
  const field = args.field as string;
  const target = node as any;
  if (field === "fills" || field === "strokes") {
    const { variable } = await resolveColor({ var: args.var as string });
    const paints = target[field] as readonly Paint[] | undefined;
    if (!Array.isArray(paints) || paints.length === 0 || paints[0].type !== "SOLID") {
      throw new PluginError("INVALID_INPUT", `${field} of ${node.name} has no solid paint to bind`, "Set a solid paint first.");
    }
    // New components carry a hidden default fill; binding a color means the agent wants it shown.
    const first = { ...(paints[0] as SolidPaint), visible: true };
    const next = [figma.variables.setBoundVariableForPaint(first, "color", variable as Variable), ...paints.slice(1)];
    target[field] = next;
    return { nodeId: node.id, field, var: args.var };
  }
  const { variable } = await resolveNumber({ var: args.var as string });
  if (typeof target.setBoundVariable !== "function") {
    throw new PluginError("INVALID_INPUT", `Node ${node.id} cannot bind variables`);
  }
  // cornerRadius is not bindable itself; it stands for all four corners.
  const fields = field === "cornerRadius" ? ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"] : [field];
  try {
    for (const f of fields) target.setBoundVariable(f, variable);
  } catch (e) {
    throw new PluginError("INVALID_INPUT", `Cannot bind ${field} on ${node.type}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { nodeId: node.id, field, var: args.var };
});
