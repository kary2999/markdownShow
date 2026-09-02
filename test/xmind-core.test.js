"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const xmind = require("../lib/xmind-core.js");

// XMind Zen content.json 形如：数组，每元素一个 sheet，sheet.rootTopic 为根主题，
// 子主题在 children.attached。
function sheet(title, rootTopic) {
  return { title: title, rootTopic: rootTopic };
}
function topic(title, attached) {
  const t = { title: title };
  if (attached) t.children = { attached: attached };
  return t;
}

test("parseXmindContent extracts sheets and normalizes topic tree", () => {
  const json = JSON.stringify([
    sheet("画布1", topic("中心", [topic("A", [topic("A1")]), topic("B")])),
  ]);
  const sheets = xmind.parseXmindContent(json);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].title, "画布1");
  assert.equal(sheets[0].root.title, "中心");
  assert.equal(sheets[0].root.children.length, 2);
  assert.equal(sheets[0].root.children[0].title, "A");
  assert.equal(sheets[0].root.children[0].children[0].title, "A1");
  assert.equal(sheets[0].root.children[1].title, "B");
  assert.deepEqual(sheets[0].root.children[1].children, []);
});

test("parseXmindContent accepts a single sheet object (not array)", () => {
  const json = JSON.stringify(sheet("单画布", topic("根")));
  const sheets = xmind.parseXmindContent(json);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].root.title, "根");
});

test("parseXmindContent drops sheets without a root topic", () => {
  const json = JSON.stringify([{ title: "空" }, sheet("有根", topic("R"))]);
  const sheets = xmind.parseXmindContent(json);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].root.title, "R");
});

test("buildMindmapMarkdown emits a mermaid mindmap with indented hierarchy", () => {
  const sheets = [sheet("画布1", topic("中心", [topic("A", [topic("A1")]), topic("B")]))].map(
    (s) => ({ title: s.title, root: xmind.normalizeTopic(s.rootTopic) })
  );
  const md = xmind.buildMindmapMarkdown(sheets, "我的导图");
  assert.match(md, /^# 我的导图/);
  assert.match(md, /## 画布1/);
  assert.match(md, /```mermaid\nmindmap/);
  assert.match(md, /root\(\(中心\)\)/);
  // A 在根下一层（4 空格），A1 再下一层（6 空格）
  assert.match(md, /\n {4}A\n {6}A1\n/);
  assert.match(md, /\n {4}B\n/);
  assert.ok(md.trim().endsWith("```"));
});

test("buildMindmapMarkdown labels multiple canvases", () => {
  const sheets = [
    { title: "", root: { title: "R1", children: [] } },
    { title: "", root: { title: "R2", children: [] } },
  ];
  const md = xmind.buildMindmapMarkdown(sheets, "多画布");
  assert.match(md, /## 画布 1/);
  assert.match(md, /## 画布 2/);
  assert.match(md, /root\(\(R1\)\)/);
  assert.match(md, /root\(\(R2\)\)/);
});

test("sanitizeNodeText strips brackets/newlines and gives a placeholder for empty", () => {
  assert.equal(xmind.sanitizeNodeText("a(b)[c]{d}"), "a b c d");
  assert.equal(xmind.sanitizeNodeText("line1\nline2"), "line1 line2");
  assert.equal(xmind.sanitizeNodeText("   "), "（空）");
  assert.equal(xmind.sanitizeNodeText(null), "（空）");
});
