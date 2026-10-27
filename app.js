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
      var run = mermaid.run({ nodes: content.querySelectorAll(".mermaid") });
      // mermaid.run 异步生成 SVG，完成后再挂放大（幂等，不会重复绑定）
      if (run && run.then) run.then(function () { setupZoom(content); });
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

  // ========================================================================
  // 展示增强套件：图片放大 / 代码复制 / 阅读统计 / 演示模式 / 站内搜索 / 导出
  // ========================================================================

  // ---- 1. 图片 & 图表 Lightbox ----------------------------------------------
  var lightbox = null;
  function ensureLightbox() {
    if (lightbox) return lightbox;
    var box = document.createElement("div");
    box.id = "mdv-lightbox";
    box.hidden = true;
    box.innerHTML =
      '<button class="mdv-lb-close" title="关闭 (Esc)">×</button>' +
      '<div class="mdv-lb-stage"></div>' +
      '<div class="mdv-lb-hint">滚轮缩放 · 拖拽平移 · Esc 关闭</div>';
    document.body.appendChild(box);
    var stage = box.querySelector(".mdv-lb-stage");
    var state = { scale: 1, x: 0, y: 0, dragging: false, sx: 0, sy: 0 };

    function apply() {
      var node = stage.firstElementChild;
      if (node)
        node.style.transform =
          "translate(" + state.x + "px," + state.y + "px) scale(" + state.scale + ")";
    }
    function reset() {
      state.scale = 1;
      state.x = 0;
      state.y = 0;
      apply();
    }
    function close() {
      box.hidden = true;
      stage.innerHTML = "";
      document.body.style.overflow = "";
    }
    box._openWith = function (node) {
      stage.innerHTML = "";
      node.style.transformOrigin = "center center";
      stage.appendChild(node);
      reset();
      box.hidden = false;
      document.body.style.overflow = "hidden";
    };

    box.querySelector(".mdv-lb-close").addEventListener("click", close);
    box.addEventListener("click", function (e) {
      if (e.target === box) close();
    });
    box.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        var next = Math.min(8, Math.max(1, state.scale * factor));
        state.scale = next;
        if (next === 1) {
          state.x = 0;
          state.y = 0;
        }
        apply();
      },
      { passive: false }
    );
    stage.addEventListener("pointerdown", function (e) {
      state.dragging = true;
      state.sx = e.clientX - state.x;
      state.sy = e.clientY - state.y;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", function (e) {
      if (!state.dragging) return;
      state.x = e.clientX - state.sx;
      state.y = e.clientY - state.sy;
      apply();
    });
    stage.addEventListener("pointerup", function () {
      state.dragging = false;
    });
    stage.addEventListener("click", function (e) {
      // 单击图片本身：1x/2x 切换（拖拽后不触发）
      if (Math.abs(e.clientX - state.sx - state.x) > 3) return;
      state.scale = state.scale > 1 ? 1 : 2;
      if (state.scale === 1) {
        state.x = 0;
        state.y = 0;
      }
      apply();
    });
    document.addEventListener("keydown", function (e) {
      if (!box.hidden && e.key === "Escape") close();
    });
    lightbox = box;
    return box;
  }

  // 仅打标记（cursor:zoom-in）；点击用委托统一处理，避开 mermaid 异步时序
  function setupZoom(content) {
    content.querySelectorAll("img, .mermaid svg").forEach(function (el) {
      el.classList.add("mdv-zoomable");
    });
  }

  var zoomDelegated = false;
  function setupZoomDelegation() {
    if (zoomDelegated) return;
    zoomDelegated = true;
    document.addEventListener("click", function (e) {
      // 只在渲染区/演示页内响应
      var scope = e.target.closest && e.target.closest("#mdv-content, .mdv-slide");
      if (!scope) return;
      var img = e.target.closest("img");
      var svg = e.target.closest(".mermaid svg");
      if (!img && !svg) return;
      var box = ensureLightbox();
      var node;
      if (img) {
        node = document.createElement("img");
        node.src = img.currentSrc || img.src;
        node.alt = img.alt || "";
      } else {
        node = svg.cloneNode(true); // SVG 矢量克隆，无损放大
      }
      box._openWith(node);
    });
  }

  // ---- 2. 代码块一键复制 -----------------------------------------------------
  function addCopyButtons(content) {
    content.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".mdv-copy-btn")) return;
      var code = pre.querySelector("code");
      if (!code) return;
      pre.classList.add("mdv-has-copy");
      var btn = document.createElement("button");
      btn.className = "mdv-copy-btn";
      btn.type = "button";
      btn.textContent = "复制";
      btn.addEventListener("click", function () {
        var text = code.textContent;
        var done = function () {
          btn.textContent = "已复制";
          btn.classList.add("mdv-copied");
          setTimeout(function () {
            btn.textContent = "复制";
            btn.classList.remove("mdv-copied");
          }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {});
        } else {
          var ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
            done();
          } catch (e) {}
          ta.remove();
        }
      });
      pre.appendChild(btn);
    });
  }

  // ---- 3. 阅读统计 & 进度条 --------------------------------------------------
  function updateReadingStats(content) {
    var text = content.textContent || "";
    var cjk = (text.match(/[一-龥]/g) || []).length;
    var words = (text.replace(/[一-龥]/g, " ").match(/[A-Za-z0-9]+/g) || [])
      .length;
    var total = cjk + words;
    var minutes = Math.max(1, Math.round(total / 400));
    var el = document.getElementById("mdv-reading-stats");
    if (!el) {
      var toc = document.getElementById("mdv-toc");
      el = document.createElement("div");
      el.id = "mdv-reading-stats";
      if (toc) toc.insertBefore(el, toc.firstChild);
    }
    el.textContent = total + " 字 · 约 " + minutes + " 分钟";
  }

  function setupProgress() {
    var bar = document.getElementById("mdv-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "mdv-progress";
      document.body.appendChild(bar);
    }
    var ticking = false;
    function update() {
      ticking = false;
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var p = max > 0 ? (h.scrollTop / max) * 100 : 0;
      bar.style.width = p + "%";
    }
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true }
    );
    update();
  }

  // ---- 4. 演示模式 -----------------------------------------------------------
  function openPresentation() {
    var content = document.getElementById("mdv-content");
    if (!content || document.getElementById("mdv-layout").hidden) return;
    if (activeKind() !== "markdown") return; // 演示模式仅适用于 markdown
    var nodes = Array.prototype.slice.call(content.childNodes);
    var hasHr = content.querySelector("hr");
    var slides = [];
    var cur = [];
    function flush() {
      if (cur.length) {
        slides.push(cur);
        cur = [];
      }
    }
    nodes.forEach(function (n) {
      if (hasHr) {
        if (n.nodeType === 1 && n.tagName === "HR") {
          flush();
          return;
        }
      } else if (
        n.nodeType === 1 &&
        (n.tagName === "H1" || n.tagName === "H2") &&
        cur.length
      ) {
        flush();
      }
      cur.push(n.cloneNode(true));
    });
    flush();
    if (!slides.length) return;

    var overlay = document.createElement("div");
    overlay.id = "mdv-slides";
    overlay.innerHTML =
      '<div class="mdv-slide markdown-body"></div>' +
      '<div class="mdv-slide-nav">' +
      '<button class="mdv-slide-prev" title="上一页 (←)">‹</button>' +
      '<span class="mdv-slide-count"></span>' +
      '<button class="mdv-slide-next" title="下一页 (→)">›</button>' +
      '<button class="mdv-slide-fs" title="全屏 (F)">⛶</button>' +
      '<button class="mdv-slide-close" title="退出 (Esc)">×</button>' +
      "</div>";
    document.body.appendChild(overlay);
    var stage = overlay.querySelector(".mdv-slide");
    var count = overlay.querySelector(".mdv-slide-count");
    var idx = 0;

    function show(i) {
      idx = Math.min(slides.length - 1, Math.max(0, i));
      stage.innerHTML = "";
      slides[idx].forEach(function (n) {
        stage.appendChild(n.cloneNode(true));
      });
      count.textContent = idx + 1 + " / " + slides.length;
      stage.scrollTop = 0;
      setupZoom(stage); // 演示页内图片仍可放大
    }
    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    }
    function onKey(e) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ")
        show(idx + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") show(idx - 1);
      else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) document.exitFullscreen();
        else overlay.requestFullscreen && overlay.requestFullscreen();
      }
    }
    overlay.querySelector(".mdv-slide-prev").addEventListener("click", function () {
      show(idx - 1);
    });
    overlay.querySelector(".mdv-slide-next").addEventListener("click", function () {
      show(idx + 1);
    });
    overlay.querySelector(".mdv-slide-fs").addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else overlay.requestFullscreen && overlay.requestFullscreen();
    });
    overlay.querySelector(".mdv-slide-close").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    show(0);
  }

  // ---- 5. 站内搜索（Ctrl/Cmd+F） --------------------------------------------
  var findBar = null;
  function clearFindMarks(content) {
    content.querySelectorAll("mark.mdv-hit").forEach(function (m) {
      var parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }
  function ensureFindBar() {
    if (findBar) return findBar;
    var bar = document.createElement("div");
    bar.id = "mdv-find";
    bar.hidden = true;
    bar.innerHTML =
      '<input type="text" class="mdv-find-input" placeholder="搜索正文…" />' +
      '<span class="mdv-find-count"></span>' +
      '<button class="mdv-find-prev" title="上一个 (Shift+Enter)">‹</button>' +
      '<button class="mdv-find-next" title="下一个 (Enter)">›</button>' +
      '<button class="mdv-find-close" title="关闭 (Esc)">×</button>';
    document.body.appendChild(bar);
    var input = bar.querySelector(".mdv-find-input");
    var countEl = bar.querySelector(".mdv-find-count");
    var hits = [];
    var pos = -1;

    function content() {
      return document.getElementById("mdv-content");
    }
    var edHits = []; // 编辑模式：源码文本框内的命中起点
    function isEdit() {
      return editMode;
    }
    function collectUnits(c) {
      // 普通文本按节点为单位；代码块按整块为单位（高亮 span 会把词拆开）
      var units = [];
      var walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          var p = node.parentNode;
          while (p && p !== c) {
            var t = (p.tagName || "").toLowerCase();
            if (t === "svg" || t === "mark" || t === "button" || t === "style" || t === "script")
              return NodeFilter.FILTER_REJECT;
            p = p.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      var byPre = new Map();
      var n;
      while ((n = walker.nextNode())) {
        var pre = n.parentNode.closest ? n.parentNode.closest("pre") : null;
        if (pre && c.contains(pre)) {
          var u = byPre.get(pre);
          if (!u) {
            u = [];
            byPre.set(pre, u);
            units.push(u);
          }
          u.push(n);
        } else if (n.nodeValue.trim()) {
          units.push([n]);
        }
      }
      return units;
    }
    function markUnit(nodes, ql, groups) {
      var starts = [];
      var text = "";
      nodes.forEach(function (nd) {
        starts.push(text.length);
        text += nd.nodeValue;
      });
      var lower = text.toLowerCase();
      var matches = [];
      var i = lower.indexOf(ql);
      while (i >= 0) {
        matches.push([i, i + ql.length]);
        i = lower.indexOf(ql, i + ql.length);
      }
      if (!matches.length) return;
      var base = groups.length;
      matches.forEach(function () {
        groups.push([]);
      });
      nodes.forEach(function (nd, k) {
        var ns = starts[k];
        var ne = ns + nd.nodeValue.length;
        var val = nd.nodeValue;
        var frag = document.createDocumentFragment();
        var cur = 0;
        matches.forEach(function (m, mi) {
          var s0 = Math.max(m[0], ns);
          var e0 = Math.min(m[1], ne);
          if (s0 >= e0) return;
          if (s0 - ns > cur) frag.appendChild(document.createTextNode(val.slice(cur, s0 - ns)));
          var mark = document.createElement("mark");
          mark.className = "mdv-hit";
          mark.textContent = val.slice(s0 - ns, e0 - ns);
          frag.appendChild(mark);
          groups[base + mi].push(mark);
          cur = e0 - ns;
        });
        if (cur === 0 && !frag.childNodes.length) return;
        if (cur < val.length) frag.appendChild(document.createTextNode(val.slice(cur)));
        nd.parentNode.replaceChild(frag, nd);
      });
    }
    function total() {
      return isEdit() ? edHits.length : hits.length;
    }
    function runSearch(q, keep) {
      var c = content();
      clearFindMarks(c);
      hits = [];
      edHits = [];
      var prev = pos;
      pos = -1;
      if (!q) {
        countEl.textContent = "";
        return;
      }
      var ql = q.toLowerCase();
      collectUnits(c).forEach(function (nodes) {
        markUnit(nodes, ql, hits);
      });
      if (isEdit()) {
        var low = document.getElementById("mdv-editor-input").value.toLowerCase();
        var i = low.indexOf(ql);
        while (i >= 0) {
          edHits.push(i);
          i = low.indexOf(ql, i + ql.length);
        }
      }
      if (!total()) {
        countEl.textContent = "0/0";
        return;
      }
      if (keep && prev >= 0 && prev < total()) {
        pos = prev; // 重渲染后仅更新计数/高亮，不抢焦点、不滚动
        setActive(false);
      } else go(0);
    }
    function setActive(scroll) {
      hits.forEach(function (g) {
        g.forEach(function (m) {
          m.classList.remove("mdv-hit-active");
        });
      });
      countEl.textContent = pos + 1 + "/" + total();
      if (isEdit()) {
        var ta = document.getElementById("mdv-editor-input");
        var st = edHits[pos];
        var len = input.value.trim().length;
        if (scroll) {
          ta.focus(); // 让浏览器把选区滚入可视区，再把焦点还给搜索框
          ta.setSelectionRange(st, st + len);
          input.focus();
        }
        return;
      }
      var g = hits[pos];
      g.forEach(function (m) {
        m.classList.add("mdv-hit-active");
      });
      if (scroll) g[0].scrollIntoView({ behavior: "smooth", block: "center" });
    }
    function go(i) {
      var t = total();
      if (!t) return;
      pos = ((i % t) + t) % t;
      setActive(true);
    }
    bar._open = function () {
      bar.hidden = false;
      input.focus();
      input.select();
      if (input.value) runSearch(input.value.trim());
    };
    bar._refresh = function () {
      if (!bar.hidden && input.value.trim()) runSearch(input.value.trim(), true);
    };
    function close() {
      bar.hidden = true;
      clearFindMarks(content());
      hits = [];
      edHits = [];
      pos = -1;
    }
    input.addEventListener("input", function () {
      runSearch(input.value.trim());
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        go(pos + (e.shiftKey ? -1 : 1));
      } else if (e.key === "Escape") close();
    });
    bar.querySelector(".mdv-find-prev").addEventListener("click", function () {
      go(pos - 1);
    });
    bar.querySelector(".mdv-find-next").addEventListener("click", function () {
      go(pos + 1);
    });
    bar.querySelector(".mdv-find-close").addEventListener("click", close);
    findBar = bar;
    return bar;
  }
  function openFind() {
    if (document.getElementById("mdv-layout").hidden) return;
    if (activeKind() !== "markdown") return; // 站内搜索仅适用于 markdown 正文
    ensureFindBar()._open();
  }

  // ---- 6. 导出 PDF / HTML ----------------------------------------------------
  function exportPDF() {
    if (document.getElementById("mdv-layout").hidden) return;
    if (activeKind() !== "markdown") return; // PDF 文档用其自带阅读器打印
    window.print();
  }
  function exportHTML() {
    var content = document.getElementById("mdv-content");
    if (!content || document.getElementById("mdv-layout").hidden) return;
    if (activeKind() !== "markdown") return; // 导出独立 HTML 仅针对 markdown 渲染结果
    var theme = document.documentElement.getAttribute("data-mdviewer-theme") || "light";
    var style = document.documentElement.getAttribute("data-mdviewer-style") || "editorial";
    var title = (docs[activeDoc] && docs[activeDoc].name) || "document";
    Promise.all([
      fetch("app.css").then(function (r) {
        return r.text();
      }),
      fetch(theme === "dark" ? "lib/hljs-dark.css" : "lib/hljs-light.css").then(
        function (r) {
          return r.text();
        }
      ),
    ])
      .then(function (parts) {
        var html =
          "<!DOCTYPE html><html data-mdviewer-theme='" +
          theme +
          "' data-mdviewer-style='" +
          style +
          "'><head><meta charset='utf-8'><title>" +
          title +
          "</title><style>" +
          parts[0] +
          parts[1] +
          "\nbody{background:var(--mdv-bg);}main{max-width:860px;margin:0 auto;padding:48px 24px;}" +
          "</style></head><body><main class='markdown-body'>" +
          content.innerHTML +
          "</main></body></html>";
        var blob = new Blob([html], { type: "text/html" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = title.replace(/\.[^.]*$/, "") + ".html";
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
        }, 2000);
      })
      .catch(function (e) {
        showError("导出 HTML 失败：" + (e && e.message ? e.message : e));
      });
  }

  // ---- multi-document tabs ---------------------------------------------------
  // 文档模型：
  //   markdown → { name, kind:'markdown', raw, reload }
  //   pdf/html → { name, kind:'pdf'|'html', file, handle, reload, blobUrl }
  var docs = [];
  var activeDoc = -1;

  function classifyName(name) {
    if (window.MDVFileTreeCore && window.MDVFileTreeCore.classifyFile) {
      return window.MDVFileTreeCore.classifyFile(name);
    }
    // 兜底：filetree-core 未加载时按扩展名简单判断
    var lower = String(name).toLowerCase();
    if (/\.pdf$/.test(lower)) return "pdf";
    if (/\.html?$/.test(lower)) return "html";
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/.test(lower)) return "image";
    if (/\.xmind$/.test(lower)) return "xmind";
    return "markdown";
  }

  function activeKind() {
    return activeDoc >= 0 && docs[activeDoc] ? docs[activeDoc].kind || "markdown" : null;
  }

  // pdf/html/image 都是"整页/二进制"文档：存 file+handle+blobUrl，用 iframe 或 img 展示
  function isBinaryKind(kind) {
    return kind === "pdf" || kind === "html" || kind === "image";
  }
  function renderByKind(doc) {
    if (doc.kind === "image") renderImage(doc);
    else renderEmbed(doc); // pdf / html
  }

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
      label.textContent = (d.dirty ? "● " : "") + d.name; // ● 表示未保存
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
    if (editMode) leaveEditMode(true); // 切换文档前退出编辑（静默同步当前内容）
    activeDoc = i;
    var d = docs[i];
    document.title = d.name + " · Markdown Show";
    renderTabs();
    if (isBinaryKind(d.kind)) renderByKind(d);
    else render(d.raw);
    updateEditToolbar();
  }

  function closeDoc(i) {
    if (editMode && i === activeDoc) leaveEditMode(true);
    if (docs[i] && docs[i].blobUrl) {
      URL.revokeObjectURL(docs[i].blobUrl);
      docs[i].blobUrl = null;
    }
    docs.splice(i, 1);
    if (docs.length === 0) {
      activeDoc = -1;
      renderTabs();
      document.getElementById("mdv-layout").hidden = true;
      document.getElementById("mdv-landing").hidden = false;
      document.title = "Markdown Show · 拖拽即渲染";
      updateEditToolbar();
      return;
    }
    switchDoc(Math.min(i, docs.length - 1));
  }

  // ---- 编辑模式（左编辑 / 右即时预览） --------------------------------------
  var editMode = false;
  var editDebounce = null;

  // ---- 编辑模式：左右双向同步滚动（按块锚点对齐，失败时退回按比例） ---------
  var syncMap = null; // { e:[编辑器像素], p:[预览像素] } 单调递增，末项为内容总高
  var syncLockEl = null;
  var syncLockUntil = 0;

  function editorLineTops(ta, lines) {
    var cs = getComputedStyle(ta);
    var m = document.createElement("div");
    m.style.cssText =
      "position:absolute;visibility:hidden;left:-99999px;top:0;box-sizing:border-box;" +
      "white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;" +
      "width:" + ta.clientWidth + "px;padding:" + cs.padding + ";font:" + cs.font +
      ";line-height:" + cs.lineHeight + ";letter-spacing:" + cs.letterSpacing +
      ";tab-size:" + cs.tabSize;
    var html = document.createDocumentFragment();
    lines.forEach(function (ln) {
      var d = document.createElement("div");
      d.textContent = ln === "" ? "\u200b" : ln;
      html.appendChild(d);
    });
    m.appendChild(html);
    document.body.appendChild(m);
    var tops = [];
    for (var i = 0; i < m.children.length; i++) tops.push(m.children[i].offsetTop);
    var h = m.scrollHeight;
    document.body.removeChild(m);
    tops.push(h);
    return tops;
  }

  function buildSyncMap() {
    syncMap = null;
    if (!editMode || activeDoc < 0) return;
    var ta = document.getElementById("mdv-editor-input");
    var content = document.getElementById("mdv-content");
    var raw = ta.value;
    var tokens;
    try {
      tokens = marked.lexer(raw);
    } catch (e) {
      return;
    }
    var starts = [];
    var line = 0;
    tokens.forEach(function (t) {
      if (t.type !== "space" && t.type !== "def") starts.push(line);
      line += (t.raw.match(/\n/g) || []).length;
    });
    var els = Array.prototype.slice.call(content.children);
    if (!starts.length || els.length !== starts.length) return; // 对不上就用比例兜底
    var lines = raw.split("\n");
    var tops = editorLineTops(ta, lines);
    var base = content.getBoundingClientRect().top - content.scrollTop;
    var e = [];
    var p = [];
    for (var i = 0; i < starts.length; i++) {
      var ey = tops[Math.min(starts[i], tops.length - 1)];
      var py = els[i].getBoundingClientRect().top - base;
      if (e.length && (ey <= e[e.length - 1] || py <= p[p.length - 1])) continue;
      e.push(ey);
      p.push(py);
    }
    e.push(ta.scrollHeight);
    p.push(content.scrollHeight);
    syncMap = { e: e, p: p };
  }

  function mapPos(from, to, v) {
    var n = from.length - 1;
    if (v <= from[0]) return to[0] * (from[0] ? v / from[0] : 0);
    for (var i = 0; i < n; i++) {
      if (v < from[i + 1]) {
        var span = from[i + 1] - from[i];
        return to[i] + ((v - from[i]) / (span || 1)) * (to[i + 1] - to[i]);
      }
    }
    return to[n];
  }

  function syncFrom(src) {
    if (!editMode) return;
    var now = Date.now();
    if (syncLockEl && syncLockEl !== src && now < syncLockUntil) return;
    syncLockEl = src;
    syncLockUntil = now + 120;
    var ta = document.getElementById("mdv-editor-input");
    var content = document.getElementById("mdv-content");
    var from = src === ta ? ta : content;
    var dst = src === ta ? content : ta;
    var fMax = from.scrollHeight - from.clientHeight;
    var dMax = dst.scrollHeight - dst.clientHeight;
    var target;
    if (fMax <= 0) return;
    if (from.scrollTop >= fMax - 1) target = dMax; // 到底对齐到底
    else if (syncMap) {
      target =
        src === ta
          ? mapPos(syncMap.e, syncMap.p, ta.scrollTop)
          : mapPos(syncMap.p, syncMap.e, content.scrollTop);
    } else target = (from.scrollTop / fMax) * dMax;
    dst.scrollTop = Math.max(0, Math.min(dMax, target));
  }

  var syncRebuildTimer = null;
  function scheduleSyncRebuild() {
    clearTimeout(syncRebuildTimer);
    syncRebuildTimer = setTimeout(function () {
      buildSyncMap();
      var ta = document.getElementById("mdv-editor-input");
      if (editMode) {
        syncLockEl = null;
        syncFrom(ta);
      }
    }, 120); // 等 mermaid / 图片撑开高度后再重算
    clearTimeout(syncLateTimer);
    syncLateTimer = setTimeout(buildSyncMap, 900); // mermaid 异步出图后的二次校准
  }
  var syncLateTimer = null;

  function canEditActive() {
    var d = docs[activeDoc];
    return !!(activeDoc >= 0 && d && d.kind === "markdown" && !d.readonly);
  }

  function enterEditMode() {
    if (!canEditActive()) return;
    editMode = true;
    var ta = document.getElementById("mdv-editor-input");
    ta.value = docs[activeDoc].raw;
    document.getElementById("mdv-editor").hidden = false;
    var layout = document.getElementById("mdv-layout");
    layout.hidden = false;
    layout.classList.add("mdv-edit-mode");
    document.getElementById("mdv-landing").hidden = true;
    render(docs[activeDoc].raw, { preserveScroll: { y: 0 } });
    updateEditToolbar();
    ta.focus();
    scheduleSyncRebuild();
  }

  function leaveEditMode(silent) {
    if (!editMode) return;
    var ta = document.getElementById("mdv-editor-input");
    if (activeDoc >= 0 && docs[activeDoc] && docs[activeDoc].kind === "markdown") {
      docs[activeDoc].raw = ta.value; // 同步编辑内容
    }
    editMode = false;
    syncMap = null;
    document.getElementById("mdv-editor").hidden = true;
    document.getElementById("mdv-layout").classList.remove("mdv-edit-mode");
    if (!silent) {
      render(docs[activeDoc].raw);
      updateEditToolbar();
    }
  }

  function toggleEdit() {
    if (editMode) leaveEditMode(false);
    else enterEditMode();
  }

  function onEditorInput() {
    if (!editMode || activeDoc < 0) return;
    var ta = document.getElementById("mdv-editor-input");
    docs[activeDoc].raw = ta.value;
    if (!docs[activeDoc].dirty) {
      docs[activeDoc].dirty = true;
      renderTabs();
    }
    clearTimeout(editDebounce);
    editDebounce = setTimeout(function () {
      var content = document.getElementById("mdv-content");
      var st = content.scrollTop; // 预览独立滚动，重渲染后恢复，避免打字时跳顶
      render(docs[activeDoc].raw, { preserveScroll: { y: window.scrollY } });
      content.scrollTop = st;
      updateEditToolbar();
      if (findBar && !findBar.hidden) findBar._refresh();
      scheduleSyncRebuild();
    }, 160);
  }

  function ensureWritePermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") return Promise.resolve(!!handle);
    return handle
      .queryPermission({ mode: "readwrite" })
      .then(function (p) {
        if (p === "granted") return true;
        return handle.requestPermission({ mode: "readwrite" }).then(function (x) {
          return x === "granted";
        });
      })
      .catch(function () {
        return false;
      });
  }

  function currentContent() {
    var doc = docs[activeDoc];
    if (editMode) doc.raw = document.getElementById("mdv-editor-input").value;
    return doc.raw;
  }

  function flashSave(msg) {
    var btn = document.getElementById("mdv-save-btn");
    var txt = btn && btn.querySelector(".mdv-btn-txt");
    if (txt) {
      txt.textContent = msg || "已保存";
      setTimeout(updateEditToolbar, 1400);
    }
  }

  function saveDoc() {
    if (activeDoc < 0) return;
    var doc = docs[activeDoc];
    if (doc.kind !== "markdown" || doc.readonly) return;
    var content = currentContent();
    if (doc.handle && typeof doc.handle.createWritable === "function") {
      ensureWritePermission(doc.handle)
        .then(function (ok) {
          if (!ok) {
            window.alert("未获得写入权限，无法保存。可改用「另存为」。");
            return null;
          }
          return doc.handle.createWritable().then(function (w) {
            return w.write(content).then(function () {
              return w.close();
            });
          });
        })
        .then(function (r) {
          if (r !== null) {
            doc.dirty = false;
            renderTabs();
            flashSave("已保存");
          }
        })
        .catch(function (e) {
          window.alert("保存失败：" + (e && e.message ? e.message : e));
        });
    } else {
      saveAsDoc(); // 拖入的文件无句柄 → 走另存为
    }
  }

  function saveAsDoc() {
    if (activeDoc < 0) return;
    var doc = docs[activeDoc];
    if (doc.kind !== "markdown") return;
    var content = currentContent();
    var base = (doc.name || "document").replace(/\.[^.]*$/, "");
    var suggested = /\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(doc.name || "") ? doc.name : base + ".md";
    if (window.showSaveFilePicker) {
      window
        .showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }],
        })
        .then(function (h) {
          return h
            .createWritable()
            .then(function (w) {
              return w.write(content).then(function () {
                return w.close();
              });
            })
            .then(function () {
              doc.handle = h;
              doc.name = h.name;
              doc.readonly = false;
              doc.dirty = false;
              document.title = h.name + " · Markdown Show";
              renderTabs();
              flashSave("已另存");
            });
        })
        .catch(function (e) {
          if (e && e.name === "AbortError") return;
          window.alert("另存为失败：" + (e && e.message ? e.message : e));
        });
    } else {
      // 降级：浏览器不支持 showSaveFilePicker 时用下载
      var blob = new Blob([content], { type: "text/markdown" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = suggested;
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 2000);
    }
  }

  function updateEditToolbar() {
    var editBtn = document.getElementById("mdv-edit-btn");
    var saveBtn = document.getElementById("mdv-save-btn");
    var saveAsBtn = document.getElementById("mdv-saveas-btn");
    var canEdit = canEditActive();
    if (editBtn) {
      editBtn.hidden = !canEdit;
      var t = editBtn.querySelector(".mdv-btn-txt");
      var ic = editBtn.querySelector(".mdv-btn-ico");
      if (t) t.textContent = editMode ? "预览" : "编辑";
      if (ic) ic.textContent = editMode ? "👁" : "✏️";
    }
    var showSave = canEdit && editMode;
    if (saveBtn) {
      saveBtn.hidden = !showSave;
      var st = saveBtn.querySelector(".mdv-btn-txt");
      if (st) st.textContent = docs[activeDoc] && docs[activeDoc].dirty ? "保存*" : "保存";
    }
    if (saveAsBtn) saveAsBtn.hidden = !showSave;
  }

  // opts.handle：可写文件句柄（编辑模式「保存」写回原文件用）；opts.readonly：合成文档
  // （如 xmind 生成的 markdown）不允许编辑保存。
  function addDoc(name, raw, reload, opts) {
    opts = opts || {};
    var doc = {
      name: name,
      kind: "markdown",
      raw: raw,
      reload: reload || null,
      handle: opts.handle || null,
      readonly: !!opts.readonly,
      dirty: false,
    };
    var existing = docs.findIndex(function (d) {
      return d.name === name;
    });
    if (existing >= 0) {
      if (docs[existing].blobUrl) {
        URL.revokeObjectURL(docs[existing].blobUrl);
        docs[existing].blobUrl = null;
      }
      docs[existing] = doc;
      switchDoc(existing);
    } else {
      docs.push(doc);
      switchDoc(docs.length - 1);
    }
  }

  // 加入一个二进制/整页展示型文档（pdf / html）。file 是当前快照，handle 可重读磁盘。
  function addBinaryDoc(name, kind, file, handle) {
    var reload = handle
      ? function () {
          return handle.getFile();
        }
      : function () {
          return Promise.resolve(file);
        };
    var doc = { name: name, kind: kind, file: file, handle: handle || null, reload: reload, blobUrl: null };
    var existing = docs.findIndex(function (d) {
      return d.name === name;
    });
    if (existing >= 0) {
      if (docs[existing].blobUrl) URL.revokeObjectURL(docs[existing].blobUrl);
      docs[existing] = doc;
      switchDoc(existing);
    } else {
      docs.push(doc);
      switchDoc(docs.length - 1);
    }
  }

  // 刷新当前文档（软刷新：保持滚动位置）。优先从来源重读，无来源则原文重渲染
  function refreshActive() {
    if (activeDoc < 0) return;
    var doc = docs[activeDoc];
    var idx = activeDoc;
    // pdf/html/image：重新读取文件并重建展示（不比较文本）
    if (isBinaryKind(doc.kind)) {
      if (doc.handle) {
        doc.handle
          .getFile()
          .then(function (f) {
            if (idx !== activeDoc) return;
            docs[idx].file = f;
            renderByKind(docs[idx]);
          })
          .catch(function (e) {
            showError("刷新失败：" + (e && e.message ? e.message : e) + "。文件可能已被移动，请重新打开。");
          });
      } else {
        renderByKind(doc);
      }
      return;
    }
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
    if (editMode) return; // 编辑中：暂停自动同步，避免覆盖未保存内容
    var doc = docs[activeDoc];
    if (!doc || !doc.reload) return;
    if (isBinaryKind(doc.kind)) return; // 二进制/整页文档不做文本轮询
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
    layout.classList.remove("mdv-embed-mode"); // 退出 pdf/html 整页模式，恢复 TOC 双列

    var content = document.getElementById("mdv-content");
    content.innerHTML = clean;

    buildToc(content);
    highlightCodeBlocks(content);
    addCopyButtons(content);
    renderMermaid(content);
    setupExternalLinks(content);
    setupZoom(content);
    updateReadingStats(content);
    if (opts && opts.preserveScroll) {
      window.scrollTo(0, opts.preserveScroll.y);
    } else {
      window.scrollTo(0, 0);
    }
  }

  // pdf/html 整页展示：内容区放一个 iframe。
  // - pdf：用浏览器原生 PDF 阅读器（blob URL，同源，安全）。
  // - html：sandbox 允许脚本但不 allow-same-origin → iframe 为 opaque origin，
  //         能运行页面内脚本（交互 HTML 可用），但读不到父页 cookie/localStorage/DOM。
  function renderEmbed(doc) {
    document.getElementById("mdv-landing").hidden = true;
    var layout = document.getElementById("mdv-layout");
    layout.hidden = false;
    layout.classList.add("mdv-embed-mode");

    // 隐藏 TOC（整页展示不需要目录）
    var toc = document.getElementById("mdv-toc");
    if (toc) toc.style.display = "none";
    layout.classList.add("mdv-no-toc");

    var content = document.getElementById("mdv-content");
    content.innerHTML = "";

    if (doc.blobUrl) {
      URL.revokeObjectURL(doc.blobUrl);
      doc.blobUrl = null;
    }
    var url = URL.createObjectURL(doc.file);
    doc.blobUrl = url;

    var iframe = document.createElement("iframe");
    iframe.className = "mdv-embed";
    iframe.title = doc.name;
    if (doc.kind === "html") {
      // 不含 allow-same-origin：脚本可运行但被隔离，无法访问本站数据
      iframe.setAttribute("sandbox", "allow-scripts allow-popups allow-forms allow-modals");
    }
    iframe.src = url;
    content.appendChild(iframe);
    window.scrollTo(0, 0);
  }

  // 图片展示：居中 <img>，复用已有的点击放大（setupZoomDelegation 委托 #mdv-content 内 img）。
  // SVG 以 <img> 加载不会执行内部脚本，安全。
  function renderImage(doc) {
    document.getElementById("mdv-landing").hidden = true;
    var layout = document.getElementById("mdv-layout");
    layout.hidden = false;
    layout.classList.remove("mdv-embed-mode"); // 图片不铺满，走居中容器
    var toc = document.getElementById("mdv-toc");
    if (toc) toc.style.display = "none";
    layout.classList.add("mdv-no-toc");

    var content = document.getElementById("mdv-content");
    content.innerHTML = "";

    if (doc.blobUrl) {
      URL.revokeObjectURL(doc.blobUrl);
      doc.blobUrl = null;
    }
    var url = URL.createObjectURL(doc.file);
    doc.blobUrl = url;

    var wrap = document.createElement("div");
    wrap.className = "mdv-image-wrap";
    var img = document.createElement("img");
    img.className = "mdv-image mdv-zoomable";
    img.alt = doc.name;
    img.src = url;
    img.onerror = function () {
      showError("图片无法显示：" + doc.name);
    };
    wrap.appendChild(img);
    content.appendChild(wrap);
    window.scrollTo(0, 0);
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

  // ---- .xmind 支持 ----------------------------------------------------------
  // .xmind 是 zip 包，取出 content.json 并（按需 deflate 解压）得到文本。
  // 只解析 zip 的中央目录（更可靠：含完整 size/offset，不受 data descriptor 影响）。
  function xmindExtractContentJson(arrayBuffer) {
    var view = new DataView(arrayBuffer);
    var bytes = new Uint8Array(arrayBuffer);
    // 从尾部找 EOCD（End of Central Directory，签名 0x06054b50）
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65536; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return Promise.reject(new Error("不是有效的 .xmind（zip）文件"));
    var cdCount = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);

    var target = null; // { offset, method, compSize }
    var p = cdOffset;
    for (var n = 0; n < cdCount; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break; // central dir header 签名
      var method = view.getUint16(p + 10, true);
      var compSize = view.getUint32(p + 20, true);
      var nameLen = view.getUint16(p + 28, true);
      var extraLen = view.getUint16(p + 30, true);
      var commentLen = view.getUint16(p + 32, true);
      var localOffset = view.getUint32(p + 42, true);
      var name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (name === "content.json") {
        target = { offset: localOffset, method: method, compSize: compSize };
        break;
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (!target) return Promise.reject(new Error("此 .xmind 不含 content.json（可能是 XMind 8 旧格式，暂不支持）"));

    // 定位 local file header，跳到压缩数据起点
    if (view.getUint32(target.offset, true) !== 0x04034b50) {
      return Promise.reject(new Error(".xmind 结构异常"));
    }
    var lNameLen = view.getUint16(target.offset + 26, true);
    var lExtraLen = view.getUint16(target.offset + 28, true);
    var dataStart = target.offset + 30 + lNameLen + lExtraLen;
    var comp = bytes.subarray(dataStart, dataStart + target.compSize);

    if (target.method === 0) {
      // stored（未压缩）
      return Promise.resolve(new TextDecoder().decode(comp));
    }
    if (target.method === 8) {
      // deflate（raw，无 zlib 头）→ 浏览器原生解压
      if (typeof DecompressionStream === "undefined") {
        return Promise.reject(new Error("当前浏览器不支持解压（需较新的 Chrome/Edge/Safari/Firefox）"));
      }
      var ds = new DecompressionStream("deflate-raw");
      var stream = new Blob([comp]).stream().pipeThrough(ds);
      return new Response(stream).arrayBuffer().then(function (ab) {
        return new TextDecoder().decode(ab);
      });
    }
    return Promise.reject(new Error(".xmind 使用了不支持的压缩方式"));
  }

  function xmindMarkdownFromBuffer(arrayBuffer, name) {
    return xmindExtractContentJson(arrayBuffer).then(function (jsonText) {
      var sheets = window.MDVXmind.parseXmindContent(jsonText);
      if (!sheets.length) throw new Error("未能从 .xmind 解析出思维导图内容");
      return window.MDVXmind.buildMindmapMarkdown(sheets, name.replace(/\.xmind$/i, ""));
    });
  }

  function loadXmind(file, handle) {
    if (!window.MDVXmind) {
      showError("思维导图解析组件未加载。");
      return;
    }
    var name = file.name;
    file
      .arrayBuffer()
      .then(function (buf) {
        return xmindMarkdownFromBuffer(buf, name);
      })
      .then(function (md) {
        var reload = handle
          ? function () {
              return handle
                .getFile()
                .then(function (f) {
                  return f.arrayBuffer();
                })
                .then(function (buf) {
                  return xmindMarkdownFromBuffer(buf, name);
                });
            }
          : null;
        // xmind 生成的是只读预览（编辑保存会写回 markdown 而非 .xmind，语义错误）
        addDoc(name, md, reload, { readonly: true });
      })
      .catch(function (e) {
        showError("打开思维导图失败：" + (e && e.message ? e.message : e));
      });
  }

  function loadFile(file) {
    if (!file) return;
    var kind = classifyName(file.name);
    if (kind === "xmind") {
      loadXmind(file, null);
      return;
    }
    if (isBinaryKind(kind)) {
      addBinaryDoc(file.name, kind, file, null);
      return;
    }
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
        var kind = classifyName(file.name);
        if (kind === "xmind") {
          loadXmind(file, handle);
          return;
        }
        if (isBinaryKind(kind)) {
          addBinaryDoc(file.name, kind, file, handle);
          return;
        }
        return file.text().then(function (text) {
          addDoc(
            file.name,
            text,
            function () {
              return handle.getFile().then(function (f) {
                return f.text();
              });
            },
            { handle: handle } // 保留句柄，编辑模式可直接保存回原文件
          );
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
    setupProgress();
    setupZoomDelegation();

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
                description: "可展示文件（Markdown / PDF / HTML / 图片）",
                accept: {
                  "text/markdown": [".md", ".markdown", ".mdown", ".mkd", ".mdx"],
                  "text/plain": [".txt"],
                  "application/pdf": [".pdf"],
                  "text/html": [".html", ".htm"],
                  "image/*": [
                    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico",
                  ],
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

    // ---- 粘贴本地路径 → 提示并弹出选择框定位文件 ------------------------------
    // 浏览器不允许网页凭路径字符串读取本地文件，所以只识别路径、取出文件名，
    // 由用户在系统选择框里确认一次（选择框需要点击/回车触发）。
    var PATH_RE = /\.(md|markdown|mdown|mkd|mdx|txt|html?|pdf|png|jpe?g|gif|webp|svg|bmp|avif|ico|xmind)$/i;
    var pathBar = null;
    function parsePastedPath(text) {
      var t = (text || "").trim().replace(/^["']|["']$/g, "");
      if (!t || /[\n\r]/.test(t)) return null;
      t = t.replace(/^file:\/\//i, "");
      try {
        if (/%[0-9a-f]{2}/i.test(t)) t = decodeURIComponent(t);
      } catch (e) {
        /* 保持原样 */
      }
      if (!/^(\/|~\/|[a-zA-Z]:[\\/])/.test(t)) return null;
      if (!PATH_RE.test(t)) return null;
      var base = t.split(/[\\/]/).pop();
      return { full: t, name: base, ext: "." + base.split(".").pop().toLowerCase() };
    }
    function hidePathBar() {
      if (pathBar) pathBar.hidden = true;
    }
    // 已授权的根目录句柄：文件夹面板的工作区（key=workspace）+ 粘贴路径时授权的目录（key=root:名称）
    function idbRoots(write) {
      return new Promise(function (resolve) {
        try {
          var req = indexedDB.open("mdv-filemanager", 1);
          req.onupgradeneeded = function () {
            req.result.createObjectStore("workspace");
          };
          req.onerror = function () {
            resolve([]);
          };
          req.onsuccess = function () {
            try {
              var tx = req.result.transaction("workspace", write ? "readwrite" : "readonly");
              var st = tx.objectStore("workspace");
              if (write) {
                st.put(write, "root:" + write.name);
                tx.oncomplete = function () {
                  resolve([]);
                };
                tx.onerror = function () {
                  resolve([]);
                };
                return;
              }
              var out = [];
              var cur = st.openCursor();
              cur.onsuccess = function () {
                var c = cur.result;
                if (c) {
                  if (c.value && c.value.kind === "directory") out.push(c.value);
                  c.continue();
                } else resolve(out);
              };
              cur.onerror = function () {
                resolve(out);
              };
            } catch (e) {
              resolve([]);
            }
          };
        } catch (e) {
          resolve([]);
        }
      });
    }
    // 用路径里与根目录同名的那一段作为锚点，逐级下钻到文件；找不到返回 null
    function resolveInRoot(root, fullPath) {
      var segs = fullPath.split(/[\\/]/).filter(Boolean);
      var starts = [];
      segs.forEach(function (sg, i) {
        if (sg === root.name && i < segs.length - 1) starts.push(i);
      });
      function tryFrom(k) {
        if (k >= starts.length) return Promise.resolve(null);
        var rest = segs.slice(starts[k] + 1);
        var p = Promise.resolve(root);
        rest.slice(0, -1).forEach(function (d) {
          p = p.then(function (h) {
            return h.getDirectoryHandle(d);
          });
        });
        return p
          .then(function (dir) {
            return dir.getFileHandle(rest[rest.length - 1]);
          })
          .catch(function () {
            return tryFrom(k + 1);
          });
      }
      return tryFrom(starts.length ? 0 : starts.length);
    }
    function rootPermission(root, ask) {
      return root
        .queryPermission({ mode: "read" })
        .then(function (p) {
          if (p === "granted" || !ask) return p;
          return root.requestPermission({ mode: "read" });
        })
        .catch(function () {
          return "denied";
        });
    }
    // ask=false：仅在已授权时静默尝试（粘贴即开）；ask=true：来自点击，可弹授权
    function tryOpenByRoot(info, ask) {
      if (!window.indexedDB || !window.showDirectoryPicker) return Promise.resolve(false);
      return idbRoots().then(function (roots) {
        function next(i) {
          if (i >= roots.length) return Promise.resolve(false);
          var root = roots[i];
          return rootPermission(root, ask).then(function (p) {
            if (p !== "granted") return next(i + 1);
            return resolveInRoot(root, info.full).then(function (fh) {
              if (!fh) return next(i + 1);
              loadHandle(fh);
              return true;
            });
          });
        }
        return next(0);
      });
    }
    // 推荐授权目录：文件所在的父目录（一定可选、范围最小）
    function suggestDir(info) {
      var segs = info.full.split(/[\\/]/).filter(Boolean);
      return segs.length >= 2 ? segs[segs.length - 2] : null;
    }
    function authorizeAndOpen(info) {
      hidePathBar();
      var dirName = suggestDir(info);
      window
        .showDirectoryPicker({ id: "mdv-path-root", mode: "read" })
        .then(function (dir) {
          return idbRoots(dir).then(function () {
            return resolveInRoot(dir, info.full).then(function (fh) {
              if (fh) loadHandle(fh);
              else showPathBar(info, "所选目录「" + dir.name + "」中没找到该文件：");
            });
          });
        })
        .catch(function () {
          /* 取消 */
        });
    }
    function openByPicker(info) {
      hidePathBar();
      if (!window.showOpenFilePicker) {
        input.click();
        return;
      }
      // 先尝试按根目录直接打开；失败再弹选择框（起始目录用工作区根，不限制类型以免文件置灰）
      tryOpenByRoot(info, true).then(function (ok) {
        if (ok) return;
        return idbRoots().then(function (roots) {
          var opts = { id: "mdv-path-open" };
          if (roots[0]) opts.startIn = roots[0];
          return window
            .showOpenFilePicker(opts)
            .then(function (hs) {
              hs.forEach(loadHandle);
            })
            .catch(function () {
              /* 用户取消 */
            });
        });
      });
    }
    function showPathBar(info, hint) {
      if (!pathBar) {
        pathBar = document.createElement("div");
        pathBar.id = "mdv-pathbar";
        document.body.appendChild(pathBar);
      }
      pathBar.innerHTML =
        '<span class="mdv-pathbar-txt"></span>' +
        '<button type="button" class="mdv-pathbar-auth"></button>' +
        '<button type="button" class="mdv-pathbar-open">手动选文件</button>' +
        '<button type="button" class="mdv-pathbar-close" title="关闭 (Esc)">×</button>';
      var txt = pathBar.querySelector(".mdv-pathbar-txt");
      txt.textContent = (hint || "检测到路径：") + info.full;
      txt.title = info.full;
      var openBtn = pathBar.querySelector(".mdv-pathbar-auth");
      var d = suggestDir(info);
      openBtn.textContent = d ? "授权「" + d + "」并打开" : "授权目录并打开";
      openBtn.addEventListener("click", function () {
        authorizeAndOpen(info);
      });
      pathBar.querySelector(".mdv-pathbar-open").addEventListener("click", function () {
        openByPicker(info);
      });
      pathBar.querySelector(".mdv-pathbar-close").addEventListener("click", hidePathBar);
      pathBar.hidden = false;
      openBtn.focus(); // 回车即可触发
    }
    document.addEventListener("paste", function (e) {
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      var info = parsePastedPath(e.clipboardData && e.clipboardData.getData("text"));
      if (!info) return;
      e.preventDefault();
      // 已授权根目录且路径在其内：粘贴即开；否则出提示条
      tryOpenByRoot(info, false).then(function (ok) {
        if (!ok) showPathBar(info);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && pathBar && !pathBar.hidden) hidePathBar();
    });

    document.getElementById("mdv-open-btn").addEventListener("click", pick);
    document.getElementById("mdv-landing-open").addEventListener("click", pick);

    var refreshBtn = document.getElementById("mdv-refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", refreshActive);

    // 编辑模式：编辑/预览切换 + 保存 + 另存为
    var editBtn = document.getElementById("mdv-edit-btn");
    if (editBtn) editBtn.addEventListener("click", toggleEdit);
    var saveBtn = document.getElementById("mdv-save-btn");
    if (saveBtn) saveBtn.addEventListener("click", saveDoc);
    var saveAsBtn = document.getElementById("mdv-saveas-btn");
    if (saveAsBtn) saveAsBtn.addEventListener("click", saveAsDoc);
    var editorInput = document.getElementById("mdv-editor-input");
    if (editorInput) {
      editorInput.addEventListener("input", onEditorInput);
      editorInput.addEventListener("scroll", function () {
        syncFrom(editorInput);
      });
      var previewEl = document.getElementById("mdv-content");
      previewEl.addEventListener("scroll", function () {
        syncFrom(previewEl);
      });
      // 图片/图表加载会撑开预览高度，需重算锚点
      previewEl.addEventListener("load", scheduleSyncRebuild, true);
      window.addEventListener("resize", function () {
        if (editMode) scheduleSyncRebuild();
      });
      // 编辑器内 Tab 键插入缩进而非跳出
      editorInput.addEventListener("keydown", function (e) {
        if (e.key === "Tab") {
          e.preventDefault();
          var s = editorInput.selectionStart,
            en = editorInput.selectionEnd;
          editorInput.value = editorInput.value.slice(0, s) + "  " + editorInput.value.slice(en);
          editorInput.selectionStart = editorInput.selectionEnd = s + 2;
          onEditorInput();
        }
      });
    }
    // Ctrl/Cmd+S 保存当前 markdown
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        if (canEditActive()) {
          e.preventDefault();
          saveDoc();
        }
      }
    });

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

    var presentBtn = document.getElementById("mdv-present-btn");
    if (presentBtn) presentBtn.addEventListener("click", openPresentation);
    var findBtn = document.getElementById("mdv-find-btn");
    if (findBtn) findBtn.addEventListener("click", openFind);
    var pdfBtn = document.getElementById("mdv-export-pdf-btn");
    if (pdfBtn) pdfBtn.addEventListener("click", exportPDF);
    var htmlBtn = document.getElementById("mdv-export-html-btn");
    if (htmlBtn) htmlBtn.addEventListener("click", exportHTML);

    // Ctrl/Cmd+F 接管为站内搜索（仅 markdown；pdf/html 交回浏览器原生查找）
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        if (!document.getElementById("mdv-layout").hidden && activeKind() === "markdown") {
          e.preventDefault();
          openFind();
        }
      }
    });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      });
    }
  }

  boot();

  // Hooks for host pages (e.g. the Chrome extension viewer / filemanager.js) to feed documents in.
  window.MarkdownShow = {
    addDoc: addDoc,
    showError: showError,
    refreshActive: refreshActive,
    loadHandle: loadHandle,
  };
})();
