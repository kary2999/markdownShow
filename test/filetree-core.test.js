"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../lib/filetree-core.js");

// ---- mock FileSystemHandle (duck-typed, no real File System Access API) ----
function file(name) {
  return { kind: "file", name: name };
}
function dir(name, children) {
  return {
    kind: "directory",
    name: name,
    entries: async function* () {
      for (const c of children) yield [c.name, c];
    },
  };
}

// ============================= validateEntryName =============================
test("validateEntryName rejects empty / whitespace-only names", () => {
  assert.equal(core.validateEntryName("").valid, false);
  assert.equal(core.validateEntryName("   ").valid, false);
});

test("validateEntryName trims and accepts a normal name", () => {
  const r = core.validateEntryName("  notes.md  ");
  assert.equal(r.valid, true);
  assert.equal(r.name, "notes.md");
});

test("validateEntryName rejects path separators and control chars", () => {
  assert.equal(core.validateEntryName("a/b.md").valid, false);
  assert.equal(core.validateEntryName("a" + String.fromCharCode(92) + "b.md").valid, false);
  assert.equal(core.validateEntryName("a" + String.fromCharCode(9) + "b.md").valid, false);
  assert.equal(core.validateEntryName("a" + String.fromCharCode(10) + "b.md").valid, false);
});

test("validateEntryName allows spaces - a normal, legitimate filename character", () => {
  const r = core.validateEntryName("My Notes.md");
  assert.equal(r.valid, true);
  assert.equal(r.name, "My Notes.md");
});

test("validateEntryName rejects '.' and '..'", () => {
  assert.equal(core.validateEntryName(".").valid, false);
  assert.equal(core.validateEntryName("..").valid, false);
});

test("validateEntryName rejects names over 255 chars", () => {
  assert.equal(core.validateEntryName("a".repeat(256)).valid, false);
  assert.equal(core.validateEntryName("a".repeat(255)).valid, true);
});

test("validateEntryName rejects Windows-reserved device names", () => {
  assert.equal(core.validateEntryName("CON").valid, false);
  assert.equal(core.validateEntryName("con.md").valid, false);
  assert.equal(core.validateEntryName("COM1").valid, false);
  assert.equal(core.validateEntryName("constant.md").valid, true); // 前缀相似但不是保留名
});

// ================================ isOpenable ================================
test("isOpenable matches known markdown/text extensions case-insensitively", () => {
  assert.equal(core.isOpenable("readme.md"), true);
  assert.equal(core.isOpenable("READHISTORY.MD"), true);
  assert.equal(core.isOpenable("notes.mdx"), true);
  assert.equal(core.isOpenable("data.png"), false);
  assert.equal(core.isOpenable("no-extension"), false);
});

// =============================== isHiddenName ================================
test("isHiddenName flags dotfiles and node_modules", () => {
  assert.equal(core.isHiddenName(".git"), true);
  assert.equal(core.isHiddenName(".env"), true);
  assert.equal(core.isHiddenName("node_modules"), true);
  assert.equal(core.isHiddenName("README.md"), false);
});

// ============================== compareEntries ================================
test("compareEntries sorts directories before files, then natural order", () => {
  const entries = [file("b.md"), dir("z-dir", []), file("a.md"), dir("a-dir", [])];
  entries.sort(core.compareEntries);
  assert.deepEqual(
    entries.map((e) => e.name),
    ["a-dir", "z-dir", "a.md", "b.md"]
  );
});

test("compareEntries uses numeric-aware natural sort within same kind", () => {
  const entries = [file("file10.md"), file("file2.md"), file("file1.md")];
  entries.sort(core.compareEntries);
  assert.deepEqual(
    entries.map((e) => e.name),
    ["file1.md", "file2.md", "file10.md"]
  );
});

// =============================== scanDirectory =================================
test("scanDirectory builds a sorted tree and marks openable files", async () => {
  const tree = dir("workspace", [
    file("b.md"),
    dir("sub", [file("nested.txt"), file("image.png")]),
    file("a.md"),
  ]);
  const result = await core.scanDirectory(tree, {});
  assert.equal(result.root.name, "workspace");
  assert.equal(result.truncated, false);
  const names = result.root.children.map((c) => c.name);
  assert.deepEqual(names, ["sub", "a.md", "b.md"]); // 目录优先，其后自然序
  const sub = result.root.children[0];
  assert.equal(sub.children.length, 2);
  const nested = sub.children.find((c) => c.name === "nested.txt");
  const image = sub.children.find((c) => c.name === "image.png");
  assert.equal(nested.openable, true);
  assert.equal(image.openable, false);
});

test("scanDirectory skips hidden entries and node_modules by default", async () => {
  const tree = dir("workspace", [
    file("visible.md"),
    file(".hidden.md"),
    dir("node_modules", [file("pkg.js")]),
    dir(".git", [file("HEAD")]),
  ]);
  const result = await core.scanDirectory(tree, {});
  assert.deepEqual(
    result.root.children.map((c) => c.name),
    ["visible.md"]
  );
});

test("scanDirectory reveals hidden entries when showHidden is true", async () => {
  const tree = dir("workspace", [file("visible.md"), file(".hidden.md")]);
  const result = await core.scanDirectory(tree, { showHidden: true });
  assert.deepEqual(
    result.root.children.map((c) => c.name).sort(),
    [".hidden.md", "visible.md"]
  );
});

test("scanDirectory stops descending past maxDepth and flags depthLimited", async () => {
  const tree = dir("root", [dir("level1", [dir("level2", [file("deep.md")])])]);
  const result = await core.scanDirectory(tree, { maxDepth: 1 });
  const level1 = result.root.children[0];
  assert.equal(level1.name, "level1");
  assert.equal(level1.depthLimited, true);
  assert.deepEqual(level1.children, []);
});

test("scanDirectory caps total visited entries and reports truncated", async () => {
  const many = [];
  for (let i = 0; i < 10; i++) many.push(file("f" + i + ".md"));
  let iterationCount = 0;
  const tree = {
    kind: "directory",
    name: "root",
    entries: async function* () {
      for (const child of many) {
        iterationCount++;
        yield [child.name, child];
      }
    },
  };
  const result = await core.scanDirectory(tree, { maxEntries: 3 });
  assert.equal(result.truncated, true);
  assert.equal(result.visitedCount, 3);
  assert.equal(result.root.children.length, 3);
  assert.equal(iterationCount, 3);
});

test("scanDirectory applies maxEntries while traversing descendants globally", async () => {
  const tree = dir("root", [dir("a", [file("nested3.md"), file("nested1.md"), file("nested2.md")])]);
  const result = await core.scanDirectory(tree, { maxEntries: 3 });

  assert.equal(result.truncated, true);
  assert.equal(result.visitedCount, 3);
  assert.deepEqual(result.root.children.map((child) => child.name), ["a"]);
  assert.deepEqual(result.root.children[0].children.map((child) => child.name), [
    "nested1.md",
    "nested3.md",
  ]);
});

test("scanDirectory isolates an unreadable subdirectory instead of failing the whole tree", async () => {
  // 模拟真实场景：某子目录 entries() 抛错（权限/特殊目录）。整棵树不应因此失败。
  const boom = {
    kind: "directory",
    name: "受限",
    entries: async function* () {
      throw new Error("PermissionDenied");
    },
  };
  const tree = dir("root", [file("ok.md"), boom, dir("normal", [file("inside.md")])]);
  const result = await core.scanDirectory(tree, {});
  // 顶层三项都在（目录优先，文件在后），受限目录被标记 error，其余目录正常递归
  assert.deepEqual(
    result.root.children.map((c) => c.name).sort(),
    ["normal", "ok.md", "受限"]
  );
  const restricted = result.root.children.find((c) => c.name === "受限");
  assert.equal(typeof restricted.error, "string");
  const normal = result.root.children.find((c) => c.name === "normal");
  assert.deepEqual(normal.children.map((c) => c.name), ["inside.md"]);
});

// ================================= scanLevel ==================================
test("scanLevel reads only one level and marks subdirectories unloaded", async () => {
  const tree = dir("root", [
    file("b.md"),
    dir("sub", [file("deep.md")]),
    file("a.md"),
    file("img.png"),
  ]);
  const result = await core.scanLevel(tree, {});
  assert.equal(result.error, null);
  assert.deepEqual(result.children.map((c) => c.name), ["sub", "a.md", "b.md", "img.png"]);
  const sub = result.children.find((c) => c.name === "sub");
  assert.equal(sub.loaded, false); // 未加载，待懒加载
  assert.equal(sub.children, null); // 不递归
  const a = result.children.find((c) => c.name === "a.md");
  assert.equal(a.openable, true);
  const img = result.children.find((c) => c.name === "img.png");
  assert.equal(img.openable, false);
});

test("scanLevel skips hidden by default and honors showHidden", async () => {
  const tree = dir("root", [file("v.md"), file(".secret.md"), dir("node_modules", [])]);
  const def = await core.scanLevel(tree, {});
  assert.deepEqual(def.children.map((c) => c.name), ["v.md"]);
  const all = await core.scanLevel(tree, { showHidden: true });
  assert.deepEqual(all.children.map((c) => c.name).sort(), [".secret.md", "node_modules", "v.md"]);
});

test("scanLevel returns an error field when the directory cannot be enumerated", async () => {
  const boom = {
    kind: "directory",
    name: "x",
    entries: async function* () {
      throw new Error("denied");
    },
  };
  const result = await core.scanLevel(boom, {});
  assert.equal(typeof result.error, "string");
  assert.deepEqual(result.children, []);
});

test("scanLevel caps at maxEntries and reports truncated", async () => {
  const many = [];
  for (let i = 0; i < 10; i++) many.push(file("f" + i + ".md"));
  const tree = dir("root", many);
  const result = await core.scanLevel(tree, { maxEntries: 4 });
  assert.equal(result.truncated, true);
  assert.equal(result.children.length, 4);
});

// ============================== serializeTree ==================================
test("serializeTree strips handles and preserves structure", () => {
  const tree = {
    name: "root",
    kind: "directory",
    handle: { fake: true },
    children: [
      { name: "a.md", kind: "file", openable: true, handle: {} },
      {
        name: "sub",
        kind: "directory",
        handle: {},
        depthLimited: true,
        children: [{ name: "b.txt", kind: "file", openable: true, handle: {} }],
      },
    ],
  };
  const s = core.serializeTree(tree);
  assert.equal(JSON.stringify(s).indexOf("handle"), -1); // 无 handle
  assert.equal(s.children[1].depthLimited, true);
  assert.equal(s.children[1].children[0].name, "b.txt");
  // 可 JSON 往返
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

// ============================== flattenFiles ===================================
test("flattenFiles produces slash paths for every descendant", () => {
  const tree = {
    name: "root",
    kind: "directory",
    children: [
      { name: "top.md", kind: "file", openable: true },
      {
        name: "docs",
        kind: "directory",
        children: [{ name: "guide.md", kind: "file", openable: true }],
      },
    ],
  };
  const flat = core.flattenFiles(tree);
  const paths = flat.map((e) => e.path);
  assert.deepEqual(paths, ["top.md", "docs", "docs/guide.md"]);
  const guide = flat.find((e) => e.path === "docs/guide.md");
  assert.equal(guide.kind, "file");
  assert.equal(guide.openable, true);
});

// ================================= filterTree ==================================
test("filterTree returns the same reference when query is empty", () => {
  const tree = { name: "root", kind: "directory", children: [] };
  assert.equal(core.filterTree(tree, ""), tree);
  assert.equal(core.filterTree(tree, "   "), tree);
});

test("filterTree keeps only matching files and their ancestor folders", () => {
  const tree = {
    name: "root",
    kind: "directory",
    children: [
      {
        name: "docs",
        kind: "directory",
        children: [
          { name: "guide.md", kind: "file" },
          { name: "notes.txt", kind: "file" },
        ],
      },
      { name: "other.md", kind: "file" },
    ],
  };
  const filtered = core.filterTree(tree, "guide");
  assert.equal(filtered.children.length, 1);
  assert.equal(filtered.children[0].name, "docs");
  assert.equal(filtered.children[0].children.length, 1);
  assert.equal(filtered.children[0].children[0].name, "guide.md");
});

test("filterTree matching is case-insensitive", () => {
  const tree = {
    name: "root",
    kind: "directory",
    children: [{ name: "README.md", kind: "file" }],
  };
  const filtered = core.filterTree(tree, "readme");
  assert.equal(filtered.children.length, 1);
});

test("filterTree returns an empty-children root when nothing matches", () => {
  const tree = {
    name: "root",
    kind: "directory",
    children: [{ name: "a.md", kind: "file" }],
  };
  const filtered = core.filterTree(tree, "zzz-not-found");
  assert.equal(filtered.name, "root");
  assert.deepEqual(filtered.children, []);
});

// ================================= countEntries ==================================
test("countEntries counts files and directories excluding the root itself", () => {
  const tree = {
    name: "root",
    kind: "directory",
    children: [
      { name: "a.md", kind: "file" },
      {
        name: "sub",
        kind: "directory",
        children: [
          { name: "b.md", kind: "file" },
          { name: "c.md", kind: "file" },
        ],
      },
    ],
  };
  const counted = core.countEntries(tree);
  assert.deepEqual(counted, { files: 3, dirs: 1 });
});
