# Course outline (2 hours, for developers)

Goal: using a single free Figma (Starter) account, students build a design system file with light/dark color variables, spacing variables, text styles, and a Section structure, and automate that process with a plugin script.

What you need: the Figma desktop app, a free account, this repo's `docs/workshop/token-plugin/` folder, and a code editor.
For all limit numbers, see `../../../skills/figma-build/references/limits-and-sources.md`.

| Time | Block | Format |
|---|---|---|
| 0:00 - 0:10 | 1. The free plan's walls at a glance | Talk |
| 0:10 - 0:30 | 2. Sections instead of pages | Talk + Lab 1 |
| 0:30 - 0:55 | 3. 2 collections instead of modes | Talk + Lab 2 |
| 0:55 - 1:05 | Break | |
| 1:05 - 1:40 | 4. Automate with a development plugin | Lab 3 |
| 1:40 - 1:50 | 5. Use MCP sparingly | Talk |
| 1:50 - 2:00 | 6. Fonts, libraries, wrap-up Q&A | Talk + Q&A |

## 1. The free plan's walls at a glance (10 min)

- Notes: Put the table from `../../../skills/figma-build/references/limits-and-sources.md` on screen and walk through it as "limit - workaround" pairs. Explain that the course follows the order in which these walls came up while actually building a design system on a Starter account.
- Emphasize: the numbers change. Explain why the table has a check date and sources.
- Expected question: "Why not just use Professional?" - For personal side projects, learning, and small teams just starting out, free is enough. Knowing the constraints also keeps your structure clean when you migrate later.

## 2. Sections instead of pages (20 min)

- Notes: A Starter design file can have up to 3 pages. Design systems usually use many pages, like Foundations, Components, Patterns, and Playground. Instead, split them into Sections on a single page.
- Live demo: Draw a Section with the Section tool in the toolbar (shortcut Shift+S) and name it. Show how a Section collapses like a folder in the layers panel on the left.
- Suggested use of the remaining 2 pages: page 1 = system (split by Sections), page 2 = playground, page 3 = archive.
- Run Lab 1 (`labs.md`).
- Expected question: "Can I put a Section inside a Section?" - Yes. But deep nesting makes things hard to find, so stick to two levels.

## 3. 2 collections instead of modes (25 min)

- Notes: Variable modes have per-plan limits, and on Starter we could actually create only 1 mode per collection. So create variables with **the same names** in two collections, `Color / Light` and `Color / Dark`.
- Connect it to code: for developers, it's the same as defining the same variable names twice, in CSS `:root` and `[data-theme="dark"]`.
- Be honest about the downside: you can't switch an entire screen with a single mode change. Build dark screens separately by binding the dark collection's variables directly. If you move to a paid plan later, merge the two collections into one with 2 modes.
- Run Lab 2 (`labs.md`). Create just 2 variables by hand, then move on to the next block with the question "What if you had to do dozens of these?"

## 4. Automate with a development plugin (35 min)

- Notes: In the desktop app, a development plugin runs right after you import its `manifest.json`. The official docs mention no plan restrictions or call limits, so it's a good fit for repetitive work on Starter.
- Code reading (10 min): Read `code.js` together.
  - `TOKENS`: data. This is the only place students edit.
  - `getCollection`, `upsertVariable`: reuse an existing item with the same name, so running multiple times creates no duplicates.
  - `buildTextStyles`: fonts must be loaded first with `loadFontAsync` before they can be set on a style.
  - `buildSections`: the same thing you did by hand in block 2, in code.
  - `documentAccess: "dynamic-page"` in `manifest.json`: this is why we use async APIs like `getLocal...Async`.
- Run Lab 3 (20 min).
- Wrap-up (5 min): Introduce the idea of extracting tokens to JSON so the code repo and Figma share the same values.

## 5. Use MCP sparingly (10 min)

- Notes: The Figma MCP server lets AI coding tools read and write Figma files. Starter gets very few calls per month, so if you build a design system with MCP you'll hit the limit quickly (from real experience).
- According to the official docs, some tools that write to files are excluded from the limit. It's mostly read calls that count against it.
- Summary: use the plugin for repetitive generation, and save MCP for moments that really need it, like "turning a finished screen into code".
- Expected question: "When does the limit reset?" - Monthly. Open the official FAQ together to check the exact rule.

## 6. Fonts, libraries, wrap-up (10 min)

- Fonts: newly installed fonts only show up after restarting the desktop app. Include this in the pre-course checklist.
- Libraries: on Starter, sharing via team libraries is hard. That's why we kept everything in one file instead of splitting it into a "token file" and a "component file". This also fits the file limit (3).
- Q&A.
