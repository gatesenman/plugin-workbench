// AI-first 首页：描述 → 识别宿主 → 可编辑方案 → 生成/构建/自动修复（可见步骤）→ 迭代 → 打包发布
// P1: SSE 流式步骤、取消、确认模式
const H = { intent: null, plan: null, job: null, project: null, es: null, jobId: null };
const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EXAMPLES = [
  ['chrome', '做一个 Chrome 扩展，一键把当前网页保存为 Markdown，并支持快捷键'],
  ['code', '给 VS Code 写个插件，统计当前文件的代码行数并显示在状态栏'],
  ['symbol-misc', 'Blender 插件：批量重命名选中的物体，并添加前缀'],
  ['comment-discussion', '给飞书做一个日报机器人，每天 18 点提醒填写日报'],
  ['question', '为我们公司内部的「Acme CAD」开发 Python 插件，导出 BOM 清单'],
  ['server', '做个 MCP server，提供查询天气的工具'],
];
const fmtTime = iso => { try { return new Date(iso).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

function flow(k, state) {
  const order = ['intent', 'plan', 'run', 'iterate', 'ship'], idx = order.indexOf(k);
  $$('#flow-steps li').forEach(li => { const i = order.indexOf(li.dataset.k); li.className = i < idx ? 'done' : i === idx ? (state || 'cur') : ''; });
}
$('#home-examples').innerHTML = EXAMPLES.map(([ic, t], i) => `<button type="button" class="chip" data-ex="${i}">${icon(ic)} ${escH(t)}</button>`).join('');
$$('#home-examples .chip').forEach(b => b.onclick = () => { $('#home-prompt').value = EXAMPLES[+b.dataset.ex][1]; $('#home-prompt').focus(); });

$('#home-prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#btn-home-go').click(); } });

function renderOnboarding() { if (localStorage.getItem('pide.onb.hidden') === '1') $('#onboarding')?.classList.add('hidden'); }
$('#btn-onb-hide').onclick = () => { localStorage.setItem('pide.onb.hidden', '1'); $('#onboarding').classList.add('hidden'); };

function renderRecent(ps) {
  const list = (ps || []).slice(0, 8);
  $('#recent-empty')?.classList.toggle('hidden', list.length > 0);
  $('#recent-list').innerHTML = list.map(p => {
    const st = p.stages || {}, last = ['publish', 'package', 'validate', 'build', 'init'].find(k => st[k]);
    return `<li data-n="${escH(p.name)}">${icon(p.origin === 'ai-first' ? 'sparkle' : 'plug')}<span class="li-body"><span class="li-title">${escH(p.name)}</span><small>${escH(p.vendorName)} · v${escH(p.version)} · ${fmtTime(p.updatedAt)}</small></span><span class="cat-pill ${st[last]?.ok === false ? 'bad' : ''}">${last || 'init'}</span></li>`;
  }).join('');
  $$('#recent-list li').forEach(li => li.onclick = () => openProject(li.dataset.n));
}

$('#btn-home-go').onclick = async () => {
  const prompt = $('#home-prompt').value.trim();
  if (!prompt) { $('#home-prompt').focus(); return; }
  const btn = $('#btn-home-go'); btn.disabled = true; btn.innerHTML = `${icon('loading', 'codicon-modifier-spin')} 识别中…`;
  ['#card-plan', '#card-run'].forEach(s => $(s).classList.add('hidden'));
  try {
    H.intent = await api('/agent/intent', { method: 'POST', body: { prompt } });
    renderIntent(H.intent); flow('intent'); activityPush(`识别宿主 → ${H.intent.recommended}（${Math.round(H.intent.confidence * 100)}%）`);
  } catch (e) { log('[error] ' + e.message); } finally { btn.disabled = false; btn.innerHTML = `${icon('arrow-right')} 开始`; }
};

function renderIntent(r) {
  $('#card-intent').classList.remove('hidden');
  $('#intent-conf').textContent = `置信度 ${Math.round(r.confidence * 100)}%`;
  const opts = r.candidates.map(c => ({ id: c.id, title: c.name, sub: [c.company !== c.name ? c.company : '', c.category].filter(Boolean).join(' · '), reason: c.reason, ic: c.custom ? 'sparkle' : 'extensions' }));
  if (r.unknown) {
    const a = r.unknown.adapter;
    opts.unshift({ id: '__unknown__', title: `${r.unknown.name}（新宿主）`, sub: '厂商库里还没有它，插件工坊会自动学习它的插件规则', reason: '未知宿主自动扩展', ic: 'wand' });
  }
  if (!opts.length) { $('#intent-cands').innerHTML = '<div class="empty-hint">未识别到宿主，请在描述中写明目标软件名称。</div>'; return; }
  $('#intent-cands').innerHTML = opts.map(o => `<label class="cand ${o.id === r.recommended ? 'sel' : ''}"><input type="radio" name="cand" value="${escH(o.id)}" ${o.id === r.recommended ? 'checked' : ''}>${icon(o.ic)}<span class="li-body cand-body"><span class="li-title cand-title">${escH(o.title)}</span>${o.sub ? `<small class="cand-sub">${escH(o.sub)}</small>` : ''}</span>${o.reason ? `<span class="cat-pill cand-reason" title="${escH(o.reason)}">${escH(o.reason)}</span>` : ''}</label>`).join('')
    + `<label class="cand other"><input type="radio" name="cand" value="__manual__">${icon('library')}<span class="li-body"><span class="li-title">都不是，手动指定</span><small><input id="cand-manual" list="vendor-dl" placeholder="输入厂商 id，如 figma"></small></span></label>`;
  $$('#intent-cands input[type=radio]').forEach(i => i.onchange = () => $$('#intent-cands .cand').forEach(l => l.classList.toggle('sel', l.contains(i) && i.checked)));
}

$('#btn-plan').onclick = async () => {
  let vendorId = $('#intent-cands input[name=cand]:checked')?.value;
  if (vendorId === '__manual__') vendorId = $('#cand-manual').value.trim();
  if (!vendorId) return log('[error] 请选择目标宿主');
  const b = $('#btn-plan'); b.disabled = true;
  try {
    H.plan = await api('/agent/plan', { method: 'POST', body: { prompt: H.intent.prompt, vendorId, unknown: H.intent.unknown } });
    renderPlan(H.plan); flow('plan'); activityPush(`方案就绪 · ${H.plan.name} · ${H.plan.features.length} 功能点`);
  } catch (e) { log('[error] ' + e.message); } finally { b.disabled = false; }
};

const FMT_PLAIN = { zip: '压缩包（.zip）', vsix: 'VS Code 安装包（.vsix）', ccx: 'Adobe 安装包（.ccx）', zxp: 'Adobe 安装包（.zxp）' };
function knowledgeHtml(k, title) {
  const fmt = FMT_PLAIN[String(k.packageFormat || '').toLowerCase().replace(/^\./, '')] || k.packageFormat;
  return `<h4>${icon('book')} ${escH(title)}</h4>
    <p class="plain-lead">插件工坊已经了解这个软件的插件规则，会自动帮你处理好配置文件，你只需要确认上面的功能描述。</p>
    <div class="kv"><span>最后得到</span><span>一个可以安装的 ${escH(fmt)}</span></div>
    <div class="kv"><span>怎么用上</span><span>打包后会一步步告诉你怎么装进 ${escH(title.replace(/ (插件须知|运行与调试)$/, ''))}</span></div>
    <div class="kv"><span>想给别人用</span><span>可以发安装包给同事，或上架到「${escH(k.publishTarget)}」</span></div>
    <details class="tech-details"><summary>${icon('chevron-right')} 技术细节（给开发同事看）</summary>
    <div class="kv"><span>配置文件</span><code>${escH(k.manifest)}</code></div>
    <div class="kv"><span>关键配置项</span><code>${escH((k.manifestRequired || []).join(', '))}</code></div>
    <div class="kv"><span>打包 / 发布</span><span>${escH(k.packageFormat)} → ${escH(k.publishTarget)}</span></div>
    <h5>${icon('law')} 平台规则</h5><ul>${(k.rules || []).map(r => `<li>${escH(r)}</li>`).join('')}</ul>
    <h5>${icon('play')} 运行 / 预览</h5><ul>${(k.run || []).map(r => `<li>${escH(r)}</li>`).join('')}</ul>
    <h5>${icon('debug')} 调试</h5><ul>${(k.debug || []).map(r => `<li>${escH(r)}</li>`).join('')}</ul>
    ${(k.docs || []).length ? `<h5>${icon('link-external')} 文档</h5><ul>${k.docs.map(d => `<li><a href="${escH(d.url)}" target="_blank" rel="noopener">${escH(d.title)}</a></li>`).join('')}</ul>` : ''}
    __FILES__</details>`;
}
function renderPlan(p) {
  $('#card-plan').classList.remove('hidden');
  $('#plan-name').value = p.name; $('#plan-summary').value = p.summary;
  $('#plan-features').value = p.features.join('\n'); $('#plan-accept').value = p.acceptance.join('\n');
  $('#plan-maxfix').value = String(p.maxFix ?? 3);
  $('#plan-knowledge').innerHTML = knowledgeHtml(p.knowledge, `${p.vendor.name} 插件须知`)
    .replace('__FILES__', `<h5>${icon('files')} 预计生成文件</h5><div class="file-chips">${p.files.map(f => `<code>${escH(f)}</code>`).join('')}</div>`);
  $('#card-plan').scrollIntoView({ block: 'nearest' });
}

const STEP_IC = { ok: 'pass-filled', fail: 'error', running: 'loading', skip: 'circle-slash' };
function renderJob(j) {
  $('#card-run').classList.remove('hidden');
  const stLabel = j.status === 'running' ? '执行中…'
    : j.status === 'awaiting_confirm' ? '等待确认…'
    : j.status === 'cancelled' ? '已取消'
    : j.status === 'error' ? '出错'
    : (j.result?.ok ? '完成 · 通过' : '完成 · 需关注');
  $('#run-status').textContent = stLabel;
  $('#run-status').dataset.state = j.status === 'running' || j.status === 'awaiting_confirm' ? 'running'
    : j.status === 'cancelled' ? 'fail' : j.result?.ok ? 'ok' : 'fail';
  const busy = j.status === 'running' || j.status === 'awaiting_confirm';
  $('#btn-job-cancel')?.classList.toggle('hidden', !busy);
  $('#agent-steps').innerHTML = (j.steps || []).map(s => `<li class="st-${s.status}">${icon(STEP_IC[s.status] || 'circle', s.status === 'running' ? 'codicon-modifier-spin' : '')}<div><div class="st-title">${icon(s.icon || 'circle')} ${escH(s.title)}</div>${s.detail ? `<pre>${escH(s.detail)}</pre>` : ''}</div></li>`).join('')
    + (j.error ? `<li class="st-fail">${icon('error')}<div><div class="st-title">${escH(j.error)}</div></div></li>` : '');
  renderConfirmBar(j);
}

function renderConfirmBar(j) {
  const bar = $('#confirm-bar'); if (!bar) return;
  const show = j.status === 'awaiting_confirm' && j.pending?.files?.length;
  bar.classList.toggle('hidden', !show);
  if (!show) return;
  $('#confirm-label').textContent = `确认应用：${j.pending.label || 'AI 改动'}（${j.pending.files.length} 个文件）`;
  $('#confirm-files').innerHTML = j.pending.files.map((f, i) =>
    `<button type="button" class="cf-file ${i ? '' : 'on'}" data-i="${i}"><span class="badge ${f.action === 'create' ? 'tag-ok' : 'tag-brand'}">${f.action === 'create' ? '+' : '✎'}</span> ${escH(f.path)}</button>`
  ).join('');
  const showPreview = i => {
    $$('#confirm-files .cf-file').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
    const f = j.pending.files[i];
    if (f) showDiff([{ path: f.path, action: f.action, content: f.preview || '' }], j.pending.label);
  };
  $$('#confirm-files .cf-file').forEach(b => b.onclick = () => showPreview(+b.dataset.i));
  showPreview(0);
}

function closeJobStream() {
  if (H.es) { try { H.es.close(); } catch {} H.es = null; }
}

/** Prefer SSE; fall back to polling. Resolves when job leaves running/awaiting_confirm — except awaiting needs user action so we keep listening. */
function watchJob(jobId) {
  return new Promise((resolve, reject) => {
    H.jobId = jobId;
    closeJobStream();
    let settled = false;
    const finish = (j) => {
      if (settled) return;
      if (j.status === 'awaiting_confirm') return; // keep watching
      settled = true; closeJobStream(); resolve(j);
    };
    try {
      const es = new EventSource('/api/agent/jobs/' + jobId + '/events');
      H.es = es;
      const onJob = (ev) => {
        try {
          const j = JSON.parse(ev.data); H.job = j; renderJob(j);
          if (j.status === 'awaiting_confirm') activityPush('等待确认 AI 改动…');
          else if (['done', 'error', 'cancelled'].includes(j.status)) finish(j);
        } catch (e) {}
      };
      es.addEventListener('job', onJob);
      es.addEventListener('snapshot', onJob);
      es.addEventListener('done', onJob);
      es.addEventListener('awaiting_confirm', () => {});
      es.onerror = async () => {
        // fallback poll
        es.close(); H.es = null;
        try { finish(await pollJob(jobId)); } catch (e) { if (!settled) { settled = true; reject(e); } }
      };
    } catch {
      pollJob(jobId).then(finish).catch(reject);
    }
  });
}

async function pollJob(jobId) {
  for (;;) {
    const j = await api('/agent/jobs/' + jobId); H.job = j; renderJob(j);
    if (j.status === 'awaiting_confirm') {
      // wait until user confirms — poll slowly
      await new Promise(r => setTimeout(r, 600));
      continue;
    }
    if (j.status !== 'running') return j;
    await new Promise(r => setTimeout(r, 400));
  }
}

async function afterJob(j) {
  if (j.project) { H.project = j.project; await openProject(j.project, { stay: true }); }
  if (j.status === 'cancelled') {
    activityPush(`任务已取消${j.project ? ' · ' + j.project : ''}`);
    addMsg('bot', '【AI 智能体】任务已取消。已写入的部分可用「撤销」回退。');
    return;
  }
  if (j.result) {
    $('#run-result').classList.remove('hidden');
    $('#run-guide').innerHTML = knowledgeHtml(j.result.guide, `${S.meta?.vendorName || j.result.guide?.name || '宿主'} 运行与调试`).replace('__FILES__', '');
    flow(j.result.ok ? 'iterate' : 'run', j.result.ok ? 'cur' : 'bad');
    activityPush(`${j.project} ${j.result.ok ? '构建与校验通过' : '需关注'}（修复 ${j.result.fixAttempts || 0} 次）`);
    addMsg('bot', `【AI 智能体】项目 ${j.project} 已${j.result.ok ? '生成并通过构建/校验' : '生成，但构建或校验仍未通过，请查看步骤详情'}。可以继续在这里描述改动，我会生成→构建→自动修复。`);
  }
}

$('#btn-run').onclick = async () => {
  const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  const p = { ...H.plan, name: $('#plan-name').value.trim(), summary: $('#plan-summary').value.trim(), features: lines('#plan-features'), acceptance: lines('#plan-accept'), maxFix: +$('#plan-maxfix').value };
  if (!p.name) return log('[error] 项目名不能为空');
  const b = $('#btn-run'); b.disabled = true; $('#run-result').classList.add('hidden'); flow('run');
  try {
    const { jobId } = await api('/agent/run', { method: 'POST', body: p });
    await afterJob(await watchJob(jobId));
  } catch (e) { log('[error] ' + e.message); } finally { b.disabled = false; $('#btn-job-cancel')?.classList.add('hidden'); }
};

$('#btn-job-cancel')?.addEventListener('click', async () => {
  if (!H.jobId) return;
  try {
    const j = await api('/agent/jobs/' + H.jobId + '/cancel', { method: 'POST', body: {} });
    H.job = j; renderJob(j); activityPush('已请求取消');
  } catch (e) { log('[error] ' + e.message); }
});

$('#btn-confirm-approve')?.addEventListener('click', async () => {
  if (!H.jobId) return;
  try { const j = await api('/agent/jobs/' + H.jobId + '/confirm', { method: 'POST', body: { decision: 'approve' } }); H.job = j; renderJob(j); activityPush('已批准 AI 改动'); }
  catch (e) { log('[error] ' + e.message); }
});
$('#btn-confirm-reject')?.addEventListener('click', async () => {
  if (!H.jobId) return;
  try { const j = await api('/agent/jobs/' + H.jobId + '/confirm', { method: 'POST', body: { decision: 'reject' } }); H.job = j; renderJob(j); activityPush('已拒绝 AI 改动'); }
  catch (e) { log('[error] ' + e.message); }
});

async function iterateProject(name, prompt) {
  tab('home'); $('#card-run').classList.remove('hidden'); $('#run-result').classList.add('hidden'); flow('run');
  const { jobId } = await api(`/projects/${name}/agent-iterate`, { method: 'POST', body: { prompt, maxFix: +($('#plan-maxfix')?.value || 3) } });
  await afterJob(await watchJob(jobId));
}
$('#btn-iterate').onclick = async () => {
  const name = H.project || S.proj; if (!name) return log('[error] 请先创建或选择项目');
  const b = $('#btn-iterate'); b.disabled = true;
  try { await iterateProject(name, $('#iter-prompt').value.trim()); $('#iter-prompt').value = ''; } catch (e) { log('[error] ' + e.message); } finally { b.disabled = false; }
};
$('#btn-open-ide').onclick = () => { if (S.info.ide) tab('code'); else tab('files'); };
$('#btn-ship').onclick = async () => {
  if (!S.proj) return;
  flow('ship');
  for (const st of ['build', 'package', 'publish']) { const r = await runStage(st); if (!r?.ok) { flow('ship', 'bad'); return; } }
  flow('ship', 'done');
  addMsg('bot', `【AI 智能体】已打包 ${S.meta?.artifact?.file || ''}。下面有「如何安装」步骤；刚才的发布只是演练，没有真正上架。`);
  window.V12?.renderInstall(S.proj, '#run-install');
};
$('#btn-undo').onclick = async () => {
  const name = H.project || S.proj; if (!name) return;
  const cps = await api(`/projects/${name}/checkpoints`);
  const target = cps.find(c => !c.label.startsWith('撤销前')) ; if (!target) return log('[undo] 没有可撤销的检查点');
  await restoreCp(name, target);
};
async function restoreCp(name, c) {
  if (!await uiConfirm('撤销 AI 改动', `恢复到快照「${c.label}」之前的状态。当前状态会先自动保存为新快照。`, { okText: '恢复', danger: true, icon: 'discard' })) return;
  const r = await api(`/projects/${name}/checkpoints/${c.id}/restore`, { method: 'POST', body: {} });
  log(`[undo] 已恢复到「${r.restored}」之前${r.removed.length ? '，移除 ' + r.removed.join(', ') : ''}`);
  await openProject(name, { stay: true });
}
async function renderCheckpoints() {
  if (!S.proj || !$('#cp-list')) return;
  let cps = []; try { cps = await api(`/projects/${S.proj}/checkpoints`); } catch {}
  $('#cp-empty').classList.toggle('hidden', cps.length > 0);
  $('#cp-list').innerHTML = cps.slice(0, 12).map((c, i) => `<li title="${escH(c.at)}">${icon('git-commit')}<span class="li-body"><span class="li-title">${escH(c.label)}</span><small>${fmtTime(c.at)} · ${c.files} 个文件</small></span><button type="button" class="btn btn-ghost btn-sm btn-restore" data-i="${i}" title="恢复到此检查点">${icon('discard')}</button></li>`).join('');
  $$('#cp-list .btn-restore').forEach(b => b.onclick = () => restoreCp(S.proj, cps[+b.dataset.i]));
}

window.iterateProject = iterateProject;
window.renderCheckpoints = renderCheckpoints;
window.activityPush = typeof activityPush === 'function' ? activityPush : (msg) => { try { window._activityPush?.(msg); } catch {} };
