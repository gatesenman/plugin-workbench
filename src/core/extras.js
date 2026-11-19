// v1.2.0 业务向能力：项目资料、快照文件级 diff、安装向导、发布说明、AI 连接测试
const fs = require('fs'), path = require('path'), { spawn, spawnSync } = require('child_process');
const L = () => require('./lifecycle'), registry = require('./registry');
const HIST = '.pluginide-history';

// —— 项目资料（喂给 AI 提示词）——
function docs(name) { return L().meta(name).contextDocs || []; }
function htmlToText(html) {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
async function addDoc(name, { title, text, url }) {
  let body = (text || '').trim(), source = 'text';
  if (url) {
    if (!/^https?:\/\//i.test(url)) throw new Error('网址需以 http:// 或 https:// 开头');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    let r; try { r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'PluginWorkbench/1.2' } }); } catch (e) { throw new Error('无法打开该网址：' + (e.name === 'AbortError' ? '超时' : e.message)); } finally { clearTimeout(t); }
    if (!r.ok) throw new Error('网页返回错误 ' + r.status);
    const raw = await r.text();
    body = /html/i.test(r.headers.get('content-type') || '') || /<html/i.test(raw) ? htmlToText(raw) : raw.trim();
    source = url;
    if (!title) title = (raw.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || url;
  }
  if (!body) throw new Error('资料内容为空');
  body = body.slice(0, 20000);
  const m = L().meta(name); m.contextDocs = m.contextDocs || [];
  const d = { id: Date.now().toString(36), title: (title || body.slice(0, 20)).slice(0, 80), source, chars: body.length, text: body, at: new Date().toISOString() };
  m.contextDocs.push(d); L().saveMeta(name, m); return d;
}
function removeDoc(name, id) { const m = L().meta(name); m.contextDocs = (m.contextDocs || []).filter(d => d.id !== id); L().saveMeta(name, m); return { ok: true }; }
function contextBlock(name) {
  try { const ds = docs(name); if (!ds.length) return ''; let budget = 12000;
    return '\n【项目资料 · 用户提供，请遵循】\n' + ds.map(d => { const t = d.text.slice(0, Math.max(0, budget)); budget -= t.length; return `## ${d.title}\n${t}`; }).join('\n') + '\n';
  } catch { return ''; }
}

// —— 快照文件级 diff + 单文件恢复 ——
function loadCp(name, id) { const f = path.join(L().pdir(name), HIST, path.basename(id) + '.json'); if (!fs.existsSync(f)) throw new Error('快照不存在'); return JSON.parse(fs.readFileSync(f, 'utf8')); }
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  if (n * m > 4e6) return { added: m, removed: n, text: '(文件较大，省略逐行对比)' };
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0, added = 0, removed = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { out.push('  ' + A[i]); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { out.push('+ ' + B[j]); j++; added++; }
    else { out.push('- ' + A[i]); i++; removed++; }
  }
  // 只保留改动附近 3 行
  const keep = new Set(); out.forEach((l, k) => { if (l[0] !== ' ') for (let d = -3; d <= 3; d++) keep.add(k + d); });
  const txt = []; let gap = false; out.forEach((l, k) => { if (keep.has(k)) { txt.push(l); gap = false; } else if (!gap) { txt.push('  …'); gap = true; } });
  return { added, removed, text: txt.join('\n') };
}
function cpDiff(name, id) {
  const c = loadCp(name, id), cur = L().readExistingMap(name), all = [...new Set([...Object.keys(c.files), ...Object.keys(cur)])].sort();
  const files = [];
  for (const f of all) {
    const a = c.files[f], b = cur[f];
    if (a === b) continue;
    const status = a == null ? 'added' : b == null ? 'deleted' : 'modified';
    const d = lineDiff(a || '', b || '');
    files.push({ path: f, status, added: d.added, removed: d.removed, diff: d.text });
  }
  return { id: c.id, label: c.label, at: c.at, files, unchanged: all.length - files.length };
}
function restoreFile(name, id, file) {
  const c = loadCp(name, id); L().snapshot(name, `恢复单个文件前自动保存（${file}）`);
  if (file in c.files) { L().writeFile(name, file, c.files[file]); return { ok: true, file, action: 'restored' }; }
  const p = path.resolve(L().pdir(name), file); if (!p.startsWith(L().pdir(name) + path.sep)) throw new Error('bad path');
  if (fs.existsSync(p)) fs.rmSync(p); return { ok: true, file, action: 'removed' };
}

// —— 安装向导（业务语言）——
function which(cmd) { const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null; }
function installGuide(name) {
  const m = L().meta(name), a = registry.resolve(m.vendorId) || { name: m.vendorName, family: m.family };
  if (!m.artifact) return { ready: false, host: a.name, steps: ['还没有安装包。请先点击「打包」生成安装文件。'] };
  const dir = L().pdir(name), file = path.join(dir, m.artifact.file), folder = path.dirname(file);
  const unpacked = path.join(dir, 'build');
  const fam = a.family; let steps, oneClick = null, title = `如何安装到 ${a.name}`, pathToCopy = file;
  if (fam === 'browser-ext') {
    pathToCopy = unpacked;
    steps = [`打开 ${/edge/i.test(a.name) ? 'Edge' : 'Chrome'} 浏览器，在地址栏输入 ${/edge/i.test(a.name) ? 'edge://extensions' : 'chrome://extensions'} 并回车。`, '打开页面右上角的「开发者模式」开关。', '点击左上角「加载已解压的扩展程序」。', `在弹出的窗口中选择这个文件夹：${unpacked}（可点下方「复制路径」后粘贴）。`, '看到扩展卡片出现即安装成功，可把它固定到工具栏上使用。'];
    oneClick = { kind: 'copy-url', label: '复制 chrome://extensions', value: 'chrome://extensions', note: '浏览器安全限制不允许其他程序直接打开该页面，请粘贴到地址栏。' };
  } else if (fam === 'vscode-ext') {
    steps = ['打开 VS Code。', '按 Ctrl+Shift+X 打开「扩展」面板。', '点击面板右上角「…」→「从 VSIX 安装…」。', `选择安装包：${file}`, '右下角提示安装完成后，按提示重新加载窗口即可使用。'];
    const code = which('code');
    oneClick = code ? { kind: 'vscode', label: '一键安装到 VS Code', available: true } : { kind: 'vscode', label: '一键安装到 VS Code', available: false, note: '本机未找到 code 命令（可在 VS Code 中按 Ctrl+Shift+P 运行「Shell Command: Install code command in PATH」），请按上面的手动步骤安装。' };
  } else if (fam === 'office-addin') {
    const mf = path.join(unpacked, 'manifest.xml'); pathToCopy = fs.existsSync(mf) ? mf : file;
    steps = ['打开 Excel（或对应的 Office 应用），新建或打开一个文件。', '点击「开始」→「加载项」（或「插入」→「我的加载项」）。', '选择「上传我的加载项」（网页版）/「管理我的加载项 → 上传」。', `选择清单文件：${pathToCopy}`, '加载项按钮会出现在功能区，点击即可打开任务窗格。', '提示：Windows 桌面版也可以把清单所在文件夹设为「共享文件夹」后，在「信任中心 → 受信任的加载项目录」中添加，再从「共享文件夹」里加载。'];
  } else if (fam === 'blender') {
    steps = ['打开 Blender。', '菜单「编辑」→「偏好设置」→「插件」（Blender 4.2+ 为「获取扩展」）。', '点击右上角下拉箭头 →「从磁盘安装…」。', `选择安装包：${file}`, '在插件列表中勾选启用，即可在 3D 视图侧边栏（N 键）找到它。'];
  } else {
    steps = [`插件工坊暂未内置「${a.name}」的自动安装步骤。`, `安装包位置：${file}`, `请在 ${a.name} 中查找「插件 / 扩展 / 加载项 → 从本地安装（或导入）」类似的入口，然后选择上面的安装包。`, ...(a.docs ? [`官方说明：${Array.isArray(a.docs) ? a.docs[0] : a.docs}`] : []), '如果是公司内部系统，请把安装包和 README 一起发给系统管理员，由管理员部署。'];
  }
  return { ready: true, host: a.name, family: fam, title, steps, file, folder, pathToCopy, oneClick };
}
function reveal(p) {
  try { const { shell } = require('electron'); if (shell?.showItemInFolder) { shell.showItemInFolder(p); return { ok: true }; } } catch {}
  const cmd = process.platform === 'win32' ? ['explorer', ['/select,', p]] : process.platform === 'darwin' ? ['open', ['-R', p]] : ['xdg-open', [path.dirname(p)]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
function revealArtifact(name) { const g = installGuide(name); if (!g.ready) throw new Error('还没有安装包'); return reveal(g.file); }
function installVscode(name) {
  const g = installGuide(name); if (g.family !== 'vscode-ext') throw new Error('该项目不是 VS Code 扩展');
  const code = which('code'); if (!code) return { ok: false, message: '本机未找到 code 命令，请按手动步骤安装。' };
  const r = spawnSync(code, ['--install-extension', g.file, '--force'], { encoding: 'utf8', timeout: 120000, shell: process.platform === 'win32' });
  return r.status === 0 ? { ok: true, message: '已安装到 VS Code，重新打开 VS Code 窗口即可使用。', log: r.stdout } : { ok: false, message: '安装失败：' + (r.stderr || r.stdout || r.error?.message || '').slice(0, 300) };
}

// —— 发布说明（dry-run 后告诉业务真实发布需要什么）——
const PUB = {
  'vscode-ext': { store: 'VS Code 扩展市场', url: 'https://marketplace.visualstudio.com/manage', account: '在 Azure DevOps 创建 Publisher（发布者）并生成个人访问令牌（PAT）', cmd: f => `npx @vscode/vsce publish --packagePath ${f}` },
  'browser-ext': { store: 'Chrome 网上应用店', url: 'https://chrome.google.com/webstore/devconsole', account: '注册 Chrome 开发者账号（一次性 5 美元注册费）', cmd: f => `在开发者后台点击「新增项」上传 ${f}` },
  'office-addin': { store: 'Microsoft AppSource / 企业内部部署', url: 'https://partner.microsoft.com/dashboard', account: '对外：Microsoft 合作伙伴中心账号；对内：由 M365 管理员在「集成应用」中部署', cmd: () => '在 M365 管理中心 → 设置 → 集成应用 → 上传自定义应用（manifest.xml）' },
  'blender': { store: 'Blender 扩展平台', url: 'https://extensions.blender.org/submit/', account: '注册 Blender ID 账号', cmd: f => `blender --command extension validate ${f}，然后在网页上传` },
  'jetbrains': { store: 'JetBrains Marketplace', url: 'https://plugins.jetbrains.com/', account: '注册 JetBrains 账号并生成发布令牌（PUBLISH_TOKEN）', cmd: () => 'gradle publishPlugin' },
};
function publishExplain(name) {
  const m = L().meta(name), a = registry.resolve(m.vendorId) || {}, p = PUB[a.family];
  const f = m.artifact?.file || '<安装包>';
  const base = { what: '刚才是「演练发布」（dry-run）：只检查并生成了发布清单，没有上传到任何商店，别人还看不到你的插件。' };
  if (!p) return { ...base, store: a.publishTarget || '宿主的插件市场 / 内部分发', needs: ['确认该软件是否有官方插件市场；没有的话，直接把安装包发给使用者或系统管理员即可。', '如需上架，通常需要厂商的开发者账号。'], command: `上传 ${f}`, link: Array.isArray(a.docs) ? a.docs[0] : a.docs || '' };
  return { ...base, store: p.store, needs: [`开发者账号：${p.account}`, '准备好插件名称、简介、图标和截图（商店展示用）', '提交后一般需要商店审核，通常 1–7 天'], command: p.cmd(f), link: p.url, internal: '只在公司内部使用？不必上架，按「如何安装」的步骤把安装包发给同事即可。' };
}

// —— AI 连接测试 ——
async function testLlm({ baseUrl, apiKey, model, provider }, saved = {}) {
  if (provider === 'mock') return { ok: true, message: '离线演示模式无需连接。' };
  if (apiKey === '***') apiKey = saved.apiKey;
  if (!baseUrl) return { ok: false, message: '请填写接口地址（Base URL）。' };
  if (!model) return { ok: false, message: '请填写模型名称。' };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000); const t0 = Date.now();
  try {
    const r = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (apiKey || 'ollama') }, body: JSON.stringify({ model, messages: [{ role: 'user', content: '回复：OK' }], max_tokens: 5 }) });
    const txt = await r.text();
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'API Key 无效或没有权限，请检查是否复制完整。', detail: txt.slice(0, 200) };
    if (r.status === 404) return { ok: false, message: '接口地址或模型名不对（404）。请确认 Base URL 以 /v1 结尾、模型名拼写正确。', detail: txt.slice(0, 200) };
    if (r.status === 429) return { ok: false, message: '请求过于频繁或账户余额不足（429）。', detail: txt.slice(0, 200) };
    if (!r.ok) return { ok: false, message: `服务返回错误 ${r.status}。`, detail: txt.slice(0, 200) };
    let reply = ''; try { reply = JSON.parse(txt).choices?.[0]?.message?.content || ''; } catch { return { ok: false, message: '服务有响应，但格式不是 OpenAI 兼容接口。', detail: txt.slice(0, 200) }; }
    return { ok: true, message: `连接成功（${Date.now() - t0} ms），模型回复：${reply.slice(0, 40) || '(空)'}` };
  } catch (e) {
    return { ok: false, message: e.name === 'AbortError' ? '连接超时（20 秒），请检查网络或接口地址。' : `无法连接：${e.cause?.code === 'ECONNREFUSED' ? '对方拒绝连接（本地 Ollama 是否已启动？）' : e.cause?.code === 'ENOTFOUND' ? '找不到该地址，请检查拼写' : e.message}` };
  } finally { clearTimeout(t); }
}

module.exports = { docs, addDoc, removeDoc, contextBlock, htmlToText, cpDiff, restoreFile, lineDiff, installGuide, revealArtifact, installVscode, publishExplain, testLlm };
