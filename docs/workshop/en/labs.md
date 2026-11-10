# Lab guide

## Lab 0. Setup (before the course)

1. Install the Figma desktop app and sign in with a free account.
2. If you want to use a font, install it ahead of time, then fully quit and reopen the Figma app. This lab uses Inter, Figma's default font, so you don't need to install anything.
3. Download this repo and note where the `docs/workshop/token-plugin/` folder is.

## Lab 1. Split areas with Sections (about 10 min)

1. Create a new design file and rename it to `My Design System`.
2. Rename the page in the top left to `System`.
3. With the Section tool (Shift+S), draw 3 large rectangles and name them `01 Foundations`, `02 Components`, `03 Patterns`.
4. Check: the layers panel shows 3 Sections, and you can collapse and expand them.

## Lab 2. Create light/dark collections by hand (about 10 min)

1. With nothing selected, open Variables in the right panel.
2. Create a new collection and name it `Color / Light`.
3. Create color variables `bg/default` = `#FFFFFF` and `text/default` = `#16181D`.
4. Try clicking the add mode button. See for yourself that it's blocked on Starter.
5. Create another collection named `Color / Dark`, and create variables with the same names set to `#111318` and `#F2F3F5`.
6. Check: both collections have 2 variables with the same names.

## Lab 3. Build everything at once with a development plugin (about 20 min)

1. Keep using the file from Lab 2. If a name already exists, the plugin doesn't create a new one; it only overwrites the value.
2. From the menu, choose Plugins > Development > Import plugin from manifest and select `token-plugin/manifest.json`. (Depending on the app version, this menu may be in the canvas right-click menu instead.)
3. Run Plugins > Development > Free Course Token Builder.
4. Check: `✅ variables 18 · text styles 4 · sections 3` appears at the bottom of the screen. Variables contains `Color / Light`, `Color / Dark`, and `Spacing`, and 4 text styles have been created.
5. Going further: add a color like `status/danger` to `TOKENS.colors` in `code.js`, save, and run it again. Check that only the new variable is added.

### If you get stuck

| Symptom | Cause and fix |
|---|---|
| There's no Development menu | You opened it in the browser. Open it in the desktop app. |
| `❌ ...font...` | The font in `TOKENS.fontFamily` isn't installed, or you didn't restart the app after installing it. |
| Nothing changes when you run it | You're looking at a different file. Bring the lab file to the front and run it again. |
