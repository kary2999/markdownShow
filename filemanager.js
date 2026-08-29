/* filemanager.js — 本地文件夹管理面板（浏览器侧胶水层）。
 * 依赖：lib/filetree-core.js（纯逻辑）+ File System Access API（Chromium 内核）
 *      + window.MarkdownShow.loadHandle（app.js 暴露，用于把选中文件送进现有渲染/Tab 流程）。
 * 安全边界：
 *   - 所有读写都通过浏览器原生权限弹窗授权，本文件不绕过、不缓存权限之外的访问。
 *   - 新建/重命名/删除前做名称校验 + 存在性检查 + 用户二次确认，删除前明确提示不可撤销。
 *   - 扫描目录有深度/条目数上限，避免超大目录卡死页面；默认跳过隐藏文件与 node_modules。
 *   - 不做任何网络请求：整套功能只在本机浏览器与所选目录之间发生。 */
(function () {
  "use strict";

  var core = window.MDVFileTreeCore;
  if (!core) return; // lib/filetree-core.js 未加载，静默不启用（不应发生，防御性检查）

  var MAX_DEPTH = 12;
  var MAX_ENTRIES = 4000;
  var DB_NAME = "mdv-filemanager";
  var DB_STORE = "workspace";
  var DB_KEY = "workspace";

  // ---- IndexedDB：记住上次打开的工作区目录句柄（可选增强，失败时静默降级） --------
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("indexedDB unavailable"));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function idbSetWorkspace(handle) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(handle, DB_KEY);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function idbGetWorkspace() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var req = tx.objectStore(DB_STORE).get(DB_KEY);
        req.onsuccess = function () {
          resolve(req.result || null);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  }

  // ---- 权限辅助 ---------------------------------------------------------------
  function queryReadPermission(handle) {
    if (typeof handle.queryPermission !== "function") return Promise.resolve("granted");
    return handle.queryPermission({ mode: "read" });
  }

  function ensureReadWrite(handle) {
    if (typeof handle.queryPermission !== "function") return Promise.resolve(true);
    return handle
      .queryPermission({ mode: "readwrite" })
      .then(function (perm) {
        if (perm === "granted") return true;
        return handle.requestPermission({ mode: "readwrite" }).then(function (p) {
          return p === "granted";
        });
      })
      .catch(function () {
        return false;
      });
  }

  function existsEntry(dirHandle, name) {
    return dirHandle
      .getFileHandle(name, { create: false })
      .then(function () {
        return true;
      })
      .catch(function (e) {
        // 同名目录会让 getFileHandle 抛出 TypeMismatchError；它仍表示条目已存在。
        if (e && e.name === "TypeMismatchError") return true;
        if (!e || e.name !== "NotFoundError") throw e;
        return dirHandle
          .getDirectoryHandle(name, { create: false })
          .then(function () {
            return true;
          })
          .catch(function (directoryError) {
            if (!directoryError || directoryError.name !== "NotFoundError") throw directoryError;
            return false;
          });
      });
  }

  function describeError(e) {
    return e && e.message ? e.message : String(e);
  }

  function findNodeByPath(root, path) {
    var node = root;
    for (var i = 0; i < path.length; i++) {
      if (!node || !node.children) return null;
      var name = path[i];
      var next = null;
      for (var j = 0; j < node.children.length; j++) {
        if (node.children[j].name === name) {
          next = node.children[j];
          break;
        }
      }
      node = next;
    }
    return node;
  }

  // ================================================================================
  // 面板 DOM
  // ================================================================================
  var panel = null;
  var els = {};
  var expanded = {}; // path string -> true，展开状态（rescan/filter 后尽量保留）
  var selectedNode = null;
  var selectedPath = null; // string[]，从工作区根开始的名称路径
  var showHidden = false;
  var filterQuery = "";
  var searchDebounce = null;

  var currentDirHandle = null;
  var currentWorkspaceName = null;
  var currentTree = null; // { root, truncated, visitedCount }
  var pendingHandle = null; // 上次记住但尚未重新授权的工作区句柄

  function ensurePanel() {
    if (panel) return panel;

    var backdrop = document.createElement("div");
    backdrop.id = "mdv-fm-backdrop";
    document.body.appendChild(backdrop);

    panel = document.createElement("div");
    panel.id = "mdv-filepanel";
    panel.hidden = true;
    panel.innerHTML =
      '<div class="mdv-fm-header">' +
      '<span class="mdv-fm-title">工作区</span>' +
      '<button type="button" class="mdv-fm-close" title="关闭">×</button>' +
      "</div>" +
      '<div class="mdv-fm-body"></div>';
    document.body.appendChild(panel);

    els.title = panel.querySelector(".mdv-fm-title");
    els.body = panel.querySelector(".mdv-fm-body");

    panel.querySelector(".mdv-fm-close").addEventListener("click", closePanel);
    backdrop.addEventListener("click", closePanel);
    document.addEventListener("keydown", function (e) {
      if (!panel.hidden && e.key === "Escape") closePanel();
    });

    els.backdrop = backdrop;
    return panel;
  }

  function openPanel() {
    ensurePanel();
    panel.hidden = false;
    requestAnimationFrame(function () {
      panel.classList.add("mdv-fm-open");
      els.backdrop.classList.add("mdv-fm-open");
    });
  }

  function closePanel() {
    if (!panel) return;
    panel.classList.remove("mdv-fm-open");
    els.backdrop.classList.remove("mdv-fm-open");
    setTimeout(function () {
      panel.hidden = true;
    }, 200);
  }

  function togglePanel() {
    if (!panel || panel.hidden) openPanel();
    else closePanel();
  }

  function clearSelection() {
    selectedNode = null;
    selectedPath = null;
  }

  function alertPanel(msg) {
    window.alert(msg);
  }

  // ---- 状态视图：unsupported / empty / tree ------------------------------------
  function renderState(mode) {
    ensurePanel();
    els.title.textContent = currentWorkspaceName ? "🗂 " + currentWorkspaceName : "工作区";
    if (mode === "unsupported") {
      els.body.innerHTML =
        '<div class="mdv-fm-empty">' +
        "<p>当前浏览器不支持文件夹管理功能（需 Chrome / Edge 等 Chromium 内核浏览器）。</p>" +
        "</div>";
      return;
    }
    if (mode === "empty") {
      var reconnectHtml = pendingHandle
        ? '<button type="button" class="mdv-fm-reconnect-btn">🔗 重新连接：' +
          escapeHtml(pendingHandle.name) +
          "</button>"
        : "";
      els.body.innerHTML =
        '<div class="mdv-fm-empty">' +
        "<p>选择一个本地文件夹，浏览与管理其中的文件。</p>" +
        '<button type="button" class="mdv-fm-open-btn">📂 打开文件夹</button>' +
        reconnectHtml +
        '<p class="mdv-fm-hint">仅本机浏览器内访问，不会上传到任何服务器。</p>' +
        "</div>";
      els.body.querySelector(".mdv-fm-open-btn").addEventListener("click", openWorkspace);
      var reconnectBtn = els.body.querySelector(".mdv-fm-reconnect-btn");
      if (reconnectBtn) {
        reconnectBtn.addEventListener("click", function () {
          reconnectWorkspace(pendingHandle);
        });
      }
      return;
    }
    // mode === 'tree'
    els.body.innerHTML =
      '<div class="mdv-fm-toolbar">' +
      '<button type="button" class="mdv-fm-rescan" title="重新扫描">🔄</button>' +
      '<label class="mdv-fm-hidden-toggle"><input type="checkbox" class="mdv-fm-hidden-cb" /> 显示隐藏文件</label>' +
      '<button type="button" class="mdv-fm-switch" title="更换文件夹">📂 更换</button>' +
      "</div>" +
      '<input type="text" class="mdv-fm-search" placeholder="筛选文件名…" />' +
      '<div class="mdv-fm-tree" role="tree"></div>' +
      '<div class="mdv-fm-status"></div>' +
      '<div class="mdv-fm-selection"></div>' +
      '<div class="mdv-fm-actions">' +
      '<button type="button" data-action="new-file">📄 新建文件</button>' +
      '<button type="button" data-action="new-folder">📁 新建文件夹</button>' +
      '<button type="button" data-action="rename">✏️ 重命名</button>' +
      '<button type="button" data-action="delete">🗑 删除</button>' +
      "</div>";

    els.tree = els.body.querySelector(".mdv-fm-tree");
    els.status = els.body.querySelector(".mdv-fm-status");
    els.selection = els.body.querySelector(".mdv-fm-selection");
    els.search = els.body.querySelector(".mdv-fm-search");
    els.search.value = filterQuery;

    els.body.querySelector(".mdv-fm-rescan").addEventListener("click", rescan);
    els.body.querySelector(".mdv-fm-switch").addEventListener("click", openWorkspace);
    var hiddenCb = els.body.querySelector(".mdv-fm-hidden-cb");
    hiddenCb.checked = showHidden;
    hiddenCb.addEventListener("change", function () {
      showHidden = hiddenCb.checked;
      rescan();
    });
    els.search.addEventListener("input", function () {
      var v = els.search.value;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        filterQuery = v;
        renderTree();
      }, 150);
    });
    els.body.querySelectorAll("[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var action = btn.getAttribute("data-action");
        if (action === "new-file") createEntry("file");
        else if (action === "new-folder") createEntry("directory");
        else if (action === "rename") renameSelected();
        else if (action === "delete") deleteSelected();
      });
    });

    renderTree();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- 树渲染 -------------------------------------------------------------------
  function updateSelectionLabel() {
    els.selection.textContent = selectedNode ? "已选中：" + selectedNode.name : "未选中任何项目";
  }

  function updateStatus(displayRoot) {
    var counts = core.countEntries(displayRoot);
    var text = counts.files + " 个文件";
    if (counts.dirs) text += " · " + counts.dirs + " 个文件夹";
    if (currentTree && currentTree.truncated) {
      text += "（已达显示上限 " + MAX_ENTRIES + " 项，未完整展示）";
    }
    els.status.textContent = text;
  }

  function makeRow(node, path, depth) {
    var key = path.join("/");
    var row = document.createElement("div");
    row.className = "mdv-fm-row";
    row.style.paddingLeft = depth * 16 + 8 + "px";
    row.setAttribute("role", "treeitem");
    row.tabIndex = 0;

    var isDir = node.kind === "directory";
    var icon = document.createElement("span");
    icon.className = "mdv-fm-icon";
    icon.textContent = isDir ? (expanded[key] ? "📂" : "📁") : node.openable ? "📄" : "📦";

    var label = document.createElement("span");
    label.className = "mdv-fm-label";
    label.textContent = node.name;

    row.appendChild(icon);
    row.appendChild(label);

    if (isDir && node.depthLimited) {
      var warn = document.createElement("span");
      warn.className = "mdv-fm-warn";
      warn.textContent = "（层级过深，未展开）";
      row.appendChild(warn);
    }

    if (selectedPath && key === selectedPath.join("/")) {
      row.classList.add("mdv-fm-selected");
    }

    function activate() {
      selectedNode = node;
      selectedPath = path;
      renderTree();
      if (isDir) {
        expanded[key] = !expanded[key];
        renderTree();
      } else if (node.openable) {
        openFile(node);
      }
    }
    row.addEventListener("click", function (e) {
      e.stopPropagation();
      activate();
    });
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });

    return row;
  }

  function renderChildren(nodes, path, depth, frag) {
    nodes.forEach(function (n) {
      var childPath = path.concat([n.name]);
      frag.appendChild(makeRow(n, childPath, depth));
      var key = childPath.join("/");
      if (n.kind === "directory" && expanded[key] && n.children) {
        renderChildren(n.children, childPath, depth + 1, frag);
      }
    });
  }

  function renderTree() {
    if (!els.tree || !currentTree) return;
    var displayRoot = filterQuery ? core.filterTree(currentTree.root, filterQuery) : currentTree.root;
    var frag = document.createDocumentFragment();
    renderChildren(displayRoot.children || [], [], 0, frag);
    els.tree.innerHTML = "";
    if (!(displayRoot.children || []).length) {
      var empty = document.createElement("div");
      empty.className = "mdv-fm-tree-empty";
      empty.textContent = filterQuery ? "没有匹配的文件" : "此文件夹为空";
      els.tree.appendChild(empty);
    } else {
      els.tree.appendChild(frag);
    }
    updateStatus(displayRoot);
    updateSelectionLabel();
  }

  // ---- 打开文件 -------------------------------------------------------------
  function openFile(node) {
    if (!node.openable) return;
    if (window.MarkdownShow && typeof window.MarkdownShow.loadHandle === "function") {
      window.MarkdownShow.loadHandle(node.handle);
    }
  }

  // ---- 目标目录（新建时相对当前选中项） --------------------------------------
  function targetDirForCreate() {
    if (!selectedNode) return { dirHandle: currentDirHandle, dirPath: [] };
    if (selectedNode.kind === "directory") {
      return { dirHandle: selectedNode.handle, dirPath: selectedPath };
    }
    var parentPath = selectedPath.slice(0, -1);
    var parentNode = parentPath.length ? findNodeByPath(currentTree.root, parentPath) : currentTree.root;
    return { dirHandle: parentNode ? parentNode.handle : currentDirHandle, dirPath: parentPath };
  }

  // ---- 新建 / 重命名 / 删除 ----------------------------------------------------
  function createEntry(kind) {
    if (!currentDirHandle) return;
    var label = kind === "directory" ? "文件夹" : "文件";
    var raw = window.prompt("新建" + label + "名称：", kind === "directory" ? "" : "untitled.md");
    if (raw === null) return;
    var v = core.validateEntryName(raw);
    if (!v.valid) {
      alertPanel(v.reason);
      return;
    }
    var target = targetDirForCreate();
    ensureReadWrite(target.dirHandle)
      .then(function (ok) {
        if (!ok) {
          alertPanel("未获得写入权限，无法新建。");
          return null;
        }
        return existsEntry(target.dirHandle, v.name).then(function (exists) {
          if (exists) {
            alertPanel("同名" + label + "已存在。");
            return null;
          }
          if (kind === "directory") return target.dirHandle.getDirectoryHandle(v.name, { create: true });
          return target.dirHandle.getFileHandle(v.name, { create: true });
        });
      })
      .then(function (created) {
        if (created) return rescan();
      })
      .catch(function (e) {
        alertPanel("新建失败：" + describeError(e));
      });
  }

  function renameSelected() {
    if (!selectedNode || !selectedPath) {
      alertPanel("请先在文件树中选中要重命名的项目。");
      return;
    }
    var node = selectedNode;
    var path = selectedPath;
    var isDir = node.kind === "directory";
    var supportsMove = typeof node.handle.move === "function";
    if (isDir && !supportsMove) {
      alertPanel("当前浏览器不支持文件夹重命名（需较新版 Chrome/Edge；可先删除后重新新建替代）。");
      return;
    }
    var raw = window.prompt("重命名为：", node.name);
    if (raw === null) return;
    var v = core.validateEntryName(raw);
    if (!v.valid) {
      alertPanel(v.reason);
      return;
    }
    if (v.name === node.name) return;

    var parentPath = path.slice(0, -1);
    var parentNode = parentPath.length ? findNodeByPath(currentTree.root, parentPath) : currentTree.root;
    var parentHandle = parentNode ? parentNode.handle : currentDirHandle;

    ensureReadWrite(parentHandle)
      .then(function (ok) {
        if (!ok) {
          alertPanel("未获得写入权限，无法重命名。");
          return null;
        }
        return existsEntry(parentHandle, v.name).then(function (exists) {
          if (exists) {
            alertPanel("同名项目已存在，换个名字试试。");
            return null;
          }
          if (supportsMove) return node.handle.move(v.name);
          return node.handle
            .getFile()
            .then(function (f) {
              return f.arrayBuffer();
            })
            .then(function (bytes) {
              return parentHandle.getFileHandle(v.name, { create: true }).then(function (newHandle) {
                return newHandle.createWritable().then(function (writable) {
                  return writable.write(bytes).then(function () {
                    return writable.close();
                  });
                });
              });
            })
            .then(function () {
              return parentHandle.removeEntry(node.name);
            });
        });
      })
      .then(function (result) {
        if (result !== null) {
          clearSelection();
          return rescan();
        }
      })
      .catch(function (e) {
        alertPanel("重命名失败：" + describeError(e));
      });
  }

  function deleteSelected() {
    if (!selectedNode || !selectedPath) {
      alertPanel("请先在文件树中选中要删除的项目。");
      return;
    }
    var node = selectedNode;
    var path = selectedPath;
    var isDir = node.kind === "directory";
    var warn = isDir
      ? "确定删除文件夹 “" + node.name + "” 及其中的全部内容吗？此操作不可撤销。"
      : "确定删除文件 “" + node.name + "” 吗？此操作不可撤销。";
    if (!window.confirm(warn)) return;

    var parentPath = path.slice(0, -1);
    var parentNode = parentPath.length ? findNodeByPath(currentTree.root, parentPath) : currentTree.root;
    var parentHandle = parentNode ? parentNode.handle : currentDirHandle;

    ensureReadWrite(parentHandle)
      .then(function (ok) {
        if (!ok) {
          alertPanel("未获得写入权限，无法删除。");
          return null;
        }
        return parentHandle.removeEntry(node.name, { recursive: isDir }).then(function () {
          return true;
        });
      })
      .then(function (done) {
        if (done) {
          clearSelection();
          return rescan();
        }
      })
      .catch(function (e) {
        alertPanel("删除失败：" + describeError(e));
      });
  }

  // ---- 扫描 / 打开工作区 --------------------------------------------------------
  function scanAndRender() {
    if (!currentDirHandle) return Promise.resolve();
    return core
      .scanDirectory(currentDirHandle, { showHidden: showHidden, maxDepth: MAX_DEPTH, maxEntries: MAX_ENTRIES })
      .then(function (result) {
        currentTree = result;
        renderState("tree");
      })
      .catch(function (e) {
        currentTree = null;
        renderState("empty");
        alertPanel("读取文件夹失败：" + describeError(e));
      });
  }

  function rescan() {
    return scanAndRender();
  }

  function openWorkspace() {
    if (!window.showDirectoryPicker) {
      alertPanel("当前浏览器不支持文件夹管理功能（需 Chrome / Edge 等 Chromium 内核浏览器）。");
      return;
    }
    return window
      .showDirectoryPicker()
      .then(function (handle) {
        currentDirHandle = handle;
        currentWorkspaceName = handle.name;
        pendingHandle = null;
        clearSelection();
        expanded = {};
        idbSetWorkspace(handle).catch(function () {
          /* 持久化失败静默降级：本次会话仍可正常使用，仅下次不会自动恢复 */
        });
        return scanAndRender();
      })
      .catch(function (e) {
        if (e && e.name === "AbortError") return;
        alertPanel("打开文件夹失败：" + describeError(e));
      });
  }

  function reconnectWorkspace(handle) {
    queryReadPermission(handle)
      .then(function (perm) {
        if (perm === "granted") return perm;
        return handle.requestPermission({ mode: "read" });
      })
      .then(function (perm) {
        if (perm !== "granted") {
          alertPanel("未获得访问权限。");
          return;
        }
        currentDirHandle = handle;
        currentWorkspaceName = handle.name;
        pendingHandle = null;
        clearSelection();
        expanded = {};
        return scanAndRender();
      })
      .catch(function (e) {
        alertPanel("重新连接失败：" + describeError(e));
      });
  }

  function restoreOnBoot() {
    idbGetWorkspace()
      .then(function (handle) {
        if (!handle) return;
        pendingHandle = handle;
        return queryReadPermission(handle).then(function (perm) {
          if (perm === "granted") {
            currentDirHandle = handle;
            currentWorkspaceName = handle.name;
            pendingHandle = null;
            return scanAndRender();
          }
        });
      })
      .catch(function () {
        /* IndexedDB 不可用（如隐私模式）：静默降级为无记忆状态 */
      });
  }

  // ---- 启动 ---------------------------------------------------------------------
  function boot() {
    var toggleBtn = document.getElementById("mdv-filepanel-btn");
    if (!toggleBtn) return;
    toggleBtn.addEventListener("click", function () {
      var wasHidden = !panel || panel.hidden;
      togglePanel();
      if (wasHidden) {
        if (!window.showDirectoryPicker) renderState("unsupported");
        else if (currentTree) renderState("tree");
        else renderState("empty");
      }
    });

    if (window.showDirectoryPicker && window.indexedDB) {
      restoreOnBoot();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
