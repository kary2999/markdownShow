/* Markdown Show — standalone web app.
 * Drag a .md file (or pick one) and render it in-browser. PWA-installable. */
(function () {
  "use strict";

  marked.setOptions({ gfm: true, breaks: false });

  // ---- theme & style ---------------------------------------------------------
  var THEME_KEY = "mdviewer-theme";
  var STYLE_KEY = "mdviewer-style";
  var STYLES = ["editorial", "minimal", "vivid"];
  var STYLE_LABEL = { editorial: "刊物", minimal: "极简", vivid: "活泼" };
  var mermaidReady = false;

  function initMermaid(dark) {
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: dark ? "dark" : "default",
        securityLevel: "strict",
      });
      mermaidReady = true;
    } catch (e) {
      /* mermaid unavailable */
    }
  }

  function getTheme() {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-mdviewer-theme", theme);
    document.getElementById("mdv-hljs-light").disabled = theme === "dark";
    document.getElementById("mdv-hljs-dark").disabled = theme !== "dark";
    if (mermaidReady) initMermaid(theme === "dark");
  }

  function getStyle() {
    var saved = localStorage.getItem(STYLE_KEY);
    return STYLES.indexOf(saved) >= 0 ? saved : "editorial";
  }

  function applyStyle(style) {
    document.documentElement.setAttribute("data-mdviewer-style", style);
    var btn = document.getElementById("mdv-style-btn");
    if (!btn) return;
    var label = STYLE_LABEL[style] || style;
    var txt = btn.querySelector(".mdv-btn-txt");
    if (txt) txt.textContent = label; // 保留图标 span 结构
    else btn.textContent = "🎨 " + label;
  }

  // ---- rendering helpers ----------------------------------------------------
  function slugify(text, used) {
    var base = text
      .toLowerCase()
      .trim()
      .replace(/[^\w一-龥\- ]/g, "")
      .replace(/\s+/g, "-");
    if (!base) base = "section";
    var slug = base,
      i = 1;
    while (used[slug]) slug = base + "-" + i++;
    used[slug] = true;
    return slug;
  }

  function highlightCodeBlocks(content) {
    content.querySelectorAll("pre code").forEach(function (code) {
      var langClass = null;
      code.classList.forEach(function (c) {
        if (c.indexOf("language-") === 0) langClass = c;
      });
      var lang = langClass ? langClass.slice("language-".length) : "";
      if (lang === "mermaid") return;
      // Unknown / non-standard info string (e.g. "startLine:endLine:filepath"):
      // drop the bogus class so highlight.js auto-detects instead of warning.
      if (lang && !hljs.getLanguage(lang) && langClass) {
        code.classList.remove(langClass);
      }
      try {
        hljs.highlightElement(code);
      } catch (e) {
        /* leave plain */
      }
    });
  }

  function buildToc(content) {
    var toc = document.getElementById("mdv-toc");
    var layout = document.getElementById("mdv-layout");
    var heads = content.querySelectorAll("h1, h2, h3, h4, h5, h6");
    if (heads.length < 2) {
      toc.style.display = "none";
      layout.classList.add("mdv-no-toc");
      return;
    }
    toc.style.display = "";
    layout.classList.remove("mdv-no-toc");
    var used = {};
    var list = document.createElement("ul");
    heads.forEach(function (h) {
      if (!h.id) h.id = slugify(h.textContent, used);
      var li = document.createElement("li");
      li.className = "mdv-toc-" + h.tagName.toLowerCase();
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent;
      a.addEventListener("click", function (e) {
        e.preventDefault();
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#" + h.id);
      });
      li.appendChild(a);
      list.appendChild(li);
    });
    toc.innerHTML = "<div id='mdv-toc-title'>目录</div>";
    toc.appendChild(list);
    setupScrollSpy(heads, toc);
    ensureTocToggle(toc);
  }

  // 窄屏抽屉开关：目录存在时显示浮动按钮，点条目后自动收起
  function ensureTocToggle(toc) {
    var btn = document.getElementById("mdv-toc-toggle");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "mdv-toc-toggle";
      btn.textContent = "☰ 目录";
      document.body.appendChild(btn);
      btn.addEventListener("click", function () {
        toc.classList.toggle("mdv-toc-open");
      });
      document.addEventListener("click", function (e) {
        if (
          toc.classList.contains("mdv-toc-open") &&
          !toc.contains(e.target) &&
          e.target !== btn
        ) {
          toc.classList.remove("mdv-toc-open");
        }
      });
    }
    toc.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        toc.classList.remove("mdv-toc-open");
      });
    });
  }

  function setupScrollSpy(heads, toc) {
    var links = {};
    toc.querySelectorAll("a").forEach(function (a) {
      links[a.getAttribute("href").slice(1)] = a;
    });
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            Object.keys(links).forEach(function (k) {
              links[k].classList.remove("mdv-active");
            });
            if (links[en.target.id]) links[en.target.id].classList.add("mdv-active");
          }
        });
      },
      { rootMargin: "0px 0px -80% 0px", threshold: 0 }
    );
    heads.forEach(function (h) {
      observer.observe(h);
    });
  }

  function renderMermaid(content) {
    var blocks = content.querySelectorAll("pre > code.language-mermaid");
    if (!blocks.length) return;
    if (!mermaidReady) initMermaid(getTheme() === "dark");
    if (!mermaidReady) return;
    blocks.forEach(function (code) {
      var pre = code.closest("pre") || code;
      var div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      pre.replaceWith(div);
    });
    try {
      mermaid.run({ nodes: content.querySelectorAll(".mermaid") });
    } catch (e) {
      /* ignore */
    }
  }

  function setupExternalLinks(content) {
    content.querySelectorAll("a[href]").forEach(function (a) {
      if (/^https?:/i.test(a.getAttribute("href"))) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    });
  }

  // ---- multi-document tabs ---------------------------------------------------
  var docs = []; // { name, raw }
  var activeDoc = -1;

  function renderTabs() {
    var bar = document.getElementById("mdv-tabs");
    bar.innerHTML = "";
    bar.hidden = docs.length === 0;
    docs.forEach(function (d, i) {
      var tab = document.createElement("button");
      tab.className = "mdv-tab" + (i === activeDoc ? " mdv-tab-active" : "");
      tab.title = d.name;
      var label = document.createElement("span");
      label.className = "mdv-tab-label";
      label.textContent = d.name;
      var close = document.createElement("span");
      close.className = "mdv-tab-close";
      close.textContent = "×";
      close.title = "关闭";
      close.addEventListener("click", function (e) {
        e.stopPropagation();
        closeDoc(i);
      });
      tab.appendChild(label);
      tab.appendChild(close);
      tab.addEventListener("click", function () {
        switchDoc(i);
      });
      bar.appendChild(tab);
    });
  }

  function switchDoc(i) {
    if (i < 0 || i >= docs.length) return;
    activeDoc = i;
    document.title = docs[i].name + " · Markdown Show";
    renderTabs();
    render(docs[i].raw);
  }

  function closeDoc(i) {
    docs.splice(i, 1);
    if (docs.length === 0) {
      activeDoc = -1;
      renderTabs();
      document.getElementById("mdv-layout").hidden = true;
      document.getElementById("mdv-landing").hidden = false;
      document.title = "Markdown Show · 拖拽即渲染";
      return;
    }
    switchDoc(Math.min(i, docs.length - 1));
  }

  function addDoc(name, raw, reload) {
    // Re-opening the same file name replaces its content.
    var existing = docs.findIndex(function (d) {
      return d.name === name;
    });
    if (existing >= 0) {
      docs[existing].raw = raw;
      if (reload) docs[existing].reload = reload;
      switchDoc(existing);
    } else {
      docs.push({ name: name, raw: raw, reload: reload || null });
      switchDoc(docs.length - 1);
    }
  }

  // 刷新当前文档（软刷新：保持滚动位置）。优先从来源重读，无来源则原文重渲染
  function refreshActive() {
    if (activeDoc < 0) return;
    var doc = docs[activeDoc];
    var idx = activeDoc;
    var scroll = { y: window.scrollY };
    if (doc.reload) {
      doc.reload()
        .then(function (text) {
          docs[idx].raw = text;
          if (idx === activeDoc) render(text, { preserveScroll: scroll });
        })
        .catch(function (e) {
          showError(
            "刷新失败：" +
              (e && e.message ? e.message : e) +
              "。文件可能已被移动或修改后无法重读，请重新拖入。"
          );
        });
    } else {
      render(doc.raw, { preserveScroll: scroll });
    }
  }

  // 自动同步：轮询当前文档的来源，内容变化即软刷新（不跳顶、不硬刷新）
  var WATCH_INTERVAL = 2000;
  var watchBusy = false;
  setInterval(function () {
    if (watchBusy || activeDoc < 0) return;
    var doc = docs[activeDoc];
    if (!doc || !doc.reload) return;
    var idx = activeDoc;
    watchBusy = true;
    doc.reload()
      .then(function (text) {
        if (idx === activeDoc && text !== docs[idx].raw) {
          docs[idx].raw = text;
          render(text, { preserveScroll: { y: window.scrollY } });
        }
      })
      .catch(function () {
        /* 来源暂不可读（文件被改动/移动），静默跳过，按钮刷新时才报错 */
      })
      .finally(function () {
        watchBusy = false;
      });
  }, WATCH_INTERVAL);

  // ---- main render ----------------------------------------------------------
  // opts.preserveScroll: 软刷新 —— 重渲染后回到原滚动位置，不跳顶
  function render(markdownText, opts) {
    var dirty = marked.parse(markdownText);
    var clean = DOMPurify.sanitize(dirty, {
      ADD_TAGS: ["foreignObject"],
      ADD_ATTR: ["target"],
    });

    document.getElementById("mdv-landing").hidden = true;
    var layout = document.getElementById("mdv-layout");
    layout.hidden = false;

    var content = document.getElementById("mdv-content");
    content.innerHTML = clean;

    buildToc(content);
    highlightCodeBlocks(content);
    renderMermaid(content);
    setupExternalLinks(content);
    if (opts && opts.preserveScroll) {
      window.scrollTo(0, opts.preserveScroll.y);
    } else {
      window.scrollTo(0, 0);
    }
  }

  function showError(msg) {
    var landing = document.getElementById("mdv-landing");
    landing.hidden = false;
    document.getElementById("mdv-layout").hidden = true;
    var tip = document.getElementById("mdv-error");
    if (!tip) {
      tip = document.createElement("p");
      tip.id = "mdv-error";
      landing.querySelector(".mdv-landing-card").appendChild(tip);
    }
    tip.textContent = "⚠️ " + msg;
  }

  function loadFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () {
      showError("读取文件失败：" + file.name);
    };
    reader.onload = function () {
      try {
        // reload 尝试重读同一 File 句柄（磁盘文件被修改后 Chrome 可能拒绝重读，
        // 届时 refreshActive 会给出提示让用户重新拖入）
        addDoc(file.name, String(reader.result), function () {
          return file.text();
        });
      } catch (e) {
        showError("渲染失败：" + (e && e.message ? e.message : e));
      }
    };
    reader.readAsText(file);
  }

  function loadFiles(fileList) {
    if (!fileList) return;
    Array.prototype.slice.call(fileList).forEach(loadFile);
  }

  // File System Access API：句柄可随时重读磁盘最新内容（File 快照做不到），
  // 自动同步/刷新按钮都靠它才能在文件被修改后继续工作。
  function loadHandle(handle) {
    handle
      .getFile()
      .then(function (file) {
        return file.text().then(function (text) {
          addDoc(file.name, text, function () {
            return handle.getFile().then(function (f) {
              return f.text();
            });
          });
        });
      })
      .catch(function (e) {
        showError("读取文件失败：" + (e && e.message ? e.message : e));
      });
  }

  // ---- drag & drop ----------------------------------------------------------
  function setupDropZone() {
    var overlay = document.getElementById("mdv-drop-overlay");
    var depth = 0;
    window.addEventListener("dragenter", function (e) {
      e.preventDefault();
      depth++;
      overlay.classList.add("mdv-visible");
    });
    window.addEventListener("dragover", function (e) {
      e.preventDefault();
    });
    window.addEventListener("dragleave", function (e) {
      e.preventDefault();
      depth--;
      if (depth <= 0) overlay.classList.remove("mdv-visible");
    });
    window.addEventListener("drop", function (e) {
      e.preventDefault();
      depth = 0;
      overlay.classList.remove("mdv-visible");
      if (!e.dataTransfer) return;
      var items = e.dataTransfer.items;
      // 优先拿文件句柄（可重读磁盘最新内容）；必须在 drop 事件同步阶段发起
      if (items && items.length && items[0].getAsFileSystemHandle) {
        Array.prototype.slice.call(items).forEach(function (item) {
          if (item.kind !== "file") return;
          // File 必须在 drop 同步阶段先抓到（await 后 DataTransfer 失效）
          var fallbackFile = item.getAsFile();
          item
            .getAsFileSystemHandle()
            .then(function (handle) {
              if (handle && handle.kind === "file") loadHandle(handle);
              else loadFile(fallbackFile); // 句柄拿不到（合成拖拽等）退回快照
            })
            .catch(function () {
              loadFile(fallbackFile);
            });
        });
      } else {
        loadFiles(e.dataTransfer.files);
      }
    });
  }

  // ---- boot -----------------------------------------------------------------
  function boot() {
    applyStyle(getStyle());
    applyTheme(getTheme());
    setupDropZone();

    var input = document.getElementById("mdv-file-input");
    input.addEventListener("change", function () {
      loadFiles(input.files);
      input.value = ""; // allow re-selecting the same file
    });
    function pick() {
      // 优先 File System Access API：句柄支持磁盘变更后的自动同步
      if (window.showOpenFilePicker) {
        window
          .showOpenFilePicker({
            multiple: true,
            types: [
              {
                description: "Markdown",
                accept: {
                  "text/markdown": [".md", ".markdown", ".mdown", ".mkd", ".mdx"],
                  "text/plain": [".txt"],
                },
              },
            ],
          })
          .then(function (handles) {
            handles.forEach(loadHandle);
          })
          .catch(function () {
            /* 用户取消选择 */
          });
        return;
      }
      input.click();
    }
    document.getElementById("mdv-open-btn").addEventListener("click", pick);
    document.getElementById("mdv-landing-open").addEventListener("click", pick);

    var refreshBtn = document.getElementById("mdv-refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", refreshActive);

    document.getElementById("mdv-theme-btn").addEventListener("click", function () {
      var next =
        document.documentElement.getAttribute("data-mdviewer-theme") === "dark"
          ? "light"
          : "dark";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });

    var styleBtn = document.getElementById("mdv-style-btn");
    if (styleBtn) {
      styleBtn.addEventListener("click", function () {
        var cur = getStyle();
        var next = STYLES[(STYLES.indexOf(cur) + 1) % STYLES.length];
        localStorage.setItem(STYLE_KEY, next);
        applyStyle(next);
      });
    }

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      });
    }
  }

  boot();

  // Hooks for host pages (e.g. the Chrome extension viewer) to feed documents in.
  window.MarkdownShow = {
    addDoc: addDoc,
    showError: showError,
    refreshActive: refreshActive,
  };
})();
