/* mock-api.js — 识别并渲染 axon-client/mock-data/apis/*.json 的“接口 Mock 文件”规范。
 * 规范：{ method, path, summary, purpose?, when_called?, called_from?, description?, request?, request_fields?, response_fields?, response_notes?, use?, scenarios: { 名: { code, msg, data, when? } } }
 * 纯逻辑（UMD，无 DOM），输出 Markdown，交给现有 Markdown 管线渲染。
 *   浏览器：window.MDVMockApi    Node：require('./lib/mock-api.js') */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MDVMockApi = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;
  // 相对时间：-3h、+7d、-2d4h30m（相对加载时刻）
  var REL_TIME = /^[+-](\d+[dhms])+$/;
  var TIME_KEY = /(^time$|_time$)/;
  var TIME_ROWS_MAX = 20;

  function isObj(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  // 内容识别（不靠文件名）：有 HTTP 方法、以 / 开头的路径、scenarios 对象，且每个场景是对象
  function isMockApi(obj) {
    if (!isObj(obj) || !METHODS.test(String(obj.method || "")) || typeof obj.path !== "string") return false;
    if (obj.path.charAt(0) !== "/" || !isObj(obj.scenarios)) return false;
    var names = Object.keys(obj.scenarios);
    return names.length > 0 && names.every(function (n) { return isObj(obj.scenarios[n]); });
  }

  function relToMs(s) {
    var sign = s.charAt(0) === "-" ? -1 : 1;
    var unit = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
    var ms = 0;
    s.replace(/(\d+)([dhms])/g, function (_, n, u) {
      ms += Number(n) * unit[u];
      return "";
    });
    return sign * ms;
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }
  function fmt(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // 收集 data 里的相对时间字段：[{ path, rel, abs }]
  function collectTimes(data, now) {
    var rows = [];
    (function walk(v, path) {
      if (Array.isArray(v)) {
        v.forEach(function (x, i) { walk(x, path + "[" + i + "]"); });
      } else if (isObj(v)) {
        Object.keys(v).forEach(function (k) {
          var val = v[k];
          var p = path ? path + "." + k : k;
          if (typeof val === "string" && TIME_KEY.test(k) && REL_TIME.test(val)) {
            rows.push({ path: p, rel: val, abs: fmt(new Date(now + relToMs(val))) });
          } else {
            walk(val, p);
          }
        });
      }
    })(data, "");
    return rows;
  }

  function fenceOf(text) {
    var runs = text.match(/`+/g) || [];
    var n = 3;
    runs.forEach(function (r) {
      if (r.length >= n) n = r.length + 1;
    });
    return new Array(n + 1).join("`");
  }
  function jsonBlock(v) {
    var text = JSON.stringify(v, null, 2);
    var f = fenceOf(text);
    return f + "json\n" + text + "\n" + f + "\n";
  }
  function cell(s) {
    return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  }


  // 字段说明表：fields = [{ field, in?, type, required?, optional?, desc }]
  function fieldTable(fields, opts) {
    opts = opts || {};
    var head = ["字段"];
    if (opts.withIn) head.push("位置");
    head.push("类型");
    if (opts.withRequired) head.push("必填");
    if (opts.withOptional) head.push("返回");
    head.push("说明");
    var lines = ["| " + head.join(" | ") + " |", "|" + head.map(function () { return "---"; }).join("|") + "|"];
    fields.forEach(function (f) {
      var row = ["`" + cell(f.field) + "`"];
      if (opts.withIn) row.push(f["in"] === "path" ? "路径" : f["in"] === "query" ? "query" : "请求体");
      row.push(cell(f.type || ""));
      if (opts.withRequired) row.push(f.required ? "**必填**" : "可选");
      if (opts.withOptional) row.push(f.optional ? "按场景返回" : "必返回");
      row.push(cell(f.desc || ""));
      lines.push("| " + row.join(" | ") + " |");
    });
    return lines.join("\n") + "\n";
  }
  function hasFields(a) {
    return Array.isArray(a) && a.length > 0;
  }

  function currentScenario(obj) {
    var names = Object.keys(obj.scenarios);
    if (typeof obj.use === "string" && obj.scenarios[obj.use]) return obj.use;
    return obj.scenarios.success ? "success" : names[0];
  }

  function toMarkdown(obj, now) {
    now = typeof now === "number" ? now : Date.now();
    var names = Object.keys(obj.scenarios);
    var cur = currentScenario(obj);
    var out = [];

    out.push("# **" + obj.method + "** `" + obj.path + "`\n");
    if (obj.summary) out.push("> " + String(obj.summary).replace(/\n/g, " ") + "\n");
    if (obj.description) out.push(String(obj.description) + "\n");
    if (obj.purpose) out.push("**接口作用**：" + String(obj.purpose).replace(/\n/g, " ") + "\n");
    if (obj.when_called) out.push("**调用时机**：" + String(obj.when_called).replace(/\n/g, " ") + "\n");
    if (obj.called_from) out.push("**调用位置**：`" + String(obj.called_from).replace(/\n/g, " ") + "`\n");
    out.push("共 **" + names.length + "** 个场景，当前返回：**" + cur + "**" + (obj.doc ? "　·　文档：`" + obj.doc + "`" : "") + "\n");

    if (obj.request !== undefined) {
      out.push("## 请求示例\n");
      out.push(jsonBlock(obj.request));
    }
    if (hasFields(obj.request_fields)) {
      out.push("## 请求参数说明\n");
      out.push(fieldTable(obj.request_fields, { withIn: true, withRequired: true }));
    } else if (obj.request === undefined) {
      out.push("## 请求参数\n\n无请求体。\n");
    }

    out.push("## 响应场景\n");
    out.push("| 场景 | code | msg | 触发条件 |\n|---|---|---|---|");
    names.forEach(function (n) {
      var s = obj.scenarios[n];
      out.push(
        "| " + cell(n) + (n === cur ? " ✅" : "") + " | `" + cell(s.code === undefined ? "" : s.code) + "` | " + cell(s.msg || "") + " | " +
          (isObj(s.when) ? cell(Object.keys(s.when).map(function (k) { return k + " = " + JSON.stringify(s.when[k]); }).join("；")) : "—") + " |"
      );
    });
    out.push("");

    if (hasFields(obj.response_fields)) {
      out.push("## 响应字段说明（成功时的 `data`）\n");
      out.push(fieldTable(obj.response_fields, { withOptional: true }));
    }
    if (isObj(obj.response_notes) && Object.keys(obj.response_notes).length) {
      out.push("## 字段补充说明\n");
      Object.keys(obj.response_notes).forEach(function (k) {
        out.push("- `" + k + "`：" + String(obj.response_notes[k]).replace(/\n/g, " "));
      });
      out.push("");
    }

    names.forEach(function (n) {
      var s = obj.scenarios[n];
      out.push("### " + (n === cur ? "✅ " : "") + n + "\n");
      var meta = "`code` **" + (s.code === undefined ? "" : s.code) + "**　`msg` " + (s.msg || "—");
      if (n === cur) meta += "　（当前 `use`）";
      out.push(meta + "\n");
      if (isObj(s.when)) {
        out.push("命中条件 `when`：" + Object.keys(s.when).map(function (k) { return "`" + k + " = " + JSON.stringify(s.when[k]) + "`"; }).join("，") + "\n");
      }
      out.push(jsonBlock(s.data === undefined ? {} : s.data));
      if (hasFields(s.data_fields)) {
        out.push("该场景 `data` 字段说明：\n");
        out.push(fieldTable(s.data_fields, {}));
      }
      var times = collectTimes(s.data, now);
      if (times.length) {
        out.push("相对时间换算（按当前时刻）：\n");
        out.push("| 字段 | 写法 | 实际时间 |\n|---|---|---|");
        times.slice(0, TIME_ROWS_MAX).forEach(function (t) {
          out.push("| `" + cell(t.path) + "` | `" + t.rel + "` | " + t.abs + " |");
        });
        if (times.length > TIME_ROWS_MAX) out.push("| … | 共 " + times.length + " 处 | |");
        out.push("");
      }
    });

    return out.join("\n");
  }

  // _index.json：{ list: [{ method, path, file, summary?, tag?, scenarios? }] }
  function isMockIndex(obj) {
    if (!isObj(obj) || !Array.isArray(obj.list) || !obj.list.length) return false;
    return obj.list.every(function (it) {
      return isObj(it) && METHODS.test(String(it.method || "")) && typeof it.path === "string" && typeof it.file === "string" && it.file;
    });
  }

  // 按 tag 分组，保持索引里的出现顺序
  function groupIndex(obj) {
    var groups = [];
    var byTag = {};
    obj.list.forEach(function (it) {
      var tag = it.tag ? String(it.tag) : "未分组";
      if (!byTag[tag]) {
        byTag[tag] = { tag: tag, items: [] };
        groups.push(byTag[tag]);
      }
      byTag[tag].items.push(it);
    });
    return groups;
  }

  return {
    isMockApi: isMockApi,
    isMockIndex: isMockIndex,
    groupIndex: groupIndex,
    toMarkdown: toMarkdown,
    collectTimes: collectTimes,
  };
});
