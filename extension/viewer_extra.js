/* Extension viewer extras: load a markdown file from a pasted local path.
 * Requires "允许访问文件网址" (Allow access to file URLs) for file:// fetch. */
(function () {
  "use strict";

  function pathToFileUrl(p) {
    p = p.trim().replace(/^["']|["']$/g, ""); // strip pasted quotes
    if (!p) return null;
    if (/^file:\/\//i.test(p)) return p;
    if (p[0] !== "/") return null; // require absolute path
    // encode each segment but keep slashes
    return (
      "file://" +
      p
        .split("/")
        .map(function (seg) {
          return encodeURIComponent(seg);
        })
        .join("/")
    );
  }

  function baseName(p) {
    var parts = p.replace(/[?#].*$/, "").split("/");
    return decodeURIComponent(parts[parts.length - 1] || "untitled.md");
  }

  function loadPath(rawPath) {
    var url = pathToFileUrl(rawPath);
    if (!url) {
      window.MarkdownShow.showError("请输入以 / 开头的绝对路径，例如 /Users/you/doc.md");
      return;
    }
    function fetchText() {
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      });
    }
    fetchText()
      .then(function (text) {
        // reload 直接重新 fetch 本地路径 → 点「刷新」即可看到磁盘最新内容
        window.MarkdownShow.addDoc(baseName(url), text, fetchText);
      })
      .catch(function (e) {
        window.MarkdownShow.showError(
          "读取失败：" +
            (e && e.message ? e.message : e) +
            "。请确认路径存在，且已在扩展详情页开启「允许访问文件网址」。"
        );
      });
  }

  var input = document.getElementById("mdv-path-input");
  var go = document.getElementById("mdv-path-go");
  go.addEventListener("click", function () {
    loadPath(input.value);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") loadPath(input.value);
  });

  // Support viewer.html?file=<encoded file:// url or absolute path>
  var params = new URLSearchParams(location.search);
  var f = params.get("file");
  if (f) {
    input.value = f;
    loadPath(f);
  }
})();
