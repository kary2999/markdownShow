/* 宿主页入口：被 iframe 内嵌或带参数打开时，免拖拽直接载入文档。
 *  1) postMessage: {type:"mdv-open", name, text}  → 渲染该 Markdown
 *     载入完成后向 parent 回发 {type:"mdv-ready"}，宿主据此再发消息
 *  2) ?src=<url>[&name=<显示名>]                  → fetch 后渲染（需目标允许跨域）
 * 内容只经 addDoc 走原有渲染链路（marked + DOMPurify），不新增 HTML 注入面。 */
(function () {
  function open(name, text) {
    if (!window.MarkdownShow || typeof text !== "string") return;
    window.MarkdownShow.addDoc(name || "document.md", text);
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "mdv-open") return;
    open(String(d.name || "document.md"), d.text);
  });

  var q = new URLSearchParams(location.search);
  var src = q.get("src");
  if (src) {
    fetch(src)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (t) {
        open(q.get("name") || decodeURIComponent(src.split("/").pop() || "document.md"), t);
      })
      .catch(function (err) {
        if (window.MarkdownShow) window.MarkdownShow.showError("载入失败：" + err.message);
      });
  }

  if (window.parent !== window) window.parent.postMessage({ type: "mdv-ready" }, "*");
})();
