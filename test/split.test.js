const assert = require("assert");
const fs = require("fs/promises");
const Module = require("module");
const os = require("os");
const path = require("path");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      workspace: {
        getConfiguration() {
          return {
            inspect() {
              return {};
            },
            get(key, fallback) {
              const values = {
                smartSplit: true,
                maxCharsPerLine: 12,
              };
              return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
            },
          };
        },
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { _test } = require("../extension");

assert.deepStrictEqual(_test.readTextLines("第一句。\n\n第二句！\n   \n第三句？"), [
  "第一句。",
  "第二句！",
  "第三句？",
]);

assert.deepStrictEqual(_test.smartSplitLine("她说：“你终于来了。”他点点头。", 20), [
  "她说：“你终于来了。”他点点头。",
]);

assert.deepStrictEqual(_test.smartSplitLine("这一句很长很长很长，应该先按逗号切开，然后继续处理。", 12), [
  "这一句很长很长很长，",
  "应该先按逗号切开，",
  "然后继续处理。",
]);

assert.deepStrictEqual(_test.smartSplitLine("第一句。第二句！第三句？", 11), [
  "第一句。第二句！",
  "第三句？",
]);

assert.deepStrictEqual(_test.smartSplitLine("abcdefghijklmnopqrstuv", 8), [
  "abcdefgh",
  "ijklmnop",
  "qrstuv",
]);

assert.strictEqual(_test.isChapterLine("第一章 初遇"), true);
assert.strictEqual(_test.isChapterLine("第12回 风起"), true);
assert.strictEqual(_test.isChapterLine("第3节 暗线"), true);
assert.strictEqual(_test.isChapterLine("Chapter 3 Return"), true);
assert.strictEqual(_test.isChapterLine("正文里提到第一章"), false);

const textIndex = _test.buildTextIndex("第一章 初遇\n这是第一句。第二句。\n\n第二章 离开\n下一段。");
assert.deepStrictEqual(textIndex.chapters, [
  {
    title: "第一章 初遇",
    segmentIndex: 0,
  },
  {
    title: "第二章 离开",
    segmentIndex: 2,
  },
]);

(async () => {
  const tmpFile = path.join(os.tmpdir(), `txt-comment-reader-${Date.now()}.txt`);
  await fs.writeFile(tmpFile, "第一章 初遇\n这是第一句。第二句。\n\n第二章 离开\n下一段。", "utf8");

  try {
    const fileIndex = await _test.loadTextIndex(tmpFile);
    assert.strictEqual(fileIndex.totalSegments, 4);
    assert.deepStrictEqual(
      fileIndex.chapters.map(({ title, segmentIndex }) => ({ title, segmentIndex })),
      [
        {
          title: "第一章 初遇",
          segmentIndex: 0,
        },
        {
          title: "第二章 离开",
          segmentIndex: 2,
        },
      ]
    );

    assert.deepStrictEqual(await _test.readSegments(tmpFile, 1, 2, fileIndex), [
      "这是第一句。第二句。",
      "第二章 离开",
    ]);
    assert.strictEqual(_test.normalizeSegmentIndex(999, fileIndex.totalSegments, 3), 3);
    assert.strictEqual(_test.getChapterIndexForSegmentIndex(fileIndex.chapters, 3), 1);
  } finally {
    await fs.unlink(tmpFile);
  }

  console.log("split tests ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
