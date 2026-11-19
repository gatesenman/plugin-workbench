# 业务人员端到端走查报告 · PluginWorkbench 1.1.0

> 日期：2026-10-19（Asia/Shanghai）  
> 人格：懂业务的半技术人员「产品经理」（见 `docs/product-review.md` §2.3）  
> 环境：Linux + xvfb + Electron 开发态 + **离线 Mock LLM**（无 API Key）  
> 驱动：`scripts/biz-e2e-walkthrough.js`（真实 UI：首页自然语言 → 意图 → 轻改方案 → Agent → 迭代 → 打包 / dry-run 发布）  
> 截图：`screenshots/biz-e2e/`（47 张）  
> 产物副本：`screenshots/biz-e2e/artifacts/`  
> 机器结果：`screenshots/biz-e2e/results.json`

---

## 1. 结论（先看这个）

| 问题 | 结论 |
|------|------|
| **业务人员能否独立完成「一句话 → 可打包产物」？** | **基本能**（Mock 下主路径 5/5 通过）：不用手填厂商 ID，能改方案、看步骤、迭代、拿到 zip/vsix，并完成 dry-run 发布。 |
| **会不会以为已经能装进真实宿主？** | **半信半疑**：产物结构像真的（Chrome `manifest.json`、VS Code `.vsix`+`extension.vsixmanifest`、Excel `manifest.xml`、Blender addon 目录），但 Mock 代码是「可演示骨架 / 伪翻译 / 演示 Webhook」，**不能替代真实 LLM + 官方工具链**。 |
| **最大信任杀手（已修 / 未修）** | **已修 P0**：「做一个 VS Code 插件…发给钉钉」曾误识别成钉钉宿主，打出 zip 而非 `.vsix`。**未完全消除**：本环境内嵌代码编辑器包不完整，代码页只能看空状态（不阻断构建打包）。 |

**总判词**：作为半技术产品经理，**可以独立走完 AI-first 流水线并拿到「看起来可安装」的包**；若要「同事真能用」，必须接真实模型，并在目标宿主里实测。Mock 适合验收流程与演示，不适合验收功能正确性。

---

## 2. 走查方法（产品经理怎么用）

每条场景严格按业务习惯操作，**不选手动厂商 ID**（除非 UI 强迫）：

1. 首页输入自然语言需求 → 点「开始」  
2. 看意图候选是否「像人话」→ 点「生成方案」  
3. **像改 PRD 一样**改项目名 / 概述 / 功能点 / 验收标准  
4. 点执行，盯 Agent 步骤条直到「完成」  
5. 在迭代框再说一句改动 → 再跑一轮  
6. 「打包发布」dry-run  
7. 解压检查产物，判断非工程师会不会相信「能装」

LLM：全程 `PLUGIN_IDE_LLM_PROVIDER=mock`。

---

## 3. 场景结果一览

| # | 场景 | 意图 | Agent | 迭代 | 产物 | Mock 语义 | 结果 |
|---|------|------|-------|------|------|-----------|------|
| 1 | Chrome：选中文字一键翻译成中文 | Chrome（浏览器扩展别名） | 完成·通过 | 完成 | `biz-translate-zh-0.0.1.zip` | 翻译 popup / 右键菜单（非 Markdown 保存） | ✅ |
| 2 | VS Code：右键选中代码发钉钉群 | **Visual Studio Code**（修后） | 完成·通过 | 完成 | `biz-code-to-dingtalk-0.0.1.vsix` | webhook + 右键菜单 | ✅ |
| 3 | Excel：表格一键周报摘要 | Excel | 完成·通过 | 完成 | `biz-excel-weekly-0.0.1.zip` | `buildWeeklySummary` / 风险项 | ✅ |
| 4 | 未知宿主：『Acme 库存系统』缺货预警侧边栏 | **新宿主自动扩展** | 完成·通过（含「准备宿主适配器」） | 完成 | `biz-acme-stock-alert-0.0.1.zip`（`plugin.json` + `index.js`） | 缺货预警 / 建议补货量 | ✅ |
| 5 | Blender：一键整理场景物体命名 | Blender | 完成·通过 | 完成 | `biz-blender-rename-0.0.1.zip`（addon 目录） | 批量重命名面板 | ✅ |

**修复前**：场景 2 意图命中「钉钉」→ 打成 `.zip`，业务上等于做错产品。  
**修复后**：宿主句式加权 +「发给/发送到…」降权 → VS Code 胜出，产物为标准 `.vsix`。

---

## 4. 分场景笔记（含截图 / 产物）

### 4.1 Chrome 扩展 · 选中翻译

- 提示语：`做一个浏览器扩展，选中网页文字后一键翻译成中文`  
- 截图：`02-…-01-prompt` → `10-…-09-ship`  
- 方案轻改：项目名 `biz-translate-zh`；功能点含右键翻译、对照、设置语言  
- 产物解压可见：`manifest.json`、`popup.js`（`mockTranslateToZh`）、`background.js`（`contextMenus`「翻译成中文」）、`README.md`、`SPEC.md`  
- **业务观感**：像能「加载已解压的扩展」；README 已写明 Mock 译文需接真实翻译 API —— **诚实**，但若用户不看 README 仍可能以为翻译是真的。

### 4.2 VS Code · 发钉钉

- 提示语：`做一个 VS Code 插件，右键把选中代码发给同事钉钉群`  
- 截图：`11-…` → `19-…`  
- 产物：`.vsix` 含 `extension.vsixmanifest`、`extension/package.json`、`extension/extension.js`（webhook 校验 + 中文「未配置」提示）  
- **业务观感**：会相信「可以装进 VS Code」；真实发送依赖用户自己填 webhook，Mock 不会替你连钉钉。

### 4.3 Excel · 周报摘要

- 截图：`20-…` → `28-…`  
- 产物：`manifest.xml`、`taskpane.html/js`（「生成周报摘要」「风险项」）  
- **业务观感**：任务窗格文案是中文、像 Office 加载项；旁加载仍需 Office 环境，产品内只有 dry-run。

### 4.4 未知宿主 · Acme 库存

- 提示语含书名号 `『Acme 库存系统』` → 正确出现「（新宿主）」并自动扩展  
- 截图：`29-…` → `37-…`  
- 产物：`plugin.json` + `index.js`（缺货列表 / 建议补货）  
- **业务观感**：未知系统也能「做出一个包」很加分；但宿主是假的，**无法在 Acme 里真装**，验收只能停在「目录里多了适配器 + 包能解开」。

### 4.5 Blender · 整理命名（可选加做）

- 截图：`38-…` → `46-…`  
- 产物：`biz_blender_rename/__init__.py` + `blender_manifest.toml`  
- **业务观感**：结构符合 Blender addon zip；本机未跑 `blender --command extension validate`（工具链缺失时跳过，不阻断）。

---

## 5. 摩擦清单（按严重度）

### P0（会让业务人员做错产品 / 卡住）—— 本轮已修

| 问题 | 表现 | 处理 |
|------|------|------|
| 意图把「集成目标」当成「宿主」 | 「VS Code 插件…发给钉钉」→ 选中钉钉 → 打出 zip | `agent.scoreVendors`：宿主句式 +22/+18；「发给/发送到…」降为集成目标 | 
| 内嵌 IDE 启动失败仍下发坏 URL | 代码页 `ERR_CONNECTION_REFUSED` / 空白 | `server.start`：`waitHttp` 失败则 `ide=null`，前端展示中文空状态，引导用「文件」页 |

### P1（体验差 / 信任下降，未全部消掉）

| 问题 | 说明 |
|------|------|
| 本环境 OpenVSCode 包不完整 | 缺 `vendor/openvscode-server/out/server-main.js`，代码页不可用；**不阻断**构建打包。需在安装/setup 中补全组件。 |
| Mock 质量上限 | 翻译是规则演示、钉钉不会真发、周报是表格文本拼装；接真实 LLM 前，业务验收只能验「流程」不能验「功能」。 |
| 意图卡片仍偏技术 | 候选副标题含 `browser-ext` / `vscode-ext` 等家族 id；已去掉「家族」二字，但仍有英文 slug。 |
| 候选区文案粘连 | 截图里标题与副标有时视觉上挤在一起（`ChromeGoogle · …`），信息层级对 PM 不够友好。 |

### P2（打磨项）

| 问题 | 说明 |
|------|------|
| 方案页「清单 / 必填字段」偏工程师语言 | 有知识面板是好事，但 PM 更想看「怎么安装到 Excel」。 |
| 发布仍是 dry-run | 符合 MVP；业务人员会问「点了发布为什么商店没有」。 |
| 空最近项目时列表高度为 0 | 空状态文案在 `#recent-empty`，E2E 已改为断言空状态而非空 `ul`。 |

---

## 6. 本轮产品改动（为走查质量服务）

1. **意图匹配**：宿主句式加权 + 发送目标降权（`src/core/agent.js`）+ 单测用例  
2. **Mock 语义**：按关键词生成翻译 / 钉钉 / 周报 / 缺货预警（`src/core/ai.js`）+ 单测  
3. **IDE 健康检查**：启动失败不暴露坏 URL；代码页中文空状态（`server.js` / `ui/app.js` / `ui/index.html`）  
4. **文案**：意图候选去掉「家族」措辞（`ui/home.js`）  
5. **测试**：`tests/e2e.spec.js` 兼容 IDE 缺失；`npm test` **21 passed**；`npm run test:unit` 通过  

未做：Windows 安装包重打（按任务要求，除非修复依赖）。

---

## 7. Mock LLM 会在哪里「骗」业务用户

| 场景 | Mock 会做什么 | 业务用户可能误判 |
|------|---------------|------------------|
| 翻译扩展 | 本地规则「译文·演示」 | 以为已经能翻译网页 |
| 钉钉 | 有 webhook 配置与 HTTP POST 代码 | 以为点一下就能发到群（未配置/无真群） |
| 周报 | 用表格单元格文本拼「本周/风险/下周」 | 以为有 AI 摘要能力 |
| Acme | 生成 generic JS 侧边栏骨架 | 以为能挂进真实库存系统 |
| 任意 | 构建=语法级；官方工具链缺失则跳过 | 以为「构建通过」=「商店可上架」 |

这些在产品文案 / README 里已有部分 disclaimer，但 **首页结果页还应更醒目地写「离线演示 · 请接真实模型」**（建议记入下一轮 P1）。

---

## 8. 产物「可安装性」观感（非工程师视角）

| 产物 | 解压后关键文件 | 会不会相信能装？ |
|------|----------------|------------------|
| `biz-translate-zh-0.0.1.zip` | `manifest.json` + popup/background | 会（对过 Chrome「加载已解压」说明） |
| `biz-code-to-dingtalk-0.0.1.vsix` | `extension.vsixmanifest` + `extension/package.json` | 会（认识 .vsix） |
| `biz-excel-weekly-0.0.1.zip` | `manifest.xml` + taskpane | 半信（知道要旁加载，但没向导） |
| `biz-acme-stock-alert-0.0.1.zip` | `plugin.json` + `index.js` | 半信（没有真实宿主安装入口） |
| `biz-blender-rename-0.0.1.zip` | `…/__init__.py` + `blender_manifest.toml` | 会（像 addon zip） |

---

## 9. 回归状态

```text
npm run test:unit   → AI unit OK / agent unit OK
xvfb-run -a npm test → 21 passed
biz-e2e-walkthrough → 5/5 pass（P0=0）
```

复现走查：

```bash
cd /workspace/plugin-ide
xvfb-run -a -s "-screen 0 1440x900x24" node scripts/biz-e2e-walkthrough.js
```

---

## 10. 最终裁决

**「业务人员能否独立完成？」→ 能完成「流程闭环与可打包演示」；不能独立保证「真实宿主可用」。**

- ✅ 自然语言入口、意图（含未知宿主）、可编辑方案、Agent 可见步骤、迭代、打包、dry-run 发布 —— 半技术用户可独自走通。  
- ⚠ 功能正确性依赖真实 LLM；本机内嵌代码编辑器组件缺失时需用「文件」页。  
- ✅ 本轮堵住的最大坑：宿主 vs 集成目标误匹配（否则业务会把钉钉机器人包当成 VS Code 扩展交付）。

---

# 1.2.0 复测（2026-10-20，Asia/Shanghai）

目标：业务人员不仅能走完流程，还能**有把握地装上插件**。

## 本轮修复

| # | 问题 | 处理 | 状态 |
|---|------|------|------|
| 1 | 内嵌代码编辑器在本机缺 `out/server-main.js` | `setup-ide.sh` 增加完整性校验（`bin/` + `out/server-main.js` + `node`），残缺自动重下；`server.js` 启动前也检查 `out/server-main.js`；OpenVSCode 改用独立进程组，退出时整组结束 | ✅ 代码页可用（截图 `screenshots/v1.2/06`）|
| 2 | Mock 容易误导 | 首页 / 执行结果 / 项目页显示「离线演示模式：生成的是示例代码…」横幅 + 「连接 AI 模型」；设置页新增向导：DeepSeek、通义千问(DashScope 兼容)、Kimi、智谱 GLM、OpenAI、Ollama 本地、离线演示；「测试连接」真实发出一次最小请求，401/404/429/超时/拒绝连接都给中文说明 | ✅ |
| 3 | 不知道怎么装 | 打包后显示「如何安装到 XXX」：Chrome/Edge 加载已解压、VS Code 从 VSIX 安装、Excel 上传加载项（manifest.xml）、Blender 从磁盘安装、未知宿主通用说明；「打开产物所在文件夹」（Electron `shell.showItemInFolder`）、复制路径；VS Code 在 PATH 上有 `code` 时可一键 `code --install-extension`；Chrome 复制 `chrome://extensions`（浏览器禁止外部程序直接打开该页） | ✅ |
| 4 | 意图卡片有英文家族 slug、挤 | 副标题只留「公司 · 类别」，标题/副标题分层，理由标签截断 | ✅ |
| 5 | 方案页工程术语 | 改为白话（「最后得到 / 怎么用上 / 想给别人用」），配置文件、必填字段、规则等收进「技术细节」折叠区；表单标签改为「插件要做的事 / 怎样算做好了」 | ✅ |
| 6 | 快照只能整体恢复 | 「版本与快照」每条快照可「对比」：文件级列表（新增/修改/删除 + 行数）+ 逐行 diff；可「只恢复这个文件」（恢复前自动再存快照） | ✅ |
| 7 | 无项目资料 | 概览页「项目资料」：粘贴文字或填网址（抓取后去标签转纯文本，最多 2 万字）；注入 AI 开发 / 调试 / 聊天提示词（约 1.2 万字预算） | ✅（Mock 不读资料，接真实模型才生效）|
| 8 | 发布 dry-run 让人困惑 | 结果中解释「演练发布没有上架」，并列出所需开发者账号、商店后台链接、确切命令；内部使用无需上架的提示 | ✅ |

## 回归

```text
npm run test:unit   → AI / agent / extras(新增) 单测全部通过
xvfb-run -a npx playwright test → 24 passed（新增 3 个 v1.2 用例；内嵌编辑器已启用的情况下）
biz-e2e-walkthrough → 5/5 pass，P0=0 P1=0 P2=0
```

## 业务走查结论（1.2.0）

- 5 个场景（Chrome 翻译、VS Code→钉钉、Excel 周报、Acme 未知宿主、Blender 重命名）都能走完，并在打包后看到对应宿主的中文安装步骤。
- Mock 模式下全程有横幅提醒，「构建通过 ≠ 功能真实可用」的误判风险明显降低。

## 仍存在的差距（如实说明）

- 「测试连接」只在本机验证了失败路径（拒绝连接）；没有真实 Key，**未对任何云厂商做成功连接测试**。各厂商 Base URL / 默认模型名按公开文档预填，可能随厂商调整而变化。
- Chrome / Excel / Blender 没有真正的一键安装（受宿主安全策略限制），只能「复制路径 + 步骤」；VS Code 一键安装需要 `code` 在 PATH，本机没有，未实测成功安装。
- 内嵌编辑器打开时仍显示 VS Code「Get Started」欢迎页（已有关闭设置但对 Web 版未完全生效）。
- Windows 安装包是 Linux 交叉打包，未在真实 Windows 上运行 E2E。
- 项目资料抓网页只做简单去标签，需要登录或 JS 渲染的页面抓不到正文。

截图：`screenshots/v1.2/01–08`（首页横幅、意图卡片、白话方案、安装向导、发布说明、代码编辑器、快照对比、AI 连接向导）；复现：`xvfb-run -a node scripts/v12-screenshots.js`。
