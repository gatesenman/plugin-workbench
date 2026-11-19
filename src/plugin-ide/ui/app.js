const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const api = async (u, o = {}) => {
  const r = await fetch('/api' + u, { headers: { 'content-type': 'application/json' }, ...o, body: o.body && JSON.stringify(o.body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
};
const icon = (name, extra = '') => `<i class="codicon codicon-${name}${extra ? ' ' + extra : ''}" aria-hidden="true"></i>`;
const S = { proj: null, file: null, info: null, vendors: [], chat: [], pendingFiles: null, lastFixes: [], meta: null, running: null };
const log = t => {
  const el = $('#log'); const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  el.textContent += t.split('\n').map((l, i) => (i ? '          ' : ts + '  ') + l).join('\n') + '\n'; el.scrollTop = 1e9;
  if (/^\[error\]/.test(t)) { toast(t.replace(/^\[error\]\s*/, ''), 'err'); $('#log-dot')?.classList.remove('hidden'); }
  else if (/^\[(init|AI apply|AI fix|undo|settings)\]/.test(t)) toast(t.replace(/^\[[^\]]+\]\s*/, ''), 'ok');
};
const STAGES = [
  ['init', '初始化', 'new-file'],
  ['build', '构建', 'tools'],
  ['validate', 'AI 校验', 'beaker'],
  ['package', '打包', 'package'],
  ['publish', '发布', 'cloud-upload'],
];

// —— 路由：页面 + 项目子页 ——
const PAGE_TITLE = { home: '首页', projects: '我的项目', project: '项目详情', vendors: '厂商库', publish: '发布中心', settings: '设置' };
S.chatPref = null;
function nav(v) {
  $$('#nav .nav-item').forEach(x => x.classList.toggle('on', x.dataset.view === v));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + v));
  document.body.dataset.page = v;
  $('#page-title').textContent = PAGE_TITLE[v] || '';
  $('#page-sub').textContent = v === 'project' && S.proj ? '/ ' + S.proj : '';
  document.body.dataset.chat = S.chatPref || (v === 'project' ? 'open' : 'closed');
  $('#btn-chat-toggle').classList.toggle('on', document.body.dataset.chat === 'open');
  if (v === 'publish') renderPublish();
  $('#content').scrollTop = 0;
}
$$('#nav .nav-item').forEach(b => b.onclick = () => nav(b.dataset.view));
$$('[data-goto]').forEach(b => b.onclick = () => nav(b.dataset.goto));
// 代码编辑器：仅在可见时加载（隐藏状态下加载 OpenVSCode 会挂载失败），带加载占位
function loadIde(force) {
  if (!S.info?.ide || !S.ideFolder) return;
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  // Sync theme + hide welcome before opening iframe
  api('/ide/theme', { method: 'POST', body: { theme } }).catch(() => {});
  const url = S.info.ide + '/?folder=' + encodeURIComponent(S.ideFolder), fr = $('#ide-frame');
  if (!force && fr.dataset.url === url) return;
  fr.dataset.url = url; fr.classList.remove('hidden');
  $('#ide-off')?.classList.add('hidden');
  const loading = $('#ide-loading');
  loading.classList.remove('hidden');
  loading.innerHTML = `<i class="codicon codicon-loading codicon-modifier-spin"></i><p>正在启动代码编辑器…</p><small>首次加载约需数秒</small>`;
  let loaded = false;
  fr.onload = () => { loaded = true; setTimeout(() => loading.classList.add('hidden'), 800); };
  fr.src = url;
  // 探测内嵌编辑器是否可达；失败时给出中文说明（避免空白页）
  setTimeout(async () => {
    if (loaded) return;
    try {
      const r = await fetch(S.info.ide + '/', { mode: 'no-cors', cache: 'no-store' });
      // no-cors 下无法读 status；能 fetch 不抛就当进程还在
      loading.innerHTML = `<i class="codicon codicon-loading codicon-modifier-spin"></i><p>编辑器仍在加载…</p><small>若长时间空白，请点下方「重新加载编辑器」</small>`;
      loading.classList.remove('hidden');
    } catch {
      loading.innerHTML = `<i class="codicon codicon-warning"></i><p>代码编辑器暂时无法连接</p><small>不影响构建/打包。可点「重新加载编辑器」，或先用「文件」页查看代码。</small>`;
      loading.classList.remove('hidden');
    }
  }, 8000);
}
document.addEventListener('click', e => {
  if (e.target.closest('#btn-ide-retry')) { e.preventDefault(); loadIde(true); }
});
function ptab(t) {
  if (t === 'code') {
    if (S.info?.ide) setTimeout(loadIde, 0);
    else { $('#ide-frame')?.classList.add('hidden'); $('#ide-off')?.classList.remove('hidden'); $('#ide-loading')?.classList.add('hidden'); }
  }
  $$('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  $$('#page-project .tab').forEach(v => v.classList.toggle('on', v.id === 'tab-' + t));
}
const tab = t => {
  t = { ide: 'code', quick: 'files' }[t] || t;
  if (t === 'home') return nav('home');
  if (t === 'vendor') return nav('vendors');
  if (!document.body.dataset.page || document.body.dataset.page !== 'project') nav('project');
  ptab(t);
};
$$('#tabs button').forEach(b => b.onclick = () => ptab(b.dataset.tab));
const setChat = st => { S.chatPref = st; document.body.dataset.chat = st; $('#btn-chat-toggle').classList.toggle('on', st === 'open'); };
$('#btn-chat-toggle').onclick = () => setChat(document.body.dataset.chat === 'open' ? 'closed' : 'open');
$('#btn-chat-close').onclick = () => setChat('closed');
const setTheme = t => {
  document.documentElement.dataset.theme = t; localStorage.setItem('pide.theme', t);
  $$('#theme-seg button').forEach(b => b.classList.toggle('on', b.dataset.themeSet === t));
  if (S.info) api('/ide/theme', { method: 'POST', body: { theme: t } }).catch(() => {});
  // reload iframe only if code tab visible AND already has a src (avoid killing first load)
  if ($('#tab-code')?.classList.contains('on') && S.info?.ide && $('#ide-frame')?.dataset?.url) loadIde(true);
};
$('#btn-theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$$('#theme-seg button').forEach(b => b.onclick = () => setTheme(b.dataset.themeSet));
setTheme(document.documentElement.dataset.theme || 'light');
const drawer = open => { $('#panel').classList.toggle('open', open); $('#panel').setAttribute('aria-hidden', String(!open)); $('#btn-log').classList.toggle('on', open); if (open) $('#log-dot').classList.add('hidden'); };
$('#btn-log').onclick = () => drawer(!$('#panel').classList.contains('open'));
$('#btn-log-close').onclick = () => drawer(false);
if (window.winCtl) { $('#win-ctl').classList.remove('hidden'); $$('#win-ctl button').forEach(b => b.onclick = () => window.winCtl[b.dataset.win]()); }
function uiConfirm(title, message, { okText = '确认', danger = false, icon: ic = 'question' } = {}) {
  const d = $('#dlg-confirm');
  $('#dlg-confirm-icon').className = 'codicon codicon-' + ic; d.classList.toggle('danger', danger);
  $('#dlg-confirm-title').textContent = title; $('#dlg-confirm-msg').textContent = message || '';
  const ok = $('#dlg-confirm-ok'); ok.innerHTML = `${icon(danger ? 'warning' : 'check')} ${okText}`; ok.className = 'btn ' + (danger ? 'btn-danger-solid' : 'btn-primary');
  d.showModal();
  return new Promise(res => {
    const done = v => { d.close(); ok.onclick = $('#dlg-confirm-cancel').onclick = d.oncancel = null; res(v); };
    ok.onclick = () => done(true); $('#dlg-confirm-cancel').onclick = () => done(false); d.oncancel = e => { e.preventDefault(); done(false); };
  });
}
function toast(msg, kind = 'info') {
  const ic = { ok: 'pass-filled', err: 'error', info: 'info' }[kind];
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.innerHTML = `${icon(ic)}<span></span>`; t.querySelector('span').textContent = msg;
  $('#toasts').append(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
}

function setStageStatus(state, label) {
  const el = $('#sb-stage');
  el.dataset.state = state || '';
  if (!state) { el.innerHTML = ''; return; }
  const ic = state === 'ok' ? 'pass' : state === 'fail' ? 'error' : 'loading';
  const spin = state === 'running' ? 'codicon-modifier-spin' : '';
  const ZH = { build: '构建', validate: 'AI 校验', package: '打包', publish: '发布', version: '版本升级', deprecate: '弃用', 'ai-dev': 'AI 开发' };
  el.innerHTML = `${icon(ic, spin)}<span>${ZH[label] || label || ''}${state === 'ok' ? ' 完成' : state === 'fail' ? ' 失败' : '中…'}</span><span class="sb-label vh">${label || ''}</span>`;
}

function syncEmpty() {
  $('#proj-empty')?.classList.toggle('hidden', $('#proj-list').children.length > 0);
  $('#file-empty')?.classList.toggle('hidden', $('#file-list').children.length > 0);
}

async function init() {
  S.info = await api('/info');
  $('#sb-vendors').innerHTML = `${icon('library')} 厂商 ${S.info.vendors}`;
  $('#vendor-count').textContent = S.info.vendors;
  $('#sb-ai').innerHTML = `${icon('sparkle')} AI: ${S.info.provider}`;
  $('#sb-ide').innerHTML = S.info.ide
    ? `${icon('circle-filled')} 代码编辑器已就绪`
    : `${icon('circle-outline')} 代码编辑器未启用`;
  if (S.info.ide) {
    S.ideFolder = S.info.workspace; // 代码编辑器按需加载（切到「代码」子页时）
  } else {
    $('#ide-frame').classList.add('hidden'); $('#sb-ide').innerHTML = `${icon('circle-outline')} 代码编辑器未启用`; // 与 #ide-off 空状态一致：缺组件时不挂坏 URL
    $('#ide-off').classList.remove('hidden');
  }
  await loadVendors();
  await loadProjects();
  const st = await api('/settings');
  $('#s-provider').value = st.provider || 'mock';
  $('#s-base').value = st.baseUrl || '';
  $('#s-key').value = st.apiKey || '';
  $('#s-model').value = st.model || '';
  if ($('#s-temp')) $('#s-temp').value = st.temperature != null ? st.temperature : 0.2;
  if ($('#s-auto-apply')) $('#s-auto-apply').checked = st.autoApplyAi !== false;
  S.autoApplyAi = st.autoApplyAi !== false;
  if ($('#toolchain-status') && st.toolchain) {
    const tc = st.toolchain;
    const bits = [['npx', tc.npx], ['vsce', tc.vsce], ['web-ext', tc.webExt], ['blender', tc.blender], ['office-addin-manifest', tc.officeValidate]]
      .map(([n, ok]) => (ok ? '✓ ' : '· ') + n);
    $('#toolchain-status').textContent = '本机官方工具链：' + bits.join('  ') + '（缺失时自动跳过，不阻断流程）';
  }
  renderOnboarding();
  log(`[ready] 通用 AI 辅助插件开发工作台已就绪 · ${S.info.vendors} 个厂商/宿主 · 工作区 ${S.info.workspace}`);
}

async function loadVendors() {
  S.vendors = await api('/vendors');
  const cats = [...new Set(S.vendors.map(v => v.category))].sort();
  $('#vendor-cat').innerHTML = '<option value="">全部类别</option>' + cats.map(c => `<option>${c}</option>`).join('');
  $('#vendor-dl').innerHTML = S.vendors.map(v => `<option value="${v.id}">${v.name} — ${v.company}</option>`).join('');
  renderVendors();
  $('#vendor-count').textContent = S.vendors.length;
  $('#sb-vendors').innerHTML = `${icon('library')} 厂商 ${S.vendors.length}`;
}

function renderVendors() {
  const q = $('#vendor-q').value.toLowerCase(), c = $('#vendor-cat').value;
  const list = S.vendors.filter(v => (!q || (v.name + v.company + v.category + (v.id || '')).toLowerCase().includes(q)) && (!c || v.category === c));
  $('#vendor-empty')?.classList.toggle('hidden', list.length > 0);
  $('#vendor-list').innerHTML = list.slice(0, 240).map(v =>
    `<li data-id="${v.id}" title="${v.company}">${icon(v.custom ? 'sparkle' : 'extensions')}<span class="li-body"><span class="li-title">${v.name}</span><small>${v.company}</small></span><span class="cat-pill">${v.category}</span></li>`
  ).join('');
  $$('#vendor-list li').forEach(li => li.onclick = async () => {
    $$('#vendor-list li').forEach(x => x.classList.toggle('sel', x === li));
    const a = await api('/vendors/' + li.dataset.id);
    let k = null; try { k = await api('/vendors/' + li.dataset.id + '/knowledge'); } catch {}
    $('#vendor-detail').innerHTML = `<div class="vd-head"><span class="pc-icon">${icon(a.custom ? 'sparkle' : 'extensions')}</span><div><h3>${a.name}</h3><small class="muted">${a.company} · ${a.category}</small></div></div>
      <dl class="meta-list"><dt>家族</dt><dd>${a.label || a.family}</dd><dt>语言</dt><dd>${a.language}</dd><dt>运行时</dt><dd>${a.runtime}</dd><dt>清单</dt><dd><code>${a.manifest}</code></dd><dt>打包</dt><dd>${a.packageFormat}</dd><dt>发布到</dt><dd>${a.publishTarget}</dd></dl>
      ${k ? `<div class="knowledge mt">${(k.rules || []).length ? '<h5>' + icon('law') + ' 规则</h5><ul>' + k.rules.map(r => '<li>' + r + '</li>').join('') + '</ul>' : ''}${(k.docs || []).length ? '<h5>' + icon('link-external') + ' 文档</h5><ul>' + k.docs.map(d => `<li><a href="${d.url}" target="_blank" rel="noopener">${d.title}</a></li>`).join('') + '</ul>' : ''}</div>` : ''}
      <div class="row-end"><button type="button" class="btn btn-primary btn-sm" id="vd-use">${icon('sparkle')} 用它新建插件</button></div>`;
    $('#vd-use').onclick = () => { nav('home'); $('#home-prompt').value = `为 ${a.name} 开发一个插件，`; $('#home-prompt').focus(); };
    $('#vendor-detail').classList.remove('hidden');
    $('#vendor-detail-empty')?.classList.add('hidden');
    tab('vendor');
    $('#new-vendor').value = a.id;
  });
}
$('#vendor-q').oninput = renderVendors;
$('#vendor-cat').onchange = renderVendors;

async function loadProjects() {
  const ps = await api('/projects');
  S.projects = ps;
  $('#proj-count').textContent = ps.length || '';
  $('#proj-list').innerHTML = ps.map(p => {
    const st = p.stages || {};
    return `<li data-n="${p.name}" class="${S.proj === p.name ? 'sel' : ''}"><div class="pc-head"><span class="pc-icon">${icon(p.status === 'deprecated' ? 'circle-slash' : p.origin === 'ai-first' ? 'sparkle' : 'plug')}</span><span class="li-body"><span class="li-title">${p.name}</span><small>${p.vendorName} · ${p.family}</small></span></div>
      <div class="pc-foot"><span class="pc-bar">${['init', 'build', 'validate', 'package', 'publish'].map(k => `<i class="${st[k] ? (st[k].ok ? 'ok' : 'fail') : ''}" title="${k}"></i>`).join('')}</span><span>v${p.version}${p.status === 'deprecated' ? ' · 已弃用' : ''}</span></div></li>`;
  }).join('');
  $$('#proj-list li').forEach(li => li.onclick = () => openProject(li.dataset.n));
  syncEmpty();
  renderRecent(ps);
}

async function openProject(n, opts = {}) {
  S.proj = n;
  const p = await api('/projects/' + n);
  S.meta = p;
  $('#t-proj').textContent = n; $('#nav-cur-proj').classList.remove('hidden');
  $('#pd-title').textContent = n; $('#chat-ctx').textContent = `上下文：${n} · ${p.vendorName}`;
  $('#sb-proj').innerHTML = `${icon('plug')} ${n} v${p.version} (${p.vendorName})`;
  $('#file-list').innerHTML = p.files.map(f =>
    `<li data-f="${f}">${icon('file')}<span class="li-body"><span class="li-title">${f}</span></span></li>`
  ).join('');
  $$('#file-list li').forEach(li => li.onclick = () => {
    $$('#file-list li').forEach(x => x.classList.toggle('sel', x === li));
    openFile(li.dataset.f);
  });
  const fmt = iso => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
  $('#proj-meta').innerHTML = [['宿主', p.vendorName], ['版本', 'v' + p.version], ['状态', p.status === 'deprecated' ? '已弃用' : '活跃'], ['来源', p.origin === 'ai-first' ? 'AI 创建' : '模板创建'], ['文件', p.files.length + ' 个'], ['创建于', fmt(p.createdAt)], ['目录', `<code class="small">${p.dir}</code>`]]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + (p.spec ? `<dt>概述</dt><dd>${p.spec.summary}</dd>` : '');
  $('#pd-artifacts').innerHTML = p.artifact ? `<div class="artifact">${icon('file-zip')}<div><b>${p.artifact.file}</b><div class="muted small">${(p.artifact.size / 1024).toFixed(1)} KB · sha256 ${p.artifact.sha256.slice(0, 16)}…</div></div></div>` : '尚未打包。点击右上角「打包」生成产物。';
  $('#pd-releases').innerHTML = (p.releases || []).slice().reverse().map(r => `<li>${icon('cloud-upload')}<span class="li-body"><span class="li-title">v${r.version}</span><small>${fmt(r.at)} · ${r.dryRun ? 'dry-run' : '已发布'}</small></span><span class="badge tag-brand">${r.dryRun ? 'dry-run' : 'live'}</span></li>`).join('') || '<li class="muted">暂无发布记录</li>';
  if ($('#pipe-hint')) $('#pipe-hint').textContent = p.status === 'deprecated' ? '已弃用' : `${p.files.length} 个文件`;
  if (!opts.stay) { nav('project'); if (S.lastOpened !== n) ptab('overview'); }
  S.lastOpened = n;
  renderPipe(p);
  loadProjects();
  syncEmpty();
  S.ideFolder = p.dir;
  if ($('#tab-code').classList.contains('on')) loadIde();
  renderCheckpoints();
  renderProjectChecklist(p);
}

function renderPipe(p) {
  const running = S.running;
  $('#pipeline-bar').innerHTML = STAGES.map(([k, l, ic]) => {
    const st = p.stages && p.stages[k];
    let cls = '', glyph = ic;
    if (running === k) { cls = 'run'; glyph = 'loading'; }
    else if (st) { cls = st.ok ? 'ok' : 'fail'; glyph = st.ok ? 'pass' : 'error'; }
    return `<div class="stage ${cls}" data-stage="${k}">${icon(glyph)}${l}<small>${k}</small></div>`;
  }).join('') + `<div class="stage ver">${icon('tag')}v${p.version}<small>${p.status}</small></div>`;
}

async function openFile(f) {
  S.file = f;
  const { content } = await api(`/projects/${S.proj}/file?path=${encodeURIComponent(f)}`);
  $('#quick-editor').value = content;
  $('#qe-path').textContent = f;
  tab('quick');
}

$('#btn-save').onclick = async () => {
  if (!S.proj || !S.file) return log('[error] 请先打开文件');
  await api(`/projects/${S.proj}/file`, { method: 'PUT', body: { path: S.file, content: $('#quick-editor').value } });
  log(`[save] ${S.file}`);
};

function showDiff(files, summary) {
  S.pendingFiles = files;
  const lines = (files || []).map(f => `--- ${f.action || 'update'}: ${f.path}\n${(f.content || '').slice(0, 2000)}${(f.content || '').length > 2000 ? '\n…' : ''}`).join('\n\n');
  if ($('#ai-diff-summary')) $('#ai-diff-summary').textContent = summary || `预览 ${files.length} 个文件`;
  if ($('#ai-diff-view')) $('#ai-diff-view').textContent = lines;
  if ($('#btn-ai-proj-apply')) $('#btn-ai-proj-apply').disabled = !files?.length;
  if ($('#dlg-ai-summary')) $('#dlg-ai-summary').textContent = summary || `${files.length} 个文件将写入磁盘`;
  if ($('#dlg-ai-files')) {
    $('#dlg-ai-filelist').innerHTML = (files || []).map((f, i) => `<button type="button" class="pv-file ${i ? '' : 'on'}" data-i="${i}"><span class="badge ${f.action === 'create' ? 'tag-ok' : 'tag-brand'}">${f.action === 'create' ? '新增' : '修改'}</span><span class="li-title">${f.path}</span></button>`).join('');
    const show = i => { $$('#dlg-ai-filelist .pv-file').forEach(b => b.classList.toggle('on', +b.dataset.i === i)); $('#dlg-ai-files').textContent = files[i]?.content || ''; };
    $$('#dlg-ai-filelist .pv-file').forEach(b => b.onclick = () => show(+b.dataset.i)); show(0);
  }
}

async function applyPending() {
  if (!S.proj || !S.pendingFiles?.length) return;
  await api(`/projects/${S.proj}/ai-apply`, { method: 'POST', body: { files: S.pendingFiles } });
  log(`[AI apply] 已写入 ${S.pendingFiles.map(f => f.path).join(', ')}`);
  const focus = S.file && S.pendingFiles.find(f => f.path === S.file);
  if (focus) $('#quick-editor').value = focus.content;
  S.pendingFiles = null;
  if ($('#btn-ai-proj-apply')) $('#btn-ai-proj-apply').disabled = true;
  await openProject(S.proj, { stay: true });
}

$('#btn-ai-dev').onclick = async () => {
  if (!S.proj) return log('[error] 请先选择项目');
  log('[AI dev] 生成中…');
  setStageStatus('running', 'ai-dev');
  try {
    const r = await api(`/projects/${S.proj}/ai-dev`, { method: 'POST', body: { path: S.file, prompt: $('#ai-dev-prompt').value } });
    const files = r.files || [];
    if (r.code && S.file) $('#quick-editor').value = r.code;
    else if (files.length === 1 && files[0].path === S.file) $('#quick-editor').value = files[0].content;
    showDiff(files, r.reply?.split('\n')[0] || `预览 ${files.length} 文件`);
    if (files.length > 1 || (files.length === 1 && files[0].path !== S.file)) {
      tab('aidev');
      $('#dlg-ai-preview')?.showModal();
    }
    log(r.reply.split('\n')[0]);
    addMsg('bot', r.reply.slice(0, 1500));
    setStageStatus('ok', 'ai-dev');
  } catch (e) { log('[error] ' + e.message); setStageStatus('fail', 'ai-dev'); }
};

if ($('#btn-ai-proj')) $('#btn-ai-proj').onclick = async () => {
  if (!S.proj) return log('[error] 请先选择项目');
  const prompt = $('#ai-proj-prompt').value.trim(); if (!prompt) return;
  log('[AI project] 多文件生成中…');
  try {
    const r = await api(`/projects/${S.proj}/ai-dev`, { method: 'POST', body: { prompt, path: S.file || undefined } });
    showDiff(r.files || [], r.reply?.split('\n')[0]);
    log(`[AI project] 预览 ${r.files?.length || 0} 个文件`);
    addMsg('bot', r.reply.slice(0, 1500));
  } catch (e) { log('[error] ' + e.message); }
};
if ($('#btn-ai-proj-apply')) $('#btn-ai-proj-apply').onclick = () => applyPending();
if ($('#btn-ai-preview-apply')) $('#btn-ai-preview-apply').onclick = async (e) => { e.preventDefault(); await applyPending(); $('#dlg-ai-preview').close(); };
if ($('#btn-ai-preview-cancel')) $('#btn-ai-preview-cancel').onclick = () => $('#dlg-ai-preview').close();

function renderDebug(r) {
  S.lastFixes = r.fixes || [];
  const tips = (r.tips && r.tips.length) ? r.tips : [(r.reply || '').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2))].flat();
  $('#debug-tips').textContent = tips.length ? tips.map(t => '• ' + t).join('\n') : (r.reply || '').slice(0, 500);
  $('#debug-fixes').innerHTML = (r.fixes || []).map((f, i) =>
    `<div class="fix-item"><code>${f.path}</code> — ${f.reason || ''}<br><button type="button" data-fix="${i}" class="btn btn-primary btn-sm btn-apply-fix">${icon('check')} 应用 AI 修复</button></div>`
  ).join('') || '<div class="small">无可自动应用的补丁</div>';
  $$('#debug-fixes .btn-apply-fix').forEach(b => b.onclick = async () => {
    const fix = S.lastFixes[+b.dataset.fix];
    await api(`/projects/${S.proj}/ai-fix`, { method: 'POST', body: fix });
    log(`[AI fix] 已应用 ${fix.path}`);
    await openProject(S.proj, { stay: true });
    if (S.file === fix.path) $('#quick-editor').value = fix.content;
  });
}

if ($('#btn-ai-debug')) $('#btn-ai-debug').onclick = async () => {
  if (!S.proj) return log('[error] 请先选择项目');
  const r = await api(`/projects/${S.proj}/ai-debug`, { method: 'POST', body: {} });
  renderDebug(r); log('[AI debug] ' + (r.tips?.[0] || r.reply?.split('\n')[0] || 'done'));
};

$('#btn-new-ai').onclick = () => { nav('home'); $('#home-prompt').focus(); };
$('#btn-new').onclick = () => {
  $('#new-name').value = '';
  $('#new-desc').value = '';
  $('#dlg-new').showModal();
  setTimeout(() => $('#new-vendor').focus(), 50);
};

$('#btn-create').onclick = async (e) => {
  e.preventDefault();
  const vendorId = $('#new-vendor').value.trim();
  const name = $('#new-name').value.trim();
  if (!vendorId || !name) { toast('请填写目标厂商与项目名', 'err'); return; }
  try {
    const r = await api('/projects', { method: 'POST', body: { vendorId, name, description: $('#new-desc').value } });
    $('#dlg-new').close();
    log(`[init] 已创建 ${r.name} (${r.adapter.name}) 文件: ${r.files.join(', ')}`);
    await openProject(r.name);
  } catch (err) { log('[error] ' + err.message); }
};

$$('button[data-stage]').forEach(b => b.onclick = () => runStage(b.dataset.stage));

async function runStage(st) {
  if (!S.proj) return log('[error] 请先选择项目');
  S.running = st;
  setStageStatus('running', st);
  $$('.btn-stage').forEach(b => {
    b.classList.toggle('running', b.dataset.stage === st);
    b.disabled = true;
  });
  if (S.meta) renderPipe(S.meta);
  const body = st === 'version' ? { level: $('#bump-level').value }
    : st === 'publish' ? { dryRun: true }
    : st === 'deprecate' ? { reason: '由新版本替代' }
    : {};
  try {
    const r = await api(`/projects/${S.proj}/${st}`, { method: 'POST', body });
    (r.log || []).forEach(l => log(l));
    setStageStatus(r.ok ? 'ok' : 'fail', st);
    if (st === 'validate' || st === 'build') {
      if (r.fixes || r.tips || r.ai) renderDebug({ reply: r.ai || r.log?.join('\n'), tips: r.tips, fixes: r.fixes });
      if (!r.ok) ptab('overview');
      if (!r.ok && st === 'build') {
        try { const d = await api(`/projects/${S.proj}/ai-debug`, { method: 'POST', body: {} }); renderDebug(d); } catch {}
      }
    }
    S.running = null;
    await openProject(S.proj, { stay: true });
    return r;
  } catch (e) {
    log('[error] ' + e.message);
    setStageStatus('fail', st);
    S.running = null;
    if (S.meta) renderPipe(S.meta);
  } finally {
    $$('.btn-stage').forEach(b => { b.disabled = false; b.classList.remove('running'); });
  }
}

$('#btn-clear').onclick = () => { $('#log').textContent = ''; };

$('#btn-ai-vendor').onclick = async () => {
  const description = $('#ai-vendor-desc').value.trim();
  if (!description) return log('[error] 请描述要扩展的新厂商');
  $('#btn-ai-vendor').disabled = true;
  try {
    const a = await api('/vendors/ai-extend', { method: 'POST', body: { description } });
    $('#ai-vendor-out').textContent = `已添加: ${a.name} (${a.id})\n家族 ${a.family} · ${a.category}\n清单 ${a.manifest} · 打包 ${a.packageFormat}`;
    log(`[AI extend] 新适配器 ${a.id}`);
    await loadVendors();
    $('#new-vendor').value = a.id;
    $('#vendor-q').value = a.name;
    renderVendors();
  } catch (e) {
    log('[error] ' + e.message);
    $('#ai-vendor-out').textContent = '生成失败: ' + e.message;
  } finally {
    $('#btn-ai-vendor').disabled = false;
  }
};

function activityPush(msg) {
  const box = $('#chat-activity'); if (!box) { log('[activity] ' + msg); return; }
  box.classList.remove('hidden');
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const row = document.createElement('div'); row.className = 'act-item';
  row.innerHTML = `<span class="act-time">${ts}</span><span></span>`;
  row.lastChild.textContent = msg;
  box.append(row); box.scrollTop = 1e9;
  // keep last 40
  while (box.children.length > 40) box.firstChild.remove();
}
window._activityPush = activityPush;

function isStatusSpam(text) {
  return /^(【AI 智能体】|\[AI |识别宿主|方案就绪|任务已|等待确认|构建（|清单校验)/.test((text || '').trim())
    || /构建与校验通过|自动修复|已生成并通过/.test(text || '');
}

function addMsg(who, t) {
  const welcome = $('#chat .chat-welcome');
  if (welcome) welcome.remove();
  const cleaned = who === 'bot' ? t.replace(/###\s*(ACTION|FILE|FIX):[^\n]*\n```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim() : t;
  // Collapse repetitive status into activity timeline instead of flooding chat bubbles
  if (who === 'bot' && isStatusSpam(cleaned) && cleaned.length < 280) {
    activityPush(cleaned.replace(/^【AI 智能体】/, '').trim());
    return;
  }
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.textContent = cleaned;
  $('#chat').append(d);
  $('#chat').scrollTop = 1e9;
}

function renderChatActions(actions) {
  const box = $('#chat-actions'); if (!box) return;
  if (!actions?.length) { box.innerHTML = ''; return; }
  box.innerHTML = actions.map((a, i) =>
    `<button type="button" data-act="${i}" class="mini">${icon(a.type === 'agent_iterate' ? 'sparkle' : 'play')} ${a.type === 'agent_iterate' ? 'AI 迭代并构建' : a.type}${a.path ? ': ' + a.path : ''}</button>`
  ).join(' ');
  box.querySelectorAll('button').forEach(b => b.onclick = () => runChatAction(actions[+b.dataset.act]));
}

async function runChatAction(a) {
  if (!a) return;
  if ((a.type === 'create_file' || a.type === 'patch_file') && a.path && a.content != null) {
    if (!S.proj) return log('[error] 请先选择项目');
    if (!await uiConfirm(a.type === 'create_file' ? '创建文件' : '修改文件', `AI 将${a.type === 'create_file' ? '创建' : '覆盖'} ${a.path}。写入前会自动创建快照，可随时撤销。`, { okText: '应用', icon: 'new-file' })) return;
    await api(`/projects/${S.proj}/ai-apply`, { method: 'POST', body: { files: [{ path: a.path, content: a.content }] } });
    log(`[AI chat] ${a.type} ${a.path}`); await openProject(S.proj, { stay: true });
  } else if (a.type === 'agent_iterate') {
    if (!S.proj) return log('[error] 请先选择项目');
    await iterateProject(S.proj, a.prompt || '');
  } else if (a.type === 'run_build' || a.type === 'run_validate' || a.type === 'run_package') {
    const st = a.type.replace('run_', '');
    if (!await uiConfirm('执行生命周期阶段', `AI 建议执行「${{ build: '构建', validate: 'AI 校验', package: '打包' }[st] || st}」。`, { okText: '执行', icon: 'play' })) return;
    await runStage(st);
  }
}

$('#btn-chat').onclick = async () => {
  const t = $('#chat-in').value.trim(); if (!t) return;
  $('#chat-in').value = '';
  addMsg('user', t);
  S.chat.push({ role: 'user', content: t });
  $('#btn-chat').disabled = true;
  try {
    const r = await api('/ai/chat', { method: 'POST', body: {
      messages: S.chat,
      context: { project: S.proj, selectedFile: S.file },
    }});
    S.chat.push({ role: 'assistant', content: r.reply });
    addMsg('bot', r.reply);
    renderChatActions(r.actions);
  } catch (e) {
    addMsg('bot', '请求失败: ' + e.message);
  } finally {
    $('#btn-chat').disabled = false;
  }
};

$('#chat-in').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('#btn-chat').click();
  }
});

$('#btn-save-settings').onclick = async () => {
  const autoApplyAi = $('#s-auto-apply') ? $('#s-auto-apply').checked : true;
  await api('/settings', { method: 'PUT', body: {
    provider: $('#s-provider').value, baseUrl: $('#s-base').value, apiKey: $('#s-key').value,
    model: $('#s-model').value, temperature: Number($('#s-temp')?.value || 0.2),
    autoApplyAi, theme: document.documentElement.dataset.theme || 'light',
  }});
  S.autoApplyAi = autoApplyAi;
  log('[settings] 已保存');
  S.info = await api('/info');
  $('#sb-ai').innerHTML = `${icon('sparkle')} AI: ${S.info.provider}`;
  const msg = $('#settings-msg');
  if (msg) {
    msg.textContent = autoApplyAi ? '设置已保存。AI 改动将自动应用（可撤销）。' : '设置已保存。Agent 将在每步写盘前等待你确认。';
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 4000);
  }
};


async function renderPublish() {
  const ps = await api('/projects');
  const arts = ps.filter(p => p.artifact).length, rel = ps.reduce((n, p) => n + (p.releases || []).length, 0);
  $('#publish-stats').innerHTML = [['项目', ps.length, 'folder-library'], ['已打包', arts, 'package'], ['发布记录', rel, 'cloud-upload'], ['已弃用', ps.filter(p => p.status === 'deprecated').length, 'circle-slash']]
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
  $('#publish-empty').classList.toggle('hidden', ps.length > 0);
  $('#publish-table tbody').innerHTML = ps.map(p => {
    const last = (p.releases || []).slice(-1)[0], ok = p.stages?.package?.ok;
    return `<tr data-n="${p.name}"><td><b>${p.name}</b></td><td>${p.vendorName}</td><td>v${p.version}</td>
      <td>${p.status === 'deprecated' ? '<span class="badge tag-warn">已弃用</span>' : ok ? '<span class="badge tag-ok">可发布</span>' : '<span class="badge">待打包</span>'}</td>
      <td>${p.artifact ? `<code class="small">${p.artifact.file.replace('dist/', '')}</code>` : '<span class="muted">—</span>'}</td>
      <td>${last ? `<span class="muted small">v${last.version} · dry-run</span>` : '<span class="muted">—</span>'}</td>
      <td style="text-align:right"><button type="button" class="btn btn-sm btn-secondary pub-open">${icon('arrow-right')} 打开</button> <button type="button" class="btn btn-sm btn-primary pub-ship">${icon('rocket')} 打包发布</button></td></tr>`;
  }).join('');
  $$('#publish-table .pub-open').forEach(b => b.onclick = () => openProject(b.closest('tr').dataset.n));
  $$('#publish-table .pub-ship').forEach(b => b.onclick = async () => {
    const n = b.closest('tr').dataset.n; b.disabled = true;
    await openProject(n, { stay: true });
    for (const st of ['build', 'package', 'publish']) { const r = await runStage(st); if (!r?.ok) break; }
    renderPublish(); toast(`${n} 已生成 dry-run 发布清单`, 'ok'); b.disabled = false;
  });
}


function renderProjectChecklist(p) {
  const box = $('#proj-checklist'); if (!box || !p) return;
  const key = 'pide.checklist.' + p.name;
  if (localStorage.getItem(key) === 'hidden') { box.classList.add('hidden'); return; }
  const st = p.stages || {};
  const items = [
    ['已创建项目脚手架', true],
    ['构建通过', !!st.build?.ok],
    ['清单校验通过', !!st.validate?.ok],
    ['已打包产物', !!st.package?.ok || !!p.artifact],
    ['生成发布清单（dry-run）', !!st.publish?.ok],
    ['在「代码」页打开编辑器看一眼', localStorage.getItem(key + '.code') === '1'],
  ];
  const allDone = items.every(i => i[1]);
  if (allDone && localStorage.getItem(key + '.autohide') !== '1') {
    // keep visible once with all checked; user can hide
  }
  box.classList.remove('hidden');
  $('#checklist-items').innerHTML = items.map(([label, ok]) =>
    `<li class="${ok ? 'done' : ''}">${ok ? '✓' : '○'} ${label}</li>`
  ).join('');
  const hideBtn = $('#btn-checklist-hide');
  if (hideBtn) hideBtn.onclick = () => { localStorage.setItem(key, 'hidden'); box.classList.add('hidden'); };
}
// mark code-tab visit
const _ptab = ptab;
ptab = function(t) {
  _ptab(t);
  if (t === 'code' && S.proj) localStorage.setItem('pide.checklist.' + S.proj + '.code', '1');
};

window.PluginIDE = { runStage, openProject, openFile, applyPending, showDiff, setStageStatus, activityPush, loadIde };
init().catch(e => log('[error] 初始化失败: ' + e.message));
