/* Markdown Show — standalone web app.
 * Drag a .md file (or pick one) and render it in-browser. PWA-installable. */
(function () {
  "use strict";

  marked.setOptions({ gfm: true, breaks: false });

  // ---- theme ----------------------------------------------------------------
  var THEME_KEY = "mdviewer-theme";
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
      if (code.classList.contains("language-mermaid")) return;
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

  // ---- main render ----------------------------------------------------------
  function render(markdownText) {
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
    window.scrollTo(0, 0);
  }

  function loadFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      document.title = file.name + " · Markdown Show";
      render(String(reader.result));
    };
    reader.readAsText(file);
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
      loadFile(e.dataTransfer && e.dataTransfer.files[0]);
    });
  }

  // ---- boot -----------------------------------------------------------------
  function boot() {
    applyTheme(getTheme());
    setupDropZone();

    var input = document.getElementById("mdv-file-input");
    input.addEventListener("change", function () {
      loadFile(input.files[0]);
    });
    function pick() {
      input.click();
    }
    document.getElementById("mdv-open-btn").addEventListener("click", pick);
    document.getElementById("mdv-landing-open").addEventListener("click", pick);

    document.getElementById("mdv-theme-btn").addEventListener("click", function () {
      var next =
        document.documentElement.getAttribute("data-mdviewer-theme") === "dark"
          ? "light"
          : "dark";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      });
    }
  }

  boot();
})();
