// In-memory stand-in for the Figma Plugin API, enough for the plugin tests. Ported from the old
// tests/token-plugin.test.mjs fake and extended; later tasks add what their commands need.
// Install with `installFakeFigma()`, which sets `globalThis.figma` (and `__html__`).

type Font = { family: string; style: string };

export type FakeNode = {
  id: string;
  type: string;
  name: string;
  parent: FakeNode | null;
  children: FakeNode[];
  x: number;
  y: number;
  width: number;
  height: number;
  removed: boolean;
  pluginData: Record<string, string>;
  [key: string]: unknown;
  appendChild(child: FakeNode): void;
  insertChild(index: number, child: FakeNode): void;
  remove(): void;
  resize(w: number, h: number): void;
  resizeWithoutConstraints(w: number, h: number): void;
  setPluginData(key: string, value: string): void;
  getPluginData(key: string): string;
};

export type FakeVariableCollection = { id: string; name: string; modes: { modeId: string; name: string }[]; variableIds: string[] };
export type FakeVariable = {
  id: string;
  name: string;
  resolvedType: string;
  variableCollectionId: string;
  valuesByMode: Record<string, unknown>;
  setValueForMode(modeId: string, value: unknown): void;
};
export type FakeTextStyle = { id: string; name: string; fontName?: Font; fontSize?: number; [key: string]: unknown };

export const DEFAULT_FONTS = ["Inter/Regular", "Inter/Medium", "Inter/Semi Bold", "Inter/Bold"];

export function createFakeFigma(opts: { fileName?: string; fonts?: string[] } = {}) {
  let seq = 0;
  const nextId = () => `1:${++seq}`;
  const nodes = new Map<string, FakeNode>();
  const collections: FakeVariableCollection[] = [];
  const variables: FakeVariable[] = [];
  const textStyles: FakeTextStyle[] = [];
  const availableFonts = new Set(opts.fonts ?? DEFAULT_FONTS);
  const loadedFonts = new Set<string>();
  const storage = new Map<string, unknown>();
  const posted: any[] = [];
  let commitUndoCalls = 0;

  function makeNode(type: string, props: Record<string, unknown> = {}): FakeNode {
    const node: FakeNode = {
      id: nextId(),
      type,
      name: type.charAt(0) + type.slice(1).toLowerCase(),
      parent: null,
      children: [],
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      removed: false,
      pluginData: {},
      appendChild(child) {
        if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child);
        child.parent = node;
        node.children.push(child);
      },
      insertChild(index: number, child: FakeNode) {
        if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child);
        child.parent = node;
        node.children.splice(index, 0, child);
      },
      remove() {
        node.removed = true;
        nodes.delete(node.id);
        if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
        node.parent = null;
      },
      resize(w, h) {
        node.width = w;
        node.height = h;
        // Like real Figma, resize turns both axes of an auto layout node to FIXED.
        if ((node as any).layoutSizingHorizontal !== undefined) (node as any).layoutSizingHorizontal = "FIXED";
        if ((node as any).layoutSizingVertical !== undefined) (node as any).layoutSizingVertical = "FIXED";
      },
      resizeWithoutConstraints(w, h) {
        node.width = w;
        node.height = h;
      },
      setPluginData(key, value) {
        node.pluginData[key] = value;
      },
      getPluginData(key) {
        return node.pluginData[key] ?? "";
      },
      setBoundVariable(field: string, variable: FakeVariable | null) {
        const bv = ((node as any).boundVariables ??= {}) as Record<string, unknown>;
        if (variable === null) delete bv[field];
        else bv[field] = { type: "VARIABLE_ALIAS", id: variable.id };
      },
      findAllWithCriteria(c: { types: string[] }) {
        const out: FakeNode[] = [];
        const walk = (n: FakeNode) => {
          for (const ch of n.children) {
            if (c.types.includes(ch.type)) out.push(ch);
            walk(ch);
          }
        };
        walk(node);
        return out;
      },
    };
    // Descriptors, not spread, so accessor props (TEXT fontName/characters) keep their getters and setters.
    Object.defineProperties(node, Object.getOwnPropertyDescriptors(props));
    nodes.set(node.id, node);
    return node;
  }

  let pagesLoaded = false;
  const root = makeNode("DOCUMENT", { name: opts.fileName ?? "Test File" });
  // dynamic-page access: searching the whole document throws until all pages are loaded.
  const rootFind = root.findAllWithCriteria as (c: { types: string[] }) => FakeNode[];
  root.findAllWithCriteria = (c: { types: string[] }) => {
    if (!pagesLoaded) throw new Error("Cannot call findAllWithCriteria on the document before figma.loadAllPagesAsync()");
    return rootFind(c);
  };
  const page = makeNode("PAGE", { name: "Page 1", selection: [] as FakeNode[] });
  root.appendChild(page);

  // New nodes land on the current page, like the real API.
  const create = (type: string, props: Record<string, unknown> = {}) => {
    const n = makeNode(type, props);
    page.appendChild(n);
    return n;
  };

  // layoutSizing* setters throw on FILL when the parent is not auto layout, like real Figma.
  function sizingAccessors() {
    const v: Record<string, string | undefined> = {};
    const prop = (key: string) => ({
      get: () => v[key],
      set(this: FakeNode, val: string) {
        const lm = this.parent?.layoutMode;
        if (val === "FILL" && (lm === undefined || lm === "NONE")) throw new Error("FILL requires an auto layout parent");
        v[key] = val;
      },
      enumerable: true,
      configurable: true,
    });
    return Object.defineProperties({}, { layoutSizingHorizontal: prop("h"), layoutSizingVertical: prop("v") });
  }

  function createText() {
    let font: Font = { family: "Inter", style: "Regular" };
    let characters = "";
    const requireLoaded = () => {
      if (!loadedFonts.has(`${font.family}/${font.style}`)) {
        throw new Error(`Font "${font.family} ${font.style}" is not loaded`);
      }
    };
    return create("TEXT", {
      // New text is black by default in Figma.
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      async setTextStyleIdAsync(id: string) {
        const st = textStyles.find((x) => x.id === id);
        if (!st) throw new Error(`Unknown style ${id}`);
        font = st.fontName as Font;
        (this as any).textStyleId = id;
      },
      get fontName() {
        return font;
      },
      set fontName(f: Font) {
        font = f;
        requireLoaded();
      },
      get characters() {
        return characters;
      },
      set characters(v: string) {
        requireLoaded();
        characters = v;
      },
    });
  }

  const figma = {
    root,
    currentPage: page,
    ui: {
      onmessage: undefined as undefined | ((msg: any) => unknown),
      postMessage(msg: unknown) {
        posted.push(msg);
      },
    },
    showUI(_html: string, _opts?: unknown) {},
    closed: null as string | null,
    closePlugin(msg?: string) {
      figma.closed = msg ?? "";
    },
    commitUndo() {
      commitUndoCalls++;
    },
    clientStorage: {
      async getAsync(key: string) {
        return storage.get(key);
      },
      async setAsync(key: string, value: unknown) {
        storage.set(key, value);
      },
      async deleteAsync(key: string) {
        storage.delete(key);
      },
      async keysAsync() {
        return [...storage.keys()];
      },
    },
    async loadAllPagesAsync() {
      pagesLoaded = true;
    },
    base64Encode(data: Uint8Array) {
      return Buffer.from(data).toString("base64");
    },
    async getStyleByIdAsync(id: string) {
      return textStyles.find((s) => s.id === id) ?? null;
    },
    async getNodeByIdAsync(id: string) {
      return nodes.get(id) ?? null;
    },
    createFrame: () =>
      create("FRAME", Object.defineProperties({
        // New frames are white by default in Figma.
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
        layoutMode: "NONE",
        itemSpacing: 0,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        primaryAxisAlignItems: "MIN",
        counterAxisAlignItems: "MIN",
        cornerRadius: 0,
      }, Object.getOwnPropertyDescriptors(sizingAccessors()))),
    createSection: () => create("SECTION"),
    createComponent: () => {
      const c: FakeNode = create("COMPONENT", {
        componentPropertyDefinitions: {} as Record<string, unknown>,
        addComponentProperty(name: string, type: string, def: unknown) {
          const key = `${name}#${++seq}`;
          (c.componentPropertyDefinitions as Record<string, unknown>)[key] = { type, defaultValue: def };
          return key;
        },
        createInstance() {
          const props: Record<string, unknown> = {};
          // A variant inside a component set: "size=large, tone=primary" gives VARIANT props keyed by
          // bare names, while other properties keep their "name#id" keys, like real Figma.
          const inSet = c.parent?.type === "COMPONENT_SET";
          if (inSet) {
            for (const pair of c.name.split(", ")) {
              const [k, v] = pair.split("=");
              props[k] = { type: "VARIANT", value: v };
            }
          }
          for (const [k, d] of Object.entries(c.componentPropertyDefinitions as Record<string, any>)) {
            props[k] = { type: d.type, value: d.defaultValue };
          }
          const i: FakeNode = create("INSTANCE", {
            name: inSet ? c.parent!.name : c.name,
            mainComponent: c,
            async getMainComponentAsync() {
              return c;
            },
            componentProperties: props,
            setProperties(p: Record<string, unknown>) {
              for (const [k, v] of Object.entries(p)) {
                if (!(k in props)) throw new Error(`Unknown property ${k}`);
                (props[k] as any).value = v;
              }
            },
          });
          return i;
        },
      });
      return c;
    },
    createText,
    combineAsVariants(components: FakeNode[], parent: FakeNode) {
      const set = makeNode("COMPONENT_SET", { componentPropertyDefinitions: {} });
      parent.appendChild(set);
      for (const c of components) set.appendChild(c);
      return set;
    },
    variables: {
      async getLocalVariableCollectionsAsync() {
        return [...collections];
      },
      async getLocalVariablesAsync(type?: string) {
        return variables.filter((v) => type === undefined || v.resolvedType === type);
      },
      async getVariableByIdAsync(id: string) {
        return variables.find((v) => v.id === id) ?? null;
      },
      // Returns a new paint carrying the alias, like the real API (paints are immutable).
      setBoundVariableForPaint(paint: any, field: string, variable: FakeVariable) {
        return { ...paint, boundVariables: { [field]: { type: "VARIABLE_ALIAS", id: variable.id } } };
      },
      createVariableCollection(name: string) {
        const n = ++seq;
        const c: FakeVariableCollection = {
          id: `VariableCollectionId:${n}`,
          name,
          modes: [{ modeId: `${n}:0`, name: "Mode 1" }],
          get variableIds() {
            return variables.filter((v) => v.variableCollectionId === c.id).map((v) => v.id);
          },
        };
        collections.push(c);
        return c;
      },
      createVariable(name: string, collection: FakeVariableCollection, type: string) {
        if (typeof collection !== "object") throw new Error("createVariable expects a collection object");
        const v: FakeVariable = {
          id: `VariableID:${++seq}`,
          name,
          resolvedType: type,
          variableCollectionId: collection.id,
          valuesByMode: {},
          setValueForMode(modeId, value) {
            if (!collection.modes.some((m) => m.modeId === modeId)) throw new Error(`Unknown mode ${modeId}`);
            v.valuesByMode[modeId] = value;
          },
        };
        variables.push(v);
        return v;
      },
    },
    async getLocalTextStylesAsync() {
      return [...textStyles];
    },
    createTextStyle() {
      let font: Font | undefined;
      const s: FakeTextStyle = {
        id: `S:${++seq}`,
        name: "",
        pluginData: {} as Record<string, string>,
        setPluginData(key: string, value: string) {
          (s.pluginData as Record<string, string>)[key] = value;
        },
        getPluginData(key: string) {
          return (s.pluginData as Record<string, string>)[key] ?? "";
        },
        setBoundVariable(field: string, variable: FakeVariable | null) {
          const bv = ((s as any).boundVariables ??= {}) as Record<string, unknown>;
          if (variable === null) delete bv[field];
          else bv[field] = { type: "VARIABLE_ALIAS", id: variable.id };
        },
        get fontName() {
          return font;
        },
        set fontName(f: Font | undefined) {
          if (!f || !loadedFonts.has(`${f.family}/${f.style}`)) throw new Error("Load the font before setting it");
          font = f;
        },
      };
      textStyles.push(s);
      return s;
    },
    // Rejects for fonts not in the allow-list, like a font that is not installed.
    async loadFontAsync(f: Font) {
      const key = `${f.family}/${f.style}`;
      if (!availableFonts.has(key)) throw new Error(`The font "${f.family} ${f.style}" could not be loaded`);
      loadedFonts.add(key);
    },
  };

  return {
    figma,
    nodes,
    page,
    collections,
    variables,
    textStyles,
    loadedFonts,
    storage,
    // Every message the plugin main thread posted to the UI, in order.
    posted,
    get commitUndoCalls() {
      return commitUndoCalls;
    },
    // Sends a message to the main thread as the UI iframe would, and waits for the handler to finish.
    async fromUi(msg: unknown) {
      await figma.ui.onmessage?.(msg);
    },
  };
}

export type FakeFigma = ReturnType<typeof createFakeFigma>;

export function installFakeFigma(opts?: Parameters<typeof createFakeFigma>[0]): FakeFigma {
  const fake = createFakeFigma(opts);
  const g = globalThis as Record<string, unknown>;
  g.figma = fake.figma;
  g.__html__ = "<html></html>";
  return fake;
}
