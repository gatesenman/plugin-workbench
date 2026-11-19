// 单元测试：AI 多文件 / 调试 / 聊天（不启 Electron）
process.env.PLUGIN_IDE_NO_TOOLCHAIN = process.env.PLUGIN_IDE_NO_TOOLCHAIN || "1";
const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os');
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'pide-ai-ws-'));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pide-ai-data-'));
process.env.PLUGIN_IDE_WORKSPACE = WS;
process.env.PLUGIN_IDE_DATA = DATA;
process.env.PLUGIN_IDE_LLM_PROVIDER = 'mock';

const L = require('../src/core/lifecycle');
const ai = require('../src/core/ai');
const llm = require('../src/core/llm');

async function run() {
  const settings = { provider: 'mock' };

  // 1) VS Code 多文件项目生成
  L.create({ vendorId: 'visual-studio-code', name: 'ai-mf-vscode', description: 'AI multi' });
  const r1 = await L.aiDev('ai-mf-vscode', { prompt: '添加一个命令和 settings 配置，并写测试', apply: false }, settings);
  assert.ok(r1.files.length >= 2, 'should propose multiple files');
  assert.ok(r1.files.some(f => f.path === 'package.json'));
  assert.ok(r1.files.some(f => f.path === 'extension.js'));
  assert.ok(r1.preview === true);
  await L.applyFiles('ai-mf-vscode', r1.files);
  const pkg = JSON.parse(L.readFile('ai-mf-vscode', 'package.json'));
  assert.ok(pkg.contributes?.commands?.length >= 1);
  assert.ok(pkg.contributes?.configuration);
  assert.ok(fs.existsSync(path.join(WS, 'ai-mf-vscode', 'test/extension.test.js')));

  // 2) 迭代 refine（单文件）
  const r2 = await L.aiDev('ai-mf-vscode', { path: 'extension.js', prompt: '添加一个计数功能', apply: true }, settings);
  assert.ok(r2.applied);
  assert.match(L.readFile('ai-mf-vscode', 'extension.js'), /AI: 添加一个计数功能/);

  // 3) Chrome / Blender / Office mock 多文件
  for (const [vid, name, key] of [
    ['chrome', 'ai-mf-chrome', 'manifest.json'],
    ['blender', 'ai-mf-blender', 'blender_manifest.toml'],
    ['excel', 'ai-mf-office', 'manifest.xml']
  ]) {
    L.create({ vendorId: vid, name, description: 'mf' });
    const r = await L.aiDev(name, { prompt: '完整增强：添加命令、设置与 README', apply: true }, settings);
    assert.ok(r.files.length >= 2, name + ' multi');
    assert.ok(L.files(name).includes(key) || fs.existsSync(path.join(WS, name, key)));
  }

  // 4) AI debug + apply fix
  L.create({ vendorId: 'chrome', name: 'ai-dbg', description: 'dbg' });
  L.writeFile('ai-dbg', 'popup.js', 'function (( {');
  const b = L.build('ai-dbg');
  assert.equal(b.ok, false);
  const dbg = await L.aiDebug('ai-dbg', b.log.join('\n') + '\n--- popup.js\nfunction (( {', settings);
  assert.ok(dbg.fixes?.length >= 1, 'expect fix');
  assert.ok(/Mock AI 调试建议/.test(dbg.reply));
  await L.aiApplyFix('ai-dbg', dbg.fixes[0]);
  assert.ok(!/function\s*\(\s*\(/.test(L.readFile('ai-dbg', 'popup.js')));
  const b2 = L.build('ai-dbg');
  assert.equal(b2.ok, true, 'build should pass after fix');

  // 5) AI chat context + actions
  const chat = await L.aiChat({
    messages: [{ role: 'user', content: '请运行构建' }],
    context: { project: 'ai-mf-vscode', selectedFile: 'extension.js' }
  }, settings);
  assert.ok(/Mock AI/.test(chat.reply));
  assert.ok(chat.actions?.some(a => a.type === 'run_build'));

  const chat2 = await L.aiChat({
    messages: [{ role: 'user', content: '创建文件 src/extra.js' }],
    context: { project: 'ai-mf-vscode' }
  }, settings);
  assert.ok(chat2.actions?.some(a => a.type === 'create_file'));



  // 5a) Keyword-aware offline mock (业务语义)
  {
    L.create({ vendorId: 'chrome', name: 'ai-kw-translate', description: 'tr' });
    const r = await L.aiDev('ai-kw-translate', { prompt: '选中网页文字后一键翻译成中文', apply: true }, settings);
    const joined = r.files.map(f => f.content).join('\n');
    assert.ok(/翻译成中文|mockTranslateToZh|translate-selection/.test(joined), 'translate mock');
    assert.ok(!/pageToMarkdown/.test(joined), 'translate should not be markdown saver');
  }
  {
    L.create({ vendorId: 'visual-studio-code', name: 'ai-kw-ding', description: 'ding' });
    const r = await L.aiDev('ai-kw-ding', { prompt: '右键把选中代码发给同事钉钉群', apply: true }, settings);
    const joined = r.files.map(f => f.content).join('\n');
    assert.ok(/dingtalk|webhook|钉钉/.test(joined), 'dingtalk mock');
  }
  {
    L.create({ vendorId: 'excel', name: 'ai-kw-weekly', description: 'w' });
    const r = await L.aiDev('ai-kw-weekly', { prompt: '把当前表格一键生成周报摘要', apply: true }, settings);
    const joined = r.files.map(f => f.content).join('\n');
    assert.ok(/周报摘要|buildWeeklySummary/.test(joined), 'weekly mock');
  }

  // 5b) Richer offline mock — no TODO stubs for main families
  for (const [vid, name, mustInclude] of [
    ['visual-studio-code', 'ai-rich-vscode', ['registerCommand', 'StatusBarItem']],
    ['chrome', 'ai-rich-chrome', ['pageToMarkdown', 'chrome.storage']],
    ['blender', 'ai-rich-blender', ['bpy.types.Panel', 'PropertyGroup']],
    ['excel', 'ai-rich-office', ['Office.onReady', 'taskpane']],
  ]) {
    L.create({ vendorId: vid, name, description: 'rich' });
    const r = await L.aiDev(name, { prompt: '完整实现命令、面板与设置', apply: true }, settings);
    assert.ok(r.files.length >= 3, name + ' files');
    const joined = r.files.map(f => f.content).join('\n');
    assert.ok(!/\/\/ TODO:/.test(joined), name + ' should not be TODO stub');
    for (const needle of mustInclude) {
      assert.ok(joined.includes(needle) || L.files(name).some(f => {
        try { return L.readFile(name, f).includes(needle); } catch { return false; }
      }), name + ' missing ' + needle);
    }
  }

  // 5c) toolchain skip surfaces in validate log
  L.create({ vendorId: 'chrome', name: 'ai-tc-skip', description: 'tc' });
  L.build('ai-tc-skip');
  const v = await L.validate('ai-tc-skip', settings);
  assert.ok(v.log.some(l => /未检测|跳过|官方|web-ext|✓/.test(l)), 'validate should mention toolchain skip or pass');

  // 6) extract helpers
  const parsed = ai.extractFiles('### FILE: a.js\n```js\nfoo\n```\n');
  assert.equal(parsed[0].path, 'a.js');
  assert.ok(parsed[0].content.includes('foo'));

  // 7) settings temperature on provider
  const p = llm.getProvider({ provider: 'openai', baseUrl: 'http://x', apiKey: 'k', model: 'm', temperature: 0.7 });
  assert.equal(p.temperature, 0.7);
  assert.equal(llm.getProvider({ provider: 'mock' }).name, 'mock');

  console.log('AI unit tests OK');
}

run().catch(e => { console.error(e); process.exit(1); });
