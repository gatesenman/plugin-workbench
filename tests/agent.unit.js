// 单元测试：AI-first 意图识别 / 方案 / 智能体循环 / 检查点 / 取消 / 确认模式 / 工具链跳过
process.env.PLUGIN_IDE_NO_TOOLCHAIN = process.env.PLUGIN_IDE_NO_TOOLCHAIN || "1";
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
process.env.PLUGIN_IDE_WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'pide-ag-ws-'));
process.env.PLUGIN_IDE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pide-ag-d-'));
const A = require('../src/core/agent'), L = require('../src/core/lifecycle'), toolchain = require('../src/core/toolchain');
const S = { provider: 'mock' };
const wait = async (id, { allowConfirm = false } = {}) => {
  for (let i = 0; i < 200; i++) {
    const j = A.job(id);
    if (j.status === 'awaiting_confirm' && allowConfirm) return j;
    if (j.status !== 'running' && j.status !== 'awaiting_confirm') return j;
    await new Promise(r => setTimeout(r, 40));
  }
  throw new Error('timeout');
};
(async () => {
  const cases = { '做一个 Chrome 扩展，保存网页为 Markdown': 'chrome', '给 VS Code 写个插件统计代码行数': 'visual-studio-code', '做一个 VS Code 插件，右键把选中代码发给同事钉钉群': 'visual-studio-code', 'Blender 批量重命名物体': 'blender', 'Photoshop 面板批量导出图层': 'photoshop', '写一个 WordPress 插件': 'wordpress' };
  for (const [q, id] of Object.entries(cases)) assert.strictEqual((await A.intent(q, S)).recommended, id, q);
  const u = await A.intent('为「Acme CAD」开发 Python 插件，导出 BOM', S);
  assert.strictEqual(u.recommended, '__unknown__'); assert.strictEqual(u.unknown.name, 'Acme CAD');
  const p = await A.plan({ prompt: u.prompt, vendorId: '__unknown__', unknown: u.unknown }, S);
  assert.ok(p.features.includes('导出 BOM')); assert.ok(p.knowledge.rules.length);
  const j = await wait(A.run(p, S).jobId);
  assert.strictEqual(j.status, 'done'); assert.ok(j.result.ok, JSON.stringify(j.steps));
  L.writeFile(j.project, 'main.py', 'def x(:\n');
  const k = await wait(A.iterate(j.project, { maxFix: 2 }, S).jobId);
  assert.ok(k.result.ok); assert.strictEqual(k.result.fixAttempts, 1);
  const cps = L.checkpoints(j.project); assert.strictEqual(cps[0].label, 'AI 自动修复 #1');
  L.restore(j.project, cps[0].id); assert.ok(L.readFile(j.project, 'main.py').includes('def x(:'));

  // Confirm mode: autoApplyAi=false → awaiting_confirm → approve
  const p2 = await A.plan({ prompt: '做一个 Chrome 扩展保存 Markdown', vendorId: 'chrome' }, S);
  p2.name = 'confirm-demo-' + Date.now().toString(36);
  const { jobId: qid } = A.run(p2, { ...S, autoApplyAi: false });
  const qj = await wait(qid, { allowConfirm: true });
  assert.strictEqual(qj.status, 'awaiting_confirm', JSON.stringify(qj));
  assert.ok(qj.pending?.files?.length >= 1);
  A.confirm(qid, 'approve');
  const qdone = await wait(qid);
  assert.strictEqual(qdone.status, 'done');
  assert.ok(qdone.result?.project);

  // Cancel while awaiting confirm (reliable mid-loop pause)
  const p3 = await A.plan({ prompt: '做一个 Chrome 扩展计数器', vendorId: 'chrome' }, S);
  p3.name = 'cancel-demo-' + Date.now().toString(36);
  const { jobId: cid } = A.run(p3, { ...S, autoApplyAi: false });
  const paused = await wait(cid, { allowConfirm: true });
  assert.strictEqual(paused.status, 'awaiting_confirm');
  const cancelled = A.cancel(cid);
  assert.ok(cancelled.cancelled || cancelled.status === 'cancelled');
  const cj = await wait(cid);
  assert.strictEqual(cj.status, 'cancelled', 'expected cancelled, got ' + cj.status);

  // Toolchain skip path: detect + runOfficial without tools should skip cleanly
  toolchain.resetDetect();
  const det = toolchain.detect();
  assert.ok(typeof det.npx === 'boolean');
  const skipVscode = toolchain.runOfficial('vscode-ext', 'validate', process.env.PLUGIN_IDE_WORKSPACE, { name: 'x' });
  assert.ok(skipVscode.skipped || skipVscode.ok);
  if (skipVscode.skipped) assert.ok(/未检测|跳过/.test(skipVscode.log.join('\n')));
  const skipWeb = toolchain.runOfficial('browser-ext', 'validate', process.env.PLUGIN_IDE_WORKSPACE, { name: 'x' });
  assert.ok(skipWeb.skipped || skipWeb.ok);

  console.log('agent unit tests OK');
})().catch(e => { console.error(e); process.exit(1); });
