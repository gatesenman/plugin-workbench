// AI-first 智能体：意图识别 → 宿主匹配（含未知宿主自动扩展）→ 可编辑方案 → 生成→构建→自动修复循环 → 校验
// P1: 取消、逐步确认（autoApplyAi）、SSE 事件广播
const crypto = require('crypto');
const registry = require('./registry'), llm = require('./llm'), L = require('./lifecycle'), knowledge = require('./knowledge'), templates = require('./templates');

const ALIASES = {
  'vscode': 'visual-studio-code', 'vs code': 'visual-studio-code', 'vsc': 'visual-studio-code',
  '谷歌浏览器': 'chrome', 'chrome 扩展': 'chrome', '浏览器扩展': 'chrome', '浏览器插件': 'chrome', '火狐': 'firefox',
  'ps ': 'photoshop', 'ps插件': 'photoshop', '表格': 'excel', 'mcp': 'mcp-server-通用', '油猴': 'chrome',
  'idea': 'intellij-idea', 'wp': 'wordpress', '飞书机器人': '飞书-lark', '钉钉机器人': '钉钉',
};
const QUOTE = /[「“"『《]([^」”"』》]{2,40})[」”"』》]/;
const isAscii = s => /^[\x00-\x7f]+$/.test(s);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scoreVendors(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const all = registry.all(), byId = new Map(all.map(v => [v.id, v])), hits = new Map();
  const add = (v, s, reason) => { if (!v) return; const h = hits.get(v.id); if (!h || h.score < s) hits.set(v.id, { ...v, score: s, reason }); };
  const hostPhrase = (n) => new RegExp(`(做|写|开发|给|为).{0,28}${esc(n)}.{0,16}(插件|扩展|加载项|add-?on|机器人)`, 'i').test(t)
    || new RegExp(`${esc(n)}.{0,8}(插件|扩展|加载项|add-?on)`, 'i').test(t);
  const destOnly = (n) => new RegExp(`(发给|发送到|推送到|同步到|分享到|发到).{0,16}${esc(n)}`, 'i').test(t) && !hostPhrase(n);
  for (const v of all) {
    for (const cand of [v.name, v.name.replace(/\s*\([^)]*\)/, '')]) {
      const n = cand.toLowerCase().trim(); if (n.length < 2) continue;
      const hit = isAscii(n) ? new RegExp(`(^|[^a-z0-9])${esc(n)}([^a-z0-9]|$)`).test(t) : t.includes(n);
      if (!hit) continue;
      if (destOnly(n)) {
        add(v, 4 + n.length, `集成目标「${cand}」（非宿主）`);
        continue;
      }
      let score = 10 + n.length * 3 + (v.builtin ? 0 : 5);
      let reason = `描述中提到「${cand}」`;
      if (hostPhrase(n)) { score += 22; reason = `宿主句式「…${cand}…插件/扩展」`; }
      add(v, score, reason);
    }
  }
  for (const [k, id] of Object.entries(ALIASES)) {
    if (!t.includes(k)) continue;
    let score = 8 + k.length;
    let reason = `别名「${k.trim()}」`;
    if (hostPhrase(k) || /(插件|扩展|加载项|浏览器)/.test(k)) { score += 18; reason = `宿主别名「${k.trim()}」`; }
    if (destOnly(k)) score = Math.min(score, 5);
    add(byId.get(id), score, reason);
  }
  return [...hits.values()].sort((a, b) => b.score - a.score);
}

function guessHostName(prompt) {
  const q = prompt.match(QUOTE); if (q) return q[1].trim();
  const m = prompt.match(/(?:为|给|针对|基于)\s*([A-Za-z][A-Za-z0-9 .+-]{1,30}?|[\u4e00-\u9fa5A-Za-z0-9]{2,12}?)\s*(?:开发|写|做|制作|编写|的|插件|扩展|，|。|$)/);
  return m ? m[1].trim() : null;
}

async function proposeAdapter(description, settings) {
  const out = await llm.getProvider(settings).chat([{ role: 'system', content: `[TASK:ADAPTER] 根据用户描述生成插件宿主适配器 JSON：{id,name,company,category,family(取值:${Object.keys(registry.FAMILIES).join('|')}),docs,overrides:{manifest,language,packageFormat,publishTarget}}。只输出 JSON 代码块。` }, { role: 'user', content: description }]);
  const def = JSON.parse(llm.extractCode(out) || out);
  if (!registry.FAMILIES[def.family]) def.family = 'generic';
  def.id = registry.slug(def.id || def.name);
  if (registry.all().some(v => v.id === def.id && v.builtin)) def.id = 'custom-' + def.id;
  return def;
}

async function intent(prompt, settings) {
  prompt = (prompt || '').trim(); if (!prompt) throw new Error('请描述你想做的插件');
  const provider = llm.getProvider(settings);
  let hostHint = null, llmUsed = false;
  if (provider.name !== 'mock') {
    try {
      const out = await provider.chat([{ role: 'system', content: '[TASK:INTENT] 从用户的插件需求中识别目标宿主软件。只输出 JSON 代码块：{"host":"宿主软件名","company":"厂商","confidence":0-1}' }, { role: 'user', content: prompt }]);
      const j = JSON.parse(llm.extractCode(out) || out); hostHint = j.host; llmUsed = true;
    } catch {}
  }
  let cands = scoreVendors(prompt + (hostHint ? ' ' + hostHint : ''));
  const named = hostHint || guessHostName(prompt);
  const quoted = (prompt.match(QUOTE) || [])[1];
  const quotedKnown = quoted && cands.some(c => quoted.toLowerCase().includes(c.name.toLowerCase().replace(/\s*\([^)]*\)/, '')) || c.name.toLowerCase().includes(quoted.toLowerCase()));
  let unknown = null;
  if ((quoted && !quotedKnown) || !cands.length) {
    const proposal = await proposeAdapter(prompt, settings);
    if (quoted) proposal.name = quoted;
    unknown = { name: proposal.name || named || '自定义宿主', proposal, adapter: { ...(registry.FAMILIES[proposal.family]), ...proposal, ...(proposal.overrides || {}) } };
  }
  cands = cands.slice(0, 5).map(c => ({ id: c.id, name: c.name, company: c.company, category: c.category, family: c.family, score: c.score, reason: c.reason, custom: !!c.custom }));
  const top = cands[0];
  const confidence = unknown ? 0.5 : top ? Math.min(0.98, 0.55 + top.score / 60) : 0;
  return { prompt, candidates: cands, unknown, recommended: unknown ? '__unknown__' : top?.id, confidence: +confidence.toFixed(2), llm: llmUsed, provider: provider.name };
}

const FEATURE_SPLIT = /[，,；;。\n]|并且|并|同时|以及|还要|另外/;
function slugName(prompt, vendor) {
  const words = (prompt.match(/[A-Za-z][A-Za-z0-9]{2,}/g) || []).map(w => w.toLowerCase()).filter(w => !vendor.toLowerCase().includes(w) && !['plugin', 'extension', 'addon', 'the', 'and', 'for', 'python', 'javascript'].includes(w)).slice(0, 2);
  const base = registry.slug(vendor).replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'plugin';
  return [base, ...(words.length ? words : ['assistant'])].join('-');
}
function uniqueName(n) { const ex = new Set(L.list().map(p => p.name)); if (!ex.has(n)) return n; let i = 2; while (ex.has(`${n}-${i}`)) i++; return `${n}-${i}`; }

async function plan({ prompt, vendorId, unknown }, settings) {
  let adapter;
  if (vendorId === '__unknown__' || (!vendorId && unknown)) {
    if (!unknown?.proposal) throw new Error('缺少未知宿主的适配器提案');
    adapter = { ...registry.FAMILIES[unknown.proposal.family] || registry.FAMILIES.generic, ...unknown.proposal, ...(unknown.proposal.overrides || {}), pending: true };
  } else {
    adapter = registry.resolve(vendorId); if (!adapter) throw new Error('未知厂商: ' + vendorId);
  }
  const provider = llm.getProvider(settings);
  let spec = null;
  if (provider.name !== 'mock') {
    try {
      const out = await provider.chat([{ role: 'system', content: `[TASK:PLAN] 你是 ${adapter.name} 插件架构师。根据需求输出 JSON 代码块：{"name":"小写-连字符项目名","displayName":"","summary":"一句话","features":["功能点"],"acceptance":["验收标准"]}` + knowledge.promptBlock(adapter) }, { role: 'user', content: prompt }]);
      spec = JSON.parse(llm.extractCode(out) || out);
    } catch {}
  }
  const feats = prompt.split(FEATURE_SPLIT).map(s => s.replace(/^(我想|我要|帮我|请|做一个|写一个|开发一个|给我)/, '').trim()).filter(s => s.length >= 2);
  const intro = /^(为|给|做|写|开发|针对|基于).{0,30}(插件|扩展|加载项|机器人|应用|server|add-?on)$/i;
  if (feats.length > 1 && intro.test(feats[0])) feats.shift();
  const bare = /^.{0,24}(插件|扩展|加载项|机器人|server|add-?on)$/i;
  while (feats.length > 1 && bare.test(feats[0]) && feats[0].toLowerCase().includes(adapter.name.toLowerCase().replace(/\s*\([^)]*\)/, ''))) feats.shift();
  spec = spec || {};
  const name = uniqueName((spec.name || slugName(prompt, adapter.name)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'my-plugin');
  const k = knowledge.forAdapter(adapter);
  const files = Object.keys(templates.render(adapter, { name, displayName: name, description: '' }));
  return {
    prompt, vendorId: adapter.pending ? '__unknown__' : adapter.id, unknown: adapter.pending ? unknown : null,
    vendor: { id: adapter.id, name: adapter.name, family: adapter.family, label: adapter.label, language: adapter.language, runtime: adapter.runtime, manifest: adapter.manifest, packageFormat: adapter.packageFormat, publishTarget: adapter.publishTarget },
    name, displayName: spec.displayName || name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' '),
    summary: spec.summary || prompt.slice(0, 120),
    features: spec.features?.length ? spec.features : (feats.length ? feats : [prompt]),
    acceptance: spec.acceptance?.length ? spec.acceptance : [`构建通过（${adapter.build}）`, `清单 ${adapter.manifest} 必填字段齐全：${(adapter.manifestRequired || []).join(', ')}`, `可打包为 ${adapter.packageFormat}`],
    files: [...new Set([...files, 'README.md', 'SPEC.md'])],
    knowledge: k, maxFix: 3,
  };
}

function specMarkdown(p) {
  return `# ${p.displayName} — 插件规格 (SPEC)\n\n目标宿主：${p.vendor.name}（${p.vendor.label || p.vendor.family}）\n\n## 概述\n${p.summary}\n\n## 功能\n${p.features.map(f => '- ' + f).join('\n')}\n\n## 验收标准\n${p.acceptance.map(f => '- [ ] ' + f).join('\n')}\n\n## 宿主规则\n${(p.knowledge?.rules || []).map(r => '- ' + r).join('\n')}\n\n## 运行 / 调试\n${[...(p.knowledge?.run || []), ...(p.knowledge?.debug || [])].map(r => '- ' + r).join('\n')}\n\n## 参考文档\n${(p.knowledge?.docs || []).map(d => `- [${d.title}](${d.url})`).join('\n')}\n\n> 原始需求：${p.prompt}\n`;
}

// —— 任务（可轮询 / SSE / 取消 / 确认） ——
const JOBS = new Map();
const listeners = new Map(); // jobId -> Set<res>

function emit(j, event, data) {
  const set = listeners.get(j.id);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { try { res.write(payload); } catch {} }
}

function subscribe(jobId, res) {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId).add(res);
  const j = JOBS.get(jobId);
  if (j) {
    res.write(`event: snapshot\ndata: ${JSON.stringify(publicJob(j))}\n\n`);
  }
  return () => { listeners.get(jobId)?.delete(res); };
}

function publicJob(j) {
  return {
    id: j.id, kind: j.kind, status: j.status, steps: j.steps, project: j.project,
    startedAt: j.startedAt, endedAt: j.endedAt, error: j.error, result: j.result,
    pending: j.pending ? { label: j.pending.label, files: (j.pending.files || []).map(f => ({ path: f.path, action: f.action, preview: (f.content || '').slice(0, 1200) })) } : null,
    cancelled: !!j.cancelled,
  };
}

function newJob(kind) {
  const j = {
    id: crypto.randomUUID(), kind, status: 'running', steps: [], project: null,
    startedAt: new Date().toISOString(), cancelled: false, pending: null,
    _confirmResolve: null,
  };
  JOBS.set(j.id, j);
  return j;
}
function step(j, title, icon) {
  throwIfCancelled(j);
  const s = { i: j.steps.length + 1, title, icon, status: 'running', detail: '', at: new Date().toISOString() };
  j.steps.push(s);
  emit(j, 'step', s);
  emit(j, 'job', publicJob(j));
  return s;
}
const done = (s, ok, detail) => { s.status = ok === null ? 'skip' : ok ? 'ok' : 'fail'; if (detail != null) s.detail = detail; };

function throwIfCancelled(j) {
  if (j.cancelled) { const e = new Error('已取消'); e.code = 'CANCELLED'; throw e; }
}

/** Wait for user confirm/reject when autoApply is off. */
function awaitConfirm(j, files, label) {
  return new Promise((resolve, reject) => {
    j.status = 'awaiting_confirm';
    j.pending = { files, label };
    emit(j, 'awaiting_confirm', { label, files: files.map(f => ({ path: f.path, action: f.action, preview: (f.content || '').slice(0, 1200) })) });
    emit(j, 'job', publicJob(j));
    j._confirmResolve = (decision) => {
      j._confirmResolve = null;
      j.pending = null;
      if (j.cancelled || decision === 'cancel') {
        j.status = 'cancelled';
        const e = new Error('已取消'); e.code = 'CANCELLED'; reject(e);
      } else if (decision === 'reject') {
        j.status = 'running';
        resolve(false);
      } else {
        j.status = 'running';
        resolve(true);
      }
      emit(j, 'job', publicJob(j));
    };
  });
}

async function maybeApply(j, name, files, label, settings) {
  throwIfCancelled(j);
  const auto = settings?.autoApplyAi !== false; // default ON
  if (!files?.length) return { applied: false, skipped: true };
  if (auto) {
    L.applyFiles(name, files, label);
    return { applied: true };
  }
  const ok = await awaitConfirm(j, files, label);
  if (ok) {
    L.applyFiles(name, files, label);
    return { applied: true };
  }
  return { applied: false, rejected: true };
}

function debugCtx(name) {
  const m = L.meta(name);
  return [...(m.lastBuild?.log || []), ...L.files(name).filter(f => /\.(js|py|ts)$/.test(f)).map(f => `--- ${f}\n${L.readFile(name, f).slice(0, 4000)}`)].join('\n');
}

async function buildFixLoop(j, name, maxFix, settings) {
  let b = L.build(name), attempt = 0;
  let s = step(j, `构建（第 1 次）`, 'tools'); done(s, b.ok, b.log.slice(-8).join('\n')); emit(j, 'step', s);
  while (!b.ok && attempt < maxFix) {
    throwIfCancelled(j);
    attempt++;
    const f = step(j, `AI 诊断与自动修复（第 ${attempt}/${maxFix} 次）`, 'debug-alt');
    const d = await L.aiDebug(name, debugCtx(name), settings);
    if (!d.fixes?.length) { done(f, false, (d.tips || []).join('\n') || d.reply.slice(0, 400)); emit(j, 'step', f); break; }
    const applied = await maybeApply(j, name, d.fixes, `AI 自动修复 #${attempt}`, settings);
    if (applied.rejected) { done(f, false, '用户拒绝了修复补丁'); emit(j, 'step', f); break; }
    done(f, true, d.fixes.map(x => `✎ ${x.path} — ${x.reason}`).join('\n')); emit(j, 'step', f);
    b = L.build(name);
    s = step(j, `构建（第 ${attempt + 1} 次）`, 'tools'); done(s, b.ok, b.log.slice(-8).join('\n')); emit(j, 'step', s);
  }
  return { ok: b.ok, attempts: attempt };
}

async function finish(j, name, settings, extra = {}) {
  throwIfCancelled(j);
  const v = step(j, '清单校验 + AI 审查', 'beaker');
  const r = await L.validate(name, settings);
  done(v, r.ok, (r.tips || []).join('\n') || r.log.filter(l => /✓|✗|未检测|官方|跳过/.test(l)).slice(0, 10).join('\n'));
  emit(j, 'step', v);
  j.result = { ok: j.buildOk && r.ok, project: name, ...extra, guide: knowledge.forAdapter(registry.resolve(L.meta(name).vendorId)) };
}

function runJob(j, fn) {
  fn().then(() => {
    if (j.cancelled) { j.status = 'cancelled'; }
    else if (j.status !== 'cancelled') j.status = 'done';
  }).catch(e => {
    if (e.code === 'CANCELLED' || j.cancelled) {
      j.status = 'cancelled'; j.error = '已取消';
      const last = j.steps[j.steps.length - 1];
      if (last && last.status === 'running') done(last, null, '已取消');
    } else {
      const last = j.steps[j.steps.length - 1];
      if (last && last.status === 'running') done(last, false, e.message);
      j.status = 'error'; j.error = e.message;
    }
  }).finally(() => {
    j.endedAt = new Date().toISOString();
    j.pending = null;
    emit(j, 'job', publicJob(j));
    emit(j, 'done', publicJob(j));
  });
  return { jobId: j.id };
}

function cancel(id) {
  const j = JOBS.get(id); if (!j) throw new Error('任务不存在');
  if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') return publicJob(j);
  j.cancelled = true;
  for (const f of (j._cleanups || [])) { try { f(); } catch {} }
  if (j._confirmResolve) j._confirmResolve('cancel');
  else if (j.status === 'running' || j.status === 'awaiting_confirm') {
    // mark; loop will throw on next check
    const last = j.steps[j.steps.length - 1];
    if (last && last.status === 'running') { done(last, null, '正在取消…'); }
  }
  emit(j, 'job', publicJob(j));
  return publicJob(j);
}

function confirm(id, decision = 'approve') {
  const j = JOBS.get(id); if (!j) throw new Error('任务不存在');
  if (j.status !== 'awaiting_confirm' || !j._confirmResolve) throw new Error('当前任务不在等待确认状态');
  j._confirmResolve(decision === 'reject' ? 'reject' : 'approve');
  return publicJob(j);
}

function run(p, settings) {
  const j = newJob('create');
  return runJob(j, async () => {
    const maxFix = Math.max(0, Math.min(5, +p.maxFix || 3));
    let vendorId = p.vendorId;
    const s0 = step(j, '准备宿主适配器', 'plug');
    if (vendorId === '__unknown__') {
      const a = registry.addCustom(p.unknown.proposal); vendorId = a.id;
      done(s0, true, `已自动扩展新宿主：${a.name}（家族 ${a.family}，清单 ${a.manifest}）`);
    } else done(s0, true, `${p.vendor?.name || vendorId}（${p.vendor?.family || ''}）`);
    emit(j, 'step', s0);
    const s1 = step(j, '创建项目脚手架', 'new-folder');
    const c = L.create({ vendorId, name: p.name, description: p.summary }); j.project = c.name;
    L.writeFile(c.name, 'SPEC.md', specMarkdown({ ...p, knowledge: knowledge.forAdapter(c.adapter) }));
    const mm = L.meta(c.name); mm.spec = { prompt: p.prompt, summary: p.summary, features: p.features, acceptance: p.acceptance }; mm.origin = 'ai-first'; L.saveMeta(c.name, mm);
    L.snapshot(c.name, '初始脚手架');
    done(s1, true, `${c.name} · ${c.files.length + 1} 个文件`); emit(j, 'step', s1);
    const s2 = step(j, 'AI 按方案生成代码', 'sparkle');
    const ask = `${p.summary}。功能：${p.features.join('；')}`;
    const g = await L.aiDev(c.name, { prompt: ask }, settings);
    throwIfCancelled(j);
    const applied = await maybeApply(j, c.name, g.files, 'AI 生成代码', settings);
    if (applied.rejected) done(s2, false, '用户拒绝了生成结果');
    else done(s2, true, g.files.map(f => `${f.action === 'create' ? '+' : '✎'} ${f.path}`).join('\n'));
    emit(j, 'step', s2);
    if (!applied.rejected) {
      const b = await buildFixLoop(j, c.name, maxFix, settings); j.buildOk = b.ok;
      await finish(j, c.name, settings, { fixAttempts: b.attempts });
    } else {
      j.buildOk = false;
      j.result = { ok: false, project: c.name, fixAttempts: 0, guide: knowledge.forAdapter(c.adapter) };
    }
  });
}

function iterate(name, { prompt, maxFix = 3 }, settings) {
  const j = newJob('iterate'); j.project = name;
  return runJob(j, async () => {
    if (prompt && prompt.trim()) {
      const s = step(j, `AI 迭代：${prompt.trim().slice(0, 40)}`, 'sparkle');
      const g = await L.aiDev(name, { prompt }, settings);
      const applied = await maybeApply(j, name, g.files, 'AI 迭代: ' + prompt.trim().slice(0, 30), settings);
      if (applied.rejected) done(s, false, '用户拒绝了迭代改动');
      else done(s, true, g.files.map(f => `${f.action === 'create' ? '+' : '✎'} ${f.path}`).join('\n') || '无变更');
      emit(j, 'step', s);
      if (applied.rejected) {
        j.buildOk = false;
        j.result = { ok: false, project: name, fixAttempts: 0, guide: knowledge.forAdapter(registry.resolve(L.meta(name).vendorId)) };
        return;
      }
    }
    const b = await buildFixLoop(j, name, Math.max(0, Math.min(5, +maxFix)), settings); j.buildOk = b.ok;
    await finish(j, name, settings, { fixAttempts: b.attempts });
  });
}

/** 通用后台任务（复用 SSE / 取消机制）：fn(ctx) 中用 ctx.step/ctx.done/ctx.check/ctx.onCancel */
function startJob(kind, project, fn) {
  const j = newJob(kind); j.project = project || null; j._cleanups = [];
  const ctx = {
    job: j,
    step: (title, icon) => step(j, title, icon),
    done: (s, ok, detail) => { done(s, ok, detail); emit(j, 'step', s); emit(j, 'job', publicJob(j)); },
    log: (s, line) => { s.detail = (s.detail ? s.detail + '\n' : '') + line; emit(j, 'step', s); },
    check: () => throwIfCancelled(j),
    onCancel: f => j._cleanups.push(f),
  };
  Promise.resolve().then(() => fn(ctx)).then(r => { j.result = r; j.status = j.cancelled ? 'cancelled' : 'done'; }).catch(e => {
    const last = j.steps[j.steps.length - 1];
    if (e.code === 'CANCELLED' || j.cancelled) { j.status = 'cancelled'; j.error = '已取消'; if (last && last.status === 'running') done(last, null, '已取消'); }
    else { if (last && last.status === 'running') done(last, false, e.message); j.status = 'error'; j.error = e.message; }
  }).finally(() => { j.endedAt = new Date().toISOString(); emit(j, 'job', publicJob(j)); emit(j, 'done', publicJob(j)); });
  return { jobId: j.id };
}
const job = id => { const j = JOBS.get(id); if (!j) throw new Error('任务不存在'); return publicJob(j); };

module.exports = {
  intent, plan, run, iterate, job, cancel, startJob, confirm, subscribe, publicJob,
  scoreVendors, proposeAdapter, specMarkdown, JOBS,
};
