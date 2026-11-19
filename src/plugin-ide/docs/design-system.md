# 插件工坊 设计系统（Design System）

> 目标：把产品做成独立桌面软件（参考 Linear / Notion / Raycast / 国内 SaaS 桌面端），而不是 IDE。界面安静、留白充足、层级清楚，品牌色只用在主操作和 AI 相关元素上。

## 1. 设计原则
1. **软件，而非 IDE**：去掉活动栏、密集面板、底部终端和 IDE 状态栏。代码编辑器只是项目内的「代码」子页。
2. **AI 是主角**：首页输入框、AI 助手、执行步骤都使用品牌渐变/品牌色；其他元素保持中性。
3. **中文优先**：使用 CJK 字体栈，行高 1.55（正文）/ 1.75（说明），不使用全大写或字母间距。
4. **一个变量，一个来源**：颜色、字号、间距、圆角、阴影、动效、层级全部取自 `ui/tokens.css`，组件和页面不出现硬编码色值（品牌渐变的辅色除外）。
5. **浅色默认，深色等价**：深色主题只覆盖语义变量，组件代码不需要改。

## 2. 文件结构
| 文件 | 职责 |
|---|---|
| `ui/tokens.css` | 设计变量：调色板 → 语义别名（浅色 / `[data-theme=dark]`） |
| `ui/components.css` | 组件层：按钮、表单、分段、卡片、列表、徽标、状态、步骤条、导航、弹窗、Toast、Tooltip、代码块、表格 |
| `ui/style.css` | 应用外壳与各页面布局（只引用 token 与组件） |

## 3. Tokens
### 颜色
- **品牌（Indigo）**：`--brand-50 … --brand-800`，主色 `--brand-600 #4f46e5`（深色主题用 500）。AI 标识用渐变 `brand-500 → #8b5cf6 → #ec4899`。
- **中性（Slate）**：`--n-0 … --n-950`。
- **语义别名**（组件只能使用这些）：`--bg-app / --bg-sidebar / --bg-surface / --bg-subtle / --bg-hover / --bg-active`、`--fg / --fg-strong / --fg-muted / --fg-subtle`、`--border / --border-strong / --divider`、`--accent / --accent-hover / --accent-soft / --accent-fg`。
- **状态色**：`--success / --danger / --warning / --info`，各配一个 `*-soft` 浅底色。
- **代码区**：`--code-bg / --code-fg`。

### 字体
- 无衬线：`Inter, SF Pro Text, -apple-system, Segoe UI, PingFang SC, HarmonyOS Sans SC, MiSans, Noto Sans CJK SC, Source Han Sans SC, Microsoft YaHei`
- 等宽：`JetBrains Mono, SF Mono, Menlo, Consolas, Noto Sans Mono CJK SC`
- 字号阶梯：11 / 12 / 13 / **14（正文）** / 16 / 18 / 22（页面标题）/ 28（首页主标题）
- 字重：400 / 500（控件、标签）/ 600（标题）/ 700

### 间距（4px 基准）
`--sp-1 4` · `--sp-2 8` · `--sp-3 12` · `--sp-4 16` · `--sp-5 20` · `--sp-6 24` · `--sp-8 32` · `--sp-10 40` · `--sp-12 48`。页面内边距 32，卡片内边距 20，卡片间距 16–20。

### 圆角
`--r-xs 4`（标签、提示）· `--r-sm 6`（按钮、输入框）· `--r-md 8`（候选项、步骤项）· `--r-lg 12`（卡片）· `--r-xl 16`（Hero、弹窗）· `--r-full`（Chip、徽标）

### 阴影 / 层级（Elevation）
| Token | 用途 |
|---|---|
| `--shadow-xs` | 卡片、按钮静止态 |
| `--shadow-sm` | 选中的导航项、分段选中项、主按钮 |
| `--shadow-md` | 悬停卡片、首页输入框 |
| `--shadow-lg` | 弹窗、抽屉、Toast |

### 动效
`--dur-fast 120ms`（悬停）· `--dur 180ms`（出现、切页）· `--dur-slow 280ms`（抽屉）；缓动 `--ease cubic-bezier(.2,.8,.2,1)`。页面切换、消息、步骤项统一使用 `rise` 动画（向上 6px 淡入）。

### z-index
`base 1 · sticky 10 · drawer 40 · overlay 50 · modal 60 · toast 70 · tooltip 80`

### 尺寸
侧边栏 232 · 顶栏 48 · AI 面板 340 · 控件高 34（小号 28 / 大号 42）。窗口默认 1280×800，最小 1100×700。

## 4. 组件
| 组件 | 类名 | 说明 |
|---|---|---|
| 按钮 | `.btn` + `.btn-primary / .btn-secondary / .btn-ghost / .btn-danger`，尺寸 `.btn-sm / .btn-lg`，`.btn-block / .btn-icon` | 每个区域最多一个主按钮；危险操作用 `.btn-danger`（红字，悬停时浅红底） |
| 图标按钮 | `.icon-btn`（可加 `data-tip` 提示） | 顶栏工具 |
| 输入 | `.input / .textarea / .select`，字段 `.field`，行 `.input-row`，搜索 `.search` | 聚焦时显示品牌色描边 + 3px 光环 |
| 分段 / Tabs | `.segmented > button.on` | 项目子页、主题切换 |
| 卡片 | `.card > h3` | 标题图标用品牌色，标题右侧可以放徽标或按钮 |
| 列表项 | `.list li / .li-body / .li-title / small` | 悬停 `--bg-hover`，选中 `--bg-active` |
| 徽标 / 标签 | `.badge`（`data-state=ok/fail/running`）、`.tag-ok/.tag-fail/.tag-warn/.tag-brand`、`.chip` | Chip 用于示例需求 |
| Toast | `toast(msg, 'ok'|'err'|'info')` | 右下角显示，3.2 秒后消失；`[error]` 日志会自动弹出 |
| 弹窗 | 原生 `<dialog>` | 圆角 16，背景模糊遮罩 |
| 抽屉 | `.drawer.open` | 活动记录（原底部日志） |
| 状态 | `.empty-state`、`.error-state`、`.skeleton`、`.spin` | 空状态：图标 + 一句标题 + 一句引导 |
| 步骤条 | `.stepper > .stage.ok/.fail/.run`、`.flow-steps li.cur/.done/.bad`、`.progress` | 生命周期与 AI 流程 |
| 导航项 | `.nav-section`、`.nav-item.on`、`.nav-sub`、`.nav-count` | 侧边栏 |
| Tooltip | `[data-tip]` | 纯 CSS |
| 代码块 / 表格 | `.code-block`、`.table` | 发布中心表格 |

## 5. 应用外壳与信息架构
```
┌ 侧边栏 232 ─────┬ 顶栏 48（无边框拖拽区 · 状态 · 活动记录 · AI · 主题 · 窗口按钮）┐
│ 品牌 / 新建插件 │ 页面内容（max 1120，居中，留白 32）           │ AI 助手 340 │
│ 工作台：首页、我的项目(当前项目) │                                │（可收起）   │
│ 资源：厂商库、发布中心           │                                │             │
│ 系统：设置                       │                                │             │
└─────────────────────────────────┴────────────────────────────────┴─────────────┘
```
- **首页**：Hero 输入框 → 识别宿主 → 方案 → 执行步骤 → 最近项目 / 上手指南。
- **我的项目**：项目卡片网格（每张卡片带生命周期进度小条）。
- **项目详情**：页面头部（名称、宿主、版本 + 构建/校验/打包/发布按钮）→ 生命周期步骤条 → 分段子页：概览 / AI 开发 / 文件 / 代码（内嵌 OpenVSCode）/ 版本与快照。AI 助手在项目页默认展开。
- **厂商库**：搜索 + 类别筛选 + 卡片网格；右侧固定显示适配器详情、开发知识、AI 扩展。
- **发布中心**：统计卡片 + 产物/发布表格，每行可以一键「打包发布」。
- **设置**：AI 提供方表单 + 外观（浅色 / 深色）。

## 6. 窗口
- 默认使用无边框窗口：顶栏和侧边栏是拖拽区，右上角是自绘的最小化 / 最大化 / 关闭按钮（`electron/preload.js` 通过 IPC 实现）。设置 `PLUGIN_IDE_FRAME=1` 可恢复系统边框。
- 默认 1280×800，最小 1100×700。内容区用 container query 自适应：宽度 ≤ 860 时双栏变单栏。

## 7. 使用约定
- 新组件先补 token，再写组件类；页面样式只负责布局。
- 不要使用 `#xxxxxx` 硬编码颜色；需要半透明时用 `color-mix(in srgb, var(--accent) N%, transparent)`。
- 图标统一使用 Codicons（`<i class="codicon codicon-*">`），尺寸 14–18，颜色继承或取 `--fg-muted / --accent`。

## 1.1.0 UI notes
- Confirm bar（Agent 暂停写盘）使用与 diff 预览一致的文件 chip + 主/次按钮，避免打断软件化外壳。
- 聊天「活动时间线」用 muted 紧凑条，状态刷屏不再变成气泡。
- 代码 iframe 加载态保留重试按钮；主题切换会 POST `/api/ide/theme` 并强制刷新 iframe。
