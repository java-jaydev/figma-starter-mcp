import { z } from "zod";
import { COMMANDS, type CommandName } from "../shared/protocol.ts";

const nonEmpty = z.string().min(1);

// A value is either a variable name or a raw value with the reason it is not a token.
export const tokenRef = z.union([
  z.strictObject({ var: nonEmpty }),
  z.strictObject({ raw: z.union([z.string(), z.number()]), reason: nonEmpty }),
]);

const ids = z.array(nonEmpty).min(1);
const limits = { maxDepth: z.number().int().min(0).optional(), maxNodes: z.number().int().min(1).optional() };
const align = z.enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"]);
const sizing = z.enum(["FIXED", "HUG", "FILL"]);

const layout = z.strictObject({
  mode: z.enum(["VERTICAL", "HORIZONTAL", "NONE"]).default("VERTICAL"),
  gap: tokenRef.optional(),
  padding: z.union([tokenRef, z.tuple([tokenRef, tokenRef, tokenRef, tokenRef])]).optional(),
  primaryAlign: align.optional(),
  counterAlign: align.optional(),
  sizing: z.strictObject({ horizontal: sizing.optional(), vertical: sizing.optional() }).optional(),
});

const textStyleDef = z.strictObject({
  name: nonEmpty,
  family: nonEmpty,
  style: nonEmpty,
  size: tokenRef,
  lineHeight: tokenRef,
});

export type ToolDef = {
  name: CommandName;
  description: string;
  input: z.ZodType;
  confirm?: (args: unknown) => boolean;
};

const empty = z.strictObject({});

const base: ToolDef[] = [
  {
    name: "status",
    description:
      "Bridge status: whether the Figma plugin is connected, the file name, and the pairing code with setup instructions when it is not. Pass renewPairingCode: true when no code is offered to get one (an unused code is kept).",
    input: z.strictObject({ renewPairingCode: z.boolean().optional() }),
  },
  {
    name: "read_selection",
    description: "Summarize the current Figma selection. Stops at maxDepth (default 4) and maxNodes (default 300) and reports how many nodes were omitted.",
    input: z.strictObject(limits),
  },
  {
    name: "read_nodes",
    description: "Summarize nodes by id. Stops at maxDepth (default 4) and maxNodes (default 300). Use it to read a subtree that another read reported as omitted.",
    input: z.strictObject({ ids, ...limits }),
  },
  {
    name: "read_page",
    description: "Summarize the current page. Stops at maxDepth (default 2) and maxNodes (default 300); a node with omitted children can be read further with read_nodes.",
    input: z.strictObject(limits),
  },
  { name: "list_variables", description: "List variable collections, their modes and variables.", input: empty },
  { name: "list_styles", description: "List text styles.", input: empty },
  { name: "list_components", description: "List components with their ids and property definitions.", input: empty },
  {
    name: "export_node",
    description: "Export a node. PNG comes back as an image; SVG as JSON text {format, base64}.",
    input: z.strictObject({ id: nonEmpty, format: z.enum(["PNG", "SVG"]), scale: z.number().positive().optional() }),
  },
  {
    name: "upsert_variables",
    description: "Create or update variables by name in one collection (single mode). Names must be lowercase slash-separated tokens, e.g. color/bg/default. COLOR values are hex strings, FLOAT values are numbers.",
    input: z.strictObject({
      collection: nonEmpty,
      variables: z.array(z.strictObject({ name: nonEmpty, type: z.enum(["COLOR", "FLOAT"]), value: z.union([z.string(), z.number()]) })).min(1),
    }),
  },
  {
    name: "upsert_text_styles",
    description: "Create or update text styles by name. The font must be installed in Figma.",
    input: z.strictObject({ styles: z.array(textStyleDef).min(1) }),
  },
  {
    name: "bind_variable",
    description:
      "Bind a variable to a node field: fills or strokes (COLOR, first solid paint), or a number field such as itemSpacing, paddingTop/paddingRight/paddingBottom/paddingLeft, topLeftRadius/topRightRadius/bottomLeftRadius/bottomRightRadius (FLOAT). cornerRadius binds all four corners.",
    input: z.strictObject({ nodeId: nonEmpty, field: nonEmpty, var: nonEmpty }),
  },
  {
    name: "create_section",
    description: "Create a section on the current page.",
    input: z.strictObject({
      name: nonEmpty,
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
    }),
  },
  {
    name: "create_frame",
    description:
      "Create a frame. Defaults to vertical auto layout. layout.mode NONE (absolute positioning) requires absolute.reason. Colors, spacing and radius take a variable ({var}) or a raw value with a reason ({raw, reason}); each reason is recorded for its field. Without fill the frame has no fill.",
    input: z.strictObject({
      parentId: nonEmpty.optional(),
      name: nonEmpty,
      layout: layout.optional(),
      fill: tokenRef.optional(),
      radius: tokenRef.optional(),
      absolute: z.strictObject({ reason: nonEmpty }).optional(),
    }),
  },
  {
    name: "create_text",
    description: "Create a text node with an existing text style (by name). fill takes a color variable ({var}) or a raw value with a reason; without it the text keeps Figma's default black.",
    input: z.strictObject({ parentId: nonEmpty, text: z.string(), textStyle: nonEmpty, fill: tokenRef.optional() }),
  },
  {
    name: "create_component",
    description: "Create a component. The name must follow the component naming rule.",
    input: z.strictObject({ parentId: nonEmpty.optional(), name: nonEmpty }),
  },
  {
    name: "add_component_property",
    description:
      "Add a BOOLEAN, TEXT or INSTANCE_SWAP property to a component and link it to a layer inside it: TEXT drives the layer's text, BOOLEAN its visibility, INSTANCE_SWAP its component. TEXT links to the only text layer when layerId is omitted; BOOLEAN and INSTANCE_SWAP link only when layerId is given. Variants are not supported in v1; the user makes them in Figma (select components, Combine as variants).",
    input: z.strictObject({
      componentId: nonEmpty,
      name: nonEmpty,
      type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP"]),
      default: z.union([z.string(), z.boolean()]),
      layerId: nonEmpty.optional(),
    }),
  },
  {
    name: "create_instance",
    description: "Create an instance of a component by name.",
    input: z.strictObject({ componentName: nonEmpty, parentId: nonEmpty }),
  },
  {
    name: "set_instance_properties",
    description: "Set component properties on an instance.",
    input: z.strictObject({ id: nonEmpty, props: z.record(z.string(), z.union([z.string(), z.boolean()])) }),
  },
  { name: "rename", description: "Rename a node. Default names such as Frame 1 are rejected.", input: z.strictObject({ id: nonEmpty, name: nonEmpty }) },
  {
    name: "move",
    description: "Move a node to a new parent and/or position.",
    input: z.strictObject({ id: nonEmpty, parentId: nonEmpty.optional(), x: z.number().optional(), y: z.number().optional(), index: z.number().int().min(0).optional() }),
  },
  {
    name: "resize",
    description: "Resize a node.",
    input: z.strictObject({ id: nonEmpty, width: z.number().positive().optional(), height: z.number().positive().optional() }),
  },
  {
    name: "set_auto_layout",
    description: "Set auto layout on a frame. layout.mode NONE requires absolute.reason.",
    input: z.strictObject({ id: nonEmpty, layout, absolute: z.strictObject({ reason: nonEmpty }).optional() }),
  },
  {
    name: "delete_nodes",
    description: "Delete nodes. The plugin asks the user to confirm risky deletes (5 or more nodes, 50 or more layers counting everything inside, or components).",
    input: z.strictObject({ ids }),
    confirm: () => true,
  },
  {
    name: "lint",
    description: "Check the selection or the current page against the design rules. A finding whose field has a recorded exception reason is hidden unless includeExcepted.",
    input: z.strictObject({ scope: z.enum(["selection", "page"]), includeExcepted: z.boolean().optional() }),
  },
];

const byName = new Map(base.map((t) => [t.name, t]));

const batchItem = z.strictObject({
  name: z.enum(COMMANDS.filter((c) => c !== "batch") as [CommandName, ...CommandName[]]),
  args: z.record(z.string(), z.unknown()),
});

const batch: ToolDef = {
  name: "batch",
  description:
    "Run up to 100 commands in order as one undo step. Stops at the first error. The plugin asks the user once to confirm all destructive items before anything runs.",
  input: z
    .strictObject({ commands: z.array(batchItem).min(1).max(100) })
    .superRefine((v, ctx) => {
      v.commands.forEach((c, i) => {
        const r = byName.get(c.name)?.input.safeParse(c.args);
        if (r && !r.success) {
          for (const issue of r.error.issues) {
            ctx.addIssue({ code: "custom", path: ["commands", i, "args", ...issue.path], message: issue.message });
          }
        }
      });
    }),
  confirm: () => true,
};

export const TOOLS: ToolDef[] = [...base, batch];
