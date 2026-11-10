// Resolves a TokenRef to a Figma Variable (to bind) or a raw value, and reads/writes the per-field
// exception reasons kept in plugin data.
import type { TokenRef } from "../shared/tokens.ts";
import type { ExceptionField, NodeSummary } from "../shared/summary.ts";
import { nearestNames } from "../shared/tokens.ts";
import { PluginError } from "./dispatch.ts";

// Plugin data key holding JSON {"<field>": "<reason>"}. A non-JSON value is a legacy whole-node reason.
export const EXCEPTION_KEY = "fsm.exception";

export type Exceptions = NonNullable<NodeSummary["exceptions"]>;

export function readExceptions(raw: string): Exceptions | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, r] of Object.entries(v)) if (typeof r === "string") out[k] = r;
      return out;
    }
  } catch {
    // Not JSON: a legacy plain-string reason.
  }
  return { "*": raw };
}

type PluginDataHolder = { getPluginData(key: string): string; setPluginData(key: string, value: string): void };

// Merges reasons into the node's exceptions and drops the cleared fields (now bound to variables).
export function writeExceptions(node: PluginDataHolder, set: Partial<Record<ExceptionField, string>>, cleared: ExceptionField[] = []): void {
  const cur: Record<string, string> = { ...readExceptions(node.getPluginData(EXCEPTION_KEY)) };
  for (const f of cleared) delete cur[f];
  Object.assign(cur, set);
  node.setPluginData(EXCEPTION_KEY, Object.keys(cur).length ? JSON.stringify(cur) : "");
}

export function parseHex(s: unknown): RGBA {
  if (typeof s !== "string" || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) {
    throw new PluginError("INVALID_INPUT", `Invalid color ${JSON.stringify(s)}`, "Use #RGB, #RRGGBB or #RRGGBBAA.");
  }
  let h = s.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

async function findVariable(name: string, type: "COLOR" | "FLOAT"): Promise<Variable> {
  const all = await figma.variables.getLocalVariablesAsync(type);
  const hit = all.find((v) => v.name === name);
  if (hit) return hit;
  const near = nearestNames(name, all.map((v) => v.name), 3);
  throw new PluginError(
    "VARIABLE_NOT_FOUND",
    `${type} variable "${name}" not found`,
    near.length ? `Nearest names: ${near.join(", ")}` : `No ${type} variables exist yet; create one with upsert_variables.`,
  );
}

export async function resolveColor(ref: TokenRef): Promise<{ variable?: Variable; raw?: RGBA }> {
  if ("var" in ref) return { variable: await findVariable(ref.var, "COLOR") };
  return { raw: parseHex(ref.raw) };
}

export async function resolveNumber(ref: TokenRef): Promise<{ variable?: Variable; raw?: number }> {
  if ("var" in ref) return { variable: await findVariable(ref.var, "FLOAT") };
  if (typeof ref.raw !== "number" || !isFinite(ref.raw)) {
    throw new PluginError("INVALID_INPUT", `Invalid number ${JSON.stringify(ref.raw)}`);
  }
  return { raw: ref.raw };
}
