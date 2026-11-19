// v1.3.0：环境检测页 + 厂商库「已安装」标记 + 一键「安装并打开测试」（SSE 进度 / 取消 / 卸载）
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FAM = { 'vscode-ext': 'VS Code 扩展', 'browser-ext': '浏览器扩展', 'office-addin': 'Office 加载项', 'adobe-uxp': 'UXP 插件', 'adobe-cep': 'CEP 扩展', 'dotnet-addin': '.NET 插件', 'python-dcc': 'Python 插件', blender: 'Blender 扩展', jetbrains: 'IDE 插件', 'design-plugin': '设计插件', 'notes-plugin': '笔记插件' };
  const STI = { ok: 'pass-filled', fail: 'error', running: 'loading', skip: 'circle-slash' };
  try { PAGE_TITLE.env = '环境检测'; } catch {}
  const E = { scan: null, vmap: {} };
  async function load(fresh) {
    E.scan = await api('/hosts' + (fresh ? '?fresh=1' : ''));
    E.vmap = {}; for (const h of E.scan.hosts) if (h.installed) for (const v of h.vendors) E.vmap[v] = E.vmap[v] || h;
    const n = E.scan.hosts.filter(h => h.installed).length; $('#env-count').textContent = n || '';
    decorateVendors(); render(); return E.scan;
  }
  function render() {
    if (!E.scan || !$('#env-table')) return;
    const only = $('#env-only').checked, hs = E.scan.hosts.filter(h => !only || h.installed), inst = E.scan.hosts.filter(h => h.installed);
    const fams = new Set(inst.map(h => h.family));
    $('#env-stats').innerHTML = `<div class="stat"><b>${inst.length}</b><span>已安装的软件</span></div><div class="stat"><b>${E.scan.hosts.length}</b><span>支持检测的软件</span></div><div class="stat"><b>${fams.size}</b><span>可直接测试的插件类型</span></div><div class="stat"><b>${{ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[E.scan.platform] || E.scan.platform}</b><span>操作系统</span></div>`;
    $('#env-meta').textContent = `检测于 ${new Date(E.scan.scannedAt).toLocaleString()} · 用时 ${E.scan.ms} ms`;
    $('#env-table tbody').innerHTML = hs.map(h => `<tr data-key="${h.key}" class="${h.installed ? '' : 'muted'}"><td><b>${esc(h.name)}</b></td>
      <td>${h.installed ? `<span class="badge tag-ok">${icon('pass-filled')} 已安装</span>` : `<span class="badge">未检测到</span>`}</td>
      <td>${esc(h.version || (h.installed ? '—' : ''))}</td><td class="env-path" title="${esc(h.path)}">${h.path ? `<code>${esc(h.path)}</code>` : ''}${h.sources.length ? `<small class="muted"> · ${esc(h.sources.join('、'))}</small>` : ''}</td>
      <td>${esc(FAM[h.family] || h.family)}</td>
      <td>${h.installed ? `<button type="button" class="btn btn-ghost btn-sm env-new" data-v="${esc(h.vendors[0])}">${icon('add')} 为它做插件</button>` : ''}</td></tr>`).join('');
    $$('#env-table .env-new').forEach(b => b.onclick = () => { const h = E.scan.hosts.find(x => x.key === b.closest('tr').dataset.key); nav('home'); $('#home-prompt').value = `为 ${h.name} 开发一个插件，`; $('#home-prompt').focus(); });
  }
  function decorateVendors() {
    $$('#vendor-list li').forEach(li => { const h = E.vmap[li.dataset.id]; if (h && !li.querySelector('.inst-pill')) { const s = document.createElement('span'); s.className = 'badge tag-ok inst-pill'; s.title = `${h.name} ${h.version || ''}\n${h.path}`; s.innerHTML = `${icon('pass-filled')} 本机已安装`; li.insertBefore(s, li.querySelector('.cat-pill')); } });
    const vd = $('#vendor-detail'), sel = $('#vendor-list li.sel');
    if (vd && sel && !vd.querySelector('.vd-host') && !vd.classList.contains('hidden')) { const h = E.vmap[sel.dataset.id]; const p = document.createElement('p'); p.className = 'vd-host small ' + (h ? '' : 'muted'); p.innerHTML = h ? `${icon('pass-filled')} 本机已安装 <b>${esc(h.name)}</b> ${esc(h.version)} — 打包后可一键安装测试` : `${icon('circle-slash')} 本机未检测到该软件，打包后需在装有它的电脑上测试`; vd.querySelector('.meta-list')?.before(p); }
  }
  new MutationObserver(() => decorateVendors()).observe(document.body, { childList: true, subtree: true });
  $('#btn-env-scan').onclick = async () => { const b = $('#btn-env-scan'); b.disabled = true; b.innerHTML = `${icon('loading', 'codicon-modifier-spin')} 正在检测…`; try { await load(true); toast('检测完成', 'ok'); } catch (e) { toast(e.message, 'err'); } finally { b.disabled = false; b.innerHTML = `${icon('refresh')} 重新检测`; } };
  $('#env-only').onchange = render;

  // —— 一键安装并打开测试 ——
  const jobs = {};
  async function renderHostInstall(name, sel) {
    const box = $(sel); if (!box || !name) return;
    let p; try { p = await api(`/projects/${name}/host-install`); } catch { box.classList.add('hidden'); return; }
    if (!p.packaged) { box.classList.add('hidden'); return; }
    const inst = Object.entries(p.installed || {});
    const cands = p.candidates.filter(h => h.installed);
    box.innerHTML = `<h4>${icon('play-circle')} 安装并打开测试</h4>
      ${p.host ? `<p class="hi-target">${icon('pass-filled')} 本机已安装 <b>${esc(p.host.name)}</b> ${esc(p.host.version)} <small class="muted">${esc(p.host.path)}</small></p>` : `<p class="hi-target muted">${icon('warning')} ${esc(p.reason)}</p>`}
      <div class="install-actions">
        ${cands.length > 1 ? `<select class="select hi-host">${cands.map(h => `<option value="${h.key}" ${h.key === p.host?.key ? 'selected' : ''}>${esc(h.name)} ${esc(h.version)}</option>`).join('')}</select>` : ''}
        <button type="button" class="btn btn-primary btn-sm hi-go" ${p.auto ? '' : 'disabled'}>${icon('rocket')} 一键安装并打开</button>
        <button type="button" class="btn btn-ghost btn-sm hi-cancel hidden">${icon('debug-stop')} 取消</button>
        ${inst.map(([k, r]) => `<button type="button" class="btn btn-ghost btn-sm hi-un" data-k="${k}" title="安装于 ${esc(new Date(r.at).toLocaleString())}">${icon('trash')} 从 ${esc(r.host)} 卸载/清理</button>`).join('')}
      </div>
      <ol class="agent-steps hi-steps"></ol>
      <div class="hi-result"></div>
      ${!p.auto ? `<details class="hi-manual" open><summary>手动安装步骤</summary><ol class="install-steps">${p.manual.map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>` : `<details class="hi-manual"><summary>不想自动安装？查看手动步骤</summary><ol class="install-steps">${p.manual.map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>`}`;
    box.classList.remove('hidden');
    const steps = box.querySelector('.hi-steps'), res = box.querySelector('.hi-result'), go = box.querySelector('.hi-go'), cancel = box.querySelector('.hi-cancel');
    const draw = j => {
      steps.innerHTML = (j.steps || []).map(s => `<li class="st-${s.status}">${icon(STI[s.status] || 'circle', s.status === 'running' ? 'codicon-modifier-spin' : '')}<div><div class="st-title">${icon(s.icon || 'circle')} ${esc(s.title)}</div>${s.detail ? `<pre>${esc(s.detail)}</pre>` : ''}</div></li>`).join('');
      const busy = j.status === 'running'; go.disabled = busy || !p.auto; cancel.classList.toggle('hidden', !busy);
      if (!busy) {
        const r = j.result || {};
        res.innerHTML = j.status === 'cancelled' ? `<p class="wz-result bad">${icon('circle-slash')} 已取消。</p>` : j.status === 'error' ? `<p class="wz-result bad">${icon('error')} 安装失败：${esc(j.error)}。可以按下面的手动步骤操作。</p>`
          : r.ok ? `<p class="wz-result ok">${icon('pass-filled')} 已安装到 ${esc(r.host)} 并已打开，去软件里试试吧。</p>${(r.notes || []).map(n => `<p class="muted small">${icon('info')} ${esc(n)}</p>`).join('')}`
          : `<p class="wz-result bad">${icon('warning')} ${esc(r.reason || '需要手动完成')}</p><ol class="install-steps">${(r.manual || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>`;
        if (j.status !== 'running' && r.ok) setTimeout(() => renderHostInstall(name, sel).then(() => { const b2 = $(sel); b2.querySelector('.hi-steps').innerHTML = steps.innerHTML; b2.querySelector('.hi-result').innerHTML = res.innerHTML; }), 50);
      }
    };
    go.onclick = async () => {
      res.innerHTML = ''; go.disabled = true;
      try {
        const { jobId } = await api(`/projects/${name}/host-install`, { method: 'POST', body: { host: box.querySelector('.hi-host')?.value } });
        jobs[sel] = jobId; cancel.onclick = () => api(`/agent/jobs/${jobId}/cancel`, { method: 'POST', body: {} });
        const es = new EventSource(`/api/agent/jobs/${jobId}/events`);
        const on = ev => { try { const j = JSON.parse(ev.data); if (!j.id) return; draw(j); if (j.status !== 'running') es.close(); } catch {} };
        es.addEventListener('job', on); es.addEventListener('snapshot', on); es.addEventListener('done', on);
        es.onerror = async () => { es.close(); for (;;) { const j = await api('/agent/jobs/' + jobId); draw(j); if (j.status !== 'running') break; await new Promise(r => setTimeout(r, 500)); } };
      } catch (e) { toast(e.message, 'err'); go.disabled = false; }
    };
    $$(`${sel} .hi-un`).forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { const r = await api(`/projects/${name}/host-uninstall`, { method: 'POST', body: { host: b.dataset.k } }); toast('已卸载并清理', 'ok'); await renderHostInstall(name, sel); $(sel).querySelector('.hi-result').innerHTML = `<p class="wz-result ok">${icon('trash')} 已卸载/清理</p><pre class="code-block small">${esc(r.log.join('\n'))}</pre>`; }
      catch (e) { toast(e.message, 'err'); b.disabled = false; }
    });
  }
  // 挂钩：打开项目 / 安装向导渲染时一起渲染
  const origOpen = window.PluginIDE?.openProject;
  if (origOpen) { const w = async (n, o) => { const r = await origOpen(n, o); renderHostInstall(n, '#pd-hostinstall'); return r; }; window.PluginIDE.openProject = w; try { openProject = w; } catch {} }
  if (window.V12) { const oi = window.V12.renderInstall; window.V12.renderInstall = async (n, sel) => { await oi(n, sel); if (sel === '#run-install') renderHostInstall(n, '#run-hostinstall'); }; }
  const iv = setInterval(() => { if (S.info) { clearInterval(iv); load(false).catch(() => {}); } }, 200);
  window.V13 = { load, renderHostInstall, state: E };
})();
