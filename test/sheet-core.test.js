const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/sheet-core.js");

test("parseCsv：引号、转义引号、引号内逗号与换行、CRLF、BOM", () => {
  const rows = S.parseCsv('﻿a,b,c\r\n1,"x,y","he said ""hi"""\r\n"多行\n文本",,末\n');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "x,y", 'he said "hi"'],
    ["多行\n文本", "", "末"],
  ]);
});

test("parseCsv：制表符分隔与无结尾换行", () => {
  assert.deepEqual(S.parseCsv("a\tb\n1\t2", "\t"), [["a", "b"], ["1", "2"]]);
});

test("colIndex / rowIndex", () => {
  assert.equal(S.colIndex("A1"), 0);
  assert.equal(S.colIndex("Z9"), 25);
  assert.equal(S.colIndex("AA1"), 26);
  assert.equal(S.rowIndex("B12"), 11);
});

test("serialToDate：整数日期、含时间、1900 闰年修正", () => {
  assert.equal(S.serialToDate(45292), "2024-01-01");
  assert.equal(S.serialToDate(45292.5), "2024-01-01 12:00:00");
  assert.equal(S.serialToDate(61), "1900-03-01");
});

test("parseSharedStrings：富文本拼接、实体解码、忽略拼音", () => {
  const xml =
    '<sst><si><t>A&amp;B</t></si><si><r><t>富</t></r><r><t xml:space="preserve"> 文本</t></r><rPh><t>fu</t></rPh></si></sst>';
  assert.deepEqual(S.parseSharedStrings(xml), ["A&B", "富 文本"]);
});

test("parseWorkbook + parseRels + resolveSheetPath", () => {
  const wb = '<sheets><sheet name="销售" sheetId="1" r:id="rId1"/><sheet name="S2" sheetId="2" r:id="rId2"/></sheets>';
  const rels = '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>';
  const sheets = S.parseWorkbook(wb);
  const map = S.parseRels(rels);
  assert.deepEqual(sheets.map((s) => s.name), ["销售", "S2"]);
  assert.equal(S.resolveSheetPath(map[sheets[0].rid]), "xl/worksheets/sheet1.xml");
  assert.equal(S.resolveSheetPath(map[sheets[1].rid]), "xl/worksheets/sheet2.xml");
});

test("parseDateStyles：内置与自定义日期格式", () => {
  const xml =
    '<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy&quot;年&quot;mm&quot;月&quot;"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>' +
    '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';
  assert.deepEqual(S.parseDateStyles(xml), { 1: true, 2: true });
});

test("parseSheet：共享串/内联串/布尔/数字/日期，稀疏单元格与空行补齐", () => {
  const xml =
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>内联</t></is></c></row>' +
    '<row r="3"><c r="A3"><v>3.5</v></c><c r="B3" s="1"><v>45292</v></c><c r="C3" t="b"><v>1</v></c><c r="D3" t="str"><v>a&lt;b</v></c></row>' +
    "</sheetData></worksheet>";
  const r = S.parseSheet(xml, ["名称"], { 1: true });
  assert.deepEqual(r.rows, [
    ["名称", "", "内联"],
    [],
    ["3.5", "2024-01-01", "TRUE", "a<b"],
  ]);
  assert.equal(r.truncated, false);
});

test("parseSheet：超过最大行数截断并标记", () => {
  const rows = [];
  for (let i = 1; i <= S.MAX_ROWS + 5; i++) rows.push(`<row r="${i}"><c r="A${i}"><v>${i}</v></c></row>`);
  const r = S.parseSheet("<sheetData>" + rows.join("") + "</sheetData>", [], {});
  assert.equal(r.rows.length, S.MAX_ROWS);
  assert.equal(r.truncated, true);
});

test("rowsToHtml：首行表头、转义 HTML、换行变 <br>、补齐列", () => {
  const html = S.rowsToHtml([["<b>", "x"], ["a\nb"]]);
  assert.match(html, /<th>&lt;b&gt;<\/th><th>x<\/th>/);
  assert.match(html, /<td>a<br>b<\/td><td><\/td>/);
  assert.doesNotMatch(html, /<b>/);
});

test("sheetsToMarkdown：每个工作表一个二级标题，HTML 无空行", () => {
  const md = S.sheetsToMarkdown([{ name: "S1", rows: [["h"], ["1"]] }], "f.csv");
  assert.match(md, /^# f\.csv\n\n## S1\n\n<div class="mdv-table-wrap">/);
  const block = md.split("## S1\n\n")[1].split("\n\n")[0];
  assert.doesNotMatch(block, /\n/);
});
