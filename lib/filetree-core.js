/* filetree-core.js — 文件管理器的纯逻辑层（不依赖 DOM / File System Access API）。
 * 设计成可在浏览器与 Node 测试环境下共用同一份逻辑（UMD）：
 *   浏览器：<script src="lib/filetree-core.js"> 后可用 window.MDVFileTreeCore
 *   Node：  require('./lib/filetree-core.js')
 * scanDirectory 只依赖“鸭子类型”的目录句柄接口（kind/name/entries()），
 * 因此测试里可以用普通对象模拟 FileSystemDirectoryHandle，无需真实浏览器。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MDVFileTreeCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 各类可展示文件的扩展名。markdown 走文本渲染；pdf/html 走 iframe 展示。
  var MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".mdx", ".txt"];
  var PDF_EXTENSIONS = [".pdf"];
  var HTML_EXTENSIONS = [".html", ".htm"];
  var IMAGE_EXTENSIONS = [
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico",
  ];
  var OPENABLE_EXTENSIONS = MARKDOWN_EXTENSIONS.concat(
    PDF_EXTENSIONS,
    HTML_EXTENSIONS,
    IMAGE_EXTENSIONS
  );

  var WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.[^.]*)?$/i;

  var DEFAULT_LIMITS = {
    maxDepth: 12,
    maxEntries: 4000,
  };

  function extOf(name) {
    var i = name.lastIndexOf(".");
    return i > 0 ? name.slice(i).toLowerCase() : "";
  }

  // 按扩展名归类：'markdown' | 'pdf' | 'html' | 'other'（other 不可在本工具内展示）。
  function classifyFile(name) {
    var e = extOf(name);
    if (MARKDOWN_EXTENSIONS.indexOf(e) >= 0) return "markdown";
    if (PDF_EXTENSIONS.indexOf(e) >= 0) return "pdf";
    if (HTML_EXTENSIONS.indexOf(e) >= 0) return "html";
    if (IMAGE_EXTENSIONS.indexOf(e) >= 0) return "image";
    return "other";
  }

  function isOpenable(name) {
    return classifyFile(name) !== "other";
  }

  function isHiddenName(name) {
    return name.charAt(0) === "." || name === "node_modules";
  }

  // 校验/规整用户输入的新建或重命名文件名。
  // 返回 { valid: boolean, reason?: string, name: string }（name 为 trim 后的规整值）。
  function validateEntryName(rawName) {
    var name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) return { valid: false, reason: "名称不能为空", name: name };
    if (name === "." || name === "..")
      return { valid: false, reason: "名称不能是 “.” 或 “..”", name: name };
    if (name.length > 255)
      return { valid: false, reason: "名称过长（超过 255 字符）", name: name };
    if (/[\x00-\x1f/\\]/.test(name))
      return { valid: false, reason: "名称不能包含斜杠或控制字符", name: name };
    if (WINDOWS_RESERVED.test(name))
      return { valid: false, reason: "该名称是系统保留名，换一个试试", name: name };
    return { valid: true, name: name };
  }

  // 目录项排序：文件夹在前，其后按自然序（数字感知）排列。
  function compareEntries(a, b) {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  }

  // 遍历目录句柄，构建一棵纯数据树。out-of-band 的截断信息通过返回值的
  // truncated / visitedCount 传出，避免遍历中途抛异常打断整棵树的渲染。
  function scanDirectory(dirHandle, options) {
    var opts = options || {};
    var showHidden = !!opts.showHidden;
    var maxDepth = typeof opts.maxDepth === "number" ? opts.maxDepth : DEFAULT_LIMITS.maxDepth;
    var maxEntries =
      typeof opts.maxEntries === "number" ? opts.maxEntries : DEFAULT_LIMITS.maxEntries;

    var visited = 0;
    var truncated = false;

    function walk(handle, depth) {
      var node = { name: handle.name, kind: handle.kind, handle: handle };
      if (handle.kind === "file") {
        node.openable = isOpenable(handle.name);
        return Promise.resolve(node);
      }
      node.children = [];
      if (depth >= maxDepth) {
        node.depthLimited = true;
        return Promise.resolve(node);
      }
      node.loaded = true;
      return (async function () {
        var kids = [];
        if (visited >= maxEntries) {
          truncated = true;
          return node;
        }
        try {
          for await (var entry of handle.entries()) {
            var childHandle = entry[1];
            if (!showHidden && isHiddenName(childHandle.name)) continue;
            kids.push(childHandle);
            visited++;
            if (visited >= maxEntries) {
              truncated = true;
              break;
            }
          }
        } catch (e) {
          // 单个目录无法枚举（权限 / 特殊目录 / 符号链接等）：只标记该节点出错，
          // 不让异常冒泡打断整棵树的扫描——这是「只读到第一层」类 bug 的根因。
          node.error = e && e.message ? e.message : String(e);
          return node;
        }
        kids.sort(compareEntries);
        for (var i = 0; i < kids.length; i++) {
          node.children.push(await walk(kids[i], depth + 1));
        }
        return node;
      })();
    }

    return walk(dirHandle, 0).then(function (root) {
      return { root: root, truncated: truncated, visitedCount: visited };
    });
  }

  // 懒加载：只读取一层目录，不递归。返回 { children, truncated, error }。
  // 目录子节点标记 loaded:false（children:null），待用户展开时再按需 scanLevel。
  // 单目录读取失败时返回 error 字段而非抛异常，调用方据此给出局部提示。
  function scanLevel(dirHandle, options) {
    var opts = options || {};
    var showHidden = !!opts.showHidden;
    var maxEntries =
      typeof opts.maxEntries === "number" ? opts.maxEntries : DEFAULT_LIMITS.maxEntries;
    return (async function () {
      var kids = [];
      var truncated = false;
      try {
        for await (var entry of dirHandle.entries()) {
          var h = entry[1];
          if (!showHidden && isHiddenName(h.name)) continue;
          var node = { name: h.name, kind: h.kind, handle: h };
          if (h.kind === "file") {
            node.openable = isOpenable(h.name);
          } else {
            node.children = null;
            node.loaded = false;
          }
          kids.push(node);
          if (kids.length >= maxEntries) {
            truncated = true;
            break;
          }
        }
      } catch (e) {
        return { children: [], truncated: false, error: e && e.message ? e.message : String(e) };
      }
      kids.sort(compareEntries);
      return { children: kids, truncated: truncated, error: null };
    })();
  }

  // 序列化为可 JSON 化的结构快照（剥离 FileSystemHandle，因其无法进 localStorage）。
  // 用于本地存储的「文件索引」：下次可秒显示目录轮廓、离线筛选文件路径。
  function serializeTree(node) {
    var o = { name: node.name, kind: node.kind };
    if (node.kind === "file") {
      o.openable = !!node.openable;
    } else {
      o.children = (node.children || []).map(serializeTree);
      if (node.depthLimited) o.depthLimited = true;
      if (node.error) o.error = node.error;
    }
    return o;
  }

  // 把树压平成文件/目录清单：[{ path, name, kind, openable }]（path 为相对工作区根的斜杠路径）。
  function flattenFiles(root) {
    var out = [];
    (function walk(n, prefix) {
      (n.children || []).forEach(function (c) {
        var p = prefix ? prefix + "/" + c.name : c.name;
        if (c.kind === "directory") {
          out.push({ path: p, name: c.name, kind: "directory" });
          walk(c, p);
        } else {
          out.push({ path: p, name: c.name, kind: "file", openable: !!c.openable });
        }
      });
    })(root, "");
    return out;
  }

  // 按名称子串（大小写不敏感）过滤树；query 为空时原样返回（同一引用，避免无谓拷贝）。
  // 目录仅当自身命中或存在命中的后代时保留，且只保留命中的后代（不整枝带出）。
  function filterTree(node, query) {
    var q = (query || "").trim().toLowerCase();
    if (!q) return node;

    function walk(n) {
      var selfMatch = n.name.toLowerCase().indexOf(q) >= 0;
      if (n.kind === "file") {
        return selfMatch ? n : null;
      }
      var kept = [];
      (n.children || []).forEach(function (child) {
        var r = walk(child);
        if (r) kept.push(r);
      });
      if (!kept.length && !selfMatch) return null;
      var copy = {};
      Object.keys(n).forEach(function (k) {
        copy[k] = n[k];
      });
      copy.children = selfMatch ? n.children : kept;
      return copy;
    }

    return walk(node) || { name: node.name, kind: node.kind, handle: node.handle, children: [] };
  }

  // 统计子树内文件/文件夹数量（不含根节点自身）。
  function countEntries(node) {
    var files = 0,
      dirs = 0;
    (function walk(n) {
      (n.children || []).forEach(function (child) {
        if (child.kind === "directory") {
          dirs++;
          walk(child);
        } else {
          files++;
        }
      });
    })(node);
    return { files: files, dirs: dirs };
  }

  return {
    OPENABLE_EXTENSIONS: OPENABLE_EXTENSIONS,
    classifyFile: classifyFile,
    isOpenable: isOpenable,
    isHiddenName: isHiddenName,
    validateEntryName: validateEntryName,
    compareEntries: compareEntries,
    scanDirectory: scanDirectory,
    scanLevel: scanLevel,
    serializeTree: serializeTree,
    flattenFiles: flattenFiles,
    filterTree: filterTree,
    countEntries: countEntries,
  };
});
