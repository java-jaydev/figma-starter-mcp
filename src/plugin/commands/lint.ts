// lint: run the shared design rules over the selection or the whole page.
import { register } from "../dispatch.ts";
import { summarize } from "../summarize.ts";
import { checkThemes, checkTree, type Finding } from "../../shared/rules.ts";
import type { NodeSummary } from "../../shared/summary.ts";

const PAGE_LIMITS = { maxDepth: 50, maxNodes: 5000 };

function count(s: NodeSummary): { nodes: number; omitted: boolean } {
  let nodes = 1;
  let omitted = s.omitted !== undefined;
  for (const c of s.children ?? []) {
    const r = count(c);
    nodes += r.nodes;
    omitted = omitted || r.omitted;
  }
  return { nodes, omitted };
}

async function collectionVariableNames(name: string): Promise<string[] | undefined> {
  const collection = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === name);
  if (!collection) return undefined;
  const names: string[] = [];
  for (const id of collection.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) names.push(v.name);
  }
  return names;
}

register("lint", async (args) => {
  const nodes: readonly SceneNode[] = args.scope === "page" ? figma.currentPage.children : figma.currentPage.selection;
  const findings: Finding[] = [];
  let checked = 0;
  let truncated = false;
  for (const node of nodes) {
    if (checked >= PAGE_LIMITS.maxNodes) {
      truncated = true;
      break;
    }
    const s = await summarize(node, { maxDepth: PAGE_LIMITS.maxDepth, maxNodes: PAGE_LIMITS.maxNodes - checked });
    const r = count(s);
    checked += r.nodes;
    if (r.omitted) truncated = true;
    findings.push(...checkTree(s));
  }
  const light = await collectionVariableNames("Color / Light");
  const dark = await collectionVariableNames("Color / Dark");
  if (light && dark) findings.push(...checkThemes(light, dark));
  const shown = args.includeExcepted ? findings : findings.filter((f) => !f.excepted);
  return truncated ? { findings: shown, checked, truncated: true } : { findings: shown, checked };
});
