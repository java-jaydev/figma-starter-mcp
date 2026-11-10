// Free Course Token Builder
// Starter 플랜 제약에 맞춰 디자인 시스템 뼈대를 만든다.
// - 모드 대신 컬렉션 2개(Color / Light, Color / Dark)
// - 페이지 대신 Section
// 여러 번 실행해도 같은 이름은 새로 만들지 않고 값만 갱신한다.

const TOKENS = {
  colors: {
    "bg/default": { light: "#FFFFFF", dark: "#111318" },
    "bg/subtle": { light: "#F4F5F7", dark: "#1B1E25" },
    "text/default": { light: "#16181D", dark: "#F2F3F5" },
    "text/muted": { light: "#5B6170", dark: "#A3A9B6" },
    "brand/primary": { light: "#4F46E5", dark: "#818CF8" },
    "border/default": { light: "#D9DCE3", dark: "#2E333D" },
  },
  spacing: { "space/1": 4, "space/2": 8, "space/3": 12, "space/4": 16, "space/6": 24, "space/8": 32 },
  textStyles: [
    { name: "Heading/H1", size: 32, lineHeight: 40, style: "Bold" },
    { name: "Heading/H2", size: 24, lineHeight: 32, style: "Semi Bold" },
    { name: "Body/Default", size: 16, lineHeight: 24, style: "Regular" },
    { name: "Body/Small", size: 14, lineHeight: 20, style: "Regular" },
  ],
  fontFamily: "Inter",
  sections: ["01 Foundations", "02 Components", "03 Patterns"],
};

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

async function getCollection(name) {
  const all = await figma.variables.getLocalVariableCollectionsAsync();
  return all.find((c) => c.name === name) || figma.variables.createVariableCollection(name);
}

async function upsertVariable(collection, name, type, value) {
  const all = await figma.variables.getLocalVariablesAsync(type);
  const variable =
    all.find((v) => v.name === name && v.variableCollectionId === collection.id) ||
    figma.variables.createVariable(name, collection, type);
  variable.setValueForMode(collection.modes[0].modeId, value);
  return variable;
}

async function buildVariables() {
  const light = await getCollection("Color / Light");
  const dark = await getCollection("Color / Dark");
  const spacing = await getCollection("Spacing");
  let count = 0;
  for (const [name, v] of Object.entries(TOKENS.colors)) {
    await upsertVariable(light, name, "COLOR", hexToRgb(v.light));
    await upsertVariable(dark, name, "COLOR", hexToRgb(v.dark));
    count += 2;
  }
  for (const [name, px] of Object.entries(TOKENS.spacing)) {
    await upsertVariable(spacing, name, "FLOAT", px);
    count += 1;
  }
  return count;
}

async function buildTextStyles() {
  const existing = await figma.getLocalTextStylesAsync();
  for (const t of TOKENS.textStyles) {
    const fontName = { family: TOKENS.fontFamily, style: t.style };
    await figma.loadFontAsync(fontName);
    const style = existing.find((s) => s.name === t.name) || figma.createTextStyle();
    style.name = t.name;
    style.fontName = fontName;
    style.fontSize = t.size;
    style.lineHeight = { value: t.lineHeight, unit: "PIXELS" };
  }
  return TOKENS.textStyles.length;
}

function buildSections() {
  const page = figma.currentPage;
  let x = 0;
  for (const name of TOKENS.sections) {
    let section = page.children.find((n) => n.type === "SECTION" && n.name === name);
    if (!section) {
      section = figma.createSection();
      section.name = name;
      section.resizeWithoutConstraints(1200, 800);
      page.appendChild(section);
    }
    section.x = x;
    section.y = 0;
    x += section.width + 200;
  }
  return TOKENS.sections.length;
}

async function main() {
  const variables = await buildVariables();
  const styles = await buildTextStyles();
  const sections = buildSections();
  figma.closePlugin(`✅ variables ${variables} · text styles ${styles} · sections ${sections}`);
}

main().catch((err) => figma.closePlugin(`❌ ${err.message}`));
