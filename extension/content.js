/* Markdown Viewer content script.
 * Runs on *.md / *.markdown URLs. Detects raw-markdown pages, renders them,
 * and also accepts drag-and-drop of local .md files onto any matched page. */
(function () {
  "use strict";

  // ---- guard: only take over pages that are actually raw markdown ----------
  // Chrome shows a plain-text file as <body><pre>...</pre> (or bare text).
  // If the page is real HTML, we must not clobber it.
  function extractRawMarkdown() {
    var body = document.body;
    if (!body) return null;
    var pre = body.querySelector("pre");
    // Typical plain-text render: exactly one <pre> holding everything.
    if (pre && body.children.length === 1 && body.firstElementChild === pre) {
      return pre.textContent;
    }
    // Bare text nodes only (no element children) → treat as raw.
    if (body.children.length === 0 && body.textContent.trim().length > 0) {
      return body.textContent;
    }
    return null; // looks like a real HTML document; leave it alone.
  }

  // ---- library configuration ------------------------------------------------
  marked.setOptions({ gfm: true, breaks: false });

  // marked v12 dropped the built-in `highlight` option, so highlight after parse.
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
        /* leave as plain text */
      }
    });
  }

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
      /* mermaid failed to load; ignore */
    }
  }

  // ---- theme ----------------------------------------------------------------
  var THEME_KEY = "mdviewer-theme";
  function getTheme() {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-mdviewer-theme", theme);
    var light = document.getElementById("mdv-hljs-light");
    var dark = document.getElementById("mdv-hljs-dark");
    if (light) light.disabled = theme === "dark";
    if (dark) dark.disabled = theme !== "dark";
    if (mermaidReady) initMermaid(theme === "dark");
  }

  function injectHljsThemes() {
    [
      ["mdv-hljs-light", "lib/hljs-light.css"],
      ["mdv-hljs-dark", "lib/hljs-dark.css"],
    ].forEach(function (pair) {
      if (document.getElementById(pair[0])) return;
      var link = document.createElement("link");
      link.id = pair[0];
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL(pair[1]);
      document.head.appendChild(link);
    });
  }

  // ---- rendering ------------------------------------------------------------
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

  function render(markdownText) {
    var dirtyHtml = marked.parse(markdownText);
    var cleanHtml = DOMPurify.sanitize(dirtyHtml, {
      ADD_TAGS: ["foreignObject"],
      ADD_ATTR: ["target"],
    });

    document.body.innerHTML =
      '<div id="mdv-toolbar">' +
      '<button id="mdv-theme-btn" title="切换主题">🌓</button>' +
      "</div>" +
      '<div id="mdv-layout">' +
      '<nav id="mdv-toc" aria-label="目录"></nav>' +
      '<main id="mdv-content" class="markdown-body"></main>' +
      "</div>";

    var content = document.getElementById("mdv-content");
    content.innerHTML = cleanHtml;

    buildToc(content);
    highlightCodeBlocks(content);
    renderMermaid(content);
    setupExternalLinks(content);

    document
      .getElementById("mdv-theme-btn")
      .addEventListener("click", function () {
        var next =
          document.documentElement.getAttribute("data-mdviewer-theme") ===
          "dark"
            ? "light"
            : "dark";
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
      });

    applyTheme(getTheme());
  }

  function buildToc(content) {
    var toc = document.getElementById("mdv-toc");
    var heads = content.querySelectorAll("h1, h2, h3, h4, h5, h6");
    if (heads.length < 2) {
      toc.style.display = "none";
      document.getElementById("mdv-layout").classList.add("mdv-no-toc");
      return;
    }
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
            Object.values(links).forEach(function (l) {
              l.classList.remove("mdv-active");
            });
            var link = links[en.target.id];
            if (link) link.classList.add("mdv-active");
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
    var blocks = content.querySelectorAll(
      "pre > code.language-mermaid, code.language-mermaid"
    );
    if (!blocks.length) return;
    if (!mermaidReady) initMermaid(getTheme() === "dark");
    if (!mermaidReady) return;
    var i = 0;
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
      /* ignore render failure */
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

  // ---- drag & drop ----------------------------------------------------------
  function setupDropZone() {
    var overlay = document.createElement("div");
    overlay.id = "mdv-drop-overlay";
    overlay.textContent = "松开以渲染 Markdown 文件";
    document.body.appendChild(overlay);

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
      var file = e.dataTransfer && e.dataTransfer.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        document.title = file.name;
        injectHljsThemes();
        render(String(reader.result));
      };
      reader.readAsText(file);
    });
  }

  // ---- boot -----------------------------------------------------------------
  function boot() {
    injectHljsThemes();
    var raw = extractRawMarkdown();
    if (raw !== null) {
      render(raw);
    }
    // Drop zone always available so users can drag .md into any matched tab
    // even when the page wasn't auto-taken-over.
    setupDropZone();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
