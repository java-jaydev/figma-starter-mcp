export type Bound = { var: string } | { raw: string | number };

// Fields an exception reason can be recorded for. "*" (in NodeSummary.exceptions) is a legacy
// whole-node reason, stored as a plain string before reasons were kept per field.
export type ExceptionField = "fill" | "stroke" | "radius" | "gap" | "padding" | "fontSize" | "lineHeight" | "absolute" | "layout";

export type NodeSummary = {
  id: string;
  type: string;
  name: string;
  children?: NodeSummary[];
  omitted?: number;
  layout?: {
    mode: "HORIZONTAL" | "VERTICAL" | "NONE";
    gap?: Bound;
    padding?: [Bound, Bound, Bound, Bound];
    primaryAlign?: string;
    counterAlign?: string;
    sizing?: { h: string; v: string };
  };
  fills?: Bound[];
  strokes?: Bound[];
  radius?: Bound;
  textStyle?: string;
  fontSize?: Bound;
  text?: string;
  component?: { name: string; props: Record<string, string | boolean> };
  exceptions?: Partial<Record<ExceptionField | "*", string>>;
};
