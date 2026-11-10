# 实操指南

## 实操 0. 准备（课前）

1. 安装 Figma 桌面应用，并用免费账号登录。
2. 如果有要用的字体，提前安装，然后完全退出 Figma 应用再重新打开。本实操使用 Figma 的默认字体 Inter，所以无需安装。
3. 下载本仓库，记住 `docs/workshop/token-plugin/` 文件夹的位置。

## 实操 1. 用 Section 划分区域（约 10 分钟）

1. 新建一个设计文件，并将名称改为 `My Design System`。
2. 将左上角的页面名称改为 `System`。
3. 用 Section 工具（Shift+S）画出 3 个大矩形，分别命名为 `01 Foundations`、`02 Components`、`03 Patterns`。
4. 确认：图层面板中能看到 3 个 Section，并且可以折叠和展开。

## 实操 2. 手动创建亮色/暗色集合（约 10 分钟）

1. 在未选中任何对象的状态下，打开右侧面板的 Variables。
2. 新建一个集合，命名为 `Color / Light`。
3. 创建颜色变量 `bg/default` = `#FFFFFF`、`text/default` = `#16181D`。
4. 试着点击添加模式按钮，亲自确认在 Starter 中会被拦住。
5. 再新建一个集合，命名为 `Color / Dark`，用同样的名称创建变量，值为 `#111318`、`#F2F3F5`。
6. 确认：两个集合中各有 2 个同名变量。

## 实操 3. 用开发用插件一次性创建（约 20 分钟）

1. 直接使用实操 2 中创建的文件。如果已有同名项，插件不会新建，只会覆盖值。
2. 在菜单中选择 Plugins > Development > Import plugin from manifest，然后选择 `token-plugin/manifest.json`。（根据应用版本不同，该菜单也可能位于画布的右键菜单中。）
3. 运行 Plugins > Development > Free Course Token Builder。
4. 确认：画面下方显示 `✅ variables 18 · text styles 4 · sections 3`。Variables 中有 `Color / Light`、`Color / Dark`、`Spacing`，并生成了 4 个文本样式。
5. 进阶：在 `code.js` 的 `TOKENS.colors` 中添加一个颜色，比如 `status/danger`，保存后再次运行。看看是否只增加了新变量。

### 遇到问题时

| 现象 | 原因与解决 |
|---|---|
| 没有 Development 菜单 | 你是在浏览器中打开的。请在桌面应用中打开。 |
| `❌ ...font...` | `TOKENS.fontFamily` 中的字体没有安装，或者安装后没有重启应用。 |
| 运行后没有任何变化 | 你正在看另一个文件。把实操文件切到前台后再运行。 |
