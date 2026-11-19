// v1.3.0 宿主环境检测：扫描本机已安装的宿主软件（Windows 为主：注册表 Uninstall / App Paths / 常见安装目录 / PATH；兼顾 macOS / Linux）
// 所有探测都可注入（platform / env / regText / exists / readdir / run），便于在 Linux 上用假安装做测试。
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');

// key, 名称, 关联厂商 id, 家族；win: reg=注册表 DisplayName 正则, appPaths=App Paths 中的 exe 名, dirs=候选可执行文件（支持 * 通配一层目录）, path=PATH 命令
// cli: 相对主程序的命令行工具（VS Code 系）；mac: .app 名 + 相对可执行文件；linux: 命令名/绝对路径
const HOSTS = [
  { key: 'vscode', name: 'Visual Studio Code', vendors: ['visual-studio-code', 'vs-code-insiders'], family: 'vscode-ext',
    win: { reg: /^Microsoft Visual Studio Code(?! Insiders)/i, appPaths: ['Code.exe'], dirs: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe', '%ProgramFiles%\\Microsoft VS Code\\Code.exe'], path: ['code'], cli: 'bin\\code.cmd' },
    mac: { app: 'Visual Studio Code.app', exe: 'Contents/MacOS/Electron', cli: 'Contents/Resources/app/bin/code' }, linux: ['code', '/usr/share/code/bin/code', '/snap/bin/code'] },
  { key: 'cursor', name: 'Cursor', vendors: ['cursor'], family: 'vscode-ext',
    win: { reg: /^Cursor\b/i, dirs: ['%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe'], path: ['cursor'], cli: 'resources\\app\\bin\\cursor.cmd' },
    mac: { app: 'Cursor.app', exe: 'Contents/MacOS/Cursor', cli: 'Contents/Resources/app/bin/cursor' }, linux: ['cursor'] },
  { key: 'windsurf', name: 'Windsurf', vendors: ['windsurf'], family: 'vscode-ext',
    win: { reg: /^Windsurf\b/i, dirs: ['%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe'], path: ['windsurf'], cli: 'bin\\windsurf.cmd' },
    mac: { app: 'Windsurf.app', exe: 'Contents/MacOS/Electron', cli: 'Contents/Resources/app/bin/windsurf' }, linux: ['windsurf'] },
  { key: 'vscodium', name: 'VSCodium', vendors: ['vscodium'], family: 'vscode-ext',
    win: { reg: /^VSCodium\b/i, dirs: ['%LOCALAPPDATA%\\Programs\\VSCodium\\VSCodium.exe', '%ProgramFiles%\\VSCodium\\VSCodium.exe'], path: ['codium'], cli: 'bin\\codium.cmd' },
    mac: { app: 'VSCodium.app', exe: 'Contents/MacOS/Electron', cli: 'Contents/Resources/app/bin/codium' }, linux: ['codium'] },
  { key: 'chrome', name: 'Google Chrome', vendors: ['chrome'], family: 'browser-ext',
    win: { reg: /^Google Chrome$/i, appPaths: ['chrome.exe'], dirs: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe'] },
    mac: { app: 'Google Chrome.app', exe: 'Contents/MacOS/Google Chrome' }, linux: ['google-chrome', 'google-chrome-stable'] },
  { key: 'chromium', name: 'Chromium', vendors: ['chrome', 'chromium'], family: 'browser-ext',
    win: { dirs: ['%LOCALAPPDATA%\\Chromium\\Application\\chrome.exe'] }, mac: { app: 'Chromium.app', exe: 'Contents/MacOS/Chromium' }, linux: ['chromium', 'chromium-browser'] },
  { key: 'edge', name: 'Microsoft Edge', vendors: ['edge'], family: 'browser-ext',
    win: { reg: /^Microsoft Edge$/i, appPaths: ['msedge.exe'], dirs: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe'] },
    mac: { app: 'Microsoft Edge.app', exe: 'Contents/MacOS/Microsoft Edge' }, linux: ['microsoft-edge', 'microsoft-edge-stable'] },
  { key: 'firefox', name: 'Mozilla Firefox', vendors: ['firefox'], family: 'browser-ext',
    win: { reg: /^Mozilla Firefox/i, appPaths: ['firefox.exe'], dirs: ['%ProgramFiles%\\Mozilla Firefox\\firefox.exe', '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe'] },
    mac: { app: 'Firefox.app', exe: 'Contents/MacOS/firefox' }, linux: ['firefox'] },
  ...[['word', 'Word', 'WINWORD.EXE', 'Microsoft Word.app'], ['excel', 'Excel', 'EXCEL.EXE', 'Microsoft Excel.app'], ['powerpoint', 'PowerPoint', 'POWERPNT.EXE', 'Microsoft PowerPoint.app'], ['outlook', 'Outlook', 'OUTLOOK.EXE', 'Microsoft Outlook.app']].map(([k, n, exe, app]) => ({
    key: k, name: 'Microsoft ' + n, vendors: [k], family: 'office-addin',
    win: { reg: /^Microsoft (Office|365)\b/i, regNeedsExe: true, appPaths: [exe], dirs: [`%ProgramFiles%\\Microsoft Office\\root\\Office16\\${exe}`, `%ProgramFiles(x86)%\\Microsoft Office\\root\\Office16\\${exe}`, `%ProgramFiles%\\Microsoft Office\\Office16\\${exe}`] },
    mac: { app, exe: 'Contents/MacOS/Microsoft ' + n } })),
  { key: 'photoshop', name: 'Adobe Photoshop', vendors: ['photoshop'], family: 'adobe-uxp',
    win: { reg: /^Adobe Photoshop/i, appPaths: ['Photoshop.exe'], dirs: ['%ProgramFiles%\\Adobe\\Adobe Photoshop *\\Photoshop.exe'] }, mac: { app: 'Adobe Photoshop */Adobe Photoshop *.app', exe: '' } },
  { key: 'indesign', name: 'Adobe InDesign', vendors: ['indesign'], family: 'adobe-uxp',
    win: { reg: /^Adobe InDesign/i, dirs: ['%ProgramFiles%\\Adobe\\Adobe InDesign *\\InDesign.exe'] }, mac: { app: 'Adobe InDesign */Adobe InDesign *.app', exe: '' } },
  { key: 'premiere', name: 'Adobe Premiere Pro', vendors: ['premiere-pro-uxp', 'premiere-pro-cep'], family: 'adobe-cep',
    win: { reg: /^Adobe Premiere Pro/i, dirs: ['%ProgramFiles%\\Adobe\\Adobe Premiere Pro *\\Adobe Premiere Pro.exe'] }, mac: { app: 'Adobe Premiere Pro */Adobe Premiere Pro *.app', exe: '' } },
  { key: 'illustrator', name: 'Adobe Illustrator', vendors: ['illustrator'], family: 'adobe-cep',
    win: { reg: /^Adobe Illustrator/i, appPaths: ['Illustrator.exe'], dirs: ['%ProgramFiles%\\Adobe\\Adobe Illustrator *\\Support Files\\Contents\\Windows\\Illustrator.exe'] }, mac: { app: 'Adobe Illustrator */Adobe Illustrator.app', exe: '' } },
  { key: 'aftereffects', name: 'Adobe After Effects', vendors: ['after-effects'], family: 'adobe-cep',
    win: { reg: /^Adobe After Effects/i, appPaths: ['AfterFX.exe'], dirs: ['%ProgramFiles%\\Adobe\\Adobe After Effects *\\Support Files\\AfterFX.exe'] }, mac: { app: 'Adobe After Effects */Adobe After Effects *.app', exe: '' } },
  { key: 'autocad', name: 'Autodesk AutoCAD', vendors: ['autocad'], family: 'dotnet-addin',
    win: { reg: /^AutoCAD( LT)? \d{4}/i, appPaths: ['acad.exe'], dirs: ['%ProgramFiles%\\Autodesk\\AutoCAD *\\acad.exe'] }, mac: { app: 'Autodesk/AutoCAD */AutoCAD *.app', exe: '' } },
  { key: '3dsmax', name: 'Autodesk 3ds Max', vendors: ['3ds-max'], family: 'dotnet-addin',
    win: { reg: /^Autodesk 3ds Max \d{4}/i, appPaths: ['3dsmax.exe'], dirs: ['%ProgramFiles%\\Autodesk\\3ds Max *\\3dsmax.exe'] } },
  { key: 'maya', name: 'Autodesk Maya', vendors: ['maya'], family: 'python-dcc',
    win: { reg: /^Autodesk Maya \d{4}/i, appPaths: ['maya.exe'], dirs: ['%ProgramFiles%\\Autodesk\\Maya*\\bin\\maya.exe'] }, mac: { app: 'Autodesk/maya*/Maya.app', exe: 'Contents/MacOS/Maya' }, linux: ['maya', '/usr/autodesk/maya*/bin/maya'] },
  { key: 'revit', name: 'Autodesk Revit', vendors: ['revit'], family: 'dotnet-addin',
    win: { reg: /^(Autodesk )?Revit \d{4}/i, dirs: ['%ProgramFiles%\\Autodesk\\Revit *\\Revit.exe'] } },
  { key: 'blender', name: 'Blender', vendors: ['blender'], family: 'blender',
    win: { reg: /^Blender\b/i, appPaths: ['blender.exe'], dirs: ['%ProgramFiles%\\Blender Foundation\\Blender *\\blender.exe', '%ProgramFiles(x86)%\\Steam\\steamapps\\common\\Blender\\blender.exe'], path: ['blender'] },
    mac: { app: 'Blender.app', exe: 'Contents/MacOS/Blender' }, linux: ['blender', '/snap/bin/blender'] },
  { key: 'cinema4d', name: 'Maxon Cinema 4D', vendors: ['cinema-4d'], family: 'python-dcc',
    win: { reg: /^(Maxon )?Cinema 4D/i, dirs: ['%ProgramFiles%\\Maxon Cinema 4D *\\Cinema 4D.exe', '%ProgramFiles%\\Maxon\\Cinema 4D *\\Cinema 4D.exe'] }, mac: { app: 'Maxon Cinema 4D */Cinema 4D.app', exe: 'Contents/MacOS/Cinema 4D' } },
  { key: 'houdini', name: 'SideFX Houdini', vendors: ['houdini'], family: 'python-dcc',
    win: { reg: /^Houdini \d/i, dirs: ['%ProgramFiles%\\Side Effects Software\\Houdini *\\bin\\houdini.exe'] }, linux: ['houdini', '/opt/hfs*/bin/houdini'] },
  ...[['intellij', 'IntelliJ IDEA', 'intellij-idea', 'IntelliJ IDEA*', 'idea64.exe', 'idea'], ['pycharm', 'PyCharm', 'pycharm', 'PyCharm*', 'pycharm64.exe', 'pycharm'], ['webstorm', 'WebStorm', 'webstorm', 'WebStorm*', 'webstorm64.exe', 'webstorm']].map(([k, n, v, dir, exe, bin]) => ({
    key: k, name: 'JetBrains ' + n, vendors: [v], family: 'jetbrains',
    win: { reg: new RegExp('^' + n.replace(' ', '\\s'), 'i'), dirs: [`%ProgramFiles%\\JetBrains\\${dir}\\bin\\${exe}`, `%LOCALAPPDATA%\\Programs\\${dir}\\bin\\${exe}`], path: [bin] },
    mac: { app: `${n}*.app`, exe: `Contents/MacOS/${bin}` }, linux: [bin, `/opt/${bin}*/bin/${bin}.sh`] })),
  { key: 'figma', name: 'Figma', vendors: ['figma'], family: 'design-plugin',
    win: { reg: /^Figma\b/i, dirs: ['%LOCALAPPDATA%\\Figma\\Figma.exe'] }, mac: { app: 'Figma.app', exe: 'Contents/MacOS/Figma' } },
  { key: 'obsidian', name: 'Obsidian', vendors: ['obsidian'], family: 'notes-plugin',
    win: { reg: /^Obsidian\b/i, dirs: ['%LOCALAPPDATA%\\Programs\\Obsidian\\Obsidian.exe', '%LOCALAPPDATA%\\Obsidian\\Obsidian.exe'] }, mac: { app: 'Obsidian.app', exe: 'Contents/MacOS/Obsidian' }, linux: ['obsidian', '/snap/bin/obsidian'] },
];

// —— 注册表解析（reg query /s 输出）——
function parseRegDump(text) {
  const out = []; let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (/^HKEY_/i.test(line)) { if (cur) out.push(cur); cur = { key: line }; continue; }
    const m = line.match(/^\s+(\S.*?)\s{2,}(REG_\w+)\s{2,}(.*)$/) || line.match(/^\s+(\S.*?)\s{2,}(REG_\w+)$/);
    if (m && cur) cur[m[1] === '(Default)' || m[1] === '(默认)' ? '' : m[1]] = (m[3] || '').trim();
  }
  if (cur) out.push(cur);
  return out;
}
const UNINSTALL_KEYS = ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'];
const APP_PATHS = ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths'];
function readRegistry(run) {
  const q = k => { const r = run('reg', ['query', k, '/s']); return r && r.status === 0 ? r.stdout : ''; };
  return { uninstall: UNINSTALL_KEYS.map(q).join('\n'), appPaths: APP_PATHS.map(q).join('\n') };
}

const expandEnv = (p, env) => p.replace(/%([^%]+)%/g, (m, k) => { const hit = Object.keys(env).find(e => e.toLowerCase() === k.toLowerCase()); return hit ? env[hit] : m; });
/** 展开带 * 的路径（每段一层通配），返回存在的文件，版本号大的在前 */
function globPaths(pattern, io) {
  const sep = pattern.includes('\\') ? '\\' : '/';
  const parts = pattern.split(/[\\/]/); let bases = [parts[0] === '' ? sep : parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i], next = [];
    for (const b of bases) {
      const join = b.endsWith(sep) ? b + seg : b + sep + seg;
      if (!seg.includes('*')) { next.push(join); continue; }
      const re = new RegExp('^' + seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
      let names = []; try { names = io.readdir(b); } catch {}
      for (const n of names) if (re.test(n)) next.push(b.endsWith(sep) ? b + n : b + sep + n);
    }
    bases = next;
  }
  return bases.filter(p => io.exists(p)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
const verFrom = s => (String(s || '').match(/\b(\d{4}|\d+\.\d+(?:\.\d+)*)\b/) || [])[1] || '';
const dirOf = (p, plat) => (plat === 'win32' ? path.win32 : path.posix).dirname(p);
const joinP = (plat, ...a) => (plat === 'win32' ? path.win32 : path.posix).join(...a);

function defaultIo() {
  return {
    exists: p => { try { return fs.existsSync(p); } catch { return false; } },
    readdir: p => fs.readdirSync(p),
    readFile: p => fs.readFileSync(p, 'utf8'),
    run: (cmd, args, o = {}) => { try { return spawnSync(cmd, args, { encoding: 'utf8', timeout: o.timeout || 8000, windowsHide: true, shell: o.shell }); } catch (e) { return { status: -1, error: e }; } },
  };
}
function whichIn(cmd, env, plat, io) {
  if (cmd.includes('/') || cmd.includes('\\')) return io.exists(cmd) ? cmd : null;
  const dirs = String(env.PATH || env.Path || '').split(plat === 'win32' ? ';' : ':').filter(Boolean);
  const exts = plat === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of dirs) for (const e of exts) { const p = joinP(plat, d, cmd + e); if (io.exists(p)) return p; }
  return null;
}

function detectWin(h, ctx) {
  const { env, io, reg, regEntries, appEntries } = ctx; const w = h.win; if (!w) return null;
  const found = { sources: [] };
  if (w.reg) {
    const hit = regEntries.find(e => e.DisplayName && w.reg.test(e.DisplayName) && !/Update|Helper|Redistributable|Language Pack|Proofing|Click-to-Run/i.test(e.DisplayName));
    if (hit) { found.version = hit.DisplayVersion || verFrom(hit.DisplayName); found.installDir = hit.InstallLocation || ''; found.displayName = hit.DisplayName; found.sources.push('注册表'); const icon = (hit.DisplayIcon || '').replace(/"/g, '').replace(/,\d+$/, ''); if (/\.exe$/i.test(icon) && !w.regNeedsExe) found.exe = icon; }
  }
  for (const exe of w.appPaths || []) {
    const e = appEntries.find(x => x.key.toLowerCase().endsWith('\\' + exe.toLowerCase()));
    const p = e && (e[''] || '').replace(/"/g, ''); if (p && io.exists(p)) { found.exe = p; found.sources.push('App Paths'); break; }
  }
  if (!found.exe) for (const d of w.dirs || []) { const hits = globPaths(expandEnv(d, env), io); if (hits.length) { found.exe = hits[0]; found.sources.push('安装目录'); break; } }
  if (!found.exe && found.installDir) { const guess = (w.appPaths || [])[0] || path.win32.basename(expandEnv((w.dirs || [''])[0], env)); const p = path.win32.join(found.installDir, guess); if (guess && io.exists(p)) found.exe = p; }
  if (!found.exe) for (const c of w.path || []) { const p = whichIn(c, env, 'win32', io); if (p) { found.cliPath = p; found.exe = p; found.sources.push('PATH'); break; } }
  if (w.regNeedsExe && !found.exe) return null; // Office 套件存在但没装这个组件
  if (!found.exe && !found.displayName) return null;
  if (found.exe && w.cli) { const c = path.win32.join(dirOf(found.exe, 'win32'), w.cli); if (io.exists(c)) found.cliPath = c; }
  if (!found.version && found.exe) found.version = verFrom(path.win32.basename(dirOf(found.exe, 'win32'))) || verFrom(found.exe.replace(/\\(bin|Support Files).*$/i, ''));
  if (!found.version && found.exe && h.family === 'vscode-ext') { try { found.version = JSON.parse(io.readFile(path.win32.join(dirOf(found.exe, 'win32'), 'resources', 'app', 'package.json'))).version; } catch {} }
  return found;
}
function detectMac(h, ctx) {
  const m = h.mac; if (!m) return null; const { io, env } = ctx;
  for (const base of ['/Applications', joinP('darwin', env.HOME || os.homedir(), 'Applications')]) {
    const hits = globPaths(base + '/' + m.app, io); if (!hits.length) continue;
    const app = hits[0], exe = m.exe ? joinP('darwin', app, m.exe) : app;
    let version = ''; try { version = (io.readFile(joinP('darwin', app, 'Contents', 'Info.plist')).match(/CFBundleShortVersionString<\/key>\s*<string>([^<]+)/) || [])[1] || ''; } catch {}
    const cli = m.cli ? joinP('darwin', app, m.cli) : null;
    return { exe, app, version: version || verFrom(app), cliPath: cli && io.exists(cli) ? cli : null, sources: ['/Applications'] };
  }
  return null;
}
function detectLinux(h, ctx) {
  const { io, env } = ctx;
  for (const c of h.linux || []) {
    const p = c.includes('*') ? globPaths(c, io)[0] : whichIn(c, env, 'linux', io); if (!p) continue;
    let version = '';
    if (['vscode-ext', 'blender', 'browser-ext'].includes(h.family) || ctx.fake) { const r = io.run(p, ['--version'], { timeout: 6000 }); version = verFrom((r && r.stdout) || ''); }
    return { exe: p, cliPath: h.family === 'vscode-ext' ? p : null, version, sources: [c.startsWith('/') ? '安装目录' : 'PATH'] };
  }
  return null;
}

/** 检测全部宿主。opts 可注入 platform/env/io/regText（测试用） */
function detect(opts = {}) {
  const platform = opts.platform || process.env.PLUGIN_IDE_HOST_PLATFORM || process.platform;
  const env = opts.env || process.env, io = { ...defaultIo(), ...(opts.io || {}) };
  const ctx = { env, io, fake: !!env.PLUGIN_IDE_FAKE_HOSTS };
  if (platform === 'win32') {
    const reg = opts.reg || (env.PLUGIN_IDE_REG_DUMP ? { uninstall: io.readFile(env.PLUGIN_IDE_REG_DUMP), appPaths: '' } : readRegistry(io.run));
    ctx.regEntries = parseRegDump(reg.uninstall); ctx.appEntries = parseRegDump(reg.appPaths);
  }
  const t0 = Date.now();
  const list = HOSTS.map(h => {
    let f = null;
    try { f = platform === 'win32' ? detectWin(h, ctx) : platform === 'darwin' ? detectMac(h, ctx) : detectLinux(h, ctx); } catch {}
    return { key: h.key, name: h.name, vendors: h.vendors, family: h.family, installed: !!f, version: f?.version || '', path: f?.exe || '', cli: f?.cliPath || '', sources: f?.sources || [] };
  });
  return { platform, scannedAt: new Date().toISOString(), ms: Date.now() - t0, hosts: list };
}
let CACHE = null;
function scan({ fresh } = {}) { if (!CACHE || fresh || Date.now() - CACHE.t > 5 * 60000) CACHE = { t: Date.now(), r: detect() }; return CACHE.r; }
const resetCache = () => { CACHE = null; };
/** 某厂商 / 家族对应的宿主：先精确匹配厂商，再按家族（如 Chrome 项目也可在 Edge 测） */
function forVendor(vendorId, family, result = scan()) {
  const exact = result.hosts.filter(h => h.vendors.includes(vendorId));
  const fam = result.hosts.filter(h => h.family === family && !exact.includes(h) && (family === 'browser-ext' || family === 'vscode-ext'));
  const all = [...exact, ...fam];
  return { exact, compatible: fam, best: all.find(h => h.installed) || null, candidates: all };
}
/** 厂商 id → 是否已安装（厂商库标记用） */
function vendorMap(result = scan()) { const m = {}; for (const h of result.hosts) if (h.installed) for (const v of h.vendors) m[v] = m[v] || { key: h.key, name: h.name, version: h.version }; return m; }

module.exports = { HOSTS, detect, scan, resetCache, forVendor, vendorMap, parseRegDump, globPaths, expandEnv, whichIn, verFrom };
