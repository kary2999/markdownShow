/* xmind-core.js — .xmind 内容解析 + 转 mermaid mindmap（纯逻辑，不依赖 DOM / zip 解压）。
 * .xmind 是 zip 包，内含 content.json（XMind Zen / 2020+）。本模块只负责：
 *   parseXmindContent(jsonText) → [{ title, root:{title, children:[...]} }]（多画布）
 *   buildMindmapMarkdown(sheets, fileTitle) → 含 ```mermaid mindmap``` 的 markdown 文本
 * zip 解压交给浏览器侧（app.js 用 DecompressionStream），本层可在 Node 下单测。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MDVXmind = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 递归把 XMind topic 规整为 { title, children:[] }。
  // XMind 的子主题在 children.attached（也可能有 detached，这里只取 attached 主干）。
  function normalizeTopic(topic) {
    var node = { title: topic && topic.title != null ? String(topic.title) : "", children: [] };
    var attached = topic && topic.children && topic.children.attached;
    if (Array.isArray(attached)) {
      node.children = attached.map(normalizeTopic);
    }
    return node;
  }

  // 解析 content.json 文本 → 画布数组。content.json 通常是数组（每个元素一个 sheet），
  // 也兼容单对象。每个 sheet 取 rootTopic（旧字段名可能是 topic）。
  function parseXmindContent(jsonText) {
    var data = JSON.parse(jsonText);
    var sheets = Array.isArray(data) ? data : [data];
    return sheets
      .map(function (sheet) {
        var rootTopic = sheet && (sheet.rootTopic || sheet.topic);
        if (!rootTopic) return null;
        return { title: sheet.title ? String(sheet.title) : "", root: normalizeTopic(rootTopic) };
      })
      .filter(Boolean);
  }

  // mermaid mindmap 节点文本清理：去换行；括号/方括号/花括号会破坏 mindmap 语法，去掉；
  // 空标题给占位，避免生成非法空节点。
  function sanitizeNodeText(text) {
    var t = String(text == null ? "" : text)
      .replace(/[\r\n]+/g, " ")
      .replace(/[()\[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return t || "（空）";
  }

  function appendTopic(topic, depth, lines, isRoot) {
    var indent = new Array(depth + 1).join("  "); // depth 个两空格
    var text = sanitizeNodeText(topic.title);
    lines.push(isRoot ? indent + "root((" + text + "))" : indent + text);
    (topic.children || []).forEach(function (child) {
      appendTopic(child, depth + 1, lines, false);
    });
  }

  // 生成 markdown：文件标题 + 每个画布一个 mermaid mindmap 代码块。
  function buildMindmapMarkdown(sheets, fileTitle) {
    var lines = [];
    if (fileTitle) {
      lines.push("# " + String(fileTitle));
      lines.push("");
    }
    var many = sheets.length > 1;
    sheets.forEach(function (sheet, i) {
      var heading = sheet.title || (many ? "画布 " + (i + 1) : "");
      if (heading) {
        lines.push("## " + heading);
        lines.push("");
      }
      lines.push("```mermaid");
      lines.push("mindmap");
      appendTopic(sheet.root, 1, lines, true);
      lines.push("```");
      lines.push("");
    });
    return lines.join("\n");
  }

  return {
    parseXmindContent: parseXmindContent,
    buildMindmapMarkdown: buildMindmapMarkdown,
    sanitizeNodeText: sanitizeNodeText,
    normalizeTopic: normalizeTopic,
  };
});
