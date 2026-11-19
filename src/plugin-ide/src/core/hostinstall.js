// v1.3.0 一键「安装并打开测试」：打包后把插件装进本机检测到的宿主，再启动宿主。
// 每个家族一个安装器；找不到宿主或不支持自动安装时，给出通俗的手动步骤。进度走 agent.startJob（SSE + 取消）。
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const L = () => require('./lifecycle'), registry = require('./registry'), hosts = require('./hosts');
const DATA = () => process.env.PLUGIN_IDE_DATA || path.join(os.homedir(), '.plugin-ide');
const isWin = () => (process.env.PLUGIN_IDE_HOST_PLATFORM || process.platform) === 'win32';
const isMac = () => (process.env.PLUGIN_IDE_HOST_PLATFORM || process.platform) === 'darwin';
const APPDATA = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const HOME = () => process.env.PLUGIN_IDE_HOME || os.homedir();

function copyDir(src, dst) { fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst, { recursive: true }); fs.cpSync(src, dst, { recursive: true }); }
/** 运行命令（可取消），返回 {code, out} */
function run(ctx, cmd, args, { timeout = 180000, env } = {}) {
  return new Promise((resolve) => {
    const shell = /\.(cmd|bat)$/i.test(cmd);
    const q = a => shell && /[\s&()]/.test(a) ? `"${a}"` : a;
    let p; try { p = spawn(shell ? q(cmd) : cmd, shell ? args.map(q) : args, { shell, windowsHide: true, env: cleanEnv(env) }); } catch (e) { return resolve({ code: -1, out: e.message }); }
    let out = ''; const t = setTimeout(() => { try { p.kill(); } catch {} out += '\n(超时)'; }, timeout);
    ctx?.onCancel(() => { try { p.kill(); } catch {} clearTimeout(t); resolve({ code: -2, out: out + '\n(已取消)' }); });
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out: out + e.message }); });
    p.on('close', c => { clearTimeout(t); resolve({ code: c, out: out.trim() }); });
  });
}
/** 启动宿主（脱离本进程） */
function launch(exe, args = [], env) {
  const shell = /\.(cmd|bat)$/i.test(exe);
  const p = spawn(shell ? `"${exe}"` : exe, shell ? args.map(a => /\s/.test(a) ? `"${a}"` : a) : args, { detached: true, stdio: 'ignore', shell, windowsHide: false, env: cleanEnv(env) });
  p.on('error', () => {}); p.unref(); return p.pid;
}
const cleanEnv = e => { const o = { ...process.env, ...(e || {}) }; delete o.ELECTRON_RUN_AS_NODE; return o; };
/** 启动 Chromium 系浏览器并通过 DevTools 协议（--remote-debugging-pipe）调用 Extensions.loadUnpacked；
 *  新版 Google Chrome 已禁用 --load-extension，CDP 是官方替代方案。Edge/Chromium 两种方式都生效。 */
function loadViaCdp(exe, args, dir, timeout = 20000) {
  return new Promise(resolve => {
    let p; try { p = spawn(exe, args, { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env: cleanEnv(), windowsHide: false }); } catch (e) { return resolve({ ok: false, error: e.message }); }
    let buf = '', fin = false; const end = (r) => { if (fin) return; fin = true; clearTimeout(t); clearInterval(iv); try { p.stdio[3].destroy(); p.stdio[4].destroy(); } catch {} p.unref(); resolve({ pid: p.pid, ...r }); };
    const t = setTimeout(() => end({ ok: false, error: '浏览器 ' + timeout / 1000 + ' 秒内没有响应' }), timeout);
    p.on('error', e => end({ ok: false, error: e.message })); p.on('exit', c => end({ ok: false, error: '浏览器已退出（' + c + '），可能已有同配置窗口打开' }));
    p.stdio[4].on('data', d => { buf += d; for (const m of buf.split('\0').slice(0, -1)) { try { const j = JSON.parse(m); if (j.id === 1) j.result ? end({ ok: true, extId: j.result.id }) : end({ ok: false, error: j.error?.message || 'loadUnpacked 失败' }); } catch {} } buf = buf.split('\0').pop(); });
    p.stdio[3].on('error', () => {}); p.stdio[4].on('error', () => {});
    let n = 0; const iv = setInterval(() => { if (++n > 15) return; try { p.stdio[3].write(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: dir } }) + '\0'); } catch {} }, 1000);
  });
}
const regAdd = (ctx, key, name, value, type = 'REG_SZ') => run(ctx, 'reg', ['add', key, '/v', name, '/t', type, '/d', String(value), '/f']);
const regDel = (key, name) => run(null, 'reg', ['delete', key, '/v', name, '/f']);

// —— 各家族的手动步骤（宿主未找到/不支持时）——
function manualSteps(fam, hostName, art, unpacked) {
  const M = {
    'vscode-ext': [`打开 ${hostName}，按 Ctrl+Shift+X 打开「扩展」。`, '点右上角「…」→「从 VSIX 安装…」。', `选择：${art}`, '按提示重新加载窗口。'],
    'browser-ext': [`打开浏览器，地址栏输入 chrome://extensions（Edge 为 edge://extensions）。`, '打开右上角「开发者模式」。', '点「加载已解压的扩展程序」。', `选择文件夹：${unpacked}`],
    'office-addin': ['打开 Excel / Word 等 Office 应用。', '「开始」→「加载项」→「我的加载项」→「上传我的加载项」。', `选择清单：${path.join(unpacked, 'manifest.xml')}`, '注意：任务窗格网页需在 https://localhost:3000 提供（npm start 或任意本地 HTTPS 服务）。'],
    'blender': ['打开 Blender →「编辑」→「偏好设置」→「获取扩展」。', '右上角下拉 →「从磁盘安装…」。', `选择：${art}`, '勾选启用。'],
    'adobe-uxp': ['安装并打开「Adobe UXP Developer Tool」（Creative Cloud 中免费获取）。', '点「Add Plugin」，选择清单：' + path.join(unpacked, 'manifest.json'), '先打开 Photoshop，再在 UXP Developer Tool 中点「Load」。'],
    'adobe-cep': [`把文件夹 ${unpacked} 复制到 ${isMac() ? '~/Library/Application Support/Adobe/CEP/extensions/' : '%APPDATA%\\Adobe\\CEP\\extensions\\'}`, '开启 CEP 调试模式（PlayerDebugMode=1），否则未签名扩展不会显示。', `重启 ${hostName}，在「窗口 → 扩展」中打开。`],
    'python-dcc': [`把文件夹 ${unpacked} 复制到 ${hostName} 的脚本/插件目录。`, `在 ${hostName} 的脚本编辑器中 import 主模块运行。`],
    'dotnet-addin': ['用 Visual Studio 编译 .csproj 得到 DLL（插件工坊离线模式只做结构校验）。', `把 ${unpacked} 复制为 %APPDATA%\\Autodesk\\ApplicationPlugins\\<名称>.bundle`, `重启 ${hostName}。`],
    'notes-plugin': ['打开 Obsidian 的一个库（vault）。', `把 ${unpacked} 中的 manifest.json、main.js 复制到 <库>/.obsidian/plugins/<插件id>/`, '「设置 → 第三方插件」关闭安全模式并启用该插件。'],
    'design-plugin': ['打开 Figma 桌面版（网页版不能加载本地插件）。', '菜单「插件 → 开发 → 从清单导入插件…」。', `选择：${path.join(unpacked, 'manifest.json')}`],
    'jetbrains': ['用 Gradle 执行 buildPlugin 生成插件 zip（插件工坊离线模式只做结构校验）。', `打开 ${hostName} →「设置 → 插件 → ⚙ → 从磁盘安装插件…」。`, `选择：${art}`, '重启 IDE。'],
  };
  return M[fam] || [`插件工坊暂不支持自动安装到「${hostName}」。`, `安装包：${art}`, `请在 ${hostName} 中找「插件 / 扩展 / 加载项 → 从本地安装」。`];
}

// —— 安装器：返回 { launched, record（用于卸载）, notes }；ctx 用于步骤输出 ——
const INSTALLERS = {
  async 'vscode-ext'(c) {
    const cli = c.host.cli || c.host.path; if (!cli) throw new Error('未找到命令行工具');
    const pj = JSON.parse(fs.readFileSync(path.join(c.unpacked, 'package.json'), 'utf8')); const extId = `${pj.publisher}.${pj.name}`;
    const s = c.step(`用 ${path.basename(cli)} --install-extension 安装`, 'extensions');
    const r = await run(c, cli, ['--install-extension', c.art, '--force']); c.done(s, r.code === 0, r.out.slice(-800) || '(无输出)');
    if (r.code !== 0) throw new Error('安装失败：' + r.out.slice(-300));
    const s2 = c.step(`启动 ${c.host.name}`, 'rocket'); const pid = launch(cli, ['--new-window']); c.done(s2, true, `已启动（pid ${pid}）。在命令面板（Ctrl+Shift+P）搜索插件命令即可测试。`);
    return { record: { kind: 'vscode', cli, extId }, notes: [`扩展 ID：${extId}`] };
  },
  async 'browser-ext'(c) {
    if (c.host.key === 'firefox') {
      const webext = hosts.whichIn('web-ext', process.env, isWin() ? 'win32' : 'linux', { exists: p => fs.existsSync(p) });
      if (!webext) return { manual: ['Firefox 不支持命令行直接加载未签名扩展。', '打开 Firefox，地址栏输入 about:debugging#/runtime/this-firefox', '点「临时载入附加组件…」，选择：' + path.join(c.unpacked, 'manifest.json')], launchArgs: ['about:debugging#/runtime/this-firefox'] };
      const s = c.step('web-ext run 启动 Firefox 并加载扩展', 'rocket'); const pid = launch(webext, ['run', '--source-dir', c.unpacked, '--firefox', c.host.path]); c.done(s, true, `pid ${pid}`); return { record: { kind: 'none' } };
    }
    const prof = path.join(DATA(), 'host-profiles', `${c.project}-${c.host.key}`);
    const s = c.step('准备独立测试配置（不影响你平时的浏览器数据）', 'folder'); fs.mkdirSync(prof, { recursive: true }); c.done(s, true, prof);
    const args = [`--user-data-dir=${prof}`, `--load-extension=${c.unpacked}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), ...(c.extraArgs || []), 'chrome://extensions/'];
    const s2 = c.step(`启动 ${c.host.name} 并加载扩展`, 'rocket');
    const r = await loadViaCdp(c.host.path, args, c.unpacked);
    c.done(s2, r.ok, `pid ${r.pid}\n${r.ok ? '扩展已加载，ID：' + r.extId : '自动加载未确认：' + r.error}`);
    if (!r.ok) return { manual: manualSteps('browser-ext', c.host.name, c.art, c.unpacked), note: '浏览器已打开，但没能确认扩展已加载。' };
    return { record: { kind: 'browser-profile', profile: prof, pid: r.pid, extId: r.extId }, notes: ['扩展已在独立测试窗口中加载；点工具栏的拼图图标可把它固定。', '这是一个干净的测试配置，不会影响你平时用的浏览器。'] };
  },
  async blender(c) {
    const ver = parseFloat(c.host.version) || 4.2; const s = c.step(`在 Blender ${c.host.version || ''} 中安装并启用`, 'extensions');
    const mod = c.project.replace(/-/g, '_'); let r;
    if (ver >= 4.2) r = await run(c, c.host.path, ['--command', 'extension', 'install-file', '-r', 'user_default', '-e', c.art]);
    else r = await run(c, c.host.path, ['--background', '--python-expr', `import bpy;bpy.ops.preferences.addon_install(filepath=r'${c.art}',overwrite=True);bpy.ops.preferences.addon_enable(module='${mod}');bpy.ops.wm.save_userpref()`]);
    c.done(s, r.code === 0, r.out.slice(-800)); if (r.code !== 0) throw new Error('Blender 安装失败：' + r.out.slice(-300));
    const s2 = c.step('启动 Blender', 'rocket'); const pid = launch(c.host.path); c.done(s2, true, `pid ${pid}。在 3D 视图按 N 打开侧边栏查看插件面板。`);
    return { record: { kind: 'blender', exe: c.host.path, module: mod, ext: ver >= 4.2 } };
  },
  async 'office-addin'(c) {
    const mf = path.join(c.unpacked, 'manifest.xml'); const id = (fs.readFileSync(mf, 'utf8').match(/<Id>([^<]+)<\/Id>/) || [])[1] || c.project;
    const s = c.step('旁加载（sideload）清单', 'file-code'); let record;
    if (isWin()) {
      const key = 'HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer'; const r = await regAdd(c, key, id, mf);
      c.done(s, r.code === 0, `${key}\\${id} = ${mf}\n${r.out}`); if (r.code !== 0) throw new Error('写入注册表失败'); record = { kind: 'office-reg', key, name: id };
    } else if (isMac()) {
      const app = { word: 'Word', excel: 'Excel', powerpoint: 'Powerpoint', outlook: 'Outlook' }[c.host.key] || 'Excel';
      const dir = path.join(HOME(), 'Library', 'Containers', 'com.microsoft.' + app, 'Data', 'Documents', 'wef'); fs.mkdirSync(dir, { recursive: true });
      const dst = path.join(dir, `${c.project}.xml`); fs.copyFileSync(mf, dst); c.done(s, true, dst); record = { kind: 'files', paths: [dst] };
    } else throw new Error('Linux 没有 Office 桌面版');
    const s2 = c.step(`启动 ${c.host.name}`, 'rocket'); const pid = launch(c.host.path); c.done(s2, true, `pid ${pid}`);
    return { record, notes: ['在「开始 → 加载项」（或「插入 → 我的加载项 → 开发人员加载项」）中找到它。', '任务窗格网页地址为 https://localhost:3000，需先启动本地 HTTPS 服务（例如 npx office-addin-dev-certs install 后 npx http-server -S），否则面板会显示无法连接。'] };
  },
  async 'adobe-uxp'(c) {
    const upia = isWin() ? path.join(process.env['CommonProgramFiles'] || 'C:\\Program Files\\Common Files', 'Adobe', 'Adobe Desktop Common', 'RemoteComponents', 'UPI', 'UnifiedPluginInstallerAgent', 'UnifiedPluginInstallerAgent.exe')
      : '/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent';
    if (!fs.existsSync(upia)) return { manual: manualSteps('adobe-uxp', c.host.name, c.art, c.unpacked), note: '未找到 Adobe 插件安装器（UnifiedPluginInstallerAgent，随 Creative Cloud 安装）。' };
    const s = c.step('用 Creative Cloud 插件安装器安装 .ccx', 'extensions'); const r = await run(c, upia, [isWin() ? '/install' : '--install', c.art]); c.done(s, r.code === 0, r.out.slice(-600));
    if (r.code !== 0) return { manual: manualSteps('adobe-uxp', c.host.name, c.art, c.unpacked), note: '.ccx 安装失败（未签名的插件通常需要用 UXP Developer Tool 加载）。' };
    const id = JSON.parse(fs.readFileSync(path.join(c.unpacked, 'manifest.json'), 'utf8')).id;
    const s2 = c.step(`启动 ${c.host.name}`, 'rocket'); launch(c.host.path); c.done(s2, true, '在「增效工具」菜单中打开。');
    return { record: { kind: 'upia', exe: upia, id } };
  },
  async 'adobe-cep'(c) {
    const xml = fs.readFileSync(path.join(c.unpacked, 'CSXS', 'manifest.xml'), 'utf8'); const bid = (xml.match(/ExtensionBundleId="([^"]+)"/) || [])[1] || c.project;
    const base = isWin() ? path.join(APPDATA(), 'Adobe', 'CEP', 'extensions') : path.join(HOME(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
    const dst = path.join(base, bid); const s = c.step('复制到 CEP 扩展目录', 'folder'); copyDir(c.unpacked, dst); c.done(s, true, dst);
    const s2 = c.step('开启 CEP 调试模式（允许未签名扩展）', 'debug'); const vers = [9, 10, 11, 12];
    if (isWin()) { for (const v of vers) await regAdd(c, `HKCU\\Software\\Adobe\\CSXS.${v}`, 'PlayerDebugMode', '1'); c.done(s2, true, vers.map(v => `HKCU\\Software\\Adobe\\CSXS.${v}\\PlayerDebugMode = 1`).join('\n')); }
    else if (isMac()) { for (const v of vers) await run(c, 'defaults', ['write', `com.adobe.CSXS.${v}`, 'PlayerDebugMode', '1']); c.done(s2, true, 'defaults write com.adobe.CSXS.* PlayerDebugMode 1'); }
    else c.done(s2, null, '非 Windows/macOS，跳过');
    const s3 = c.step(`启动 ${c.host.name}`, 'rocket'); launch(c.host.path); c.done(s3, true, '在「窗口 → 扩展」中打开面板。');
    return { record: { kind: 'files', paths: [dst] }, notes: ['调试模式会保持开启；如需关闭，把 PlayerDebugMode 改回 0。'] };
  },
  async 'python-dcc'(c) {
    // 用环境变量把插件目录加入宿主搜索路径后启动（不改动宿主目录，卸载即删除副本）
    const dst = path.join(DATA(), 'host-plugins', c.host.key, c.project); const s = c.step('复制插件到测试目录', 'folder'); copyDir(c.unpacked, dst); c.done(s, true, dst);
    const sep = isWin() ? ';' : ':';
    const ENV = { maya: { MAYA_SCRIPT_PATH: dst, PYTHONPATH: dst + sep + (process.env.PYTHONPATH || ''), MAYA_PLUG_IN_PATH: dst }, cinema4d: { g_additionalModulePath: dst }, houdini: { HOUDINI_PATH: dst + sep + '&' } }[c.host.key] || { PYTHONPATH: dst };
    const s2 = c.step(`启动 ${c.host.name}（已把插件目录加入搜索路径）`, 'rocket'); const pid = launch(c.host.path, [], ENV); c.done(s2, true, `pid ${pid}\n` + Object.entries(ENV).map(([k, v]) => `${k}=${v}`).join('\n'));
    return { record: { kind: 'files', paths: [dst] }, notes: [c.host.key === 'maya' ? '在 Maya 脚本编辑器（Python）运行：import main' : c.host.key === 'cinema4d' ? '在「扩展」菜单中找到插件。' : '在宿主的 Python 控制台 import 主模块。'] };
  },
  async 'dotnet-addin'(c) {
    const name = c.project; const dst = path.join(APPDATA(), 'Autodesk', 'ApplicationPlugins', name + '.bundle');
    const s = c.step('复制到 Autodesk ApplicationPlugins（自动加载目录）', 'folder'); copyDir(c.unpacked, dst); c.done(s, true, dst);
    const s2 = c.step(`启动 ${c.host.name}`, 'rocket'); launch(c.host.path); c.done(s2, true, '');
    return { record: { kind: 'files', paths: [dst] }, notes: ['注意：插件工坊离线模式不编译 C#，需先用 Visual Studio 编译出 DLL 并放进 bundle 的 Contents 目录，宿主才会真正加载。', ...(c.host.key === 'revit' ? ['Revit 需要 .addin 清单，放到 %APPDATA%\\Autodesk\\Revit\\Addins\\<年份>\\。'] : [])] };
  },
  async 'notes-plugin'(c) {
    const cfgDir = isWin() ? path.join(APPDATA(), 'obsidian') : isMac() ? path.join(HOME(), 'Library', 'Application Support', 'obsidian') : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME(), '.config'), 'obsidian');
    let vaults = []; try { vaults = Object.values(JSON.parse(fs.readFileSync(path.join(cfgDir, 'obsidian.json'), 'utf8')).vaults || {}).sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || (b.ts || 0) - (a.ts || 0)); } catch {}
    const s = c.step('查找 Obsidian 库（vault）', 'search');
    const vault = vaults.find(v => v.path && fs.existsSync(v.path))?.path || path.join(HOME(), 'PluginWorkbench-TestVault');
    fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true }); c.done(s, true, vaults.length ? `使用最近打开的库：${vault}` : `没找到已有的库，已新建测试库：${vault}`);
    const id = JSON.parse(fs.readFileSync(path.join(c.unpacked, 'manifest.json'), 'utf8')).id;
    const dst = path.join(vault, '.obsidian', 'plugins', id); const s2 = c.step('复制插件并启用', 'extensions');
    copyDir(c.unpacked, dst); const cp = path.join(vault, '.obsidian', 'community-plugins.json'); let en = []; try { en = JSON.parse(fs.readFileSync(cp, 'utf8')); } catch {}
    const added = !en.includes(id); if (added) { en.push(id); fs.writeFileSync(cp, JSON.stringify(en, null, 2)); } c.done(s2, true, dst);
    const s3 = c.step('启动 Obsidian', 'rocket'); launch(c.host.path, ['obsidian://open?path=' + encodeURIComponent(vault)]); c.done(s3, true, '首次使用需在「设置 → 第三方插件」关闭安全模式。');
    return { record: { kind: 'obsidian', paths: [dst], enabledFile: added ? cp : null, id } };
  },
};

function targetHost(name, hostKey) {
  const m = L().meta(name), a = registry.resolve(m.vendorId) || { family: m.family, name: m.vendorName }, scan = hosts.scan();
  const fv = hosts.forVendor(m.vendorId, a.family, scan);
  const host = hostKey ? scan.hosts.find(h => h.key === hostKey && h.installed) : fv.best;
  return { m, a, host, fv };
}
function plan(name, hostKey) {
  const { m, a, host, fv } = targetHost(name, hostKey), dir = L().pdir(name);
  const art = m.artifact ? path.join(dir, m.artifact.file) : null, unpacked = path.join(dir, 'build');
  const auto = !!INSTALLERS[a.family];
  return { project: name, family: a.family, vendor: a.name, packaged: !!art, artifact: art, unpacked, host, candidates: fv.candidates.map(h => ({ key: h.key, name: h.name, installed: h.installed, version: h.version, path: h.path })),
    auto: auto && !!host, installed: m.installs || {}, manual: manualSteps(a.family, host?.name || a.name, art || '(请先打包)', unpacked),
    reason: !art ? '还没有安装包，请先打包。' : !host ? `这台电脑上没有检测到 ${fv.candidates.map(h => h.name).join(' / ') || a.name}。` : !auto ? `暂不支持自动安装到 ${host.name}，请按下面的步骤手动操作。` : '' };
}
function installAndOpen(name, { hostKey } = {}) {
  const startJob = require('./agent').startJob;
  return startJob('host-install', name, async (ctx) => {
    const p = plan(name, hostKey);
    const s0 = ctx.step('检查安装包与目标软件', 'checklist');
    if (!p.packaged) { ctx.done(s0, false, p.reason); return { ok: false, manual: p.manual, reason: p.reason }; }
    if (!p.host || !INSTALLERS[p.family]) { ctx.done(s0, null, p.reason); return { ok: false, manual: p.manual, reason: p.reason }; }
    ctx.done(s0, true, `${p.host.name} ${p.host.version || ''}\n${p.host.path}`);
    ctx.check();
    const c = { ...ctx, onCancel: ctx.onCancel, step: (t, i) => { ctx.check(); return ctx.step(t, i); }, project: name, host: p.host, art: p.artifact, unpacked: p.unpacked };
    const r = await INSTALLERS[p.family](c);
    if (r.manual) { const s = ctx.step('需要手动完成', 'info'); ctx.done(s, null, (r.note ? r.note + '\n' : '') + r.manual.join('\n')); if (r.launchArgs) launch(p.host.path, r.launchArgs); return { ok: false, manual: r.manual, reason: r.note || '' }; }
    const m = L().meta(name); m.installs = m.installs || {}; m.installs[p.host.key] = { host: p.host.name, at: new Date().toISOString(), version: m.version, ...r.record }; L().saveMeta(name, m);
    return { ok: true, host: p.host.name, notes: r.notes || [] };
  });
}
async function uninstall(name, hostKey) {
  const m = L().meta(name), rec = (m.installs || {})[hostKey]; if (!rec) throw new Error('没有该宿主的安装记录');
  const log = [];
  if (rec.kind === 'vscode') { const r = await run(null, rec.cli, ['--uninstall-extension', rec.extId]); log.push(r.out || `exit ${r.code}`); }
  if (rec.kind === 'blender') { const r = rec.ext ? await run(null, rec.exe, ['--command', 'extension', 'remove', 'user_default.' + rec.module]) : await run(null, rec.exe, ['--background', '--python-expr', `import bpy;bpy.ops.preferences.addon_disable(module='${rec.module}');bpy.ops.preferences.addon_remove(module='${rec.module}');bpy.ops.wm.save_userpref()`]); log.push(r.out || `exit ${r.code}`); }
  if (rec.kind === 'office-reg') { const r = await regDel(rec.key, rec.name); log.push(`删除 ${rec.key}\\${rec.name}: ${r.code === 0 ? 'OK' : r.out}`); }
  if (rec.kind === 'upia') { const r = await run(null, rec.exe, [isWin() ? '/remove' : '--remove', rec.id]); log.push(r.out); }
  if (rec.kind === 'browser-profile') { try { if (isWin()) await run(null, 'taskkill', ['/pid', String(rec.pid), '/T', '/F']); else process.kill(rec.pid); log.push('已关闭测试浏览器'); } catch {} await new Promise(r => setTimeout(r, 800)); fs.rmSync(rec.profile, { recursive: true, force: true }); log.push('已删除测试配置 ' + rec.profile + '（请先关闭测试浏览器窗口）'); }
  for (const p of rec.paths || []) { fs.rmSync(p, { recursive: true, force: true }); log.push('已删除 ' + p); }
  if (rec.enabledFile) { try { const en = JSON.parse(fs.readFileSync(rec.enabledFile, 'utf8')).filter(x => x !== rec.id); fs.writeFileSync(rec.enabledFile, JSON.stringify(en, null, 2)); log.push('已从 community-plugins.json 移除'); } catch {} }
  delete m.installs[hostKey]; L().saveMeta(name, m);
  return { ok: true, log };
}
module.exports = { plan, installAndOpen, uninstall, manualSteps, INSTALLERS, run, launch };
