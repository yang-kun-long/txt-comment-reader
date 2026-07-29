const fs = require("fs/promises");
const crypto = require("crypto");
const path = require("path");
const vscode = require("vscode");

const STATE_KEY = "txtCommentReader.state";
const LEGACY_STATE_KEY = "txtNovelComments.state";
const FOCUS_MODE_KEY = "txtCommentReader.focusMode";
const LEGACY_FOCUS_MODE_KEY = "txtNovelComments.compactMode";
const PROGRESS_PREFIX = "txtCommentReader.progress.";
const LEGACY_PROGRESS_PREFIX = "txtNovelComments.progress.";
const DEFAULT_TOKEN = "◆";
const DEFAULT_MAX_CHARS = 48;

const LINE_COMMENT_PREFIX = {
  javascript: "//",
  javascriptreact: "//",
  typescript: "//",
  typescriptreact: "//",
  c: "//",
  cpp: "//",
  csharp: "//",
  java: "//",
  go: "//",
  rust: "//",
  kotlin: "//",
  dart: "//",
  swift: "//",
  php: "//",
  jsonc: "//",
  python: "#",
  ruby: "#",
  perl: "#",
  shellscript: "#",
  bash: "#",
  zsh: "#",
  yaml: "#",
  toml: "#",
  properties: "#",
  makefile: "#",
  ini: ";",
  lua: "--",
  sql: "--",
  plaintext: "//",
};

const BLOCK_COMMENT_PAIR = {
  html: ["<!--", "-->"],
  xml: ["<!--", "-->"],
  markdown: ["<!--", "-->"],
  css: ["/*", "*/"],
  scss: ["/*", "*/"],
  less: ["/*", "*/"],
};

const EXTENSION_TO_LANGUAGE = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".java": "java",
  ".go": "go",
  ".rs": "rust",
  ".kt": "kotlin",
  ".dart": "dart",
  ".swift": "swift",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".pl": "perl",
  ".sh": "shellscript",
  ".bash": "bash",
  ".zsh": "zsh",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".ini": "ini",
  ".properties": "properties",
  ".mk": "makefile",
  ".make": "makefile",
  ".lua": "lua",
  ".sql": "sql",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".md": "markdown",
  ".markdown": "markdown",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".jsonc": "jsonc",
};

const CHAPTER_PATTERNS = [
  /^第[0-9零〇一二三四五六七八九十百千万两]+[章节回卷篇部集节]/u,
  /^(序章|序言|楔子|引子|开篇|尾声|后记|番外)(?:\s|$)/u,
  /^chapter\s*\d+/iu,
  /^part\s*\d+/iu,
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getConfig() {
  return vscode.workspace.getConfiguration("txtCommentReader");
}

function hasConfiguredValue(inspected) {
  return Boolean(
    inspected &&
      (inspected.globalValue !== undefined ||
        inspected.workspaceValue !== undefined ||
        inspected.workspaceFolderValue !== undefined ||
        inspected.globalLanguageValue !== undefined ||
        inspected.workspaceLanguageValue !== undefined ||
        inspected.workspaceFolderLanguageValue !== undefined)
  );
}

function getConfiguredValue(key, defaultValue) {
  const config = getConfig();
  if (hasConfiguredValue(config.inspect(key))) {
    return config.get(key, defaultValue);
  }

  const legacyValue = vscode.workspace.getConfiguration("txtNovelViewer").get(key);
  return legacyValue === undefined ? config.get(key, defaultValue) : legacyValue;
}

function getConfiguredToken() {
  const token = getConfiguredValue("markerToken", DEFAULT_TOKEN);
  return typeof token === "string" && token.trim() ? token.trim() : DEFAULT_TOKEN;
}

function getFallbackLineCommentPrefix() {
  const prefix = getConfiguredValue("fallbackLineCommentPrefix", "//");
  return typeof prefix === "string" && prefix.trim() ? prefix.trim() : "//";
}

function shouldShowStatusBar() {
  return getConfiguredValue("showStatusBar", true);
}

function shouldSmartSplit() {
  return getConfiguredValue("smartSplit", true);
}

function getMaxCharsPerLine() {
  const value = getConfiguredValue("maxCharsPerLine", DEFAULT_MAX_CHARS);
  if (!Number.isInteger(value)) {
    return DEFAULT_MAX_CHARS;
  }

  return Math.max(8, Math.min(200, value));
}

function isChapterLine(line) {
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }

  return CHAPTER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getState(context) {
  const currentState = context.workspaceState.get(STATE_KEY);
  if (currentState && typeof currentState === "object") {
    return {
      filePath: "",
      ...currentState,
    };
  }

  const legacyState = context.workspaceState.get(LEGACY_STATE_KEY);
  if (legacyState && typeof legacyState === "object") {
    return {
      filePath: "",
      ...legacyState,
    };
  }

  return {
    filePath: "",
  };
}

function getFocusMode(context) {
  const focusMode = context.workspaceState.get(FOCUS_MODE_KEY);
  if (typeof focusMode === "boolean") {
    return focusMode;
  }

  const legacyFocusMode = context.workspaceState.get(LEGACY_FOCUS_MODE_KEY);
  return typeof legacyFocusMode === "boolean" ? legacyFocusMode : false;
}

async function setState(context, nextState) {
  await context.workspaceState.update(STATE_KEY, {
    ...getState(context),
    ...nextState,
  });
}

async function setFocusMode(context, focusMode) {
  await context.workspaceState.update(FOCUS_MODE_KEY, focusMode);
  await vscode.commands.executeCommand("setContext", "txtCommentReader.focusMode", focusMode);
}

function getActiveEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("先打开一个代码文件，再运行 TXT 注释阅读器命令。");
    return null;
  }

  return editor;
}

function getCommentStyle(document) {
  const languageId = document.languageId;
  if (LINE_COMMENT_PREFIX[languageId]) {
    return { kind: "line", prefix: LINE_COMMENT_PREFIX[languageId], source: languageId };
  }

  if (BLOCK_COMMENT_PAIR[languageId]) {
    const [start, end] = BLOCK_COMMENT_PAIR[languageId];
    return { kind: "block", start, end, source: languageId };
  }

  const ext = path.extname(document.fileName).toLowerCase();
  const mappedLanguage = EXTENSION_TO_LANGUAGE[ext];
  if (mappedLanguage && LINE_COMMENT_PREFIX[mappedLanguage]) {
    return { kind: "line", prefix: LINE_COMMENT_PREFIX[mappedLanguage], source: mappedLanguage };
  }

  if (mappedLanguage && BLOCK_COMMENT_PAIR[mappedLanguage]) {
    const [start, end] = BLOCK_COMMENT_PAIR[mappedLanguage];
    return { kind: "block", start, end, source: mappedLanguage };
  }

  return { kind: "line", prefix: getFallbackLineCommentPrefix(), source: "fallback" };
}

function getMarkerExample(style, token) {
  if (style.kind === "block") {
    return `${style.start} ${token}: ${style.end}`;
  }

  return `${style.prefix} ${token}:`;
}

function findMarkerLines(document, style, token) {
  const tokenPattern = escapeRegExp(token);
  const markers = [];

  let markerPattern;
  if (style.kind === "block") {
    markerPattern = new RegExp(
      `^(\\s*)${escapeRegExp(style.start)}\\s*${tokenPattern}(?:\\s*:\\s*.*|\\s+.*)?\\s*${escapeRegExp(style.end)}\\s*$`
    );
  } else {
    markerPattern = new RegExp(`^(\\s*)${escapeRegExp(style.prefix)}\\s*${tokenPattern}(?:\\s*:\\s*.*|\\s+.*)?\\s*$`);
  }

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const text = document.lineAt(lineIndex).text;
    const match = text.match(markerPattern);
    if (match) {
      markers.push({
        lineIndex,
        indent: match[1] || "",
      });
    }
  }

  return markers;
}

function splitByPattern(text, pattern) {
  const pieces = [];
  let rest = text;
  let match;

  while ((match = rest.match(pattern))) {
    const end = match.index + match[0].length;
    pieces.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }

  if (rest) {
    pieces.push(rest);
  }

  return pieces.filter((piece) => piece.length > 0);
}

function hardSplit(text, maxChars) {
  const pieces = [];
  let rest = text.trim();

  while (rest.length > maxChars) {
    pieces.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars).trimStart();
  }

  if (rest) {
    pieces.push(rest);
  }

  return pieces;
}

function splitLongPiece(text, maxChars) {
  if (text.length <= maxChars) {
    return [text];
  }

  const softPieces = splitByPattern(text, /^[\s\S]*?[，,；;、]/u);
  if (softPieces.length > 1) {
    return softPieces.flatMap((piece) => splitLongPiece(piece, maxChars));
  }

  return hardSplit(text, maxChars);
}

function joinPieces(left, right) {
  if (!left) {
    return right;
  }

  if (/[\w)]$/u.test(left) && /^[\w(]/u.test(right)) {
    return `${left} ${right}`;
  }

  return `${left}${right}`;
}

function packPieces(pieces, maxChars) {
  const packed = [];
  let current = "";

  for (const piece of pieces) {
    if (!piece) {
      continue;
    }

    const next = joinPieces(current, piece);
    if (current && next.length > maxChars) {
      packed.push(current);
      current = piece;
    } else {
      current = next;
    }
  }

  if (current) {
    packed.push(current);
  }

  return packed;
}

function smartSplitLine(line, maxChars) {
  const normalized = line.trim();
  if (!normalized) {
    return [];
  }

  const sentencePieces = splitByPattern(normalized, /^[\s\S]*?[。！？!?…]+[”’"'）】》」』]*\s*/u);
  const pieces = sentencePieces.flatMap((piece) => splitLongPiece(piece, maxChars));
  return packPieces(pieces, maxChars);
}

function buildTextIndex(content) {
  const rawLines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) => line.trim().length > 0);

  const segments = [];
  const chapters = [];
  const maxChars = getMaxCharsPerLine();
  const useSmartSplit = shouldSmartSplit();

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (isChapterLine(trimmed)) {
      chapters.push({
        title: trimmed,
        segmentIndex: segments.length,
      });
    }

    const pieces = useSmartSplit ? smartSplitLine(trimmed, maxChars) : [line];
    segments.push(...pieces);
  }

  return {
    chapters,
    segments,
  };
}

function readTextLines(content) {
  const index = buildTextIndex(content);
  if (!shouldSmartSplit()) {
    return index.segments;
  }

  return index.segments;
}

async function loadTextLines(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return readTextLines(content);
}

async function loadTextIndex(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return buildTextIndex(content);
}

function createPlaceholderTreeItem(label, command) {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.contextValue = "placeholder";
  if (command) {
    item.command = command;
  }
  return item;
}

class ChapterTreeProvider {
  constructor(context) {
    this.context = context;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(item) {
    return item;
  }

  async getChildren() {
    const state = getState(this.context);
    if (!state.filePath) {
      return [
        createPlaceholderTreeItem("先选择 txt 文件", {
          command: "txtCommentReader.openText",
          title: "打开 TXT 文件",
        }),
      ];
    }

    try {
      const index = await loadTextIndex(state.filePath);
      if (index.chapters.length === 0) {
        return [createPlaceholderTreeItem("未识别到章节目录")];
      }

      return index.chapters.map((chapter, chapterIndex) => {
        const item = new vscode.TreeItem(chapter.title, vscode.TreeItemCollapsibleState.None);
        item.description = `${chapterIndex + 1}`;
        item.tooltip = chapter.title;
        item.command = {
          command: "txtCommentReader.openChapter",
          title: "跳转章节",
          arguments: [chapterIndex],
        };
        return item;
      });
    } catch (error) {
      return [createPlaceholderTreeItem(`目录读取失败: ${error instanceof Error ? error.message : String(error)}`)];
    }
  }
}

function buildCommentLine(style, token, text, indent) {
  const cleanText = style.kind === "block" && style.end ? text.split(style.end).join("") : text;
  const suffix = cleanText ? ` ${cleanText}` : "";
  if (style.kind === "block") {
    return `${indent}${style.start} ${token}:${suffix} ${style.end}`;
  }

  return `${indent}${style.prefix} ${token}:${suffix}`;
}

function getProgressHash(document, filePath) {
  const raw = `${document.uri.toString()}|${filePath}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

function getProgressKey(document, filePath) {
  return `${PROGRESS_PREFIX}${getProgressHash(document, filePath)}`;
}

function getLegacyProgressKey(document, filePath) {
  return `${LEGACY_PROGRESS_PREFIX}${getProgressHash(document, filePath)}`;
}

function getSavedPage(context, document, filePath) {
  const savedPage = context.workspaceState.get(getProgressKey(document, filePath));
  if (Number.isInteger(savedPage)) {
    return savedPage;
  }

  const legacySavedPage = context.workspaceState.get(getLegacyProgressKey(document, filePath));
  return Number.isInteger(legacySavedPage) ? legacySavedPage : 0;
}

async function setSavedPage(context, document, filePath, page) {
  await context.workspaceState.update(getProgressKey(document, filePath), page);
}

function getChapterPage(chapter, markersLength) {
  return Math.floor(chapter.segmentIndex / markersLength);
}

function getChapterIndexForPage(chapters, page, markersLength) {
  const segmentIndex = page * markersLength;
  let chapterIndex = -1;

  for (let index = 0; index < chapters.length; index += 1) {
    if (chapters[index].segmentIndex > segmentIndex) {
      break;
    }

    chapterIndex = index;
  }

  return chapterIndex;
}

async function replaceMarkerLines(editor, markers, style, token, pageLines) {
  const document = editor.document;
  return editor.edit((editBuilder) => {
    markers.forEach((marker, index) => {
      const range = document.lineAt(marker.lineIndex).range;
      editBuilder.replace(range, buildCommentLine(style, token, pageLines[index] || "", marker.indent));
    });
  });
}

async function renderPage(context, requestedPage, visibleContent = true) {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const state = getState(context);
  if (!state.filePath) {
    vscode.window.showInformationMessage("还没有选择 txt 文件。");
    return;
  }

  const token = getConfiguredToken();
  const style = getCommentStyle(editor.document);
  const markers = findMarkerLines(editor.document, style, token);
  if (markers.length === 0) {
    vscode.window.showInformationMessage(`当前文件没有目标注释行。示例: ${getMarkerExample(style, token)}`);
    return;
  }

  const textIndex = await loadTextIndex(state.filePath);
  const textLines = textIndex.segments;
  if (textLines.length === 0) {
    vscode.window.showInformationMessage("txt 文件没有可显示的非空行。");
    return;
  }

  const totalPages = Math.max(1, Math.ceil(textLines.length / markers.length));
  const nextPage = Math.max(0, Math.min(totalPages - 1, requestedPage));
  const start = nextPage * markers.length;
  const pageLines = visibleContent ? textLines.slice(start, start + markers.length) : markers.map(() => "");
  const ok = await replaceMarkerLines(editor, markers, style, token, pageLines);

  if (!ok) {
    vscode.window.showErrorMessage("更新目标注释行失败。");
    return;
  }

  await setSavedPage(context, editor.document, state.filePath, nextPage);
  await setState(context, {
    totalPages,
    targetLines: markers.length,
  });
  vscode.window.setStatusBarMessage(
    visibleContent
      ? `TXT Comment Reader: ${nextPage + 1}/${totalPages} 页，${markers.length} 行`
      : `TXT Comment Reader: 已清空目标注释行内容`,
    2500
  );
}

async function pickTxtFile() {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: {
      Text: ["txt"],
    },
    title: "选择 txt 文件",
  });

  return picked?.[0]?.fsPath || "";
}

async function openText(context, chapterTreeProvider) {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const filePath = await pickTxtFile();
  if (!filePath) {
    return;
  }

  await setState(context, {
    filePath,
  });
  chapterTreeProvider.refresh();
  await renderPage(context, getSavedPage(context, editor.document, filePath), !getFocusMode(context));
}

async function reopenLast(context) {
  const state = getState(context);
  if (!state.filePath) {
    vscode.window.showInformationMessage("还没有打开过 txt 文件。");
    return;
  }

  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  await renderPage(context, getSavedPage(context, editor.document, state.filePath), !getFocusMode(context));
}

async function openChapter(context, chapterIndex) {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const state = getState(context);
  if (!state.filePath) {
    vscode.window.showInformationMessage("还没有选择 txt 文件。");
    return;
  }

  const token = getConfiguredToken();
  const style = getCommentStyle(editor.document);
  const markers = findMarkerLines(editor.document, style, token);
  if (markers.length === 0) {
    vscode.window.showInformationMessage(`当前文件没有目标注释行。示例: ${getMarkerExample(style, token)}`);
    return;
  }

  const textIndex = await loadTextIndex(state.filePath);
  const chapter = textIndex.chapters[chapterIndex];
  if (!chapter) {
    vscode.window.showInformationMessage("章节不存在，目录可能需要刷新。");
    return;
  }

  const page = getChapterPage(chapter, markers.length);
  await renderPage(context, page, !getFocusMode(context));
}

async function openPreviousChapter(context) {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const state = getState(context);
  if (!state.filePath) {
    vscode.window.showInformationMessage("还没有选择 txt 文件。");
    return;
  }

  const token = getConfiguredToken();
  const style = getCommentStyle(editor.document);
  const markers = findMarkerLines(editor.document, style, token);
  if (markers.length === 0) {
    vscode.window.showInformationMessage(`当前文件没有目标注释行。示例: ${getMarkerExample(style, token)}`);
    return;
  }

  const textIndex = await loadTextIndex(state.filePath);
  const currentPage = getSavedPage(context, editor.document, state.filePath);
  const currentChapterIndex = getChapterIndexForPage(textIndex.chapters, currentPage, markers.length);
  if (currentChapterIndex <= 0) {
    vscode.window.showInformationMessage("已经是第一章。");
    return;
  }

  const chapter = textIndex.chapters[currentChapterIndex - 1];
  const page = getChapterPage(chapter, markers.length);
  await renderPage(context, page, !getFocusMode(context));
}

async function openNextChapter(context) {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const state = getState(context);
  if (!state.filePath) {
    vscode.window.showInformationMessage("还没有选择 txt 文件。");
    return;
  }

  const token = getConfiguredToken();
  const style = getCommentStyle(editor.document);
  const markers = findMarkerLines(editor.document, style, token);
  if (markers.length === 0) {
    vscode.window.showInformationMessage(`当前文件没有目标注释行。示例: ${getMarkerExample(style, token)}`);
    return;
  }

  const textIndex = await loadTextIndex(state.filePath);
  const currentPage = getSavedPage(context, editor.document, state.filePath);
  const currentChapterIndex = getChapterIndexForPage(textIndex.chapters, currentPage, markers.length);
  const nextChapterIndex = currentChapterIndex < 0 ? 0 : currentChapterIndex + 1;
  if (nextChapterIndex >= textIndex.chapters.length) {
    vscode.window.showInformationMessage("已经是最后一章。");
    return;
  }

  const chapter = textIndex.chapters[nextChapterIndex];
  const page = getChapterPage(chapter, markers.length);
  await renderPage(context, page, !getFocusMode(context));
}

async function showChapters(context, chapterTreeProvider, statusBar) {
  if (getFocusMode(context)) {
    await setFocusMode(context, false);
    updateStatusBarItems(statusBar.items, statusBar.focusItem, false);

    const state = getState(context);
    const editor = vscode.window.activeTextEditor;
    if (editor && state.filePath) {
      await renderPage(context, getSavedPage(context, editor.document, state.filePath), true);
    }
  }

  chapterTreeProvider.refresh();
  await vscode.commands.executeCommand("workbench.view.explorer");
  try {
    await vscode.commands.executeCommand("txtCommentReader.chapters.focus");
  } catch {
    // The focus command is provided by VS Code for contributed views in recent versions.
  }
}

async function nextPage(context) {
  const state = getState(context);
  const editor = getActiveEditor();
  if (!editor || !state.filePath) {
    await renderPage(context, 0, !getFocusMode(context));
    return;
  }

  await renderPage(context, getSavedPage(context, editor.document, state.filePath) + 1, !getFocusMode(context));
}

async function prevPage(context) {
  const state = getState(context);
  const editor = getActiveEditor();
  if (!editor || !state.filePath) {
    await renderPage(context, 0, !getFocusMode(context));
    return;
  }

  await renderPage(context, getSavedPage(context, editor.document, state.filePath) - 1, !getFocusMode(context));
}

async function toggleFocusMode(context, chapterTreeProvider, statusBarItems) {
  const nextMode = !getFocusMode(context);
  await setFocusMode(context, nextMode);
  updateStatusBarItems(statusBarItems.items, statusBarItems.focusItem, nextMode);
  chapterTreeProvider.refresh();

  const state = getState(context);
  const editor = getActiveEditor();
  if (!editor || !state.filePath) {
    return;
  }

  await renderPage(context, getSavedPage(context, editor.document, state.filePath), !nextMode);
}

async function setToken(context) {
  const token = await vscode.window.showInputBox({
    title: "设置标记",
    prompt: "当前代码文件中，只有包含这个标记的注释行会被替换为 txt 文本。",
    value: getConfiguredToken(),
    ignoreFocusOut: true,
  });

  if (token === undefined) {
    return;
  }

  const nextToken = token.trim() || DEFAULT_TOKEN;
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await getConfig().update("markerToken", nextToken, target);
  vscode.window.showInformationMessage(`标记已设置为: ${nextToken}`);
}

function getLineIndexesForSelections(selections) {
  const lineIndexes = new Set();

  for (const selection of selections) {
    let startLine = selection.start.line;
    let endLine = selection.end.line;
    if (!selection.isEmpty && selection.end.character === 0 && endLine > startLine) {
      endLine -= 1;
    }

    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
      lineIndexes.add(lineIndex);
    }
  }

  return [...lineIndexes].sort((a, b) => a - b);
}

async function initTargetLines(context) {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const style = getCommentStyle(editor.document);
  const token = getConfiguredToken();
  const lineIndexes = getLineIndexesForSelections(editor.selections);

  const ok = await editor.edit((editBuilder) => {
    for (const lineIndex of lineIndexes) {
      const line = editor.document.lineAt(lineIndex);
      const indent = line.text.match(/^\s*/)?.[0] || "";
      editBuilder.replace(line.range, buildCommentLine(style, token, "", indent));
    }
  });

  if (!ok) {
    vscode.window.showErrorMessage("初始化目标注释行失败。");
    return;
  }

  vscode.window.showInformationMessage(`已初始化 ${lineIndexes.length} 行目标注释行。`);
}

function updateStatusBarItems(items, focusItem, focusMode) {
  const showStatusBar = shouldShowStatusBar();
  const primaryVisible = showStatusBar && !focusMode;
  const focusVisible = showStatusBar;

  items.forEach((item) => {
    if (primaryVisible) {
      item.show();
    } else {
      item.hide();
    }
  });

  if (focusVisible) {
    focusItem.text = focusMode ? "$(expand-all) 展开" : "$(collapse-all) 专注";
    focusItem.tooltip = focusMode ? "退出专注模式" : "进入专注模式";
    focusItem.show();
  } else {
    focusItem.hide();
  }
}

function createStatusBarItems() {
  const prevChapterItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 104);
  prevChapterItem.text = "$(chevron-up)";
  prevChapterItem.tooltip = "上一章";
  prevChapterItem.command = "txtCommentReader.prevChapter";

  const prevItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 103);
  prevItem.text = "$(chevron-left)";
  prevItem.tooltip = "上一页";
  prevItem.command = "txtCommentReader.prevPage";

  const nextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
  nextItem.text = "$(chevron-right)";
  nextItem.tooltip = "下一页";
  nextItem.command = "txtCommentReader.nextPage";

  const nextChapterItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  nextChapterItem.text = "$(chevron-down)";
  nextChapterItem.tooltip = "下一章";
  nextChapterItem.command = "txtCommentReader.nextChapter";

  const initItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  initItem.text = "$(comment)";
  initItem.tooltip = "把选中行初始化为目标注释行";
  initItem.command = "txtCommentReader.initTargetLines";

  const focusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  focusItem.text = "$(collapse-all)";
  focusItem.tooltip = "进入专注模式";
  focusItem.command = "txtCommentReader.toggleFocusMode";

  const items = [prevChapterItem, prevItem, nextItem, nextChapterItem, initItem];
  return { items, focusItem };
}

async function activate(context) {
  const chapterTreeProvider = new ChapterTreeProvider(context);
  const statusBar = createStatusBarItems();
  const focusMode = getFocusMode(context);
  await vscode.commands.executeCommand("setContext", "txtCommentReader.focusMode", focusMode);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("txtCommentReader.chapters", chapterTreeProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("txtCommentReader.openText", () => openText(context, chapterTreeProvider)),
    vscode.commands.registerCommand("txtCommentReader.reopenLast", () => reopenLast(context)),
    vscode.commands.registerCommand("txtCommentReader.openChapter", (chapterIndex) => openChapter(context, chapterIndex)),
    vscode.commands.registerCommand("txtCommentReader.showChapters", () => showChapters(context, chapterTreeProvider, statusBar)),
    vscode.commands.registerCommand("txtCommentReader.refreshChapters", () => chapterTreeProvider.refresh()),
    vscode.commands.registerCommand("txtCommentReader.nextPage", () => nextPage(context)),
    vscode.commands.registerCommand("txtCommentReader.prevPage", () => prevPage(context)),
    vscode.commands.registerCommand("txtCommentReader.prevChapter", () => openPreviousChapter(context)),
    vscode.commands.registerCommand("txtCommentReader.nextChapter", () => openNextChapter(context)),
    vscode.commands.registerCommand("txtCommentReader.setToken", () => setToken(context)),
    vscode.commands.registerCommand("txtCommentReader.initTargetLines", () => initTargetLines(context)),
    vscode.commands.registerCommand("txtCommentReader.toggleFocusMode", () => toggleFocusMode(context, chapterTreeProvider, statusBar))
  );

  context.subscriptions.push(...statusBar.items, statusBar.focusItem);
  updateStatusBarItems(statusBar.items, statusBar.focusItem, focusMode);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("txtCommentReader.showStatusBar") || event.affectsConfiguration("txtCommentReader.focusMode")) {
        updateStatusBarItems(statusBar.items, statusBar.focusItem, getFocusMode(context));
      }
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  _test: {
    buildTextIndex,
    hardSplit,
    isChapterLine,
    packPieces,
    readTextLines,
    smartSplitLine,
    splitByPattern,
  },
};
