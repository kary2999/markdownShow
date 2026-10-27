/* 表格解析纯逻辑（CSV/TSV、xlsx 内部 XML），无 DOM 依赖，可在 Node 下单测。
 * 导出 MDVSheet。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MDVSheet = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var MAX_ROWS = 5000; // 单表最多展示行数
  var MAX_COLS = 200;

  // ---- CSV / TSV（RFC 4180：引号、转义引号、引号内换行） ----------------------
  function parseCsv(text, delim) {
    text = String(text).replace(/^﻿/, "");
    delim = delim || ",";
    var rows = [];
    var row = [];
    var cell = "";
    var inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') {
            cell += '"';
            i++;
          } else inQ = false;
        } else cell += ch;
      } else if (ch === '"' && cell === "") {
        inQ = true;
      } else if (ch === delim) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  // ---- XML 小工具 -------------------------------------------------------------
  function decodeXml(s) {
    return String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) {
        return String.fromCodePoint(parseInt(h, 16));
      })
      .replace(/&#(\d+);/g, function (_, d) {
        return String.fromCodePoint(parseInt(d, 10));
      })
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }
  function attr(tag, name) {
    var m = new RegExp("(?:^|\\s)" + name + '="([^"]*)"').exec(tag);
    return m ? decodeXml(m[1]) : null;
  }
  // 取 <si>/<is> 内所有 <t> 文本（富文本拼接；忽略拼音 <rPh>）
  function textOf(inner) {
    inner = inner.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
    var out = "";
    var re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    var m;
    while ((m = re.exec(inner))) out += decodeXml(m[1]);
    return out;
  }

  function parseSharedStrings(xml) {
    var list = [];
    var re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
    var m;
    while ((m = re.exec(xml))) list.push(textOf(m[1]));
    return list;
  }

  // 工作表清单：[{ name, rid }]，再用 rels 映射 rid → 文件路径
  function parseWorkbook(xml) {
    var sheets = [];
    var re = /<sheet\s[^>]*>/g;
    var m;
    while ((m = re.exec(xml))) {
      sheets.push({ name: attr(m[0], "name"), rid: attr(m[0], "r:id") });
    }
    return sheets;
  }
  function parseRels(xml) {
    var map = {};
    var re = /<Relationship\s[^>]*>/g;
    var m;
    while ((m = re.exec(xml))) {
      var id = attr(m[0], "Id");
      var target = attr(m[0], "Target");
      if (id && target) map[id] = target;
    }
    return map;
  }
  function resolveSheetPath(target) {
    if (target.charAt(0) === "/") return target.slice(1);
    return "xl/" + target.replace(/^\.\//, "");
  }

  // ---- 日期：按样式判断哪些数值单元格是日期 ------------------------------------
  var BUILTIN_DATE_IDS = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 45: 1, 46: 1, 47: 1 };
  function isDateFormatCode(code) {
    var c = String(code).replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
    return /[ymdhs]/i.test(c) && !/^(general|0|#)/i.test(c.trim());
  }
  // 返回 Set 风格对象：{ [cellXfIndex]: true }，表示该样式为日期
  function parseDateStyles(xml) {
    var custom = {};
    var re = /<numFmt\s[^>]*>/g;
    var m;
    while ((m = re.exec(xml))) {
      var id = attr(m[0], "numFmtId");
      if (id != null) custom[id] = attr(m[0], "formatCode") || "";
    }
    var res = {};
    var cx = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!cx) return res;
    var xr = /<xf\s[^>]*?\/?>/g;
    var idx = 0;
    while ((m = xr.exec(cx[1]))) {
      var nf = attr(m[0], "numFmtId");
      if (nf != null && (BUILTIN_DATE_IDS[nf] || (custom[nf] != null && isDateFormatCode(custom[nf])))) {
        res[idx] = true;
      }
      idx++;
    }
    return res;
  }
  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }
  // Excel 序列号 → yyyy-mm-dd[ hh:mm:ss]（1900 日期系统，含 1900 闰年错误的修正）
  function serialToDate(serial) {
    var n = Number(serial);
    if (!isFinite(n)) return String(serial);
    var days = Math.floor(n);
    var frac = n - days;
    if (days >= 61) days -= 1; // 修正 Excel 把 1900 当闰年
    var ms = Date.UTC(1899, 11, 31) + days * 86400000;
    var d = new Date(ms);
    var out = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
    if (frac > 0) {
      var secs = Math.round(frac * 86400);
      out += " " + pad(Math.floor(secs / 3600) % 24) + ":" + pad(Math.floor(secs / 60) % 60) + ":" + pad(secs % 60);
    }
    return out;
  }

  // "AB12" → 列下标（0 起）
  function colIndex(ref) {
    var m = /^([A-Za-z]+)/.exec(ref || "");
    if (!m) return -1;
    var s = m[1].toUpperCase();
    var n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function rowIndex(ref) {
    var m = /(\d+)$/.exec(ref || "");
    return m ? parseInt(m[1], 10) - 1 : -1;
  }

  // 解析单个工作表 XML → { rows: string[][], truncated: bool }
  function parseSheet(xml, shared, dateStyles) {
    var rows = [];
    var truncated = false;
    var rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
    var rm;
    var autoRow = 0;
    while ((rm = rowRe.exec(xml))) {
      var rTag = rm[0].slice(0, rm[0].indexOf(">") + 1);
      var rAttr = attr(rTag, "r");
      var ri = rAttr ? parseInt(rAttr, 10) - 1 : autoRow;
      autoRow = ri + 1;
      if (ri >= MAX_ROWS) {
        truncated = true;
        break;
      }
      var cells = [];
      var body = rm[1] || "";
      var cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      var cm;
      var autoCol = 0;
      while ((cm = cRe.exec(body))) {
        var tag = cm[1];
        var ref = attr(tag, "r");
        var ci = ref ? colIndex(ref) : autoCol;
        autoCol = ci + 1;
        if (ci < 0 || ci >= MAX_COLS) continue;
        var inner = cm[2] || "";
        var t = attr(tag, "t");
        var val = "";
        var vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (t === "s") {
          val = vm ? shared[parseInt(vm[1], 10)] || "" : "";
        } else if (t === "inlineStr") {
          var im = /<is>([\s\S]*?)<\/is>/.exec(inner);
          val = im ? textOf(im[1]) : "";
        } else if (t === "b") {
          val = vm ? (vm[1] === "1" ? "TRUE" : "FALSE") : "";
        } else if (t === "str" || t === "e") {
          val = vm ? decodeXml(vm[1]) : "";
        } else if (vm) {
          val = decodeXml(vm[1]);
          var sIdx = attr(tag, "s");
          if (sIdx != null && dateStyles && dateStyles[sIdx]) val = serialToDate(val);
        }
        cells[ci] = val;
      }
      for (var k = 0; k < cells.length; k++) if (cells[k] === undefined) cells[k] = "";
      rows[ri] = cells;
    }
    for (var j = 0; j < rows.length; j++) if (!rows[j]) rows[j] = [];
    return { rows: rows, truncated: truncated };
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 行 → HTML 表格（首行作表头）。单元格文本全部转义，之后仍会过 DOMPurify。
  function rowsToHtml(rows) {
    if (!rows.length) return "<p><em>（空表）</em></p>";
    var width = 0;
    rows.forEach(function (r) {
      if (r.length > width) width = r.length;
    });
    function tr(r, tag) {
      var out = "<tr>";
      for (var i = 0; i < width; i++) {
        out += "<" + tag + ">" + esc(r[i] == null ? "" : r[i]).replace(/\r?\n/g, "<br>") + "</" + tag + ">";
      }
      return out + "</tr>";
    }
    var html = '<div class="mdv-table-wrap"><table><thead>' + tr(rows[0], "th") + "</thead><tbody>";
    for (var i = 1; i < rows.length; i++) html += tr(rows[i], "td");
    return html + "</tbody></table></div>";
  }

  // 多个工作表 → Markdown（标题 + 原生 HTML 表格，进 TOC 可跳转）
  function sheetsToMarkdown(sheets, title) {
    var out = "# " + String(title).replace(/[\r\n]+/g, " ") + "\n\n";
    sheets.forEach(function (s) {
      out += "## " + String(s.name).replace(/[\r\n#]+/g, " ") + "\n\n";
      out += rowsToHtml(s.rows).replace(/\n/g, "") + "\n\n";
      if (s.truncated) out += "> 仅显示前 " + MAX_ROWS + " 行。\n\n";
    });
    return out;
  }

  return {
    MAX_ROWS: MAX_ROWS,
    parseCsv: parseCsv,
    decodeXml: decodeXml,
    parseSharedStrings: parseSharedStrings,
    parseWorkbook: parseWorkbook,
    parseRels: parseRels,
    resolveSheetPath: resolveSheetPath,
    parseDateStyles: parseDateStyles,
    serialToDate: serialToDate,
    colIndex: colIndex,
    rowIndex: rowIndex,
    parseSheet: parseSheet,
    rowsToHtml: rowsToHtml,
    sheetsToMarkdown: sheetsToMarkdown,
  };
});
