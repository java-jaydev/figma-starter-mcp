# Figma terms check: local plugin bridge (Task 0 gate)

Verdict: UNCLEAR
- Nothing found that bans a plugin talking to a localhost WebSocket, or a private unpublished development plugin; `devAllowedDomains` explicitly supports local servers.
- The Community plugin review guidelines say Figma "generally do[es] not approve" plugins that "Expose an MCP server through a plugin, or otherwise provide programmatic AI access to Figma files" - that is exactly this project's shape, so publishing to Community is likely a no.
- The guidelines also say Figma "may not approve plugins or widgets that function as a workaround to Figma's paid offerings", and the AUP bars programmatic access to Figma content "except as expressly permitted by Figma"; a user decision is needed on proceeding as private, never-published, personal-use tooling.

Checked 2026-11-10. Quotes below come from a page-to-text fetch tool that returns excerpts and paraphrases, so wording is as returned; re-read the live pages before relying on them legally.

## Pages reached

| Page | URL |
|---|---|
| Plugin and widget review guidelines | https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines |
| Terms of Service | https://www.figma.com/legal/tos/ |
| Developer Terms | https://www.figma.com/legal/developer-terms/ |
| Acceptable Use Policy | https://www.figma.com/legal/aup/ |
| Plugin docs: network requests | https://developers.figma.com/docs/plugins/making-network-requests/ |
| Plugin docs: quickstart | https://developers.figma.com/docs/plugins/plugin-quickstart-guide/ |

Not reached: https://www.figma.com/legal/dev-terms/ (404; the working URL is /legal/developer-terms/). The AUP and guidelines fetches were truncated or length-limited, so some clauses may be missed. Not read: Figma Community Product-Specific Terms, plugin publishing docs, Dev Mode / REST rate-limit docs.

## (a) Plugin receiving commands from a localhost WebSocket

Allowed by the plugin network model. Source: https://developers.figma.com/docs/plugins/making-network-requests/
- "add its domain(s) to the `devAllowedDomains` list"
- "The domains that you add to the list should correspond to the local URL(s) for your development server."
- "If you want to access a local or development web server in `allowedDomains`, then `reasoning` is required." (example `"http://localhost:3000"`)
- "Figma enforces the list of domains that you gave for `allowedDomains`." (others blocked by CSP)
- The page does not mention WebSocket specifically; whether `ws://localhost` is covered by the same list is a technical item to verify in Task 1, not a terms question.

Review guidelines (https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines), Trust and Safety, API Usage:
- Plugins "can only leverage official plugin APIs or widget APIs provided by Figma" and "cannot require users to install separate packages that manipulate Figma on the Web or the Desktop App." A local Node server that only relays to the official plugin API arguably is not a package that manipulates Figma itself, but this is a judgment call for a published plugin.
- Security: "we may reject plugins or widgets that read or modify a Figma file without a user's explicit awareness and consent". Design implication: show a visible connected state and user-initiated connect.
- Performance: Figma may reject plugins that hurt performance, "An example of this would be a long-running background process." A persistent bridge plugin fits that description.

## (b) Rule against automated / AI control via plugins

This is the key finding. Review guidelines, section 3 Business, AI functionality:
- "We encourage the Community to create AI plugins and widgets that extend and complement Figma's native capabilities"
- "We generally do not approve plugins or widgets that overlap with Figma's AI capabilities and paid offerings", including ones that "Expose an MCP server through a plugin, or otherwise provide programmatic AI access to Figma files" (continuation paraphrased by the tool: covers access outside Figma's official MCP server).
- Lead-in mentions "the Figma agent, our Model Context Protocol (MCP) server".

Scope: these are Community approval criteria ("generally do not approve"), not a usage ban. Nothing in the Terms of Service or Developer Terms fetched mentions plugins, AI control, or MCP for end users' own editors (Developer Terms: "The terms don't mention plugins"; preamble lists "Model Context Protocol servers, and related resources and documentation" among Developer Resources).

Acceptable Use Policy, section 2 ("While using the Services, you may not:"), item (j):
- "scrape, data mine, systematically extract, collect, aggregate, or compile substantial quantities of Figma or Figma content"
- "or otherwise access Figma or Figma content programmatically" (qualified by "except as expressly permitted by Figma or to the extent such restriction is impermissible under applicable law")
- Honest reading: a literal reading of "access ... Figma content programmatically" could cover an agent driving the editor, but the official Plugin API is itself an express, documented programmatic channel, and the clause is framed around scraping/extraction. Risk is low-to-moderate and unresolved by Figma text.
- Item (a): "damage, disable, override, interfere with, or circumvent any aspect of the Services" (no exception); item (b): "interfere with the Services operation (e.g., by exceeding or trying to exceed load specifications"; item (n): "modify, or use anything that modifies, Figma's code or code execution". The bridge must stay within the Plugin API and not patch the app.

## (c) Unpublished development plugins

- Quickstart: "navigate to Plugins > Development, then select New plugin." "Plugin development and testing requires the Figma desktop app."
- No restriction on unpublished plugins, plan type, or Starter use was found on that page or the network page. Review guidelines apply to publishing to Community; they were not found to govern private development plugins.
- Not verified: any Developer Terms clause on use of Developer Resources beyond "only as necessary to develop, test, and support an integration or other connection" (Section 2). Using a dev plugin purely for personal work is consistent with "develop, test", but that is an interpretation.

## (d) Circumventing plan limits or rate limits

- Review guidelines: "We may not approve plugins or widgets that function as a workaround to Figma's paid offerings." A bridge that gives agents read/write Figma access on Starter, in place of the paid Dev Mode / REST / official MCP route, could be read as a workaround. Applies to approval.
- Developer Terms 8(e): Figma may change fees "(including by introducing or modifying rate limits)". Nothing addresses circumventing them.
- Terms of Service 2.2: no explicit anti-circumvention-of-plan-limits sentence surfaced; 2.2(i) bars reverse engineering ("reverse engineer, decompile, disassemble, or otherwise attempt to discover the source code"), 2.2(iii) bars modifying/deriving the Services. AUP (a) "circumvent any aspect of the Services" is generic and could be argued either way.
- The bridge calls no REST API and uses no token, so it does not evade any rate limit literally; the "workaround to paid offerings" language is the only plausible hook.

## Recommendation for the user decision

- Proceed only as a private, unpublished development plugin for the user's own files, with a visible connect state; do not submit to Community, and do not describe it as Figma-endorsed.
- Residual risk is account action under AUP / ToS discretion (ToS 8.2(a), 9.4 give Figma broad termination discretion), which the fetched text cannot rule out.
- If the user wants zero ambiguity, ask Figma support whether a local, unpublished plugin driven by an AI agent is acceptable. That would settle the UNCLEAR.

## Decision (2026-11-10)

The owner chose to follow the common practice of similar open-source bridges: publish the bridge publicly, never submit the plugin to the Figma Community, distribute it only as a development plugin imported from a manifest, quote the relevant Figma guidelines in the README with a clear notice that users accept the risk, and lead with the developer-friendly workflow rather than with avoiding paid limits. The plugin shows a visible connected state and connects only after the user pairs it.
