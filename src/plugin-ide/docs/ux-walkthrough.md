# UI/UX 深度走查笔记

日期：2026-10-13（Asia/Shanghai）  
范围：`/workspace/plugin-ide` 宿主壳层（活动栏 / 侧栏 / 中心区 / AI 面板 / 状态栏 / 对话框）  
图标方案：**Codicons**（`@vscode/codicons`，本地打包至 `ui/assets/codicon.{css,ttf}`）

## 选型说明

- 选用 **VS Code Codicons**：与内嵌 OpenVSCode 视觉一致，适合桌面 IDE 密度。
- 通过 `@font-face` 本地加载，离线 Electron 可用；类名形如 `i.codicon.codicon-files`。
- 中文文案保留为文本标签；仅图标字形改为字体图标（不再使用 emoji / Unicode 装饰符）。

## 走查路径与结果

| 步骤 | 操作 | 结果 |
|------|------|------|
| 冷启动 | 打开应用 | 标题栏 / 活动栏 / 空状态提示 / 状态栏就绪；日志 `[ready]`，厂商 **715** |
| 厂商目录 | 搜索 Adobe、点选适配器 | 列表可读（名称 + 公司 + 类别胶囊）；详情进「适配器」页 |
| 新建项目 | Blender → `mesh-tools` | 对话框主/次按钮清晰；创建后文件列表与内嵌 IDE 切到项目目录 |
| AI 开发 | 快速编辑 + 多文件预览 | 单文件写入编辑器；多文件进「AI 开发」预览 / 应用 |
| 生命周期 | build → validate → package → publish | 顶部阶段条绿/红状态；侧栏阶段按钮带图标与英文副标 |
| AI 扩厂商 | Acme Robotics | 目录出现新项，可继续新建项目 |
| 设置 | mock / OpenAI 兼容 | 保存反馈；mock 无需 Key |
| 失败构建 | 破坏 `popup.js` 语法 | 状态栏 `data-state=fail`；AI 调试面板给出建议 / 一键修复 |

## 发现的问题与修复

1. **文字/emoji 图标遍布活动栏、按钮、列表、状态栏**  
   → 全面替换为 Codicons；状态栏成功/失败改为 `data-state` + `codicon-pass/error`（`::before` 字形不进入 `textContent`，E2E 改断言）。

2. **空状态缺失**（无项目 / 无文件 / 无厂商匹配 / 未选适配器）  
   → 增加虚线提示框与中文说明。

3. **流水线按钮像普通蓝按钮，层次不清**  
   → 改为 IDE 风 `btn-stage`（图标 + 中文主标 + 英文副标）；运行中高亮；危险操作「弃用」独立样式。

4. **对话框偏「网页表单」**  
   → 统一圆角、遮罩、主/次按钮、标题图标；新建项目支持必填与命名规则提示。

5. **焦点 / 命中区域偏小**  
   → 活动栏 48×48；常规按钮 `min-height: 28px`；输入框 focus 描边用强调色。

6. **与并行 AI 面板改动冲突**  
   → 合并保留：`#tab-aidev`、`#debug-panel`、`#dlg-ai-preview`、`#chat-actions`、temperature 设置及对应 API 调用；仅替换图标与壳层样式。

7. **截图脚本在内嵌 IDE 偶发超时**  
   → 等待 monaco 失败时继续截图，避免整流程中断（OpenVSCode 本身 HTTP 正常）。

## 截图清单

路径：`/workspace/plugin-ide/screenshots/`

1. `01-cold-start-explorer.png` — 冷启动空状态  
2. `02-vendor-catalog-search.png` — 厂商搜索  
3. `03-adapter-detail.png` — 适配器详情  
4. `04-new-project-dialog.png` — 新建项目对话框  
5. `05-embedded-ide-project.png` — 创建后内嵌 IDE  
6. `06-ai-dev-and-chat.png` — AI 开发与聊天  
7. `07-ai-multifile-preview.png` — 多文件预览  
8. `08-pipeline-success.png` — 流水线成功态  
9. `09-ai-extend-vendor.png` — AI 扩展厂商  
10. `10-settings-llm.png` — LLM 设置  
11. `11-broken-build-ai-debug.png` — 构建失败 + AI 调试  

## 测试

```text
xvfb-run -a npm test
→ 11 passed
```

## 主要改动文件

- `ui/assets/codicon.css` / `ui/assets/codicon.ttf` — 本地图标字体  
- `ui/index.html` — 结构、空状态、Codicons、对话框  
- `ui/style.css` — IDE 密度主题、阶段条、按钮、状态栏  
- `ui/app.js` — 图标渲染、空状态同步、阶段状态、保留 AI 逻辑  
- `tests/e2e.spec.js` — 状态栏 / Codicon 断言  
- `scripts/screenshots.js` — 全流程 11 张截图  
- `electron/main.js` — 启动闪屏去掉文字图标  
- `package.json` — 依赖 `@vscode/codicons`  

## 前后对照（示例）

| 位置 | Before | After |
|------|--------|-------|
| 活动栏 | 📁 🧩 🚀 ⚙️ | `codicon-files` / `library` / `rocket` / `settings-gear` |
| 构建按钮 | 🔨 构建 Build | `codicon-tools` + 构建 / Build |
| 状态成功 | 文本 `✔ build` | `<i class="codicon-pass">` + `data-state=ok` |
| 项目列表 | 🔌 / ⛔ 前缀 | `codicon-plug` / `circle-slash` |
| Logo | ◆ | `codicon-extensions` |

## 已知遗留（未阻塞）

- 内嵌 OpenVSCode 冷启动在高负载下偶发 >45s；宿主壳层与 E2E 在清理残留进程后稳定。  
- 侧栏 JSON 元数据仍偏「开发者原始视图」，后续可做成键值卡片。  
- 终端/日志面板高度固定 200px，暂无拖拽分隔条。

## 2026-10 更新：AI-first 改版

- 默认首页改为「首页 · AI 创建」（活动栏新增 home 图标），内容包括输入框、示例、5 步进度、最近项目、上手指南。
- 新截图：`screenshots/00-home-ai-first.png`、`00a-ai-intent-vendor-match.png`、`00b-ai-plan-editable.png`、`00c-ai-agent-steps.png`、`00d-unknown-host-autofix-loop.png`、`00e-checkpoints-undo.png`。
- 目录、生命周期、AI 开发 Tab 保留为辅助界面；生命周期页新增「检查点 / 撤销 AI 改动」。
