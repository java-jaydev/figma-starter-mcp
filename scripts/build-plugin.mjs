// Builds the Figma plugin into dist/plugin: code.js (main thread), ui.html (UI script inlined,
// since Figma loads ui.html as a single document) and manifest.json.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const out = "dist/plugin";
// The Figma sandbox and plugin iframe are older JS environments, so lower syntax to ES2017.
const common = { bundle: true, target: "es2017", format: "iife", logLevel: "warning" };

await mkdir(out, { recursive: true });
await build({ ...common, entryPoints: ["src/plugin/code.ts"], outfile: `${out}/code.js` });

const ui = await build({ ...common, entryPoints: ["src/plugin/ui/main.ts"], write: false });
const script = ui.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const template = await readFile("src/plugin/ui.html", "utf8");
if (!template.includes("<!-- UI_SCRIPT -->")) throw new Error("src/plugin/ui.html lacks the <!-- UI_SCRIPT --> marker");
await writeFile(`${out}/ui.html`, template.replace("<!-- UI_SCRIPT -->", () => `<script>\n${script}</script>`));

await copyFile("src/plugin/manifest.json", `${out}/manifest.json`);
