// 插件全生命周期：init -> AI dev -> build -> validate(AI debug) -> package -> publish -> version/deprecate
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const archiver = require('archiver');
const registry = require('./registry'), templates = require('./templates'), llm = require('./llm'), ai = require('./ai'), toolchain = require('./toolchain');
const META = '.pluginide.json', HIST = '.pluginide-history';
const root = () => { const r = process.env.PLUGIN_IDE_WORKSPACE || path.join(require('os').homedir(), 'PluginIDE-Projects'); fs.mkdirSync(r, { recursive: true }); return r; };
const pdir = (name) => { const d = path.join(root(), name); if (!d.startsWith(root())) throw new Error('bad path'); return d; };
const meta = (name) => JSON.parse(fs.readFileSync(path.join(pdir(name), META), 'utf8'));
const saveMeta = (name, m) => fs.writeFileSync(path.join(pdir(name), META), JSON.stringify(m, null, 2));
const IGN = new Set(['build', 'dist', 'node_modules', '.git', META, HIST, '__pycache__']);
function walk(dir, base = dir) { let out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (IGN.has(e.name)) continue; const f = path.join(dir, e.name); if (e.isDirectory()) out = out.concat(walk(f, base)); else out.push(path.relative(base, f)); } return out.sort(); }
function log(name, stage, ok, lines) { const m = meta(name); m.stages[stage] = { ok, at: new Date().toISOString() }; m.history.push({ stage, ok, at: new Date().toISOString() }); saveMeta(name, m); return { stage, ok, log: lines }; }

function list() {
  return fs.readdirSync(root()).filter(n => fs.existsSync(path.join(root(), n, META))).map(n => { const m = meta(n); return { name: n, ...m, updatedAt: m.history?.[m.history.length - 1]?.at || m.createdAt }; })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
// —— 检查点：每次 AI 写盘前自动快照，可一键撤销 ——
function snapshot(name, label) {
  const d = path.join(pdir(name), HIST); fs.mkdirSync(d, { recursive: true });
  const id = Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex');
  const fl = {}; for (const f of walk(pdir(name))) fl[f] = fs.readFileSync(path.join(pdir(name), f), 'utf8');
  fs.writeFileSync(path.join(d, id + '.json'), JSON.stringify({ id, label, at: new Date().toISOString(), files: fl }));
  const all = fs.readdirSync(d).sort(); for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(d, old));
  return { id, label };
}
function checkpoints(name) {
  const d = path.join(pdir(name), HIST); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => { const c = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); return { id: c.id, label: c.label, at: c.at, files: Object.keys(c.files).length }; }).sort((a, b) => b.at.localeCompare(a.at));
}
function restore(name, id) {
  const f = path.join(pdir(name), HIST, path.basename(id) + '.json'); if (!fs.existsSync(f)) throw new Error('检查点不存在');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  snapshot(name, `撤销前自动保存（恢复到「${c.label}」）`);
  const removed = [];
  for (const cur of walk(pdir(name))) if (!(cur in c.files)) { fs.rmSync(path.join(pdir(name), cur)); removed.push(cur); }
  for (const [p, content] of Object.entries(c.files)) writeFile(name, p, content);
  const m = meta(name); m.history.push({ stage: 'restore', ok: true, at: new Date().toISOString(), label: c.label }); saveMeta(name, m);
  return { ok: true, restored: c.label, files: Object.keys(c.files), removed };
}
function create({ vendorId, name, description }) {
  const a = registry.resolve(vendorId); if (!a) throw new Error('未知厂商: ' + vendorId);
  name = (name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''); if (!name) throw new Error('项目名无效');
  const dir = pdir(name); if (fs.existsSync(dir)) throw new Error('项目已存在: ' + name);
  const files = templates.render(a, { name, displayName: name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' '), description: description || `${a.name} plugin` });
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  const m = { vendorId, vendorName: a.name, family: a.family, version: '0.0.1', status: 'active', stages: { init: { ok: true, at: new Date().toISOString() } }, history: [{ stage: 'init', ok: true, at: new Date().toISOString() }], createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, META), JSON.stringify(m, null, 2));
  return { name, dir, files: Object.keys(files), adapter: a };
}
const files = (name) => walk(pdir(name));
const safe = (name, f) => { const p = path.resolve(pdir(name), f); if (!p.startsWith(pdir(name) + path.sep)) throw new Error('bad path'); return p; };
const readFile = (name, f) => fs.readFileSync(safe(name, f), 'utf8');
const writeFile = (name, f, c) => { const p = safe(name, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return true; };

function readExistingMap(name) {
  const map = {};
  for (const f of files(name)) map[f] = readFile(name, f);
  return map;
}

function build(name) {
  const dir = pdir(name), out = path.join(dir, 'build'), a = registry.resolve(meta(name).vendorId), L = [`[build] 适配器 ${a.name} (${a.family}) · 构建: ${a.build}`];
  fs.rmSync(out, { recursive: true, force: true }); let ok = true;
  for (const f of files(name)) {
    const src = path.join(dir, f), dst = path.join(out, f); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst);
    let r = null;
    if (f.endsWith('.js')) r = spawnSync(process.env.PLUGIN_IDE_NODE || 'node', ['--check', src], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    else if (f.endsWith('.py')) r = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])', src], { encoding: 'utf8' });
    else if (f.endsWith('.json')) { try { JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) { r = { status: 1, stderr: e.message }; } }
    if (r && r.error) { L.push(`  ~ ${f} (跳过检查: ${r.error.code})`); continue; }
    if (r && r.status !== 0) { ok = false; L.push(`  ✗ ${f}\n${(r.stderr || '').trim()}`); } else L.push(`  ✓ ${f}`);
  }
  // Best-effort official toolchain (e.g. web-ext lint for browser-ext)
  try {
    const off = toolchain.runOfficial(a.family, 'build', dir, { name });
    if (off.log?.length) L.push(...off.log.map(x => '  ' + x));
    else if (off.skipped) L.push('  ℹ 未检测到官方工具，已跳过');
    else if (!off.ok) L.push('  ⚠ 官方工具链有警告（不阻断构建）');
  } catch (e) { L.push('  ⚠ 官方工具链调用异常: ' + e.message); }
  L.push(ok ? `[build] 成功 → ${path.relative(dir, out)}/` : '[build] 失败');
  const result = log(name, 'build', ok, L);
  // 缓存最近构建结果供 AI 聊天上下文
  const mm = meta(name); mm.lastBuild = { ok, at: new Date().toISOString(), log: L.slice(-20) }; saveMeta(name, mm);
  return result;
}
function checkManifest(name, a) {
  const L = [], mf = path.join(pdir(name), a.manifest); let ok = true;
  if (!fs.existsSync(mf)) return { ok: false, L: [`  ✗ 缺少清单文件 ${a.manifest}`] };
  const txt = fs.readFileSync(mf, 'utf8'); let obj = null; if (a.manifest.endsWith('.json')) try { obj = JSON.parse(txt); } catch (e) { return { ok: false, L: ['  ✗ 清单 JSON 无效: ' + e.message] }; }
  for (const k of a.manifestRequired || []) { const has = obj ? obj[k] !== undefined : txt.includes(k); if (!has) { ok = false; L.push(`  ✗ missing manifest field: ${k}`); } else L.push(`  ✓ ${k}`); }
  return { ok, L };
}
async function validate(name, settings) {
  const m = meta(name), a = registry.resolve(m.vendorId), L = [`[validate] 清单 ${a.manifest} 校验`];
  const mc = checkManifest(name, a); L.push(...mc.L);
  let ok = mc.ok; if (!m.stages.build?.ok) { ok = false; L.push('  ✗ 尚未成功构建'); }
  // Best-effort official validate (vsce / web-ext / office-addin-manifest / blender)
  try {
    const off = toolchain.runOfficial(a.family, 'validate', pdir(name), { name });
    if (off.log?.length || off.skipped || off.tool) {
      L.push('[官方工具链]');
      for (const line of (off.log || [])) L.push('  ' + line);
      if (off.skipped && !(off.log || []).length) L.push('  ℹ 未检测到官方工具，已跳过');
      else if (!off.skipped && !off.ok) { ok = false; L.push('  ✗ 官方工具链校验未通过'); }
      else if (!off.skipped && off.tool) L.push(`  ✓ 官方工具 ${off.tool} 通过`);
    }
  } catch (e) { L.push('  ⚠ 官方工具链异常（已忽略）: ' + e.message); }
  const ctx = L.join('\n') + '\n' + (m.lastBuild?.log || []).join('\n') + '\n' + files(name).filter(f => /\.(js|py|ts)$/.test(f)).map(f => `--- ${f}\n${readFile(name, f).slice(0, 4000)}`).join('\n');
  const dbg = await aiDebug(name, ctx, settings);
  L.push('[AI 调试/审查]', dbg.reply);
  L.push(ok ? '[validate] 通过' : '[validate] 未通过');
  const result = { ...log(name, 'validate', ok, L), ai: dbg.reply, tips: dbg.tips, fixes: dbg.fixes };
  const mm = meta(name); mm.lastValidate = { ok, at: new Date().toISOString(), tips: dbg.tips, fixCount: (dbg.fixes || []).length }; saveMeta(name, mm);
  return result;
}

async function aiDebug(nameOrCtx, contextOrSettings, maybeSettings) {
  // 兼容: aiDebug(ctx, settings) 或 aiDebug(name, ctx, settings)
  let name = null, context, settings;
  if (typeof contextOrSettings === 'string' || (maybeSettings !== undefined)) {
    name = nameOrCtx; context = contextOrSettings; settings = maybeSettings;
  } else {
    context = nameOrCtx; settings = contextOrSettings;
  }
  const provider = llm.getProvider(settings);
  if (provider.name === 'mock') {
    const structured = ai.mockDebugStructured(context);
    return structured;
  }
  const reply = await provider.chat([
    { role: 'system', content: ai.DEBUG_SYSTEM + (name ? (() => { try { return require('./knowledge').promptBlock(registry.resolve(meta(name).vendorId)) + require('./extras').contextBlock(name); } catch { return ''; } })() : '') },
    { role: 'user', content: context }
  ]);
  return { reply, tips: [], fixes: ai.extractFixes(reply) };
}

/**
 * AI 开发：多文件项目感知。
 * @param {string} name 项目名
 * @param {object} opts { path?, prompt, apply?: boolean }
 * @returns { reply, files:[{path,content,action}], code?, applied? }
 */
async function aiDev(name, fileOrOpts, askMaybe, settingsMaybe) {
  // 兼容旧签名 aiDev(name, file, ask, settings)
  let opts, settings;
  if (typeof fileOrOpts === 'string') {
    opts = { path: fileOrOpts, prompt: askMaybe, apply: false };
    settings = settingsMaybe;
  } else {
    opts = fileOrOpts || {};
    settings = askMaybe;
  }
  const ask = opts.prompt || opts.ask || '';
  const focusPath = opts.path || null;
  const m = meta(name), a = registry.resolve(m.vendorId);
  const existing = readExistingMap(name);
  const focusContent = focusPath && existing[focusPath] != null ? existing[focusPath] : (focusPath ? '' : null);
  const provider = llm.getProvider(settings);
  const metaDev = {
    adapter: a,
    projectName: name,
    displayName: name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' '),
    description: ask,
    ask,
    existingFiles: existing,
    focusPath,
    focusContent
  };

  let reply, fileList;
  if (provider.name === 'mock') {
    const r = ai.mockMultiFileDev(metaDev);
    reply = r.reply; fileList = r.files;
  } else {
    const fileSummary = Object.keys(existing).map(f => `- ${f} (${existing[f].length} bytes)`).join('\n');
    const focusBlock = focusPath
      ? `\n当前焦点文件 ${focusPath}:\n\`\`\`\n${(focusContent || '').slice(0, 12000)}\n\`\`\`\n`
      : '';
    reply = await provider.chat([
      { role: 'system', content: ai.DEV_SYSTEM(a) + require('./knowledge').promptBlock(a) + require('./extras').contextBlock(name) },
      { role: 'user', content: `项目 ${name} · 厂商 ${a.name} (${a.family})\n已有文件:\n${fileSummary || '(空)'}${focusBlock}\n需求：${ask}` }
    ]);
    const extracted = ai.extractFiles(reply);
    fileList = extracted.map(f => {
      const p = f.path || focusPath;
      if (!p) return null;
      return { path: p, content: f.content.endsWith('\n') ? f.content : f.content + '\n', action: existing[p] != null ? 'update' : 'create' };
    }).filter(Boolean);
    if (!fileList.length && focusPath) {
      const code = llm.extractCode(reply);
      if (code) fileList = [{ path: focusPath, content: code.endsWith('\n') ? code : code + '\n', action: 'update' }];
    }
  }

  // 规范化 action
  fileList = (fileList || []).map(f => ({
    ...f,
    action: f.action || (existing[f.path] != null ? 'update' : 'create')
  }));

  const code = focusPath ? (fileList.find(f => f.path === focusPath)?.content || null) : (fileList[0]?.content || null);
  let applied = false;
  if (opts.apply && fileList.length) {
    applyFiles(name, fileList);
    applied = true;
  }
  return { reply, files: fileList, code, applied, preview: !applied };
}

function applyFiles(name, fileList, label = 'AI 变更') {
  const applied = [];
  if ((fileList || []).some(f => f.path && f.content != null)) snapshot(name, label);
  for (const f of fileList) {
    if (!f.path || f.content == null) continue;
    writeFile(name, f.path, f.content);
    applied.push(f.path);
  }
  return { ok: true, applied };
}

async function aiApplyFix(name, fix) {
  if (!fix?.path || fix.content == null) throw new Error('无效修复');
  snapshot(name, 'AI 修复: ' + fix.path);
  writeFile(name, fix.path, fix.content);
  return { ok: true, path: fix.path };
}

async function aiChat(body, settings) {
  const { messages = [], context = {} } = body;
  const provider = llm.getProvider(settings);
  const chatContext = { ...context };
  if (context.project) {
    try {
      const m = meta(context.project);
      chatContext.files = files(context.project);
      chatContext.vendor = registry.resolve(m.vendorId);
      chatContext.lastBuild = m.lastBuild;
      chatContext.lastValidate = m.lastValidate;
      if (context.selectedFile) {
        chatContext.selectedFile = context.selectedFile;
        try { chatContext.selectedContent = readFile(context.project, context.selectedFile).slice(0, 8000); } catch {}
      }
    } catch {}
  }
  const sys = { role: 'system', content: '[TASK:CHAT] ' + ai.CHAT_SYSTEM +
    `\n厂商: ${chatContext.vendor?.name || '无'} (${chatContext.vendor?.family || '-'})\n` +
    `文件: ${(chatContext.files || []).join(', ') || '无'}\n` +
    `选中: ${chatContext.selectedFile || '无'}\n` +
    `构建: ${chatContext.lastBuild ? (chatContext.lastBuild.ok ? 'ok' : 'fail') : '无'}` + (context.project ? require('./extras').contextBlock(context.project) : '') };

  if (provider.name === 'mock') {
    const last = messages[messages.length - 1]?.content || '';
    const r = ai.mockChatContextual({ message: last, ...chatContext });
    return { reply: r.reply, actions: r.actions };
  }
  const reply = await provider.chat([sys, ...messages], { chatContext });
  return { reply, actions: ai.extractActions(reply) };
}

function zip(outFile, entries) { return new Promise((res, rej) => { const o = fs.createWriteStream(outFile), z = archiver('zip', { zlib: { level: 9 } }); o.on('close', res); z.on('error', rej); z.pipe(o); for (const [n, v] of entries) v.file ? z.file(v.file, { name: n }) : z.append(v.data, { name: n }); z.finalize(); }); }
async function pack(name) {
  const dir = pdir(name), m = meta(name), a = registry.resolve(m.vendorId), b = path.join(dir, 'build');
  if (!m.stages.build?.ok || !fs.existsSync(b)) return log(name, 'package', false, ['[package] 请先成功构建']);
  const dist = path.join(dir, 'dist'); fs.mkdirSync(dist, { recursive: true });
  const bf = walk(b); let ext = 'zip', entries;
  if (a.family === 'vscode-ext') { ext = 'vsix'; const pj = JSON.parse(fs.readFileSync(path.join(b, 'package.json'), 'utf8'));
    entries = [['[Content_Types].xml', { data: '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>' }],
      ['extension.vsixmanifest', { data: `<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${pj.name}" Version="${pj.version}" Publisher="${pj.publisher}"/><DisplayName>${pj.displayName || pj.name}</DisplayName><Description>${pj.description || ''}</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>` }],
      ...bf.map(f => ['extension/' + f, { file: path.join(b, f) }])]; }
  else if (a.family === 'blender') entries = bf.map(f => [name.replace(/-/g, '_') + '/' + f, { file: path.join(b, f) }]);
  else entries = bf.map(f => [f, { file: path.join(b, f) }]);
  if (a.family === 'adobe-uxp') ext = 'ccx'; if (a.family === 'adobe-cep') ext = 'zxp';
  const out = path.join(dist, `${name}-${m.version}.${ext}`); await zip(out, entries);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex'); const size = fs.statSync(out).size;
  const extraLog = [];
  try {
    const off = toolchain.runOfficial(a.family, 'package', dir, { name });
    if (off.log?.length) extraLog.push(...off.log.map(x => '  ' + x));
    else if (off.skipped) extraLog.push('  ℹ 未检测到官方工具，已跳过');
  } catch (e) { extraLog.push('  ⚠ 官方打包工具异常: ' + e.message); }
  const r = log(name, 'package', true, [`[package] 格式 ${a.packageFormat}`, `  → dist/${path.basename(out)} (${size} bytes)`, `  sha256 ${sha}`, ...(ext === 'zxp' ? ['  ⚠ 未用 ZXPSignCmd 签名 (需证书)'] : []), ...extraLog]);
  const mm = meta(name); mm.artifact = { file: path.relative(dir, out), sha256: sha, size }; saveMeta(name, mm); return { ...r, artifact: mm.artifact };
}
const PUBLISH_CMDS = { 'vscode-ext': f => `vsce publish --packagePath ${f}  (或 ovsx publish ${f})`, 'browser-ext': f => `chrome-webstore-upload / web-ext sign / Edge Partner Center API 上传 ${f}`, 'blender': f => `blender --command extension validate ${f} && 上传至 extensions.blender.org`, 'office-addin': f => `通过 Partner Center 提交 AppSource，或在 M365 管理中心集中部署 manifest.xml`, 'jetbrains': f => `gradle publishPlugin (需 PUBLISH_TOKEN)` };
function publish(name, { dryRun = true, credentials } = {}) {
  const dir = pdir(name), m = meta(name), a = registry.resolve(m.vendorId);
  if (!m.stages.package?.ok || !m.artifact) return log(name, 'publish', false, ['[publish] 请先打包']);
  if (!dryRun && !credentials) return log(name, 'publish', false, ['[publish] 真实发布需要商店凭据；当前未配置，已拒绝。可使用 dry-run 生成发布清单。']);
  const manifest = { plugin: name, version: m.version, vendor: a.name, family: a.family, target: a.publishTarget, artifact: m.artifact, command: (PUBLISH_CMDS[a.family] || (f => `上传 ${f} 至 ${a.publishTarget}`))(m.artifact.file), docs: a.docs, dryRun: true, generatedAt: new Date().toISOString() };
  const f = path.join(dir, 'dist', `publish-${m.version}.json`); fs.writeFileSync(f, JSON.stringify(manifest, null, 2));
  const ex = require('./extras').publishExplain(name);
  const r = log(name, 'publish', true, [`[publish] 演练发布（dry-run）→ ${a.publishTarget}`, `  ${ex.what}`, `  真实发布到：${ex.store}`, ...ex.needs.map(x => '  · ' + x), `  命令/操作：${ex.command}`, `  发布清单 → dist/${path.basename(f)}`]);
  const mm = meta(name); mm.releases = [...(mm.releases || []), { version: m.version, at: manifest.generatedAt, dryRun: true }]; saveMeta(name, mm); return { ...r, manifest, explain: ex };
}
function bump(name, level = 'patch') {
  const m = meta(name), a = registry.resolve(m.vendorId), [x, y, z] = m.version.split('.').map(Number);
  const nv = level === 'major' ? `${x + 1}.0.0` : level === 'minor' ? `${x}.${y + 1}.0` : `${x}.${y}.${z + 1}`;
  const touched = [];
  for (const f of files(name)) { if (!/\.(json|xml|toml|php|txt|kts|csproj|py|yml)$/.test(f)) continue; const t = readFile(name, f); const esc = m.version.replace(/\./g, '\\.');
    let n = t.replace(new RegExp(`(["']?version["']?\\s*[:=]\\s*["']?)${esc}`, 'gi'), `$1${nv}`).replace(new RegExp(`(Version[">: ]+\\s*)${esc}`, 'g'), `$1${nv}`).replace(new RegExp(`AppVersion="${esc}"`, 'g'), `AppVersion="${nv}"`);
    if (f.endsWith('.py')) n = n.replace(`"version": (${m.version.split('.').join(', ')})`, `"version": (${nv.split('.').join(', ')})`);
    if (n !== t) { writeFile(name, f, n); touched.push(f); } }
  const ch = path.join(pdir(name), 'CHANGELOG.md'); fs.writeFileSync(ch, `## ${nv}\n- 版本更新 (${level})\n\n` + (fs.existsSync(ch) ? fs.readFileSync(ch, 'utf8') : ''));
  const mm = meta(name); mm.version = nv; mm.stages = { init: mm.stages.init }; saveMeta(name, mm);
  return log(name, 'version', true, [`[version] ${m.version} → ${nv}`, ...touched.map(f => '  ✎ ' + f), '  ✎ CHANGELOG.md']);
}
function deprecate(name, reason = '') { const mm = meta(name); mm.status = 'deprecated'; mm.deprecation = { reason, at: new Date().toISOString() }; saveMeta(name, mm); fs.writeFileSync(path.join(pdir(name), 'DEPRECATED.md'), `# 已弃用\n\n${reason}\n`); return log(name, 'deprecate', true, [`[deprecate] 已标记弃用: ${reason}`]); }
async function aiExtendVendor(description, settings) {
  return registry.addCustom(await require('./agent').proposeAdapter(description, settings));
}
module.exports = {
  root, list, create, files, readFile, writeFile, build, validate, pack, publish, bump, deprecate,
  aiDev, aiDebug, aiApplyFix, applyFiles, aiChat, aiExtendVendor, meta, saveMeta, pdir, readExistingMap, snapshot, checkpoints, restore,
  toolchainDetect: () => toolchain.detect()
};
