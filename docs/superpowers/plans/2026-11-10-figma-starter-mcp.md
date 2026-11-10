# figma-starter-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local MCP bridge (Node server + Figma development plugin over a localhost WebSocket, no Figma token, no REST) that lets AI coding agents read and write Figma on the free Starter plan, with developer-friendly rules enforced at write time and checked by a linter, shipped as one repo for Claude Code, Gemini CLI, Codex and Grok Build.

**Architecture:** Each AI session starts `figma-starter-mcp` over stdio. The first process to bind `127.0.0.1:39917` becomes the hub; later processes connect to the hub as peers. The Figma plugin's UI iframe holds the WebSocket (the plugin main thread has no network access) and relays commands to the main thread, which runs Plugin API calls. Rules live in one pure module shared by the plugin (enforcement and lint) and documented in the skills.

**Tech Stack:** TypeScript 5, Node >= 20, `@modelcontextprotocol/sdk`, `zod`, `ws`, `vitest`, `esbuild` (plugin bundle), `tsc` (server), `@figma/plugin-typings`.

**Spec:** `docs/superpowers/specs/2026-11-10-figma-free-bridge-design.md` (approved 2026-11-10). Read it before any task.

## Global Constraints

- **Clean-room:** never open source files of Figma Console MCP, Figwright, Talk to Figma MCP, Framelink or their forks. Allowed references: Figma Plugin API docs (developers.figma.com/docs/plugins), Figma manifest docs, MCP spec (modelcontextprotocol.io), official MCP TypeScript SDK docs/README, docs of `ws`, `zod`, `vitest`, `esbuild`. `docs/research/prior-art.md` (README-level notes) is the only allowed record of other projects.
- No Figma personal access token anywhere, no call to `api.figma.com`. A test greps for both (Task 12).
- Server binds `127.0.0.1` only. Fixed port `39917`. Plugin manifest `networkAccess.allowedDomains: ["none"]`, `devAllowedDomains: ["ws://localhost:39917"]`, with `reasoning`.
- No em dash (U+2014) or en dash (U+2013) in any file. Hyphen only. A test enforces it (Task 12).
- No personal info (email, account names other than the repo owner path in install URLs) in files.
- Git: never commit on `main`. One branch per task group, in a worktree `../figma-free-course.<branch>`; merge by PR. Before any `git push`/`gh`: `gh auth status`, active account must be the repo owner account (ask the user if not).
- Starter limits to respect in generated structure: 3 pages per file, 1 mode per variable collection, no team library.
- Names: npm package and bin `figma-starter-mcp`; Claude plugin / Gemini extension `figma-starter`; GitHub repo `figma-starter-mcp`; skills `figma-build` and `figma-to-code` (names are this plan's call, spec left them open).
- Plugin data namespace for rule exceptions: key `fsm.exception` on the node, value = reason string.
- Confirmation required: delete of 5 or more nodes in one request, or delete of any component, component set, variable, variable collection or style. Confirm timeout 120 s. Normal request timeout 30 s.
- Docs languages: README and `docs/` in ko (source), en, ja, zh. Skills and rules reference: ko only. Plugin UI and error messages: English.

## Review Focus

1. Plugin not running or Figma closed when a tool is called: tool returns `PLUGIN_NOT_CONNECTED` with one-line fix ("Open Figma desktop, run Plugins > Development > figma-starter"), never hangs. Test in Task 5.
2. Two AI sessions at once, then the hub session exits: the remaining session takes over the port within 3 s and the plugin reconnects with the stored secret, no re-pairing. Test in Task 4.
3. A node id from an earlier call no longer exists (user deleted it or switched file): `NODE_NOT_FOUND` naming the id and the current file name. Test in Task 7.
4. `TokenRef` names a variable that does not exist: `VARIABLE_NOT_FOUND` with up to 3 closest names. Test in Task 8.
5. Reading a huge selection: summary stops at `maxDepth` (default 4) and `maxNodes` (default 300) and says how many nodes were omitted. Test in Task 7.

---

## File Structure

```text
package.json                 name/bin figma-starter-mcp, scripts: build, test, prepare
tsconfig.json                server + shared (NodeNext, strict)
tsconfig.plugin.json         plugin + shared (DOM, figma typings)
scripts/build-plugin.mjs     esbuild: src/plugin/code.ts -> dist/plugin/code.js, inline ui -> dist/plugin/ui.html, copy manifest
src/shared/protocol.ts       wire types, error codes, constants
src/shared/summary.ts        NodeSummary type
src/shared/rules.ts          rule ids, pure checks on NodeSummary, name validators
src/shared/tokens.ts         TokenRef type, nearest-name helper
src/server/cli.ts            entry: `figma-starter-mcp` (stdio MCP) and `figma-starter-mcp plugin-path`
src/server/pairing.ts        code generation, secret store
src/server/hub.ts            WebSocket hub: plugin auth, peer routing, timeouts
src/server/peer.ts           connect to hub or become hub, takeover
src/server/tools.ts          MCP tool table: name, zod input, command mapping
src/server/mcp.ts            McpServer wiring over a Bridge interface
src/plugin/manifest.json
src/plugin/ui.html           socket, pairing form, confirm dialog, log
src/plugin/code.ts           main thread dispatcher
src/plugin/commands/read.ts
src/plugin/commands/tokens.ts
src/plugin/commands/structure.ts
src/plugin/commands/edit.ts
src/plugin/commands/lint.ts
src/plugin/commands/batch.ts
src/plugin/resolve.ts        TokenRef -> Variable / raw with exception
src/plugin/summarize.ts      SceneNode -> NodeSummary
tests/fake-figma.ts          fake `figma` global (grown from tests/token-plugin.test.mjs)
tests/**.test.ts
skills/figma-build/SKILL.md
skills/figma-to-code/SKILL.md
skills/figma-build/references/rules.md          single source of the 7 rules (ko)
skills/figma-build/references/limits-and-sources.md
.claude-plugin/plugin.json, .claude-plugin/marketplace.json, .mcp.json
gemini-extension.json
docs/workshop/{ko,en,ja,zh}/  former course material
docs/install/{codex,grok}.md (+ en/ja/zh)
README.md, README.en.md, README.ja.md, README.zh.md
```

---

### Task 0: Figma terms gate

**Files:** Create `docs/research/figma-terms.md`

- [ ] **Step 1:** Read Figma Developer Terms and the plugin review guidelines (official figma.com / help.figma.com pages only). Record, with URLs and quotes, anything about automated control of plugins, local network servers, or AI agents.
- [ ] **Step 2:** Decide: `CLEAR` or `RESTRICTED`. If `RESTRICTED`, stop the whole plan and report the quotes to the user. Do not continue.
- [ ] **Step 3:** Commit on branch `chore/terms-check`.

### Task 1: Repo reshape and TypeScript skeleton

**Files:**
- Move: `skills/figma-free-design-system/references/{ko,en,ja,zh}/{course-outline,labs}.md` -> `docs/workshop/<lang>/`
- Move: `skills/figma-free-design-system/references/ko/limits-and-sources.md` -> `skills/figma-build/references/limits-and-sources.md`; delete en/ja/zh copies of it (skills are ko only)
- Delete: `skills/figma-free-design-system/` (rest), `tests/token-plugin.test.mjs` after its fake is ported (keep the file until Task 8 lands; delete there)
- Keep `skills/figma-free-design-system/assets/token-plugin/code.js` moved to `docs/workshop/token-plugin/` as workshop material
- Create: `package.json`, `tsconfig.json`, `tsconfig.plugin.json`, `scripts/build-plugin.mjs`, `tests/smoke.test.ts`
- Modify: `AGENTS.md` (structure section, test command `npm test`)

- [ ] **Step 1:** Rename the GitHub repo: `gh repo rename figma-starter-mcp -R java-jaydev/figma-free-design-system --yes`, then `git remote set-url origin https://github.com/java-jaydev/figma-starter-mcp.git`.
- [ ] **Step 2:** Do the moves above. Fix relative links inside moved docs (workshop docs now reference `../token-plugin/`).
- [ ] **Step 3:** Write `tests/smoke.test.ts`: imports `PORT` from `src/shared/protocol.ts` and asserts `PORT === 39917`.
- [ ] **Step 4:** `npm test` fails (module missing). Create `package.json` (`"type": "module"`, `"bin": {"figma-starter-mcp": "dist/server/cli.js"}`, `"files": ["dist", "skills"]`, scripts `build` = `tsc -p tsconfig.json && node scripts/build-plugin.mjs`, `test` = `vitest run`, `prepare` = `npm run build`), install exact current versions of the Tech Stack packages, and a minimal `src/shared/protocol.ts` exporting `PORT`.
- [ ] **Step 5:** `npm test` passes; `npm run build` produces `dist/server/` (plugin script may no-op until Task 6).
- [ ] **Step 6:** Commit, PR, merge (branch `chore/reshape`).

### Task 2: Shared protocol, tokens and rules

**Files:** `src/shared/protocol.ts`, `src/shared/summary.ts`, `src/shared/tokens.ts`, `src/shared/rules.ts`, `tests/shared/rules.test.ts`, `tests/shared/tokens.test.ts`

**Interfaces (Produces):**
```ts
// protocol.ts
export const PORT = 39917, REQUEST_TIMEOUT_MS = 30_000, CONFIRM_TIMEOUT_MS = 120_000, CONFIRM_DELETE_THRESHOLD = 5;
export type ErrorCode = "PLUGIN_NOT_CONNECTED" | "PAIRING_REQUIRED" | "AUTH_FAILED" | "TIMEOUT" | "USER_DECLINED"
  | "NODE_NOT_FOUND" | "VARIABLE_NOT_FOUND" | "STYLE_NOT_FOUND" | "FONT_NOT_AVAILABLE" | "RULE_VIOLATION" | "INVALID_INPUT";
export type Command = { id: string; name: CommandName; args: unknown };
export type Result = { id: string; ok: true; data: unknown } | { id: string; ok: false; code: ErrorCode; message: string; hint?: string };
export type Envelope =
  | { t: "hello-plugin"; secret?: string; code?: string }      // plugin -> hub
  | { t: "hello-peer"; secret: string }                         // peer server -> hub
  | { t: "welcome"; secret: string } | { t: "denied"; code: ErrorCode }
  | { t: "cmd"; sig: string; cmd: Command } | { t: "res"; res: Result };
export type CommandName = (typeof COMMANDS)[number];
export const COMMANDS = ["status","read_selection","read_nodes","read_page","list_variables","list_styles","list_components",
  "export_node","upsert_variables","upsert_text_styles","bind_variable","create_section","create_frame","create_text",
  "create_component","add_component_property","create_instance","set_instance_properties","rename","move","resize",
  "set_auto_layout","delete_nodes","lint","batch"] as const;
// tokens.ts
export type TokenRef = { var: string } | { raw: string | number; reason: string };
export function nearestNames(target: string, names: string[], n = 3): string[]; // Levenshtein, ties alphabetical
// summary.ts
export type NodeSummary = { id: string; type: string; name: string; children?: NodeSummary[]; omitted?: number;
  layout?: { mode: "HORIZONTAL" | "VERTICAL" | "NONE"; gap?: Bound; padding?: [Bound,Bound,Bound,Bound];
    primaryAlign?: string; counterAlign?: string; sizing?: { h: string; v: string } };
  fills?: Bound[]; strokes?: Bound[]; radius?: Bound; textStyle?: string; fontSize?: Bound; text?: string;
  component?: { name: string; props: Record<string, string | boolean> }; exception?: string };
export type Bound = { var: string } | { raw: string | number };
// rules.ts
export type RuleId = "hardcoded-value" | "token-name" | "theme-mismatch" | "missing-auto-layout" | "component-name" | "prop-name" | "default-layer-name";
export type Finding = { rule: RuleId; nodeId: string; message: string; fix: string; excepted: boolean };
export function checkTree(root: NodeSummary): Finding[];
export function checkThemes(light: string[], dark: string[]): Finding[]; // nodeId "" for collection-level
export const isTokenName: (s: string) => boolean;     // /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)+$/
export const isComponentName: (s: string) => boolean; // PascalCase, optional "/" groups: /^([A-Z][A-Za-z0-9]*)(\/[A-Z][A-Za-z0-9]*)*$/
export const isPropName: (s: string) => boolean;      // camelCase /^[a-z][A-Za-z0-9]*$/
export const DEFAULT_NAME = /^(Frame|Group|Rectangle|Ellipse|Text|Vector|Line|Polygon|Star|Component|Instance) \d+$/;
```

- [ ] **Step 1: Failing tests** in `tests/shared/rules.test.ts`:
  - `hardcoded fill is flagged`: frame with `fills:[{raw:"#4F46E5"}]` -> one finding `hardcoded-value`, `excepted:false`.
  - `exception marks finding excepted`: same node with `exception:"brand gradient"` -> finding `excepted:true`.
  - `frame without auto layout flagged, text not`: `{type:"FRAME", layout:{mode:"NONE"}}` -> `missing-auto-layout`; TEXT node -> none.
  - `default names flagged`: name `"Frame 12"` -> `default-layer-name`; `"header"` -> none.
  - `component and prop names`: `component:{name:"button",props:{Variant:"a"}}` -> `component-name` and `prop-name`.
  - `isTokenName`: true for `color/bg/default`, `space/4`; false for `Color/BG`, `bg`, `color//x`.
  - `checkThemes(["a/b","a/c"],["a/b"])` -> one `theme-mismatch` mentioning `a/c`.
  - `tests/shared/tokens.test.ts`: `nearestNames("color/bg/defualt", ["color/bg/default","color/bg/subtle","space/4"])[0] === "color/bg/default"`.
- [ ] **Step 2:** Run `npx vitest run tests/shared` -> FAIL.
- [ ] **Step 3:** Implement the interfaces above. `checkTree` walks recursively; `hardcoded-value` covers fills, strokes, radius, fontSize, gap, padding when the Bound is `raw`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit (branch `feat/core`, which Tasks 2-5 share; PR after Task 5).

### Task 3: Pairing and secret store

**Files:** `src/server/pairing.ts`, `tests/server/pairing.test.ts`

**Interfaces (Produces):**
```ts
export function newPairingCode(): string;                 // 6 chars from "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export function newSecret(): string;                      // 32 random bytes, base64url
export type Secrets = { server: string; plugin?: string };   // server: hub<->peer auth, created on first start; plugin: set by pairing
export type SecretStore = { load(): Promise<Secrets | null>; save(s: Secrets): Promise<void>; clearPlugin(): Promise<void> };
export function fileSecretStore(dir?: string): SecretStore; // default dir: $XDG_CONFIG_HOME or ~/.config, + "/figma-starter-mcp/pairing.json", file mode 0600
export function sign(secret: string, payload: string): string; // HMAC-SHA256 hex
export function safeEqual(a: string, b: string): boolean;      // timingSafeEqual
```
- [ ] **Step 1: Failing tests:** code length 6 and alphabet; two secrets differ; store round-trip in a temp dir; file mode `0o600`; `clearPlugin()` keeps `server` and removes `plugin`; `sign` deterministic; `safeEqual` false on different length.
- [ ] **Step 2:** FAIL. **Step 3:** implement with `node:crypto`, `node:fs/promises`. **Step 4:** PASS. **Step 5:** commit.

### Task 4: Hub, peers and takeover

**Files:** `src/server/hub.ts`, `src/server/peer.ts`, `tests/server/hub.test.ts`

**Interfaces:**
- Consumes: Task 2 `Envelope`, `Command`, `Result`, constants; Task 3 store, `sign`, `safeEqual`, `newPairingCode`.
- Produces:
```ts
export interface Bridge { send(name: CommandName, args: unknown, opts?: { confirm?: boolean }): Promise<Result>; status(): BridgeStatus; close(): Promise<void> }
export type BridgeStatus = { role: "hub" | "peer"; pluginConnected: boolean; pairingCode?: string; fileName?: string };
export function startBridge(opts: { port?: number; store: SecretStore; host?: "127.0.0.1" }): Promise<Bridge>; // in peer.ts: try listen -> hub; EADDRINUSE -> peer; on peer socket close -> retry listen within 3 s
```
Hub start: if `store.load()` is null or lacks `server`, create and save `server`. Hub rules: plugin `hello-plugin` with a valid stored `plugin` secret -> `welcome`; with the current pairing code -> new secret saved, `welcome{secret}`; else `denied AUTH_FAILED`. Peers must send `hello-peer` with the stored `server` secret. Every `cmd` carries `sig = sign(secret, cmd.id + cmd.name)`, using `server` on peer links and `plugin` on the plugin link; plugin and hub reject bad `sig`. Reject any connection whose `Origin` header is present and not `null`/figma (the plugin iframe sends `null`). Requests with `confirm` use `CONFIRM_TIMEOUT_MS`, others `REQUEST_TIMEOUT_MS`. No plugin -> immediate `PLUGIN_NOT_CONNECTED` with hint text from Review Focus 1.

- [ ] **Step 1: Failing tests** (real sockets on a random free port, fake plugin client built with `ws`):
  - `pairs with code then reconnects with secret`.
  - `rejects wrong code and unsigned cmd` (`AUTH_FAILED`).
  - `rejects foreign Origin` (`Origin: https://evil.example`).
  - `no plugin -> PLUGIN_NOT_CONNECTED` within 100 ms.
  - `request timeout -> TIMEOUT` (use fake timers or a 50 ms override option).
  - `second bridge becomes peer and routes through hub`.
  - `hub closes -> peer takes over within 3 s and plugin reconnects with stored secret` (Review Focus 2).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit.

### Task 5: MCP tools and CLI

**Files:** `src/server/tools.ts`, `src/server/mcp.ts`, `src/server/cli.ts`, `tests/server/mcp.test.ts`

**Interfaces:**
- Consumes: Task 4 `Bridge`; Task 2 `COMMANDS`, `TokenRef`.
- Produces: `export const TOOLS: { name: CommandName; description: string; input: z.ZodTypeAny; confirm?: (args) => boolean }[]` and `export function createMcpServer(bridge: Bridge): McpServer`.
- Tool names are the `COMMANDS` strings. Every color/spacing/radius/font-size input is a `TokenRef` zod schema; frames default `layout.mode = "VERTICAL"`. `delete_nodes.confirm` = `ids.length >= 5 || args.includesSystemNodes`; the plugin re-checks node types (it knows if a node is a component). `status` returns `BridgeStatus` plus, when unpaired, the pairing code and the instruction sentence.
- CLI: no args -> `startBridge` + MCP over `StdioServerTransport`; `plugin-path` -> prints absolute path of `dist/plugin/manifest.json`; `unpair` -> `store.clearPlugin()`. Logs go to stderr only (stdout is MCP).

- [ ] **Step 1: Failing tests** with a fake `Bridge` and the SDK's in-memory client transport: tool list equals `COMMANDS`; `create_frame` with `fill:{raw:"#fff"}` but no `reason` -> `INVALID_INPUT`; `delete_nodes` with 5 ids sets `confirm:true`; Review Focus 1 message text present when bridge returns `PLUGIN_NOT_CONNECTED`; `plugin-path` prints a path ending in `dist/plugin/manifest.json`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, plus `npm run build` and `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`-style handshake via the SDK client in the test, not by hand.
- [ ] **Step 5:** Commit, PR `feat/core`, merge.

### Task 6: Plugin shell

**Files:** `src/plugin/manifest.json`, `src/plugin/ui.html`, `src/plugin/code.ts`, `scripts/build-plugin.mjs`, `tests/fake-figma.ts`, `tests/plugin/dispatch.test.ts`

**Interfaces:**
- Produces: `export type Handler = (args: any, ctx: Ctx) => Promise<unknown>`; `export type Ctx = { confirm(summary: string): Promise<boolean> }`; `export function register(name: CommandName, h: Handler): void`; `export async function dispatch(cmd: Command, ctx: Ctx): Promise<Result>` in `code.ts`. Handlers throw `PluginError(code: ErrorCode, message, hint?)`; dispatch maps it to `Result`. Each successful write ends with `figma.commitUndo()`.
- Manifest: `name "figma-starter"`, `id "figma-starter-dev"`, `api "1.0.0"`, `main "code.js"`, `ui "ui.html"`, `editorType ["figma"]`, `documentAccess "dynamic-page"`, `networkAccess` per Global Constraints with `reasoning: "Connects to the figma-starter-mcp server running on this computer."`.
- UI: shows status, a 6-char code input when no secret in `figma.clientStorage` (main thread reads/writes storage and posts it to UI), log of last 20 commands, confirm dialog (Approve / Decline) driven by `ctx.confirm`, "Unpair" button. Reconnect every 2 s while disconnected.
- `tests/fake-figma.ts`: port the fake from `tests/token-plugin.test.mjs` to TS and extend it as later tasks need (nodes with ids, `getNodeByIdAsync`, `commitUndo`, `clientStorage`, `createFrame`, `createText`, `createComponent`, `variables.*`, `getLocalTextStylesAsync`, `loadFontAsync` that rejects for fonts not in an allow-list).

- [ ] **Step 1: Failing tests:** unknown command -> `INVALID_INPUT`; handler throwing `PluginError("NODE_NOT_FOUND", ...)` -> same code in `Result`; successful handler calls `commitUndo` once.
- [ ] **Step 2:** FAIL. **Step 3:** implement; `build-plugin.mjs` bundles `code.ts` (target es2017, Figma sandbox) and inlines UI script into `dist/plugin/ui.html`, copies manifest.
- [ ] **Step 4:** PASS; `npm run build` produces `dist/plugin/{manifest.json,code.js,ui.html}`.
- [ ] **Step 5:** Commit (branch `feat/plugin`, shared by Tasks 6-10; PR after Task 10).

### Task 7: Read commands and summaries

**Files:** `src/plugin/summarize.ts`, `src/plugin/commands/read.ts`, `tests/plugin/read.test.ts`

**Interfaces:** `summarize(node: SceneNode, opts: { maxDepth: number; maxNodes: number }): Promise<NodeSummary>` (Bound from `boundVariables` -> `{var: variable.name}`, else `{raw}`; colors as `#RRGGBB` or `#RRGGBBAA`; `exception` from plugin data `fsm.exception`). Commands: `status` -> `{fileName, pageName, selectionCount}`; `read_selection {maxDepth=4,maxNodes=300}`; `read_nodes {ids}`; `read_page`; `list_variables` -> `{collections:[{name, modes, variables:[{name,type,valuesByMode}]}]}`; `list_styles`; `list_components` -> name, id, property definitions; `export_node {id, format:"PNG"|"SVG", scale=2}` -> base64.

- [ ] **Step 1: Failing tests:** bound fill summarizes as `{var:"color/bg/default"}`; raw fill as `{raw:"#4F46E5"}`; 400-node tree with `maxNodes:300` -> `omitted` totals 100 (Review Focus 5); `read_nodes` with a missing id -> `NODE_NOT_FOUND` whose message contains the id and `figma.root.name` (Review Focus 3); instance summarizes `component.name` and props.
- [ ] **Step 2-4:** FAIL, implement, PASS. **Step 5:** commit.

### Task 8: Token commands and TokenRef resolution

**Files:** `src/plugin/resolve.ts`, `src/plugin/commands/tokens.ts`, `tests/plugin/tokens.test.ts`; delete `tests/token-plugin.test.mjs`

**Interfaces:** `resolveColor(ref: TokenRef, node?: SceneNode): Promise<{ variable?: Variable; raw?: RGBA }>` and `resolveNumber(...)`; a `raw` ref writes `fsm.exception` = reason on the node. Commands: `upsert_variables {collection, variables:[{name, type:"COLOR"|"FLOAT", value}]}` (idempotent by name, one mode, name must pass `isTokenName` else `RULE_VIOLATION`); `upsert_text_styles {styles:[{name, family, style, size, lineHeight}]}` (load font first; missing font -> `FONT_NOT_AVAILABLE` naming family/style and "restart Figma after installing fonts"); `bind_variable {nodeId, field, var}`.
- Absorb the logic of `docs/workshop/token-plugin/code.js` (author's own code) into these commands.

- [ ] **Step 1: Failing tests:** upsert twice -> no duplicates (port of the old idempotency test); `collections[i].modes.length === 1`; bad name `Color/BG` -> `RULE_VIOLATION`; `{var:"color/bg/defualt"}` -> `VARIABLE_NOT_FOUND` listing `color/bg/default` (Review Focus 4); missing font -> `FONT_NOT_AVAILABLE`; `raw` ref records the reason in plugin data.
- [ ] **Step 2-4:** FAIL, implement, PASS. **Step 5:** commit.

### Task 9: Structure and edit commands

**Files:** `src/plugin/commands/structure.ts`, `src/plugin/commands/edit.ts`, `tests/plugin/structure.test.ts`, `tests/plugin/edit.test.ts`

**Interfaces:** `create_section {name, x?, y?, width?, height?}`; `create_frame {parentId?, name, layout?: {mode, gap: TokenRef, padding: TokenRef | TokenRef[4], primaryAlign?, counterAlign?, sizing?}, fill?: TokenRef, radius?: TokenRef, absolute?: {reason}}` (`layout.mode:"NONE"` requires `absolute.reason`, stored as exception); `create_text {parentId, text, textStyle: string}` (style name required; raw font only via `{raw..., reason}`); `create_component {parentId?, name}` (must pass `isComponentName`); `add_component_property {componentId, name, type, default}` (`isPropName`); `create_instance {componentName, parentId}`; `set_instance_properties {id, props}`; `rename {id, name}` (rejects `DEFAULT_NAME`); `move`, `resize`, `set_auto_layout`; `delete_nodes {ids}` -> calls `ctx.confirm` when count >= 5 or any node is COMPONENT/COMPONENT_SET; decline -> `USER_DECLINED`, nothing deleted.

- [ ] **Step 1: Failing tests:** frame default is auto layout VERTICAL; `layout.mode:"NONE"` without reason -> `RULE_VIOLATION`; component name `button` -> `RULE_VIOLATION`; text without style -> `INVALID_INPUT`; deleting 5 nodes calls confirm, decline leaves all 5; deleting 1 component calls confirm; deleting 2 frames does not.
- [ ] **Step 2-4:** FAIL, implement, PASS. **Step 5:** commit.

### Task 10: Lint and batch

**Files:** `src/plugin/commands/lint.ts`, `src/plugin/commands/batch.ts`, `tests/plugin/lint.test.ts`, `tests/plugin/batch.test.ts`

**Interfaces:** `lint {scope: "selection"|"page", includeExcepted=false}` -> `{findings: Finding[], checked: number}` using `summarize` + `checkTree`, plus `checkThemes` on collections named `Color / Light` and `Color / Dark` when both exist. `batch {commands: {name, args}[]}` (max 100): if any item needs confirmation, one `ctx.confirm` listing all destructive items before running anything; runs sequentially; stops at first error and returns per-item results; one `commitUndo` at the end.

- [ ] **Step 1: Failing tests:** lint finds hardcoded + default-name on a fixture page; excepted findings hidden unless `includeExcepted`; theme mismatch reported; batch with one delete of 6 nodes asks once and on decline runs nothing; batch error at item 2 returns item 1 ok, item 2 error, item 3 not run.
- [ ] **Step 2-4:** FAIL, implement, PASS. **Step 5:** commit, PR `feat/plugin`, merge.

### Task 11: Skills and rules reference

**Files:** `skills/figma-build/SKILL.md`, `skills/figma-build/references/rules.md`, `skills/figma-to-code/SKILL.md`, `tests/skills.test.ts`

- `rules.md`: the 7 rules of spec section 6 in Korean, each with the `RuleId` it maps to (rule 7 file structure has no lint id), the exception syntax (`{raw, reason}`, `absolute.reason`), and Starter vs paid theme handling.
- `figma-build`: steps of spec 5.4 (status, read variables/components, tokens first, build with auto layout, `lint`, `export_node` to show result); never propose the official Figma MCP for reads (quota); link `references/rules.md` and `references/limits-and-sources.md`. Star request greeting from the old skill kept (4 languages), updated URL.
- `figma-to-code`: read selection, map `var` names to project tokens (search the repo for the token file first), map components/props to existing components, write code, report unmapped items.
- Descriptions in frontmatter: Korean + one English sentence each, so all four agents trigger.

- [ ] **Step 1: Failing test** `tests/skills.test.ts`: every `RuleId` in `src/shared/rules.ts` appears in `rules.md`; each SKILL.md has `name` equal to its folder; no `figma-free-design-system` string left in repo.
- [ ] **Step 2-4:** FAIL, write, PASS. **Step 5:** commit (branch `feat/skills-packaging`, shared with Task 12).

### Task 12: Packaging, docs and repo-wide checks

**Files:** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, `gemini-extension.json`, `docs/install/{codex,grok}.md` (+ `en/ja/zh`), `README*.md`, `AGENTS.md`, `tests/repo.test.ts`

- `.mcp.json` and `gemini-extension.json` `mcpServers.figma-starter`: `{"command":"npx","args":["-y","github:java-jaydev/figma-starter-mcp"]}`. Plugin/extension name `figma-starter`, marketplace name `figma-starter-mcp`.
- Codex and Grok docs: register the same command per each tool's current official MCP config docs (check them at this step), copy `skills/*` to `~/.agents/skills/`.
- README (ko source, then en/ja/zh): keep banner and badge style; new sections: what it is, why (Starter limits table with sources), install per agent, first run (`plugin-path`, import manifest, pair), rules summary linking `rules.md`, workshop link `docs/workshop/`, security notes (localhost, pairing, confirmations).
- [ ] **Step 1: Failing test** `tests/repo.test.ts`: no U+2013/U+2014 in tracked text files; no `api.figma.com` and no `figd_` / `X-Figma-Token` strings in `src/`; manifest `devAllowedDomains` equals `["ws://localhost:39917"]`; `.mcp.json` and `gemini-extension.json` commands identical; all relative links in README*.md and docs resolve.
- [ ] **Step 2-4:** FAIL, write, PASS; `claude plugin validate .` passes (author warning allowed).
- [ ] **Step 5:** Commit, PR `feat/skills-packaging`, merge.

### Task 13: Real-app verification

**Files:** Create `docs/verification/2026-xx-xx-v1.md` (date of run)

- [ ] **Step 1:** Fresh clone, `npm ci && npm run build && npm test` -> all pass.
- [ ] **Step 2:** In Claude Code: install via marketplace; in Figma desktop (free account): import `plugin-path` manifest, pair, then scenes A, B, C from spec section 2. Record pass/fail per scene with screenshots via `export_node`.
- [ ] **Step 3:** Same install and scene A in Gemini CLI.
- [ ] **Step 4:** Security checks from spec section 11: foreign Origin, wrong code, unsigned message all rejected (reuse Task 4 tests against the real hub with the real plugin connected).
- [ ] **Step 5:** Two sessions at once, close the first, confirm the second keeps working without re-pairing.
- [ ] **Step 6:** Commit the record (branch `docs/v1-verification`), PR, merge. Report to the user: what passed, what failed, what was not run (Codex, Grok: docs only).
