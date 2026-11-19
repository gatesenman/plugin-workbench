// v1.3 环境检测 + 一键安装：Windows 注册表解析（模拟）、Linux 假安装检测、各家族安装/卸载
const assert = require('assert'), os = require('os'), fs = require('fs'), path = require('path');
process.env.PLUGIN_IDE_WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-h-')); process.env.PLUGIN_IDE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-hd-'));
const fake = require('./fixtures/fakehosts')(); Object.assign(process.env, fake.env);
const H = require('../src/core/hosts'), HI = require('../src/core/hostinstall'), L = require('../src/core/lifecycle'), A = require('../src/core/agent');
const waitJob = async id => { let j; do { await new Promise(r => setTimeout(r, 100)); j = A.job(id); } while (j.status === 'running'); return j; };
(async () => {
  // 1) Windows：注册表 Uninstall + App Paths + 安装目录通配 + PATH（全部模拟）
  const W = 'C:\\Users\\u\\AppData\\Local', PF = 'C:\\Program Files';
  const files = new Set([`${W}\\Programs\\Microsoft VS Code\\Code.exe`, `${W}\\Programs\\Microsoft VS Code\\bin\\code.cmd`, `${PF}\\Google\\Chrome\\Application\\chrome.exe`, `${PF}\\Blender Foundation\\Blender 4.2\\blender.exe`, `${PF}\\Blender Foundation\\Blender 4.5\\blender.exe`,
    `${PF}\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe`, `${PF}\\Autodesk\\AutoCAD 2026\\acad.exe`, `${PF}\\Microsoft Office\\root\\Office16\\EXCEL.EXE`, `${W}\\Programs\\Obsidian\\Obsidian.exe`, 'C:\\tools\\cursor.cmd']);
  const dirs = { [`${PF}\\Blender Foundation`]: ['Blender 4.2', 'Blender 4.5'], [`${PF}\\Adobe`]: ['Adobe Photoshop 2025', 'Adobe Illustrator 2025'], [`${PF}\\Autodesk`]: ['AutoCAD 2026'] };
  const reg = { uninstall: `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{771FD6B0}_is1
    DisplayName    REG_SZ    Microsoft Visual Studio Code (User)
    DisplayVersion    REG_SZ    1.105.1
    InstallLocation    REG_SZ    ${W}\\Programs\\Microsoft VS Code\\

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\O365ProPlusRetail - zh-cn
    DisplayName    REG_SZ    Microsoft 365 企业应用版 - zh-cn
    DisplayVersion    REG_SZ    16.0.19127.20000

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PHSP_26_0
    DisplayName    REG_SZ    Adobe Photoshop 2025
    DisplayVersion    REG_SZ    26.0.0
`, appPaths: `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe
    (Default)    REG_SZ    ${PF}\\Google\\Chrome\\Application\\chrome.exe
    Path    REG_SZ    ${PF}\\Google\\Chrome\\Application
` };
  const io = { exists: p => files.has(p) || p in dirs, readdir: p => { if (!dirs[p]) throw new Error('ENOENT'); return dirs[p]; }, readFile: () => { throw new Error('no'); }, run: () => ({ status: 1, stdout: '' }) };
  const r = H.detect({ platform: 'win32', env: { LOCALAPPDATA: W, ProgramFiles: PF, 'ProgramFiles(x86)': 'C:\\Program Files (x86)', PATH: 'C:\\tools;C:\\Windows' }, io, reg });
  const g = k => r.hosts.find(h => h.key === k);
  assert.ok(g('vscode').installed); assert.strictEqual(g('vscode').version, '1.105.1'); assert.ok(g('vscode').cli.endsWith('bin\\code.cmd')); assert.ok(g('vscode').sources.includes('注册表'));
  assert.ok(g('chrome').installed); assert.ok(g('chrome').sources.includes('App Paths'));
  assert.ok(g('blender').path.includes('Blender 4.5'), '多版本取最新'); assert.strictEqual(g('blender').version, '4.5');
  assert.strictEqual(g('photoshop').version, '26.0.0'); assert.strictEqual(g('autocad').version, '2026');
  assert.ok(g('excel').installed); assert.strictEqual(g('excel').version, '16.0.19127.20000'); assert.ok(!g('word').installed, 'Office 套件在，但没装 Word');
  assert.ok(g('cursor').installed && g('cursor').sources.includes('PATH')); assert.ok(g('obsidian').installed); assert.ok(!g('maya').installed); assert.ok(!g('illustrator').installed);
  assert.strictEqual(H.parseRegDump('HKEY_X\\a\n    (默认)    REG_SZ    C:\\x.exe\n')[0][''], 'C:\\x.exe');
  // 2) macOS（模拟 /Applications）
  const m = H.detect({ platform: 'darwin', env: { HOME: '/Users/u' }, io: { exists: p => ['/Applications/Blender.app', '/Applications/Blender.app/Contents/MacOS/Blender'].includes(p) || p === '/Applications', readdir: p => p === '/Applications' ? ['Blender.app'] : [], readFile: () => '<key>CFBundleShortVersionString</key>\n<string>4.4.1</string>' } });
  assert.strictEqual(m.hosts.find(h => h.key === 'blender').version, '4.4.1');
  // 3) Linux 假安装（真实 PATH 扫描 + --version）
  H.resetCache(); const lx = H.scan({ fresh: true }), lg = k => lx.hosts.find(h => h.key === k);
  assert.ok(lg('vscode').installed && lg('vscode').version === '1.105.1'); assert.strictEqual(lg('blender').version, '4.5.3'); assert.ok(lg('obsidian').installed); assert.ok(lg('maya').installed);
  assert.strictEqual(H.vendorMap(lx)['visual-studio-code'].key, 'vscode');
  // 4) 安装并打开：VS Code
  const mkProj = async (v, n) => { L.create({ vendorId: v, name: n }); assert.ok(L.build(n).ok); await L.pack(n); };
  await mkProj('visual-studio-code', 'hv'); let j = await waitJob(HI.installAndOpen('hv').jobId);
  assert.strictEqual(j.status, 'done'); assert.ok(j.result.ok, JSON.stringify(j)); await new Promise(r => setTimeout(r, 300));
  assert.ok(/code --install-extension .*hv-0\.0\.1\.vsix --force/.test(fake.calls()), fake.calls()); assert.ok(/code --new-window/.test(fake.calls()));
  assert.ok(L.meta('hv').installs.vscode.extId.endsWith('.hv'));
  const un = await HI.uninstall('hv', 'vscode'); assert.ok(un.ok); assert.ok(/--uninstall-extension/.test(fake.calls())); assert.ok(!L.meta('hv').installs.vscode);
  // Blender 4.5 → extension install-file
  await mkProj('blender', 'hb'); j = await waitJob(HI.installAndOpen('hb').jobId); assert.ok(j.result.ok); assert.ok(/blender --command extension install-file -r user_default -e .*hb-0\.0\.1\.zip/.test(fake.calls()));
  // Obsidian：复制到最近库并启用
  await mkProj('obsidian', 'ho'); j = await waitJob(HI.installAndOpen('ho').jobId); assert.ok(j.result.ok, JSON.stringify(j));
  const pdir = path.join(fake.vault, '.obsidian', 'plugins', 'ho'); assert.ok(fs.existsSync(path.join(pdir, 'manifest.json'))); assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fake.vault, '.obsidian', 'community-plugins.json'))), ['ho']);
  await HI.uninstall('ho', 'obsidian'); assert.ok(!fs.existsSync(pdir)); assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fake.vault, '.obsidian', 'community-plugins.json'))), []);
  // Maya：复制到测试目录 + 环境变量启动
  await mkProj('maya', 'hm'); j = await waitJob(HI.installAndOpen('hm').jobId); assert.ok(j.result.ok); assert.ok(j.steps.some(s => /MAYA_SCRIPT_PATH=/.test(s.detail)));
  // 未安装宿主（Figma）→ 手动步骤；未打包 → 提示先打包
  await mkProj('figma', 'hf'); const pf = HI.plan('hf'); assert.strictEqual(pf.auto, false); assert.ok(pf.manual.some(s => s.includes('从清单导入')));
  j = await waitJob(HI.installAndOpen('hf').jobId); assert.strictEqual(j.result.ok, false); assert.ok(j.result.manual.length);
  L.create({ vendorId: 'excel', name: 'hx' }); assert.strictEqual(HI.plan('hx').packaged, false); j = await waitJob(HI.installAndOpen('hx').jobId); assert.ok(/打包/.test(j.result.reason));
  // 取消
  const slow = path.join(fake.bin, 'code'); const orig = fs.readFileSync(slow, 'utf8'); fs.writeFileSync(slow, orig.replace('exit 0\n', 'sleep 30\nexit 0\n').replace(/exit 0; fi/, 'exit 0; fi'));
  const { jobId } = HI.installAndOpen('hv'); await new Promise(r => setTimeout(r, 400)); A.cancel(jobId); j = await waitJob(jobId); assert.strictEqual(j.status, 'cancelled'); fs.writeFileSync(slow, orig);
  console.log('hosts unit tests OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
