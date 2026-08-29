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
    function runSearch(q) {
      var c = content();
      clearFindMarks(c);
      hits = [];
      pos = -1;
      if (!q) {
        countEl.textContent = "";
        return;
      }
      var walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          var p = node.parentNode;
          // 跳过代码块/SVG/已有 mark，保护高亮与图表
          while (p && p !== c) {
            var t = p.tagName;
            if (t === "PRE" || t === "CODE" || t === "SVG" || t === "MARK")
              return NodeFilter.FILTER_REJECT;
            p = p.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      var ql = q.toLowerCase();
      var textNodes = [];
      var n;
      while ((n = walker.nextNode())) textNodes.push(n);
      textNodes.forEach(function (node) {
        var val = node.nodeValue;
        var lower = val.toLowerCase();
        var i = lower.indexOf(ql);
        if (i < 0) return;
        var frag = document.createDocumentFragment();
        var last = 0;
        while (i >= 0) {
          if (i > last) frag.appendChild(document.createTextNode(val.slice(last, i)));
          var mark = document.createElement("mark");
          mark.className = "mdv-hit";
          mark.textContent = val.slice(i, i + q.length);
          frag.appendChild(mark);
          hits.push(mark);
          last = i + q.length;
          i = lower.indexOf(ql, last);
        }
        if (last < val.length)
          frag.appendChild(document.createTextNode(val.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
      if (hits.length) go(0);
      else countEl.textContent = "0/0";
    }
    function go(i) {
      if (!hits.length) return;
      if (pos >= 0 && hits[pos]) hits[pos].classList.remove("mdv-hit-active");
      pos = (i + hits.length) % hits.length;
      var cur = hits[pos];
      cur.classList.add("mdv-hit-active");
      cur.scrollIntoView({ behavior: "smooth", block: "center" });
      countEl.textContent = pos + 1 + "/" + hits.length;
    }
    bar._open = function () {
      bar.hidden = false;
      input.focus();
      input.select();
      if (input.value) runSearch(input.value);
    };
    function close() {
      bar.hidden = true;
      clearFindMarks(content());
      hits = [];
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
    ensureFindBar()._open();
  }

  // ---- 6. 导出 PDF / HTML ----------------------------------------------------
  function exportPDF() {
    if (document.getElementById("mdv-layout").hidden) return;
    window.print();
  }
  function exportHTML() {
    var content = document.getElementById("mdv-content");
    if (!content || document.getElementById("mdv-layout").hidden) return;
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

    var presentBtn = document.getElementById("mdv-present-btn");
    if (presentBtn) presentBtn.addEventListener("click", openPresentation);
    var findBtn = document.getElementById("mdv-find-btn");
    if (findBtn) findBtn.addEventListener("click", openFind);
    var pdfBtn = document.getElementById("mdv-export-pdf-btn");
    if (pdfBtn) pdfBtn.addEventListener("click", exportPDF);
    var htmlBtn = document.getElementById("mdv-export-html-btn");
    if (htmlBtn) htmlBtn.addEventListener("click", exportHTML);

    // Ctrl/Cmd+F 接管为站内搜索
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        if (!document.getElementById("mdv-layout").hidden) {
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
