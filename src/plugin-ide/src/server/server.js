// 后端：REST API + 静态宿主 UI + 管理内嵌 OpenVSCode Server
const express = require('express'), path = require('path'), fs = require('fs'), net = require('net'), { spawn } = require('child_process');
const L = require('../core/lifecycle'), registry = require('../core/registry'), llm = require('../core/llm');
const SETTINGS_FILE = () => path.join(process.env.PLUGIN_IDE_DATA || path.join(require('os').homedir(), '.plugin-ide'), 'settings.json');
const getSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch { return { provider: 'mock' }; } };
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function waitHttp(u, ms) { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(u); if (r.status < 500) return true; } catch {} await new Promise(r => setTimeout(r, 300)); } return false; }
/** 按平台选择内嵌代码编辑器：Windows → code-server；Linux/macOS → OpenVSCode Server */
function resolveIde(appRoot) {
  if (process.env.PLUGIN_IDE_NO_EMBED === '1') return null;
  const isWin = process.platform === 'win32';
  if (isWin) {
    const root = path.join(appRoot, 'vendor', 'code-server');
    const node = path.join(root, 'lib', 'node.exe');
    const cmd = path.join(root, 'bin', 'code-server.cmd');
    if (fs.existsSync(node) && fs.existsSync(root)) return { kind: 'code-server', root, node, cmd };
    return null;
  }
  const bin = path.join(appRoot, 'vendor', 'openvscode-server', 'bin', 'openvscode-server');
  if (fs.existsSync(bin) && fs.existsSync(path.join(appRoot, 'vendor', 'openvscode-server', 'out', 'server-main.js'))) return { kind: 'openvscode', bin };
  return null;
}
function writeIdeSettings(ud, theme) {
  const ms = path.join(ud, 'data', 'Machine'); fs.mkdirSync(ms, { recursive: true });
  const colorTheme = (theme === 'light') ? 'Default Light Modern' : 'Default Dark Modern';
  // Hide Get Started / Welcome; sync app light/dark
  const settings = {
    'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none',
    'workbench.welcomePage.walkthroughs.openOnInstall': false,
    'workbench.colorTheme': colorTheme,
    'workbench.preferredDarkColorTheme': 'Default Dark Modern',
    'workbench.preferredLightColorTheme': 'Default Light Modern',
    'files.exclude': { '**/.pluginide.json': true, '**/.pluginide-history': true },
    'window.title': '插件工坊 — ${rootName}',
    'telemetry.telemetryLevel': 'off',
    'extensions.ignoreRecommendations': true,
  };
  fs.writeFileSync(path.join(ms, 'settings.json'), JSON.stringify(settings, null, 2));
  const us = path.join(ud, 'User'); fs.mkdirSync(us, { recursive: true });
  fs.writeFileSync(path.join(us, 'settings.json'), JSON.stringify(settings, null, 2));
  // Also write to data/User for OpenVSCode variants
  const us2 = path.join(ud, 'data', 'User'); fs.mkdirSync(us2, { recursive: true });
  fs.writeFileSync(path.join(us2, 'settings.json'), JSON.stringify(settings, null, 2));
}
function killTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-proc.pid, 'SIGTERM');
    }
  } catch {}
}
async function startIde(appRoot) {
  const ide = resolveIde(appRoot); if (!ide) return null;
  const port = await freePort();
  const ud = path.join(process.env.PLUGIN_IDE_DATA || path.join(require('os').homedir(), '.plugin-ide'), ide.kind === 'code-server' ? 'cs' : 'ovs');
  writeIdeSettings(ud, getSettings().theme || 'dark');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let p;
  if (ide.kind === 'code-server') {
    // Windows: node.exe out/entry (via package main) with code-server flags
    const args = [ide.root, '--bind-addr', `127.0.0.1:${port}`, '--auth', 'none', '--user-data-dir', ud, '--extensions-dir', path.join(ide.root, 'extensions'), '--disable-telemetry', '--disable-update-check', L.root()];
    p = spawn(ide.node, args, { env, stdio: 'ignore', windowsHide: true, detached: false });
  } else {
    p = spawn(ide.bin, ['--host', '127.0.0.1', '--port', String(port), '--without-connection-token', '--server-data-dir', ud, '--default-folder', L.root(), '--disable-telemetry', '--disable-workspace-trust'], { env, stdio: 'ignore', detached: true }); // 独立进程组，便于 killTree 整组结束
  }
  p.killTree = () => killTree(p);
  process.on('exit', p.killTree);
  return { port, url: `http://127.0.0.1:${port}`, proc: p, kind: ide.kind };
}

async function start({ port = 0, appRoot = path.join(__dirname, '..', '..') } = {}) {
  const app = express(); app.use(express.json({ limit: '5mb' }));
  let ide = null;
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(400).json({ error: e.message }); } };
  app.get('/api/info', h(() => ({ vendors: registry.all().length, families: Object.keys(registry.FAMILIES).length, workspace: L.root(), ide: ide ? ide.url : null, provider: llm.getProvider(getSettings()).name })));
  app.get('/api/vendors', h(req => { const q = (req.query.q || '').toLowerCase(), c = req.query.category; return registry.all().filter(v => (!q || (v.name + v.company + v.category + v.family).toLowerCase().includes(q)) && (!c || v.category === c)); }));
  app.get('/api/vendors/:id', h(req => registry.resolve(req.params.id)));
  app.get('/api/families', h(() => registry.FAMILIES));
  app.post('/api/vendors/ai-extend', h(req => L.aiExtendVendor(req.body.description, getSettings())));
  app.get('/api/projects', h(() => L.list()));
  app.post('/api/projects', h(req => L.create(req.body)));
  app.get('/api/projects/:n', h(req => ({ ...L.meta(req.params.n), dir: L.pdir(req.params.n), files: L.files(req.params.n) })));
  app.get('/api/projects/:n/file', h(req => ({ content: L.readFile(req.params.n, req.query.path) })));
  app.put('/api/projects/:n/file', h(req => L.writeFile(req.params.n, req.body.path, req.body.content)));
  app.post('/api/projects/:n/build', h(req => L.build(req.params.n)));
  app.post('/api/projects/:n/validate', h(req => L.validate(req.params.n, getSettings())));
  app.post('/api/projects/:n/package', h(req => L.pack(req.params.n)));
  app.post('/api/projects/:n/publish', h(req => L.publish(req.params.n, req.body)));
  app.post('/api/projects/:n/version', h(req => L.bump(req.params.n, req.body.level)));
  app.post('/api/projects/:n/deprecate', h(req => L.deprecate(req.params.n, req.body.reason)));
  // AI 开发：预览多文件（默认不落盘）；body.apply=true 直接写入
  app.post('/api/projects/:n/ai-dev', h(req => L.aiDev(req.params.n, {
    path: req.body.path,
    prompt: req.body.prompt || req.body.ask,
    apply: !!req.body.apply
  }, getSettings())));
  // 应用 AI 预览中的文件变更
  app.post('/api/projects/:n/ai-apply', h(req => L.applyFiles(req.params.n, req.body.files || [], req.body.label || 'AI 变更')));
  // 结构化 AI 调试（可基于最近构建或自定义 context）
  app.post('/api/projects/:n/ai-debug', h(async req => {
    const name = req.params.n;
    const m = L.meta(name);
    const ctx = req.body.context || [
      ...(m.lastBuild?.log || []),
      ...L.files(name).filter(f => /\.(js|py|ts)$/.test(f)).map(f => `--- ${f}\n${L.readFile(name, f).slice(0, 4000)}`)
    ].join('\n');
    return L.aiDebug(name, ctx, getSettings());
  }));
  // 一键应用单条 AI 修复
  app.post('/api/projects/:n/ai-fix', h(req => L.aiApplyFix(req.params.n, req.body)));
  // —— AI-first 智能体流程 ——
  const agent = require('../core/agent'), knowledge = require('../core/knowledge');
  app.post('/api/agent/intent', h(req => agent.intent(req.body.prompt, getSettings())));
  app.post('/api/agent/plan', h(req => agent.plan(req.body, getSettings())));
  app.post('/api/agent/run', h(req => agent.run(req.body, getSettings())));
  app.get('/api/agent/jobs/:id', h(req => agent.job(req.params.id)));
  app.post('/api/agent/jobs/:id/cancel', h(req => agent.cancel(req.params.id)));
  app.post('/api/agent/jobs/:id/confirm', h(req => agent.confirm(req.params.id, req.body?.decision || 'approve')));
  app.get('/api/agent/jobs/:id/events', (req, res) => {
    try {
      const id = req.params.id;
      agent.job(id); // throws if missing
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      const unsub = agent.subscribe(id, res);
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
      req.on('close', () => { clearInterval(hb); unsub(); });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/projects/:n/agent-iterate', h(req => agent.iterate(req.params.n, req.body, getSettings())));
  app.get('/api/projects/:n/checkpoints', h(req => L.checkpoints(req.params.n)));
  app.post('/api/projects/:n/checkpoints/:id/restore', h(req => L.restore(req.params.n, req.params.id)));
  app.get('/api/vendors/:id/knowledge', h(req => { const a = registry.resolve(req.params.id); if (!a) throw new Error('未知厂商'); return knowledge.forAdapter(a); }));
  // 上下文感知聊天
  app.post('/api/ai/chat', h(async req => L.aiChat(req.body, getSettings())));
  app.get('/api/settings', h(() => {
    const s = getSettings();
    return {
      provider: s.provider || 'mock', baseUrl: s.baseUrl || '', apiKey: s.apiKey ? '***' : '', model: s.model || '',
      temperature: s.temperature != null ? s.temperature : 0.2,
      autoApplyAi: s.autoApplyAi !== false,
      theme: s.theme || 'light',
      toolchain: L.toolchainDetect ? L.toolchainDetect() : {},
    };
  }));
  app.put('/api/settings', h(req => {
    const cur = getSettings();
    const nx = { ...cur };
    for (const k of ['provider', 'baseUrl', 'apiKey', 'model', 'temperature', 'autoApplyAi', 'theme']) {
      if (req.body[k] !== undefined) nx[k] = req.body[k];
    }
    if (req.body.apiKey === '***') nx.apiKey = cur.apiKey;
    if (nx.temperature != null) nx.temperature = Number(nx.temperature);
    if (nx.autoApplyAi != null) nx.autoApplyAi = !!nx.autoApplyAi;
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(nx, null, 2));
    // sync IDE theme if running
    try { if (ide) writeIdeSettings(path.join(process.env.PLUGIN_IDE_DATA || path.join(require('os').homedir(), '.plugin-ide'), ide.kind === 'code-server' ? 'cs' : 'ovs'), nx.theme); } catch {}
    return { ok: true, provider: llm.getProvider(nx).name, autoApplyAi: nx.autoApplyAi !== false };
  }));
  app.post('/api/ide/theme', h(req => {
    const theme = req.body?.theme === 'light' ? 'light' : 'dark';
    const cur = getSettings(); const nx = { ...cur, theme };
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(nx, null, 2));
    if (ide) {
      const ud = path.join(process.env.PLUGIN_IDE_DATA || path.join(require('os').homedir(), '.plugin-ide'), ide.kind === 'code-server' ? 'cs' : 'ovs');
      writeIdeSettings(ud, theme);
    }
    return { ok: true, theme };
  }));
  // —— v1.2.0 ——
  const X = require('../core/extras');
  app.get('/api/projects/:n/docs', h(req => X.docs(req.params.n).map(({ text, ...d }) => ({ ...d, preview: text.slice(0, 160) }))));
  app.post('/api/projects/:n/docs', h(req => { return X.addDoc(req.params.n, req.body).then(({ text, ...d }) => d); }));
  app.delete('/api/projects/:n/docs/:id', h(req => X.removeDoc(req.params.n, req.params.id)));
  app.get('/api/projects/:n/checkpoints/:id/diff', h(req => X.cpDiff(req.params.n, req.params.id)));
  app.post('/api/projects/:n/checkpoints/:id/restore-file', h(req => X.restoreFile(req.params.n, req.params.id, req.body.path)));
  app.get('/api/projects/:n/install-guide', h(req => X.installGuide(req.params.n)));
  app.post('/api/projects/:n/reveal', h(req => X.revealArtifact(req.params.n)));
  app.post('/api/projects/:n/install-vscode', h(req => X.installVscode(req.params.n)));
  app.get('/api/projects/:n/publish-explain', h(req => X.publishExplain(req.params.n)));
  app.post('/api/settings/test', h(req => X.testLlm(req.body || {}, getSettings())));
  // —— v1.3.0 环境检测 + 一键安装并打开测试 ——
  const H = require('../core/hosts'), HI = require('../core/hostinstall');
  app.get('/api/hosts', h(req => H.scan({ fresh: req.query.fresh === '1' })));
  app.get('/api/hosts/vendor-map', h(() => H.vendorMap()));
  app.get('/api/projects/:n/host-install', h(req => HI.plan(req.params.n, req.query.host)));
  app.post('/api/projects/:n/host-install', h(req => HI.installAndOpen(req.params.n, { hostKey: req.body?.host })));
  app.post('/api/projects/:n/host-uninstall', h(req => HI.uninstall(req.params.n, req.body?.host)));
  app.use(express.static(path.join(appRoot, 'ui')));
  const srv = await new Promise(r => { const s = app.listen(port, '127.0.0.1', () => r(s)); });
  process.env.PLUGIN_IDE_API = `http://127.0.0.1:${srv.address().port}`;
  ide = await startIde(appRoot);
  if (ide) {
    const ok = await waitHttp(ide.url, 30000);
    if (!ok) {
      try { ide.proc.killTree(); } catch {}
      ide = null; // 启动失败时不要把坏 URL 交给前端，避免代码页空白
    }
  }
  return { server: srv, port: srv.address().port, ide, close: () => { srv.close(); if (ide) ide.proc.killTree(); } };
}
module.exports = { start };
if (require.main === module) start({ port: +process.env.PORT || 7788 }).then(({ port, ide }) => console.log(`Plugin IDE http://127.0.0.1:${port}  embedded IDE: ${ide ? ide.url : 'disabled'}`));
