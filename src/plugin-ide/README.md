# 通用 AI 辅助插件开发工作台（AI-first Plugin Workbench）

> 一句话描述你想做的插件 → AI 识别目标宿主（未知宿主自动扩展适配器）→ 生成可编辑方案 → 生成项目、构建、失败自动修复（步骤可见）→ 对话迭代 → 打包并 dry-run 发布。每次 AI 写盘前自动建检查点，可一键撤销。产品诊断与路线图见 [docs/product-review.md](docs/product-review.md)。

## 1.3.0 要点（本轮）
- **环境检测**：侧边栏「环境检测」页会扫描本机已安装的宿主软件（Windows 读注册表 / App Paths / 安装目录 / PATH，macOS 和 Linux 同样支持），列出版本和路径；厂商库中已安装的宿主会标注「本机已安装」。
- **一键安装并打开测试**：打包后，可以直接把插件装进检测到的宿主并启动它（VS Code / Chrome / Edge / Blender / Office / Adobe / Maya / C4D / Autodesk / Obsidian）；有实时步骤、可取消、可卸载/清理；不支持的宿主会给出手动步骤。
- 详见 `docs/host-env-install.md`；截图见 `screenshots/v1.3/`；单元测试 `tests/hosts.unit.js`；e2e 共 28 条。

## 1.2.0 要点

- 离线演示横幅 + 「连接 AI 模型」向导（DeepSeek / 通义千问 / Kimi / 智谱 / OpenAI / Ollama）与真实「测试连接」
- 打包后「如何安装到 XXX」中文步骤、打开产物文件夹、复制路径、VS Code 一键安装（需 code 命令）
- 发布演练结果解释真实上架所需账号/命令；方案页白话 + 技术细节折叠；意图卡片去英文标识
- 快照文件级对比 + 单文件恢复；项目资料（粘贴文字/网址）注入 AI 提示词
- `npm run setup` 校验内嵌编辑器完整性（缺 out/server-main.js 自动重下）

## 1.1.0 要点
- 官方工具链 best-effort（vsce / web-ext / office-addin-manifest / blender）；缺失时跳过并提示
- 设置「自动应用 AI 改动」；关闭后 Agent 逐步 diff 确认
- Agent 任务 SSE 流式日志 + 取消
- 更完整的离线 Mock（VS Code / Chrome / Blender / Office）
- 聊天状态折叠为活动时间线；代码页主题同步与加载重试
- 首项目上手清单；Windows/Linux 安装包版本 1.1.0

## AI-first 主流程（首页）

1. **描述**：在首页「描述你想做的插件」输入框里写需求，或者点击示例。
2. **识别宿主**：按名称/别名匹配 715 个宿主并给出候选；描述中用引号点名、但目录里没有的宿主（如「Acme CAD」）会标为「新宿主」，并附带适配器提案。
3. **确认方案**：项目名、概述、功能点、验收标准、自动修复上限（0–5）都可以编辑；右侧显示该宿主的清单规则、文档链接、运行/调试方法（这些知识同时会注入 AI 提示词）。
4. **执行**：准备适配器 → 脚手架 + `SPEC.md` → AI 生成 → 构建 → 失败时 AI 诊断修复并重建（最多 N 次）→ 清单校验 + AI 审查。
5. **迭代**：在结果卡片里描述改动（留空表示只做构建 + 自动修复），或者在右侧聊天中描述，然后点击「AI 迭代并构建」动作。
6. **撤销**：「撤销上次 AI 改动」，或者在「生命周期 → 检查点」中恢复到任意快照。
7. **发布**：「打包 + 发布（dry-run）」。

新增 API：`POST /api/agent/intent`、`POST /api/agent/plan`、`POST /api/agent/run`、`GET /api/agent/jobs/:id`、`POST /api/projects/:n/agent-iterate`、`GET /api/projects/:n/checkpoints`、`POST /api/projects/:n/checkpoints/:id/restore`、`GET /api/vendors/:id/knowledge`。核心代码：`src/core/agent.js`、`src/core/knowledge.js`、`ui/home.js`。

---

（以下为原有能力说明：目录、流水线与 AI 面板作为辅助界面继续保留。）


一个**独立桌面应用**（Electron），内嵌开源 Web IDE **OpenVSCode Server v1.94.2**（Gitpod，MIT）作为编辑器核心，
并在其外围集成我们自己的产品功能：700+ 厂商/宿主目录、快速脚手架、**AI 多文件开发**、**AI 调试/一键修复**、构建、打包、发布（dry-run）、版本升级/弃用。

> 它**不是**跑在现有 IDE 里的插件：应用自带后端、自带品牌化的内嵌 IDE（product.json 已改名为 *Plugin IDE*）和内置桥接扩展。

## 截图
`screenshots/01-vendor-catalog.png` 厂商目录 · `02-new-project-dialog.png` 新建项目 · `03-embedded-ide-project.png` 内嵌 IDE ·
`04-ai-dev-and-pipeline.png` AI 开发 + 流水线 · `05-ai-extend-vendor.png` AI 扩展新厂商

## 架构
```
┌──────────────────────── Electron 主进程 (electron/main.js) ─────────────────────────┐
│ 启动 → src/server/server.js (Express, 127.0.0.1:随机端口)                              │
│        ├─ REST API /api/*  ── src/core/lifecycle.js  (init/build/validate/package/…)
│        │                    ├─ registry.js + vendors.data.txt + families.js
│        │                    ├─ templates.js · ai.js（多文件/调试/聊天）· llm.js
│        └─ 子进程 vendor/openvscode-server
│ BrowserWindow → 宿主 UI (ui/)：活动栏 | 资源管理器/厂商目录/流水线/设置 | 内嵌 IDE + 快速编辑 + AI 开发预览 | AI 面板 | 终端/日志
└────────────────────────────────────────────────────────────────────────────────────┘
```
- **适配器模型**：`families.js` 定义 23 个“家族基础适配器”。`vendors.data.txt` 列出 **715+** 真实厂商/宿主。
- **生命周期**：init → AI 开发（多文件预览/应用）→ build → validate（AI 调试 + 可选一键修复）→ package → publish(dry-run) → version / deprecate。
- **AI**：`llm.js` 提供 `OpenAICompatProvider` 与离线 `MockProvider`；`ai.js` 负责多文件协议、结构化修复与聊天动作。

## AI 开发用法（完善）

### 1. AI 开发（多文件、项目感知）
1. 新建或打开某厂商项目（如 VS Code / Chrome / Blender / Office）。
2. 打开顶部 **「✨ AI 开发」** 标签，用自然语言描述需求，例如：
   - `添加一个命令和 settings 配置，并写测试`
   - `增加弹窗计数按钮与选项页`
   - `fix this error` / `修复语法错误`
3. 点击 **生成预览**：右侧/预览区展示将创建或更新的文件（清单、入口、README、测试桩等）。
4. 确认后点 **应用到磁盘**：写入工作区并刷新资源管理器；若已打开内嵌 IDE 会重新加载文件夹。
5. **快速编辑**栏的「✨ AI 开发」仍支持针对当前文件的迭代 refine（如「添加一个计数功能」），并在多文件时弹出 Diff 预览。

Mock 模式下会对 vscode / chrome / blender / office 等模板按关键词生成真实多文件；配置真实 API 后由模型按同一 `### FILE: path` 协议输出。

### 2. AI 调试
- 构建或校验失败时，流水线旁的 **AI 调试** 面板显示可操作建议。
- 若 Mock/模型给出 `### FIX:` 补丁，可点 **「应用 AI 修复」** 一键写回文件，再重新构建。
- API：`POST /api/projects/:n/ai-debug`、`POST /api/projects/:n/ai-fix`。

### 3. AI 聊天（带上下文）
聊天会附带：当前厂商、项目文件列表、选中文件、最近构建/校验结果。
模型（或 Mock）可返回动作，UI 以按钮确认后执行：
- `create_file` / `patch_file`
- `run_build` / `run_validate` / `run_package`

### 4. 提供方与设置
设置面板（或 `~/.plugin-ide/settings.json`）：
| 字段 | 说明 |
|------|------|
| provider | `mock`（离线）或 `openai`（OpenAI 兼容） |
| baseUrl | API 根路径，需含 `/v1` |
| apiKey | 密钥（环境变量亦可） |
| model | 模型名 |
| temperature | 采样温度，默认 0.2 |

环境变量仍有效：`PLUGIN_IDE_LLM_BASE_URL`、`PLUGIN_IDE_LLM_API_KEY`、`PLUGIN_IDE_LLM_MODEL`、`PLUGIN_IDE_LLM_PROVIDER`、`PLUGIN_IDE_LLM_TEMPERATURE`。

**接入示例**
```bash
# DeepSeek
# Base URL: https://api.deepseek.com/v1   Model: deepseek-chat

# OpenAI
# Base URL: https://api.openai.com/v1     Model: gpt-4o-mini

# 本地 Ollama（OpenAI 兼容，API Key 可填 ollama）
# Base URL: http://127.0.0.1:11434/v1     Model: llama3.2
export PLUGIN_IDE_LLM_BASE_URL=http://127.0.0.1:11434/v1
export PLUGIN_IDE_LLM_API_KEY=ollama
export PLUGIN_IDE_LLM_MODEL=llama3.2
```

### 相关 API
- `POST /api/projects/:n/ai-dev` — body: `{ prompt, path?, apply? }` → `{ reply, files[], code, preview }`
- `POST /api/projects/:n/ai-apply` — body: `{ files: [{ path, content }] }`
- `POST /api/projects/:n/ai-debug` / `ai-fix`
- `POST /api/ai/chat` — body: `{ messages, context: { project, selectedFile } }` → `{ reply, actions[] }`

## 运行
```bash
npm install
npm run setup            # 下载并品牌化 OpenVSCode Server
npm start                # 桌面应用
npm run web              # 仅后端 http://127.0.0.1:7788
npm run test:unit        # AI 单元测试（无需 GUI）
npm test                 # Playwright Electron E2E（无显示器：xvfb-run -a npm test）
npm run dist:linux       # AppImage / deb
```

## 扩展
1. **加厂商**：`vendors.data.txt` 加一行。
2. **加家族**：`families.js` + `templates.js`；必要时改 `lifecycle.js` 打包分支。
3. **AI 扩展厂商**：厂商目录用自然语言生成适配器 → `~/.plugin-ide/custom-vendors.json`。

## 测试
- `tests/ai.unit.js`：多文件生成、refine、debug 一键修复、聊天动作、提供方 temperature。
- `tests/e2e.spec.js`：内嵌 IDE、厂商目录、VS Code/Chrome/Blender/Office 全流程、AI 扩展厂商、语法错误拦截、**AI 多文件应用**、**AI 调试修复**、**AI 聊天动作**。

## 已知限制
- 发布仅 dry-run；签名（ZXP/VSIX/商店）未实现。
- 构建为轻量语法/结构校验；Java/Kotlin/C#/C++ 不调用完整工具链。
- Mock AI 基于模板+关键词，复杂需求请配置真实 OpenAI 兼容 API；真实 API 需自备密钥验证。
- 内嵌 OpenVSCode 主要为 Linux/macOS；Windows 建议 WSL 或改用 code-server。
- 内嵌 IDE iframe 无连接令牌（仅 127.0.0.1）。


## Windows 打包

OpenVSCode Server 无官方 Windows 构建；Windows 安装包内嵌 **code-server**（`vendor/code-server`），Linux 仍用 OpenVSCode Server。

```bash
# 下载 Windows 版 code-server（可在 Linux 交叉准备）
PLUGIN_IDE_SETUP_TARGET=win   # 或 all
npm run setup:win

# 生成 win-unpacked + NSIS 安装包（Linux 上若 wine 不可用，用脚本回退到系统 makensis）
npm run dist:win          # electron-builder（需可用的 wine 才能走内置 NSIS）
bash scripts/build-win-nsis.sh   # 推荐：dir 包 + 本机 makensis
```

产物：`dist-app/PluginWorkbench-1.0.0-win-x64-setup.exe`、`dist-app/win-unpacked/`。
