const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../lib/mock-api.js");

const NOW = new Date(2026, 10, 1, 12, 0).getTime();
const sample = {
  method: "POST", path: "/contract/positions/list", summary: "持仓列表", use: "success",
  request: { filters: { position_status: "OPEN" } },
  scenarios: {
    success: { code: "0", msg: "success", data: { list: [{ opened_time: "-5h", n: 1 }] } },
    历史持仓: { when: { "filters.position_status": "CLOSED" }, code: "0", msg: "success", data: { closed_time: "-2d4h30m" } },
  },
};

test("isMockApi 按内容识别，不靠文件名", () => {
  assert.ok(M.isMockApi(sample));
  assert.ok(!M.isMockApi({ method: "POST", path: "/x" }));
  assert.ok(!M.isMockApi({ method: "FOO", path: "/x", scenarios: { a: {} } }));
  assert.ok(!M.isMockApi({ method: "GET", path: "x", scenarios: { a: {} } }));
  assert.ok(!M.isMockApi({ method: "GET", path: "/x", scenarios: {} }));
  assert.ok(!M.isMockApi([]) && !M.isMockApi(null) && !M.isMockApi("a"));
});

test("collectTimes 解析相对时间", () => {
  const rows = M.collectTimes(sample.scenarios.success.data, NOW);
  assert.deepStrictEqual(rows.map((r) => [r.path, r.rel, r.abs]), [["list[0].opened_time", "-5h", "2026-11-01 07:00"]]);
  const r2 = M.collectTimes(sample.scenarios.历史持仓.data, NOW);
  assert.strictEqual(r2[0].abs, "2026-10-30 07:30");
  assert.strictEqual(M.collectTimes({ x_time: "2026-01-01T00:00:00Z", note: "-3h" }, NOW).length, 0);
});

test("toMarkdown 含接口头、当前场景、when 条件", () => {
  const md = M.toMarkdown(sample, NOW);
  assert.match(md, /^# \*\*POST\*\* `\/contract\/positions\/list`/);
  assert.match(md, /当前返回：\*\*success\*\*/);
  assert.match(md, /### ✅ success/);
  assert.match(md, /filters\.position_status = "CLOSED"/);
  assert.match(md, /2026-11-01 07:00/);
});

test("data 里含反引号时围栏自适应", () => {
  const md = M.toMarkdown({ ...sample, scenarios: { s: { code: "0", msg: "```", data: { a: "```x```" } } } }, NOW);
  assert.match(md, /````json/);
});

test("真实 mock-data 全部文件都能识别并渲染（目录存在时）", (t) => {
  const dir = "/Volumes/AiCode/Axon模拟盘/axon-client/mock-data/apis";
  if (!fs.existsSync(dir)) return t.skip("mock-data 目录不可用");
  const files = fs.readdirSync(dir).filter((f) => /^[A-Z]+_.*\.json$/.test(f));
  assert.ok(files.length > 0);
  files.forEach((f) => {
    const o = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.ok(M.isMockApi(o), f);
    assert.ok(M.toMarkdown(o, NOW).length > 50, f);
  });
  assert.ok(!M.isMockApi(JSON.parse(fs.readFileSync(path.join(dir, "_index.json"), "utf8"))));
});

test("isMockIndex / groupIndex", () => {
  const idx = { list: [
    { method: "POST", path: "/a", file: "POST_a.json", summary: "A", tag: "账户" },
    { method: "GET", path: "/b", file: "GET_b.json", tag: "行情" },
    { method: "GET", path: "/c", file: "GET_c.json", tag: "账户" },
    { method: "GET", path: "/d", file: "GET_d.json" },
  ] };
  assert.ok(M.isMockIndex(idx));
  assert.ok(!M.isMockIndex({ list: [] }) && !M.isMockIndex({ list: [{ method: "GET", path: "/x" }] }) && !M.isMockIndex(sample));
  const g = M.groupIndex(idx);
  assert.deepStrictEqual(g.map((x) => [x.tag, x.items.length]), [["账户", 2], ["行情", 1], ["未分组", 1]]);
});

test("真实 _index.json 可识别且每个 file 都存在", (t) => {
  const dir = "/Volumes/AiCode/Axon模拟盘/axon-client/mock-data/apis";
  if (!fs.existsSync(dir)) return t.skip("mock-data 目录不可用");
  const o = JSON.parse(fs.readFileSync(path.join(dir, "_index.json"), "utf8"));
  assert.ok(M.isMockIndex(o));
  o.list.forEach((it) => assert.ok(fs.existsSync(path.join(dir, it.file)), it.file));
});
