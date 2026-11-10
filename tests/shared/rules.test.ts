import { describe, expect, it } from "vitest";
import { checkTree, checkThemes, isTokenName } from "../../src/shared/rules.ts";
import type { NodeSummary } from "../../src/shared/summary.ts";

const frame = (extra: Partial<NodeSummary> = {}): NodeSummary => ({
  id: "1:1",
  type: "FRAME",
  name: "header",
  layout: { mode: "HORIZONTAL" },
  ...extra,
});

describe("checkTree", () => {
  it("hardcoded fill is flagged", () => {
    const f = checkTree(frame({ fills: [{ raw: "#4F46E5" }] }));
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe("hardcoded-value");
    expect(f[0].excepted).toBe(false);
  });

  it("an exception on the same field marks the finding excepted", () => {
    const f = checkTree(frame({ fills: [{ raw: "#4F46E5" }], exceptions: { fill: "brand gradient" } }));
    expect(f).toHaveLength(1);
    expect(f[0].excepted).toBe(true);
  });

  it("an exception on another field does not", () => {
    const f = checkTree(frame({ fills: [{ raw: "#4F46E5" }], radius: { raw: 3 }, exceptions: { radius: "hairline" } }));
    expect(f.map((x) => [x.message.split(" ")[0], x.excepted])).toEqual([
      ["radius", true],
      ["fills[0]", false],
    ]);
  });

  it("matches strokes, padding, gap and fontSize per field", () => {
    const f = checkTree(
      frame({
        strokes: [{ raw: "#000000" }],
        layout: { mode: "HORIZONTAL", gap: { raw: 6 }, padding: [{ raw: 2 }, { raw: 2 }, { raw: 2 }, { raw: 2 }] },
        exceptions: { stroke: "a", padding: "b" },
      }),
    );
    const excepted = Object.fromEntries(f.map((x) => [x.message.split(" ")[0], x.excepted]));
    expect(excepted).toEqual({ gap: false, "strokes[0]": true, "padding[0]": true, "padding[1]": true, "padding[2]": true, "padding[3]": true });
    const t = checkTree({ id: "1:2", type: "TEXT", name: "t", fontSize: { raw: 13 }, exceptions: { fontSize: "legacy" } });
    expect(t[0].excepted).toBe(true);
  });

  it("missing auto layout is excepted by an absolute or layout reason only", () => {
    const none = { layout: { mode: "NONE" as const } };
    expect(checkTree(frame({ ...none, exceptions: { absolute: "overlay" } }))[0].excepted).toBe(true);
    expect(checkTree(frame({ ...none, exceptions: { layout: "legacy" } }))[0].excepted).toBe(true);
    expect(checkTree(frame({ ...none, exceptions: { fill: "brand" } }))[0].excepted).toBe(false);
  });

  it("a legacy whole-node exception (*) excepts every finding", () => {
    const f = checkTree(frame({ name: "Frame 1", fills: [{ raw: "#4F46E5" }], exceptions: { "*": "legacy banner" } }));
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.excepted)).toBe(true);
  });

  it("does not flag raw 0 gap and padding (unset spacing)", () => {
    const zero = { raw: 0 };
    expect(checkTree(frame({ layout: { mode: "VERTICAL", gap: zero, padding: [zero, zero, zero, zero] } }))).toEqual([]);
    const f = checkTree(frame({ layout: { mode: "VERTICAL", gap: { raw: 4 }, padding: [zero, zero, { raw: 8 }, zero] } }));
    expect(f.map((x) => x.message.split(" ")[0])).toEqual(["gap", "padding[2]"]);
  });

  it("frame without auto layout flagged, text not", () => {
    const f = checkTree(frame({ layout: { mode: "NONE" } }));
    expect(f.map((x) => x.rule)).toEqual(["missing-auto-layout"]);
    expect(checkTree({ id: "1:2", type: "TEXT", name: "title" })).toEqual([]);
  });

  it("default names flagged", () => {
    expect(checkTree(frame({ name: "Frame 12" })).map((x) => x.rule)).toEqual(["default-layer-name"]);
    expect(checkTree(frame({ name: "header" }))).toEqual([]);
  });

  it("component and prop names", () => {
    const f = checkTree(frame({ component: { name: "button", props: { Variant: "a" } } }));
    const rules = f.map((x) => x.rule);
    expect(rules).toContain("component-name");
    expect(rules).toContain("prop-name");
  });

  it("walks children", () => {
    const f = checkTree(frame({ children: [{ id: "1:2", type: "TEXT", name: "t", fontSize: { raw: 14 } }] }));
    expect(f).toHaveLength(1);
    expect(f[0].nodeId).toBe("1:2");
  });
});

describe("isTokenName", () => {
  it("accepts and rejects", () => {
    expect(isTokenName("color/bg/default")).toBe(true);
    expect(isTokenName("space/4")).toBe(true);
    expect(isTokenName("Color/BG")).toBe(false);
    expect(isTokenName("bg")).toBe(false);
    expect(isTokenName("color//x")).toBe(false);
  });
});

describe("checkThemes", () => {
  it("flags names missing in one theme", () => {
    const f = checkThemes(["a/b", "a/c"], ["a/b"]);
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe("theme-mismatch");
    expect(f[0].message).toContain("a/c");
  });
});
