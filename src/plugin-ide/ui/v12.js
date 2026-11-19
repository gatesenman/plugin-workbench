// v1.2.0：离线演示横幅、连接 AI 向导、安装向导、发布说明、快照对比、项目资料
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const copy = async (t, what = '路径') => { try { await navigator.clipboard.writeText(t); toast(`已复制${what}`, 'ok'); } catch { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(`已复制${what}`, 'ok'); } };

  // —— 离线演示横幅 ——
  function renderBanner() {
    const mock = !S.info || S.info.provider === 'mock';
    $$('[data-demo-banner]').forEach(el => {
      el.classList.toggle('hidden', !mock);
      if (mock && !el.dataset.done) {
        el.innerHTML = `${icon('info')}<span class="db-text"><b>离线演示模式</b>：生成的是示例代码，接入真实模型后才能实现真实功能</span><button type="button" class="btn btn-sm btn-secondary db-go">${icon('plug')} 连接 AI 模型</button>`;
        el.querySelector('.db-go').onclick = () => { nav('settings'); $('#ai-wizard')?.scrollIntoView({ block: 'start' }); };
        el.dataset.done = '1';
      }
    });
  }
  window.renderDemoBanner = renderBanner;

  // —— 连接 AI 向导 ——
  const PRESETS = [
    { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'https://platform.deepseek.com/api_keys', ic: 'sparkle' },
    { id: 'qwen', name: '通义千问', sub: '阿里云百炼 DashScope', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', key: 'https://bailian.console.aliyun.com/', ic: 'cloud' },
    { id: 'kimi', name: 'Kimi', sub: '月之暗面 Moonshot', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', key: 'https://platform.moonshot.cn/console/api-keys', ic: 'rocket' },
    { id: 'glm', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', key: 'https://open.bigmodel.cn/usercenter/apikeys', ic: 'lightbulb' },
    { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: 'https://platform.openai.com/api-keys', ic: 'globe' },
    { id: 'ollama', name: 'Ollama 本地', sub: '本机运行，无需 Key', base: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', key: 'https://ollama.com/download', ic: 'vm', nokey: true },
    { id: 'mock', name: '离线演示', sub: '不联网，仅示例代码', ic: 'circle-slash' },
  ];
  function renderPresets() {
    const box = $('#wz-presets'); if (!box) return;
    const curBase = $('#s-base')?.value, curProv = $('#s-provider')?.value;
    box.innerHTML = PRESETS.map(p => {
      const on = p.id === 'mock' ? curProv === 'mock' : curProv !== 'mock' && curBase === p.base;
      return `<button type="button" class="wz-preset ${on ? 'on' : ''}" data-p="${p.id}">${icon(p.ic)}<span><b>${esc(p.name)}</b>${p.sub ? `<small>${esc(p.sub)}</small>` : ''}</span></button>`;
    }).join('');
    $$('#wz-presets .wz-preset').forEach(b => b.onclick = () => {
      const p = PRESETS.find(x => x.id === b.dataset.p);
      if (p.id === 'mock') { $('#s-provider').value = 'mock'; $('#wz-hint').innerHTML = '离线演示模式：不联网、不需要 Key，但只能生成示例代码。'; }
      else {
        $('#s-provider').value = 'openai'; $('#s-base').value = p.base; $('#s-model').value = p.model;
        if (p.nokey && !$('#s-key').value) $('#s-key').value = 'ollama';
        $('#wz-hint').innerHTML = p.nokey ? `请先安装并启动 Ollama（<a href="${p.key}" target="_blank" rel="noopener">下载</a>），再在终端运行 <code>ollama pull ${esc(p.model)}</code>。` : `到 <a href="${p.key}" target="_blank" rel="noopener">${esc(p.name)} 控制台</a> 创建 API Key，粘贴到下方「API Key」。模型已预填为 <code>${esc(p.model)}</code>，可改。`;
        $('#s-key').focus();
      }
      $('#wz-result').classList.add('hidden'); renderPresets();
    });
  }
  async function testConn() {
    const b = $('#btn-test-llm'), out = $('#wz-result'); b.disabled = true; b.innerHTML = `${icon('loading', 'codicon-modifier-spin')} 正在测试…`;
    try {
      const r = await api('/settings/test', { method: 'POST', body: { provider: $('#s-provider').value, baseUrl: $('#s-base').value.trim(), apiKey: $('#s-key').value.trim(), model: $('#s-model').value.trim() } });
      out.className = 'wz-result ' + (r.ok ? 'ok' : 'bad');
      out.innerHTML = `${icon(r.ok ? 'pass-filled' : 'error')} ${esc(r.message)}${r.ok && $('#s-provider').value !== 'mock' ? ' — 记得点「保存设置」。' : ''}${r.detail ? `<details><summary>服务返回的原始信息</summary><code>${esc(r.detail)}</code></details>` : ''}`;
    } catch (e) { out.className = 'wz-result bad'; out.textContent = '测试失败：' + e.message; }
    finally { b.disabled = false; b.innerHTML = `${icon('debug-disconnect')} 测试连接`; }
  }
  $('#btn-test-llm') && ($('#btn-test-llm').onclick = testConn);
  ['#s-base', '#s-provider'].forEach(s => $(s)?.addEventListener('change', renderPresets));
  $('#btn-save-settings')?.addEventListener('click', () => setTimeout(async () => { try { S.info = await api('/info'); } catch {} renderBanner(); renderPresets(); }, 300));

  // —— 安装向导 + 发布说明 ——
  async function renderInstall(name, sel) {
    const box = $(sel); if (!box || !name) return;
    let g; try { g = await api(`/projects/${name}/install-guide`); } catch { box.classList.add('hidden'); return; }
    if (!g.ready) { box.classList.add('hidden'); return; }
    let ex = null; try { if ((S.meta?.releases || []).length || sel === '#run-install') ex = await api(`/projects/${name}/publish-explain`); } catch {}
    const oc = g.oneClick;
    box.innerHTML = `<h4>${icon('desktop-download')} ${esc(g.title)}</h4>
      <ol class="install-steps">${g.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="install-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-act="reveal">${icon('folder-opened')} 打开产物所在文件夹</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="copy">${icon('copy')} 复制${g.pathToCopy === g.file ? '安装包' : g.family === 'browser-ext' ? '文件夹' : '文件'}路径</button>
        ${oc?.kind === 'vscode' ? `<button type="button" class="btn btn-primary btn-sm" data-act="vscode" ${oc.available ? '' : 'disabled'}>${icon('vscode')} ${esc(oc.label)}</button>` : ''}
        ${oc?.kind === 'copy-url' ? `<button type="button" class="btn btn-primary btn-sm" data-act="url">${icon('link')} ${esc(oc.label)}</button>` : ''}
      </div>
      <code class="install-path">${esc(g.pathToCopy)}</code>
      ${oc?.note ? `<p class="muted small">${icon('info')} ${esc(oc.note)}</p>` : ''}
      <p class="install-msg muted small hidden"></p>
      ${ex ? `<div class="publish-explain"><h4>${icon('cloud-upload')} 关于「发布」</h4><p>${esc(ex.what)}</p>
        <p>想让所有人都能在 <b>${esc(ex.store)}</b> 搜到它，还需要：</p><ul>${ex.needs.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        <div class="kv"><span>真实发布操作</span><code>${esc(ex.command)}</code></div>
        ${ex.link ? `<div class="kv"><span>开发者后台</span><a href="${esc(ex.link)}" target="_blank" rel="noopener">${esc(ex.link)}</a></div>` : ''}
        ${ex.internal ? `<p class="muted small">${icon('organization')} ${esc(ex.internal)}</p>` : ''}</div>` : ''}`;
    box.classList.remove('hidden');
    const msg = box.querySelector('.install-msg');
    box.querySelector('[data-act=reveal]').onclick = async () => { try { await api(`/projects/${name}/reveal`, { method: 'POST', body: {} }); } catch (e) { toast(e.message, 'err'); } };
    box.querySelector('[data-act=copy]').onclick = () => copy(g.pathToCopy);
    const u = box.querySelector('[data-act=url]'); if (u) u.onclick = () => copy(oc.value, '地址，请粘贴到浏览器地址栏');
    const v = box.querySelector('[data-act=vscode]'); if (v) v.onclick = async () => {
      v.disabled = true; msg.classList.remove('hidden'); msg.textContent = '正在安装到 VS Code…';
      try { const r = await api(`/projects/${name}/install-vscode`, { method: 'POST', body: {} }); msg.textContent = r.message; toast(r.message, r.ok ? 'ok' : 'err'); } catch (e) { msg.textContent = e.message; } finally { v.disabled = false; }
    };
  }

  // —— 快照对比 + 单文件恢复 ——
  const ST = { added: ['+', '新增', 'tag-ok'], deleted: ['−', '已删除', 'tag-warn'], modified: ['✎', '修改', 'tag-brand'] };
  async function openCpDiff(name, cp) {
    const d = await api(`/projects/${name}/checkpoints/${cp.id}/diff`);
    const dlg = $('#dlg-cp'); let cur = null;
    $('#cp-title').textContent = `快照「${d.label}」与现在的差异`;
    $('#cp-summary').textContent = d.files.length ? `自这个快照以来有 ${d.files.length} 个文件发生变化（${d.unchanged} 个未变）。选中文件可单独恢复。` : '现在的文件与这个快照完全一致。';
    $('#cp-files').innerHTML = d.files.map((f, i) => `<button type="button" class="cf-file" data-i="${i}"><span class="badge ${ST[f.status][2]}">${ST[f.status][0]}</span> ${esc(f.path)} <small class="muted">${ST[f.status][1]} +${f.added}/−${f.removed}</small></button>`).join('');
    const show = i => { cur = d.files[i]; $$('#cp-files .cf-file').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
      $('#cp-diff').innerHTML = cur ? esc(cur.diff).split('\n').map(l => `<span class="dl ${l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : ''}">${l}</span>`).join('\n') : '';
      $('#btn-cp-file').disabled = !cur; $('#btn-cp-file').innerHTML = `${icon('discard')} ${cur?.status === 'added' ? '删除这个新文件（回到快照状态）' : '只恢复这个文件'}`; };
    $$('#cp-files .cf-file').forEach(b => b.onclick = () => show(+b.dataset.i)); show(0); if (!d.files.length) $('#cp-diff').textContent = '';
    $('#btn-cp-close').onclick = () => dlg.close();
    $('#btn-cp-file').onclick = async () => { if (!cur) return; const r = await api(`/projects/${name}/checkpoints/${cp.id}/restore-file`, { method: 'POST', body: { path: cur.path } });
      toast(`${cur.path} ${r.action === 'removed' ? '已删除' : '已恢复'}（原状态已自动存为快照）`, 'ok'); dlg.close(); await openProject(name, { stay: true }); };
    $('#btn-cp-all').onclick = async () => { dlg.close(); const r = await api(`/projects/${name}/checkpoints/${cp.id}/restore`, { method: 'POST', body: {} }); log(`[undo] 已恢复到「${r.restored}」`); await openProject(name, { stay: true }); };
    dlg.showModal();
  }
  const origCp = window.renderCheckpoints;
  window.renderCheckpoints = async function () {
    await origCp();
    let cps = []; try { cps = await api(`/projects/${S.proj}/checkpoints`); } catch {}
    $$('#cp-list li').forEach((li, i) => {
      if (!cps[i] || li.querySelector('.btn-cpdiff')) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-sm btn-cpdiff'; b.title = '查看改了哪些文件'; b.innerHTML = `${icon('diff')} 对比`;
      b.onclick = e => { e.stopPropagation(); openCpDiff(S.proj, cps[i]).catch(err => toast(err.message, 'err')); };
      li.insertBefore(b, li.querySelector('.btn-restore'));
    });
  };

  // —— 项目资料 ——
  async function renderDocs() {
    if (!S.proj || !$('#doc-list')) return;
    let ds = []; try { ds = await api(`/projects/${S.proj}/docs`); } catch {}
    $('#doc-list').innerHTML = ds.map(d => `<li>${icon(d.source === 'text' ? 'note' : 'globe')}<span class="li-body"><span class="li-title">${esc(d.title)}</span><small>${d.source === 'text' ? '粘贴的文字' : esc(d.source)} · ${d.chars} 字 · ${esc(d.preview.slice(0, 60))}…</small></span><button type="button" class="btn btn-ghost btn-sm" data-del="${esc(d.id)}" title="删除">${icon('trash')}</button></li>`).join('') || '<li class="muted">还没有资料。</li>';
    $$('#doc-list [data-del]').forEach(b => b.onclick = async () => { await api(`/projects/${S.proj}/docs/${b.dataset.del}`, { method: 'DELETE' }); renderDocs(); });
  }
  if ($('#btn-doc-add')) $('#btn-doc-add').onclick = async () => {
    const b = $('#btn-doc-add'), url = $('#doc-url').value.trim(), text = $('#doc-text').value.trim();
    if (!url && !text) return toast('请填写网页地址或粘贴文字', 'err');
    b.disabled = true; b.innerHTML = `${icon('loading', 'codicon-modifier-spin')} ${url ? '正在抓取网页…' : '添加中…'}`;
    try { const d = await api(`/projects/${S.proj}/docs`, { method: 'POST', body: { title: $('#doc-title').value.trim(), url: url || undefined, text } });
      toast(`已添加资料「${d.title}」（${d.chars} 字），AI 之后会参考它`, 'ok'); ['#doc-title', '#doc-url', '#doc-text'].forEach(s => $(s).value = ''); renderDocs(); }
    catch (e) { toast(e.message, 'err'); } finally { b.disabled = false; b.innerHTML = `${icon('add')} 添加资料`; }
  };

  // 挂钩 openProject：每次打开项目刷新安装向导/资料/横幅
  const origOpen = window.PluginIDE?.openProject;
  if (origOpen) {
    const wrapped = async (n, o) => { const r = await origOpen(n, o); renderBanner(); renderInstall(n, '#pd-install'); renderDocs(); return r; };
    window.PluginIDE.openProject = wrapped;
    try { openProject = wrapped; } catch {}
  }
  // 等待初始化完成后渲染
  const iv = setInterval(() => { if (S.info) { clearInterval(iv); renderBanner(); renderPresets(); } }, 200);
  window.V12 = { renderInstall, renderBanner, renderDocs, openCpDiff, PRESETS };
})();
