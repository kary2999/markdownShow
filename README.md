# Markdown Show

拖拽即渲染的 Markdown 展示工具。两种用法：

1. **网页版（PWA）** — 浏览器直接打开，拖 `.md` 进去即渲染，可"装到桌面像 App 一样打开"。部署在 GitHub Pages。
2. **Chrome 扩展** — 自动接管浏览器里打开的 `.md` / `.markdown` 链接。

## 功能

- ✨ 代码高亮（highlight.js）
- 🧭 目录 TOC（点击跳转 + 滚动高亮）
- 🌓 亮/暗主题（记忆选择，默认跟随系统）
- 📊 Mermaid 图表
- 🔒 DOMPurify 清洗，防脚本注入

## 网页版（推荐）

在线访问：`https://kary2999.github.io/markdownShow/`

- 把 `.md` 文件拖到页面任意位置，或点「选择文件」
- 支持离线（Service Worker 缓存）与安装到桌面（PWA）

本地预览：

```bash
python3 -m http.server 4599
# 打开 http://localhost:4599/
```

## Chrome 扩展

见 [`extension/`](extension/)。

1. 打开 `chrome://extensions/` → 开启开发者模式
2. 「加载已解压的扩展程序」→ 选择 `extension/` 目录
3. **开启「允许访问文件网址」**（详情页里）：接管本地 `.md` 与路径读取都依赖它

能力：

- **自动接管**：打开任何 `.md/.markdown/.mdown/.mkd/.mdx` 链接（file:// 或 http(s)://）自动渲染
- **查看器页面**：点工具栏图标打开，支持
  - 粘贴本地绝对路径（如 `/Users/you/doc.md`）→ 直接展示
  - 拖拽 / 选择多个文件，Tab 切换
- 也可用 URL 直达：`viewer.html?file=/Users/you/doc.md`

## 目录结构

```
index.html / app.js / app.css   网页版（GitHub Pages 根目录）
manifest.webmanifest / sw.js     PWA 清单 + Service Worker
lib/                             第三方库（marked / DOMPurify / highlight.js / mermaid）
icons/                           图标
sample.md                        测试文档
extension/                       Chrome 扩展（独立目录，含自带 lib/icons）
```

## 技术说明

- mermaid 用 v10 UMD 单文件（v11 是 ESM 分包，无法当经典脚本用）。
- marked v12 移除了 `highlight` 选项，改为解析后 `hljs.highlightElement` 逐块高亮。
- 网页版与扩展共享同一套渲染逻辑与样式（扩展版内联在 content.js/viewer.css，网页版在 app.js/app.css）。
