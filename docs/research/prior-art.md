# Prior art: free-plan Figma <-> AI coding agent bridges

Researched 2026-11-10. 13 web requests. Star counts and dates are as reported by the fetched pages on that day. "UNVERIFIED" marks claims taken from third-party listings or not confirmed on a primary source.

## 1. The constraint that decides everything: Figma's own limits

### REST API (rate limits effective 2025-11-17)
Source: https://developers.figma.com/docs/rest-api/rate-limits/

| Tier | Endpoints | View/Collab seat (any plan, incl. Starter) | Starter Dev/Full |
|---|---|---|---|
| 1 | GET file, GET file nodes, GET image | **up to 20 / month** | 10/min |
| 2 | local/published variables, comments, version history, image fills, projects... | up to 5/min | 25/min |
| 3 | components & styles, file metadata, POST variables | up to 10/min | 50/min |

- Free Starter users realistically hold a View/Collab-style quota for API usage, so **GET file / GET file nodes / GET image are capped at ~20 calls per month**. That kills REST-based design-to-code tools (Framelink etc.) for free users: one moderate session burns the month.
- Limits are per user, per plan, per token (same page).
- Note: the page shows Starter Dev/Full numbers too; whether a solo free user counts as "Full seat on Starter" for REST purposes is UNVERIFIED. The MCP page (below) shows no Full/Dev entry for Starter at all, which suggests free users get the View/Collab row.
- Variables REST endpoints are Enterprise-only per figma-console-mcp docs (https://github.com/southleft/figma-console-mcp); consistent with long-standing Figma docs but not re-verified on Figma's site this session.

### Official Figma MCP server
Sources: https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/ , https://help.figma.com/hc/en-us/articles/39252411778583

- Starter: View/Collab "up to 20 per month"; Full/Dev column is a dash. Upgrade path: Professional+ with Full or Dev seat (200/day, 10/min).
- Exempt from limits: `add_code_connect_map`, `create_new_file`, `generate_figma_design`, `whoami` (list says "such as", so not exhaustive).
- Canvas writing (`use_figma`) is beta, currently free, "will eventually become a usage-based paid feature"; writing outside drafts needs a Full seat (help article).
- Whether `use_figma` counts against Starter's 20/month: NOT stated on the official page. Third-party pages claim it is exempt (UNVERIFIED, https://instagit.com/figma/mcp-server-guide/figma-mcp-rate-limits-and-billing-information/). Some older third-party pages say Starter is 6/month; official page today says 20.
- Even if writes are free, any read (screenshot, design context, metadata) on Starter is capped, so a write-verify loop is not viable for free users.

### Plugin API path
- Development plugins are imported via Plugins > Development > Import plugin from manifest in the desktop app and use the Plugin API locally; no REST call, so no REST quota applies (mechanism confirmed by every bridge project below; explicit Figma statement that dev plugins are unlimited on Starter was NOT found).
- Localhost access: manifest `networkAccess.allowedDomains` / `devAllowedDomains` must list the local server; localhost requires a `reasoning` string (https://developers.figma.com/docs/plugins/manifest , https://developers.figma.com/docs/plugins/making-network-requests). Example with `ws://localhost:3055`: https://www.mintlify.com/grab/cursor-talk-to-figma-mcp/guides/figma-plugin (third party).
- Terms / guidelines: no Figma rule prohibiting an agent-controlled plugin bridge was found. Not conclusively checked; Figma Developer Terms and Community plugin review guidelines still need a direct read (UNVERIFIED either way). Precedent: grab's Talk to Figma plugin is published on the Figma Community (https://github.com/grab/cursor-talk-to-figma-mcp), suggesting the pattern passes review.

## 2. Existing projects

| Project | Mechanism | Write? | Variables | Components | Auto layout | Text styles | Screenshot/export | Works free? | Agents | Activity | License |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Framelink** GLips/Figma-Context-MCP | REST PAT | No (read, simplified layout JSON) | read via file data | read | read | read | image download (per prior knowledge, UNVERIFIED this session) | **Effectively no**: GET file/nodes/images = Tier 1, 20/month | Cursor-first, any MCP client | 16.2k stars, 260 commits, no releases listed | MIT |
| **Talk to Figma MCP** grab/cursor-talk-to-figma-mcp | Plugin + Bun WebSocket relay (channel join) | Yes | **None** (open issue "Add Figma variables support", 2026-02-12) | instances, overrides, list local comps; cannot create components | yes (mode, padding, align, sizing, spacing) | no dedicated tool; `get_styles` | `export_node_as_image` ("limited", base64) | Yes (no REST) | Cursor, Claude Code, Codex | 7.1k stars, 794 forks, 68 open issues, no releases; recent issues to 2026-10 | MIT |
| **Figma Console MCP** southleft/figma-console-mcp | Desktop Bridge plugin over WebSocket (ports 9223-9232) + REST PAT; also Cloud relay and read-only remote SSE | Yes, broad (130 tools) | full CRUD for collections/modes/variables, batch 100; docs say works on Free plan via plugin | create component sets, properties, instances | `figma_set_layout` | `figma_get_text_styles` (create UNVERIFIED) | `figma_take_screenshot`, `figma_capture_screenshot` | **Partly**: plugin tools free; **local install requires a PAT**, and REST-backed tools would hit Starter's 20/month Tier 1 cap (which tools use REST: UNVERIFIED) | Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Claude Desktop, Antigravity; cloud: Claude.ai, v0, Replit, Lovable | 3.3k stars, v1.46.0 (~2026-10-29), 5 open issues | MIT |
| **Figwright** awdr74100/figwright | Plugin (Vue UI) + loopback WebSocket, msgpack; no token | Yes (101 tools, atomic `batch`) | read/write | read/write, `component_map` | `set_auto_layout` | styles read/write | screenshots, PDF | **Yes**, claims free tier is enough, no token | Claude Code, Cursor, VS Code, Windsurf, Codex CLI | v0.2.0, first tag mid-2026, single maintainer, not on Community (sideload) | MIT |
| figma-designer-mcp (npm) | Plugin + WebSocket port 3055 | Yes, 50+ tools | UNVERIFIED | placing components | yes | UNVERIFIED | UNVERIFIED | Likely yes | UNVERIFIED | npm 0.3.6 | MIT |
| figma-mcp-rs (Rust) | Plugin + WebSocket, "never calls REST API, unlimited and free" | Yes | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | Claims yes | UNVERIFIED | UNVERIFIED (socket.dev 403) | UNVERIFIED |
| Figma Unified MCP | REST for reads + variable CRUD, plugin for canvas writes | Yes | via REST (Enterprise-only endpoint, so likely fails on free) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | Partly | UNVERIFIED | UNVERIFIED | MIT |

Others seen in listings only (not inspected): bromso/bro + metapowers bridge plugin, kolganovr/figma-mcp-bridge, @maxisoft/figma-mcp-bridge, youware-labs/figma-pilot, oo-figma-mcp-write-server, eonist/conduit, sethford/mcp-figma, Figmatic, figma-opencode-mcp, markdojo fork of figma-console-mcp.

Sources for table rows:
- https://github.com/GLips/Figma-Context-MCP
- https://github.com/grab/cursor-talk-to-figma-mcp and https://github.com/grab/cursor-talk-to-figma-mcp/issues
- https://github.com/southleft/figma-console-mcp , https://docs.figma-console-mcp.southleft.com/architecture
- https://mcp.directory/blog/figwright-bidirectional-figma-mcp-2026 , https://cdn.jsdelivr.net/gh/awdr74100/figwright@main/README.md
- https://socket.dev/npm/package/figma-designer-mcp , https://socket.dev/npm/package/figma-mcp-rs , https://figma-unified-mcp.pages.dev/docs (search snippets only)
- Listing pages: https://glama.ai/mcp/servers/dzhpclb5q2 , https://mcpservers.org/servers/kolganovr/figma-mcp-bridge , https://bromso.github.io/metapowers/docs/development/mcp-server/bridge-plugin/

## 3. Known complaints / gaps (Talk to Figma, the most-used bridge)
From https://github.com/grab/cursor-talk-to-figma-mcp/issues:
- Connection/setup friction: Mac desktop Dev Mode connection, server won't start, port change, Windows bunx certificate error, remote server use.
- Security: unauthenticated WebSocket channels and bulk delete without confirmation (#163), log injection in `join_channel` (#198), outdated MCP SDK with high-severity CVEs (#148).
- Missing: variables, fontFamily on text, vectors, custom component usage, effects/borders not read fully, generated screens look poor.

## 4. Implications for the idea
- The core premise holds: REST-based tools are effectively unusable on Starter (20 Tier-1 calls/month), official MCP reads are 20/month, so a Plugin-API bridge is the only free path. This is verified.
- But the niche is **already occupied**: Figma Console MCP (mature, 130 tools, variables CRUD, many agents incl. Gemini CLI) and Figwright (token-free, bidirectional, codegen grounding) cover most of the stated scope. Talk to Figma has the mindshare but lacks variables and has security gaps.
- Possible differentiation (to validate): (a) zero-token, zero-REST guarantee with every tool plugin-backed (Figma Console still requires a PAT locally); (b) opinionated "developer-friendly structure" writes (tokens-as-variables first, enforced auto layout, code-mappable naming, lint/verify pass); (c) authenticated localhost socket and confirm-on-destructive by default; (d) one-command install across Claude Code / Codex / Gemini CLI / Grok CLI (Grok support not seen in any project).
- Open risks: Figma could restrict dev plugin networking or ToS (not checked); `use_figma` official write is free in beta now, and if Figma exempts it from Starter limits permanently, the write half of the value proposition shrinks (reads remain capped).
