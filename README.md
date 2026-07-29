# TXT 注释阅读器

在 VS Code 当前代码文件的标记注释行中阅读本地 `.txt` 文本。

## 功能

- 用户手动选择本地 `.txt` 文件
- 自动识别当前文件语言的注释语法，识别不到时回退到 `//`
- 只更新包含标记的目标注释行
- 过滤 txt 空行，支持智能断句
- 自动识别文本大纲，大纲项可点击跳转
- 支持上一节、上一页、下一页、下一节
- 支持专注模式，用于临时清空目标注释行内容并减少界面按钮
- 支持状态栏按钮、命令面板和快捷键
- 阅读进度按“TXT 文件 + 当前代码文件”保存

## 隐私

本扩展只读取用户主动选择的本地 `.txt` 文件和当前编辑器内容。扩展不包含网络请求、遥测、远程服务或第三方数据上传逻辑。

## 快速开始

1. 在代码文件里选中几行，执行 `TXT 注释阅读器：初始化目标注释行`
2. 执行 `TXT 注释阅读器：打开 TXT 文件`
3. 用状态栏按钮、快捷键或大纲继续阅读

## 安装

- VS Code Marketplace：搜索 `TXT Comment Reader`
- GitHub Releases：下载 `.vsix` 后执行 `Extensions: Install from VSIX...`

## 状态栏

状态栏保留以下入口：

- `上一节`
- `上一页`
- `下一页`
- `下一节`
- `初始化目标注释行`
- `专注模式`

## 快捷键

默认快捷键使用数字入口：

- 打开 txt：`Ctrl+K 1`
- 重新打开上次 txt：`Ctrl+K 2`
- 上一页：`Ctrl+K 3`
- 下一页：`Ctrl+K 4`
- 显示大纲：`Ctrl+K 5`
- 刷新大纲：`Ctrl+K 6`
- 设置标记：`Ctrl+K 7`
- 初始化目标注释行：`Ctrl+K 8`
- 上一节：`Ctrl+K 9`
- 专注模式：`Ctrl+K 0`

macOS 对应为 `Cmd+K 1` 到 `Cmd+K 9`，以及 `Cmd+K 0`。

## 设置

- `txtCommentReader.markerToken`：目标注释行标记，默认 `◆`
- `txtCommentReader.fallbackLineCommentPrefix`：识别不到语言时使用的注释符，默认 `//`
- `txtCommentReader.showStatusBar`：是否显示状态栏按钮，默认 `true`
- `txtCommentReader.smartSplit`：是否启用智能断句，默认 `true`
- `txtCommentReader.maxCharsPerLine`：每个目标注释行最大字符数，默认 `48`

## 大纲

打开 txt 文件后，Explorer 侧边栏会出现 `TXT 大纲`。

当前会识别这些标题：

- `第一章`、`第1章`
- `第一回`、`第1卷`、`第1节`
- `序章`、`序言`、`楔子`、`引子`、`开篇`
- `尾声`、`后记`、`番外`
- `Chapter 1`、`Part 1`

## 断句

启用智能断句时，插件会：

1. 先过滤 txt 空行
2. 在同一行内先按 `。！？!?…` 等句末标点找候选断点
3. 连续短句会尽量拼到同一个目标注释行，拼上下一句超过上限才换行
4. 单句太长时按 `，,；;、` 继续切
5. 仍然过长时按最大字符数硬切

## 开发

1. 用 VS Code 打开本项目，按 `F5` 启动扩展调试
2. 运行 `npm test`
3. 运行 `npm run lint`

## 发布

1. 准备 `README.md`、`CHANGELOG.md`、`LICENSE` 和图标
2. 使用 `vsce package` 打包
3. 使用 `vsce publish` 发布到 Marketplace
