// 按家族/厂商的开发知识：文档链接、清单规则、运行/预览/调试指南 —— 注入到 AI 提示词并展示给用户
const K = {
  'vscode-ext': {
    docs: [['Extension API', 'https://code.visualstudio.com/api'], ['Extension Manifest', 'https://code.visualstudio.com/api/references/extension-manifest'], ['发布扩展', 'https://code.visualstudio.com/api/working-with-extensions/publishing-extension']],
    rules: ['package.json 必须包含 name/version/publisher/engines.vscode/main', 'contributes.commands 中的每个 command 必须在 activate() 中 registerCommand', 'VS Code 1.74+ 可省略 activationEvents（由 contributes 推断）', 'main 指向的入口必须导出 activate/deactivate'],
    run: ['在内嵌 IDE 中打开项目，按 F5「运行扩展」启动 Extension Development Host', '命令面板 (Ctrl+Shift+P) 搜索插件命令进行验证'],
    debug: ['在 extension.js 设置断点，F5 后断点在 Extension Host 生效', '「帮助 → 切换开发人员工具」查看扩展宿主日志'],
  },
  'browser-ext': {
    docs: [['Chrome Extensions', 'https://developer.chrome.com/docs/extensions'], ['Manifest V3', 'https://developer.chrome.com/docs/extensions/reference/manifest'], ['Firefox Extension Workshop', 'https://extensionworkshop.com']],
    rules: ['manifest_version 必须为 3', 'background 使用 service_worker，不可使用持久后台页', '最小化 permissions；访问页面用 activeTab + scripting', 'MV3 禁止远程代码与内联脚本（CSP）'],
    run: ['chrome://extensions → 打开「开发者模式」→「加载已解压的扩展程序」选择 build/ 目录', 'Firefox：about:debugging → 临时载入附加组件'],
    debug: ['扩展卡片上「Service Worker」链接打开后台调试器', '在弹窗上右键「检查」调试 popup'],
  },
  'blender': {
    docs: [['Blender Extensions', 'https://docs.blender.org/manual/en/latest/advanced/extensions/'], ['bpy API', 'https://docs.blender.org/api/current/']],
    rules: ['blender_manifest.toml 必须包含 schema_version/id/version/name/blender_version_min/type/license', 'Operator 的 bl_idname 必须为 "category.name" 小写格式', 'register()/unregister() 必须成对注册/注销所有类'],
    run: ['Blender → 编辑 → 偏好设置 → 获取扩展 → 从磁盘安装，选择打包后的 zip', '或命令行：blender --command extension build'],
    debug: ['从终端启动 Blender 以查看 print 输出', '使用 Python 控制台与「信息」编辑器查看报错'],
  },
  'office-addin': {
    docs: [['Office 加载项', 'https://learn.microsoft.com/office/dev/add-ins/'], ['清单参考', 'https://learn.microsoft.com/office/dev/add-ins/develop/add-in-manifests']],
    rules: ['manifest.xml 必须包含 Id(GUID)/Version(四段)/ProviderName/DisplayName/Hosts/SourceLocation', 'SourceLocation 必须为 HTTPS', '调用 Office API 前必须等待 Office.onReady'],
    run: ['npx office-addin-dev-certs install 安装本地 HTTPS 证书，并在 3000 端口托管', 'npx office-addin-debugging start manifest.xml 旁加载'],
    debug: ['Windows 使用 Edge DevTools 附加到任务窗格；Office 网页版直接 F12'],
  },
  'adobe-uxp': {
    docs: [['UXP for Photoshop', 'https://developer.adobe.com/photoshop/uxp/'], ['UXP Developer Tool', 'https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/']],
    rules: ['manifest.json 需 manifestVersion 5、id、name、version、host.app、entrypoints', 'host.minVersion 需与目标应用版本匹配'],
    run: ['用 UXP Developer Tool「Add Plugin」选择 manifest.json 并 Load'], debug: ['UDT 中点击 Debug 打开 DevTools'],
  },
  'adobe-cep': { docs: [['CEP Resources', 'https://github.com/Adobe-CEP/CEP-Resources']], rules: ['CSXS/manifest.xml 需 ExtensionBundleId/ExtensionBundleVersion', '发布前需 ZXPSignCmd 签名'], run: ['开启 PlayerDebugMode 后放入 extensions 目录'], debug: ['.debug 文件配置远程调试端口，Chrome 访问 localhost:端口'] },
  'design-plugin': { docs: [['Figma Plugin Docs', 'https://www.figma.com/plugin-docs/']], rules: ['manifest.json 需 name/id/api/main，若有 UI 需 ui 字段', '插件沙箱无 DOM，UI 在 iframe 中，通过 postMessage 通信'], run: ['Figma 桌面版 → 插件 → 开发 → 从清单导入'], debug: ['插件 → 开发 → 打开控制台'] },
  'notes-plugin': { docs: [['Obsidian Developer Docs', 'https://docs.obsidian.md']], rules: ['manifest.json 需 id/name/version/minAppVersion', 'main.js 导出继承 Plugin 的类，实现 onload/onunload'], run: ['复制 main.js + manifest.json 到 <库>/.obsidian/plugins/<id>/ 后在设置中启用'], debug: ['Ctrl+Shift+I 打开开发者工具'] },
  'python-dcc': { docs: [], rules: ['plugin.json 需 name/version/host', 'Python 入口需可被宿主内嵌解释器导入（避免依赖未安装的第三方包）'], run: ['在宿主的脚本编辑器/插件管理器中加载 main.py'], debug: ['使用宿主脚本控制台查看 traceback；可配置 debugpy 远程调试'] },
  'ai-agent': { docs: [['Model Context Protocol', 'https://modelcontextprotocol.io']], rules: ['必须实现 initialize / tools/list / tools/call', 'stdout 只能输出 JSON-RPC 消息，日志写 stderr'], run: ['在 MCP 客户端配置 { "command": "node", "args": ["server.js"] }', '用 npx @modelcontextprotocol/inspector node server.js 交互测试'], debug: ['用 Inspector 查看请求/响应；日志写到 stderr'] },
  'saas-app': { docs: [], rules: ['app.json 需 name/version/scopes，scopes 最小化', 'Webhook 必须校验平台签名'], run: ['node index.js 本地启动，用隧道(ngrok/cloudflared)暴露给平台'], debug: ['在平台开发者后台查看事件投递日志'] },
  'chat-bot': { docs: [], rules: ['app.json 需 name/version/scopes', '事件回调需在 3 秒内响应，耗时任务异步处理'], run: ['本地启动后在平台开发者后台配置事件订阅 URL'], debug: ['查看平台事件日志与本地请求日志'] },
  'jetbrains': { docs: [['IntelliJ Platform SDK', 'https://plugins.jetbrains.com/docs/intellij/']], rules: ['plugin.xml 需 <id>/<name>/<vendor>，并声明 <depends>', 'Action 需在 plugin.xml <actions> 中注册'], run: ['gradle runIde 启动沙箱 IDE'], debug: ['gradle runIde 以 Debug 模式运行，在 IDE 中附加'] },
  'dotnet-addin': { docs: [['Autodesk APS', 'https://aps.autodesk.com/']], rules: ['PackageContents.xml 需 ApplicationPackage/Name/AppVersion', '目标框架需与宿主版本匹配（Revit 2025+ 为 .NET 8）'], run: ['dotnet build 后将 .bundle 复制到 ApplicationPlugins 目录'], debug: ['Visual Studio 附加到宿主进程'] },
  'cms-plugin': { docs: [['WordPress Plugin Handbook', 'https://developer.wordpress.org/plugins/']], rules: ['主文件头部注释需包含 Plugin Name 与 Version', '文件开头检查 ABSPATH 防止直接访问', '输出需转义 (esc_html 等)'], run: ['将目录放入 wp-content/plugins 并在后台启用'], debug: ['wp-config.php 开启 WP_DEBUG 与 WP_DEBUG_LOG'] },
};
const GENERIC = { docs: [], rules: ['清单需包含 name 与 version', '入口文件需导出宿主约定的激活函数'], run: ['按宿主文档将 build/ 目录或打包产物加载到宿主中'], debug: ['查看宿主日志/控制台输出；先保证本 IDE 构建与校验通过'] };

function forAdapter(a) {
  const k = K[a.family] || GENERIC;
  const docs = [...(a.docs ? [[a.name + ' 官方文档', a.docs]] : []), ...k.docs].filter((d, i, arr) => arr.findIndex(x => x[1] === d[1]) === i);
  return { family: a.family, label: a.label, manifest: a.manifest, manifestRequired: a.manifestRequired || [], docs: docs.map(([title, url]) => ({ title, url })), rules: k.rules, run: k.run, debug: k.debug, packageFormat: a.packageFormat, publishTarget: a.publishTarget };
}
/** 注入到系统提示词的知识块 */
function promptBlock(a) {
  const k = forAdapter(a);
  return `\n【宿主知识 · ${a.name}】\n清单 ${k.manifest}，必填：${k.manifestRequired.join(', ')}\n规则：\n${k.rules.map(r => '- ' + r).join('\n')}\n参考文档：${k.docs.map(d => d.url).join(' ')}\n`;
}
module.exports = { forAdapter, promptBlock, K };
