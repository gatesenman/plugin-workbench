# v1.3.0 · 环境检测 + 一键「安装并打开测试」

> 用户诉求：「可以检查电脑已安装的软件环境，可以开发后一键安装打开软件去使用测试」。

## 1. 环境检测（侧边栏「环境检测」）
代码：`src/core/hosts.js`；API：`GET /api/hosts[?fresh=1]`、`GET /api/hosts/vendor-map`。结果缓存 5 分钟，「重新检测」会强制刷新。

| 平台 | 探测来源（按顺序） |
|---|---|
| Windows | ① `reg query` 读取 `HKLM`/`HKLM\WOW6432Node`/`HKCU` 下的 `...\CurrentVersion\Uninstall`（DisplayName / DisplayVersion / InstallLocation / DisplayIcon）② `App Paths`（chrome.exe、msedge.exe、EXCEL.EXE…）③ 常见安装目录，支持一层通配，多个版本时取最新（如 `%ProgramFiles%\Blender Foundation\Blender *\blender.exe`）④ `PATH`（code、cursor、blender…） |
| macOS | `/Applications`、`~/Applications` 下的 `.app`，版本取 `Info.plist` 的 `CFBundleShortVersionString` |
| Linux | `PATH` 命令与常见绝对路径；VS Code 系、Blender、浏览器会执行 `--version` 读取版本 |

覆盖 29 款宿主：VS Code / Cursor / Windsurf / VSCodium、Chrome / Chromium / Edge / Firefox、Word / Excel / PowerPoint / Outlook、Photoshop / InDesign / Premiere Pro / Illustrator / After Effects、AutoCAD / 3ds Max / Maya / Revit、Blender、Cinema 4D、Houdini、IntelliJ IDEA / PyCharm / WebStorm、Figma、Obsidian。

界面表现：
- 环境检测页：已安装数量、版本、路径、探测来源、对应的插件类型，以及「为它做插件」入口。
- 厂商库：已安装宿主的卡片上显示「本机已安装」标签，详情页会提示「打包后可一键安装测试」。
- 项目概览 → 产物卡片：显示「安装并打开测试」面板。Agent 结果页打包后也会显示同一面板。

## 2. 一键安装并打开测试
代码：`src/core/hostinstall.js`；API：`GET/POST /api/projects/:n/host-install`、`POST /api/projects/:n/host-uninstall`。
进度复用 Agent 的任务机制（`agent.startJob`）：通过 `GET /api/agent/jobs/:id/events` 以 SSE 推送步骤，取消用 `POST /api/agent/jobs/:id/cancel`，取消时会结束正在运行的子进程。
每次安装都会写入 `.pluginide.json → installs[hostKey]`，「卸载/清理」按这份记录回滚。

| 家族 | 自动安装方式 | 卸载/清理 |
|---|---|---|
| VS Code 系 | `<cli> --install-extension x.vsix --force`，再执行 `<cli> --new-window` | `--uninstall-extension publisher.name` |
| Chrome / Edge / Chromium | 在独立测试配置 `--user-data-dir=<data>/host-profiles/<项目>-<宿主>` 下启动，同时用两种方式加载扩展：`--load-extension` 和 DevTools 协议 `--remote-debugging-pipe --enable-unsafe-extension-debugging` + `Extensions.loadUnpacked`（新版 Google Chrome 已禁用 `--load-extension`，CDP 是官方替代方案）。只有拿到扩展 ID 才算成功 | 关闭测试浏览器，删除测试配置 |
| Firefox | 有 `web-ext` 时执行 `web-ext run`，否则打开 about:debugging 并给出手动步骤 | — |
| Blender | 4.2 及以上：`blender --command extension install-file -r user_default -e x.zip`；更早版本：`--background --python-expr` 调用 addon_install + addon_enable + save_userpref；然后启动 Blender | `extension remove` / addon_remove |
| Office | Windows：写入 `HKCU\Software\Microsoft\Office\16.0\WEF\Developer\<Id>=manifest.xml`（开发者旁加载）；macOS：复制到 `~/Library/Containers/com.microsoft.<App>/Data/Documents/wef`；然后启动应用 | 删除注册表值 / 文件 |
| Adobe UXP | 用 Creative Cloud 自带的 `UnifiedPluginInstallerAgent /install x.ccx` 安装；找不到这个工具或安装失败时，改为给出 UXP Developer Tool 的手动步骤 | `/remove <id>` |
| Adobe CEP | 复制到 `%APPDATA%\Adobe\CEP\extensions\<BundleId>`，并把 CSXS.9–12 的 `PlayerDebugMode` 设为 1 | 删除目录 |
| Maya / C4D / Houdini | 复制到 `<data>/host-plugins/...`，启动时通过环境变量 `MAYA_SCRIPT_PATH`/`PYTHONPATH`/`MAYA_PLUG_IN_PATH`、`g_additionalModulePath`、`HOUDINI_PATH` 注入，不改动宿主自身目录 | 删除副本 |
| AutoCAD / 3ds Max / Revit | 复制到 `%APPDATA%\Autodesk\ApplicationPlugins\<名>.bundle`（需要先自行编译出 DLL） | 删除目录 |
| Obsidian | 读取 `obsidian.json`，选最近打开的库（没有库就新建 `~/PluginWorkbench-TestVault`）；复制到 `.obsidian/plugins/<id>`，写入 `community-plugins.json`，再用 `obsidian://open` 打开 | 删除插件目录并移除启用记录 |
| Figma / JetBrains / 其它 | 不支持自动安装，显示通俗的手动步骤；按钮置灰并说明原因 | — |

未检测到宿主或还没打包时：按钮置灰，面板上直接说明原因（「这台电脑上没有检测到 Microsoft Excel」或「请先打包」），并默认展开手动步骤。

## 3. 测试
- `tests/hosts.unit.js`：模拟 Windows 注册表（Uninstall 与 App Paths 的 reg 输出）、文件系统和 PATH，覆盖多版本取最新、Office 组件判断、`(默认)` 键名；模拟 macOS 的 Info.plist；在 Linux 上造假安装（`tests/fixtures/fakehosts.js`）检测 code / blender / obsidian / maya；验证 VS Code、Blender、Obsidian、Maya 的安装与卸载、Figma 和未打包时的回退，以及取消任务。
- e2e 新增 4 条：环境检测页与厂商库标记、VS Code 一键安装与卸载（假 CLI，校验实际参数）、Excel 手动回退、**真实 Google Chrome 155**（独立配置 + CDP 加载，并从配置的 Preferences 文件确认扩展路径已写入）。
- 截图：`screenshots/v1.3/`。

## 4. 未在真实 Windows 上验证的部分
本轮在 Linux 上开发和测试，Windows 路径只通过注入的模拟数据验证过，实机上可能存在差异：`reg query` 的真实输出与编码（中文系统下的 `(默认)` 已覆盖）、`.cmd` 启动的引号处理、CDP 管道在 Windows 上的行为、Office 旁加载注册表键、UPIA 参数、CEP 调试模式。另外：Office 任务窗格需要本地 HTTPS（localhost:3000）；.NET / JetBrains / C++ 项目离线模式不编译，宿主不会真正加载；Blender 安装包的根目录是 `<模块名>/` 子目录，真实 Blender 4.2+ 的 `install-file` 能否接受这种结构未经实机确认。
