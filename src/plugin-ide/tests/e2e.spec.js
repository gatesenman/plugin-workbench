// 端到端测试：针对 Electron 桌面应用 (开发态或打包后的可执行文件)
const { test, expect, _electron } = require('@playwright/test');
const fs = require('fs'), path = require('path'), os = require('os'), { execSync } = require('child_process');
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'pide-ws-')), DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pide-data-'));
let app, page;
const FAKE = require('./fixtures/fakehosts')();
test.beforeAll(async () => {
  const exe = process.env.PLUGIN_IDE_EXE;
  app = await _electron.launch({ ...(exe ? { executablePath: path.resolve(exe), args: ['--no-sandbox'] } : { args: ['--no-sandbox', '.'] }), env: { ...process.env, ...FAKE.env, PLUGIN_IDE_WORKSPACE: WS, PLUGIN_IDE_DATA: DATA, PLUGIN_IDE_LLM_PROVIDER: 'mock' } });
  app.process().stderr.on('data', d => process.stderr.write('[electron] ' + d)); page = await app.firstWindow();
  await expect(page.locator('#log')).toContainText('[ready]', { timeout: 60000 });
});
test.afterAll(async () => { const pid = app?.process().pid; await Promise.race([app?.evaluate(({ app }) => app.quit()).catch(() => {}), new Promise(r => setTimeout(r, 5000))]); await new Promise(r => setTimeout(r, 1500)); try { process.kill(pid, 'SIGKILL'); } catch {} });

const unzipList = f => execSync(`unzip -l "${f}"`).toString();

async function ensureChatOpen() {
  const open = await page.evaluate(() => document.body.dataset.chat === 'open');
  if (!open) await page.click('#btn-chat-toggle');
  await expect(page.locator('#chat-in')).toBeVisible({ timeout: 5000 });
}
async function expectStage(state, name) {
  await expect(page.locator('#sb-stage')).toHaveAttribute('data-state', state, { timeout: 30000 });
  await expect(page.locator('#sb-stage .sb-label')).toHaveText(name);
}
async function lifecycle(vendorQuery, vendorId, name, fileToEdit, edit) {
  await page.click('#nav [data-view=projects]');
  await page.click('#btn-new'); await page.fill('#new-vendor', vendorId); await page.fill('#new-name', name); await page.fill('#new-desc', 'E2E ' + vendorQuery);
  await page.click('#btn-create');
  await expect(page.locator('#log')).toContainText(`[init] 已创建 ${name}`, { timeout: 20000 });
  // 编辑
  await page.click('#tabs [data-tab=files]'); await page.click(`#file-list li[data-f="${fileToEdit}"]`);
  await expect(page.locator('#qe-path')).toHaveText(fileToEdit);
  const cur = await page.inputValue('#quick-editor'); await page.fill('#quick-editor', cur + edit); await page.click('#btn-save');
  await expect(page.locator('#log')).toContainText(`[save] ${fileToEdit}`);
  // AI 开发
  await page.fill('#ai-dev-prompt', '添加一个计数功能'); await page.click('#btn-ai-dev');
  await expect(page.locator('#quick-editor')).toHaveValue(/AI: 添加一个计数功能/); await page.click('#btn-save');
  // 生命周期
  await page.click('#nav [data-view=project]');
  for (const st of ['build', 'validate', 'package', 'publish']) {
    await page.click(`#pipe-buttons [data-stage=${st}]`);
    await expectStage('ok', st);
  }
  await expect(page.locator('#pipeline-bar .stage.ok')).toHaveCount(5);
  const dir = path.join(WS, name), m = JSON.parse(fs.readFileSync(path.join(dir, '.pluginide.json')));
  const art = path.join(dir, m.artifact.file); expect(fs.existsSync(art)).toBeTruthy();
  expect(fs.existsSync(path.join(dir, 'dist', 'publish-0.0.1.json'))).toBeTruthy();
  expect(fs.readFileSync(path.join(dir, 'build', fileToEdit), 'utf8')).toContain('AI: 添加一个计数功能');
  return { dir, art, list: unzipList(art) };
}

test('应用启动：内嵌 IDE + 500+ 厂商目录', async () => {
  const n = +(await page.textContent('#vendor-count')); expect(n).toBeGreaterThanOrEqual(500);
  await page.click('#nav [data-view=vendors]'); await page.fill('#vendor-q', 'Photoshop');
  await expect(page.locator('#vendor-list li').first()).toContainText('Photoshop');
  // 字体图标：活动栏使用 codicon，而非 emoji
  await expect(page.locator('#nav [data-view=vendors] .codicon-library')).toBeVisible();
  await expect(page.locator('#nav [data-view=projects] .codicon-folder-library')).toBeVisible();
  await expect(page.locator('#activity')).toHaveCount(0);
  await expect(page.locator('#statusbar')).toHaveCount(0);
  // 内嵌 IDE 依赖 vendor/openvscode-server 完整包；缺失时状态为「未启用」，不应阻断主流程
  await expect(page.locator('#sb-ide')).toContainText(/已就绪|未启用/);
  // 代码编辑器只是项目内的「代码」子页，默认不作为主界面
  await expect(page.locator('#ide-frame')).toBeHidden();
});
test('VS Code 扩展 → .vsix', async () => {
  const r = await lifecycle('VS Code', 'visual-studio-code', 'e2e-vscode', 'extension.js', '\n// edited by e2e\n');
  expect(r.art).toMatch(/\.vsix$/); expect(r.list).toContain('extension.vsixmanifest'); expect(r.list).toContain('extension/package.json');
});
test('Chrome 扩展 → zip', async () => {
  const r = await lifecycle('Chrome', 'chrome', 'e2e-chrome', 'background.js', '\n// edited\n');
  expect(r.list).toContain('manifest.json'); expect(r.list).toContain('background.js');
});
test('Blender 插件 → addon zip', async () => {
  const r = await lifecycle('Blender', 'blender', 'e2e-blender', '__init__.py', '\n# edited\n');
  expect(r.list).toContain('e2e_blender/__init__.py'); expect(r.list).toContain('e2e_blender/blender_manifest.toml');
});
test('Office (Excel) 加载项 → zip', async () => {
  const r = await lifecycle('Excel', 'excel', 'e2e-office', 'taskpane.js', '\n// edited\n');
  expect(r.list).toContain('manifest.xml'); expect(fs.readFileSync(path.join(r.dir, 'manifest.xml'), 'utf8')).toContain('Workbook');
});
test('AI 扩展新厂商 → 全流程 + 版本/弃用', async () => {
  await page.click('#nav [data-view=vendors]');
  await page.fill('#ai-vendor-desc', '为「Acme Robotics Studio」开发 Python 插件，类别：机器人仿真');
  await page.click('#btn-ai-vendor'); await expect(page.locator('#ai-vendor-out')).toContainText('acme-robotics-studio');
  await page.fill('#vendor-q', 'Acme'); await expect(page.locator('#vendor-list li').first()).toContainText('Acme Robotics Studio');
  const r = await lifecycle('Acme', 'acme-robotics-studio', 'e2e-acme', 'main.py', '\n# edited\n');
  expect(r.list).toContain('plugin.json');
  await page.click('#tabs [data-tab=versions]'); await page.selectOption('#bump-level', 'minor'); await page.click('#tab-versions [data-stage=version]');
  await expectStage('ok', 'version'); await expect(page.locator('#sb-proj')).toContainText('v0.1.0');
  expect(JSON.parse(fs.readFileSync(path.join(r.dir, 'plugin.json'))).version).toBe('0.1.0');
  await page.click('#tab-versions [data-stage=deprecate]'); await expectStage('ok', 'deprecate');
  expect(fs.existsSync(path.join(r.dir, 'DEPRECATED.md'))).toBeTruthy();
});
test('AI 调试：语法错误被构建拦截', async () => {
  await page.click('#nav [data-view=projects]');
  let target = page.locator('#proj-list li[data-n=e2e-chrome]');
  if (await target.count() === 0) {
    await page.click('#btn-new'); await page.fill('#new-vendor', 'chrome'); await page.fill('#new-name', 'e2e-chrome-dbg'); await page.fill('#new-desc', 'dbg'); await page.click('#btn-create');
    await expect(page.locator('#log')).toContainText('[init] 已创建 e2e-chrome-dbg');
    target = page.locator('#proj-list li[data-n=e2e-chrome-dbg]');
  }
  await target.click();
  await page.click('#tabs [data-tab=files]'); await page.click('#file-list li[data-f="popup.js"]'); await page.fill('#quick-editor', 'function (( {'); await page.click('#btn-save');
  await page.click('#nav [data-view=project]'); await page.click('#pipe-buttons [data-stage=build]');
  await expectStage('fail', 'build'); await expect(page.locator('#log')).toContainText('✗ popup.js');
  await page.click('#pipe-buttons [data-stage=validate]'); await expect(page.locator('#log')).toContainText('Mock AI 调试建议');
});
test('AI 助手聊天', async () => {
  await ensureChatOpen();
  await page.fill('#chat-in', '如何为 Photoshop 写 UXP 面板？'); await page.click('#btn-chat');
  await expect(page.locator('#chat .msg.bot').last()).toContainText('Mock AI');
});

test('AI 多文件开发：预览并应用到磁盘', async () => {
  await page.click('#nav [data-view=projects]');
  await page.click('#btn-new');
  await page.fill('#new-vendor', 'visual-studio-code');
  await page.fill('#new-name', 'e2e-ai-multi');
  await page.fill('#new-desc', 'multi file AI');
  await page.click('#btn-create');
  await expect(page.locator('#log')).toContainText('[init] 已创建 e2e-ai-multi');
  await page.click('#tabs [data-tab=aidev]');
  await page.fill('#ai-proj-prompt', '添加一个命令和 settings 配置，并写测试');
  await page.click('#btn-ai-proj');
  await expect(page.locator('#ai-diff-view')).toContainText('package.json', { timeout: 15000 });
  await expect(page.locator('#btn-ai-proj-apply')).toBeEnabled();
  await page.click('#btn-ai-proj-apply');
  await expect(page.locator('#log')).toContainText('[AI apply]');
  const dir = path.join(WS, 'e2e-ai-multi');
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  expect(pkg.contributes?.configuration || pkg.contributes?.commands).toBeTruthy();
  expect(fs.existsSync(path.join(dir, 'test/extension.test.js'))).toBeTruthy();
});

test('AI 调试一键修复', async () => {
  await page.click('#nav [data-view=projects]');
  await page.click('#btn-new');
  await page.fill('#new-vendor', 'chrome');
  await page.fill('#new-name', 'e2e-ai-fix');
  await page.fill('#new-desc', 'fix test');
  await page.click('#btn-create');
  await expect(page.locator('#log')).toContainText('[init] 已创建 e2e-ai-fix');
  await page.click('#tabs [data-tab=files]'); await page.click('#file-list li[data-f="popup.js"]');
  await page.fill('#quick-editor', 'function (( {');
  await page.click('#btn-save');
  await page.click('#nav [data-view=project]');
  await page.click('#pipe-buttons [data-stage=build]');
  await expectStage('fail', 'build');
  await expect(page.locator('#debug-fixes .btn-apply-fix').first()).toBeVisible({ timeout: 15000 });
  await page.click('#debug-fixes .btn-apply-fix');
  await expect(page.locator('#log')).toContainText('[AI fix]');
  await page.click('#pipe-buttons [data-stage=build]');
  await expectStage('ok', 'build');
});

test('AI 聊天上下文与动作', async () => {
  await page.click('#nav [data-view=projects]');
  // 使用已有项目或新建
  const has = await page.locator('#proj-list li[data-n=e2e-ai-multi]').count();
  if (has) await page.click('#proj-list li[data-n=e2e-ai-multi]');
  else if (await page.locator('#proj-list li').count()) await page.click('#proj-list li').first();
  await ensureChatOpen();
  await page.fill('#chat-in', '请运行构建');
  await page.click('#btn-chat');
  await expect(page.locator('#chat .msg.bot').last()).toContainText('Mock AI');
  await expect(page.locator('#chat-actions button').first()).toContainText('run_build');
});

// —— AI-first 主流程 ——
test('首页：AI-first 入口、示例与上手指南', async () => {
  await page.click('#act-home');
  await expect(page.locator('#page-home')).toBeVisible();
  await expect(page.locator('#home-prompt')).toBeVisible();
  await expect(page.locator('#home-examples .chip')).toHaveCount(6);
  await expect(page.locator('#onboarding')).toBeVisible();
  // 最近项目：无项目时展示空状态文案；有项目时列表可见
  const recentCount = await page.locator('#recent-list li').count();
  if (recentCount === 0) await expect(page.locator('#recent-empty')).toBeVisible();
  else await expect(page.locator('#recent-list li').first()).toBeVisible();
});

test('AI-first：描述 → 识别 Chrome → 编辑方案 → 生成/构建/校验 → 迭代 → 打包', async () => {
  await page.click('#act-home');
  await page.fill('#home-prompt', '做一个 Chrome 扩展，一键把当前网页保存为 Markdown，并支持快捷键');
  await page.click('#btn-home-go');
  await expect(page.locator('#intent-cands .cand.sel')).toContainText('Chrome');
  await page.click('#btn-plan');
  await expect(page.locator('#plan-knowledge')).toContainText('manifest_version');
  await expect(page.locator('#plan-knowledge a').first()).toHaveAttribute('href', /^https:/);
  await page.fill('#plan-name', 'ai-first-md');
  await page.fill('#plan-features', '一键保存网页为 Markdown\n支持快捷键 Ctrl+Shift+M\n添加 settings 配置');
  await page.click('#btn-run');
  await expect(page.locator('#run-status')).toHaveText(/完成/, { timeout: 30000 });
  await expect(page.locator('#agent-steps li.st-ok')).toHaveCount(5);
  await expect(page.locator('#run-guide')).toContainText('加载已解压的扩展程序');
  const dir = path.join(WS, 'ai-first-md');
  expect(fs.readFileSync(path.join(dir, 'SPEC.md'), 'utf8')).toContain('支持快捷键 Ctrl+Shift+M');
  expect(JSON.parse(fs.readFileSync(path.join(dir, '.pluginide.json'))).stages.validate.ok).toBeTruthy();
  // 迭代
  await page.fill('#iter-prompt', '增加一个导出历史记录功能');
  await page.click('#btn-iterate');
  await expect(page.locator('#agent-steps li').first()).toContainText('AI 迭代', { timeout: 30000 });
  await expect(page.locator('#run-status')).toHaveText(/完成/, { timeout: 30000 });
  // 打包发布
  await page.click('#btn-ship');
  await expect(page.locator('#flow-steps li[data-k=ship]')).toHaveClass(/done/, { timeout: 30000 });
  expect(fs.existsSync(path.join(dir, 'dist', 'publish-0.0.1.json'))).toBeTruthy();
});

test('AI-first：未知宿主自动扩展适配器 + 构建失败自动修复循环', async () => {
  await page.click('#act-home');
  await page.fill('#home-prompt', '为我们公司内部的「Zeta MES」开发 Python 插件，导出工单报表');
  await page.click('#btn-home-go');
  await expect(page.locator('#intent-cands .cand.sel')).toContainText('Zeta MES（新宿主）');
  await page.click('#btn-plan');
  await page.fill('#plan-name', 'zeta-report');
  await page.click('#btn-run');
  await expect(page.locator('#run-status')).toHaveText(/完成/, { timeout: 30000 });
  await expect(page.locator('#agent-steps li').first()).toContainText('准备宿主适配器');
  await expect(page.locator('#agent-steps li').first()).toContainText('已自动扩展新宿主');
  // 人为破坏代码，验证 构建失败 → AI 诊断修复 → 重建通过
  fs.writeFileSync(path.join(WS, 'zeta-report', 'main.py'), 'def broken(:\n');
  await page.fill('#iter-prompt', '');
  await page.click('#btn-iterate');
  await expect(page.locator('#run-status')).toHaveText(/完成 · 通过/, { timeout: 30000 });
  await expect(page.locator('#agent-steps li.st-fail')).toHaveCount(1);
  await expect(page.locator('#agent-steps')).toContainText('AI 诊断与自动修复（第 1/3 次）');
  await expect(page.locator('#agent-steps')).toContainText('构建（第 2 次）');
});

test('检查点：撤销上一次 AI 改动', async () => {
  const f = path.join(WS, 'zeta-report', 'main.py');
  const fixed = fs.readFileSync(f, 'utf8');
  expect(fixed).not.toContain('def broken(:');
  await page.click('#btn-undo');
  await expect(page.locator('#dlg-confirm')).toBeVisible();
  await page.click('#dlg-confirm-ok');
  await expect(page.locator('#log')).toContainText('[undo] 已恢复');
  expect(fs.readFileSync(f, 'utf8')).toContain('def broken(:');
  await page.click('#nav [data-view=project]'); await page.click('#tabs [data-tab=versions]');
  await expect(page.locator('#cp-list li').first()).toContainText('撤销前自动保存');
});

test('聊天触发 AI 迭代动作', async () => {
  await page.fill('#chat-in', '添加一个批量导出功能');
  await page.click('#btn-chat');
  await expect(page.locator('#chat-actions button').first()).toContainText('AI 迭代并构建');
  await page.click('#chat-actions button');
  await expect(page.locator('#run-status')).toHaveText(/完成/, { timeout: 30000 });
});

test('软件化外壳：主题切换、发布中心、活动记录抽屉', async () => {
  await page.click('#btn-theme');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#btn-theme');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.click('#nav [data-view=publish]');
  await expect(page.locator('#publish-table tbody tr[data-n=ai-first-md]')).toContainText('可发布');
  await page.click('#btn-log');
  await expect(page.locator('#panel')).toHaveClass(/open/);
  await expect(page.locator('#log')).toBeVisible();
  await page.click('#btn-log-close');
  await page.click('#nav [data-view=settings]');
  await expect(page.locator('#s-provider')).toBeVisible();
});

test('代码子页：按需加载内嵌编辑器（带加载占位）', async () => {
  await page.click('#nav [data-view=projects]');
  let target = page.locator('#proj-list li[data-n=ai-first-md]');
  if (await target.count() === 0) {
    await page.click('#btn-new');
    await page.fill('#new-vendor', 'chrome');
    await page.fill('#new-name', 'e2e-ide-frame');
    await page.fill('#new-desc', 'ide');
    await page.click('#btn-create');
    await expect(page.locator('#log')).toContainText('[init] 已创建 e2e-ide-frame');
    target = page.locator('#proj-list li[data-n=e2e-ide-frame]');
  } else {
    await target.click();
  }
  await page.click('#tabs [data-tab=code]');
  const ideOn = /已就绪/.test(await page.locator('#sb-ide').textContent());
  if (ideOn) {
    await expect(page.locator('#ide-frame')).toHaveAttribute('src', /folder=/);
    await expect(page.locator('#btn-ide-retry')).toBeVisible();
    try {
      await expect(page.frameLocator('#ide-frame').locator('.monaco-workbench')).toBeVisible({ timeout: 30000 });
    } catch {
      await page.click('#btn-ide-retry');
    }
    await expect(page.locator('#ide-frame')).toHaveAttribute('src', /folder=/);
  } else {
    // vendor 不完整时：展示中文空状态，不挂坏 URL
    await expect(page.locator('#ide-off')).toBeVisible();
    await expect(page.locator('#ide-off')).toContainText(/代码编辑器|文件/);
    await expect(page.locator('#ide-frame')).toBeHidden();
  }
});

test('设置：自动应用 AI 改动开关可见并可保存', async () => {
  await page.click('#nav [data-view=settings]');
  await expect(page.locator('#s-auto-apply')).toBeVisible();
  await expect(page.locator('#s-auto-apply')).toBeChecked();
  await page.uncheck('#s-auto-apply');
  await page.click('#btn-save-settings');
  await expect(page.locator('#settings-msg')).toContainText('等待你确认', { timeout: 5000 });
  await page.check('#s-auto-apply');
  await page.click('#btn-save-settings');
  await expect(page.locator('#settings-msg')).toContainText('自动应用', { timeout: 5000 });
});

test('首页 AI-first：Chrome 扩展生成更完整示例（非 TODO 骨架）', async () => {
  await page.click('#nav [data-view=home]');
  await page.fill('#home-prompt', '做一个 Chrome 扩展，保存网页为 Markdown 并支持快捷键（富示例）');
  await page.click('#btn-home-go');
  await expect(page.locator('#card-intent')).toBeVisible({ timeout: 15000 });
  await page.click('#btn-plan');
  await expect(page.locator('#card-plan')).toBeVisible({ timeout: 15000 });
  await page.fill('#plan-name', 'e2e-rich-chrome');
  await page.click('#btn-run');
  await expect(page.locator('#run-status')).toHaveText(/完成/, { timeout: 90000 });
  const popup = fs.readFileSync(path.join(WS, 'e2e-rich-chrome', 'popup.js'), 'utf8');
  expect(popup).toMatch(/pageToMarkdown|chrome\.storage/);
  expect(popup).not.toMatch(/\/\/ TODO:/);
});

test('执行过程提供取消按钮', async () => {
  await page.click('#nav [data-view=home]');
  // cancel button exists in DOM (hidden until running)
  await expect(page.locator('#btn-job-cancel')).toHaveCount(1);
});

// —— v1.2.0 业务向 ——
test('v1.2：离线演示横幅 + 连接 AI 向导 + 测试连接中文结果', async () => {
  await page.click('#act-home');
  await expect(page.locator('#page-home [data-demo-banner]').first()).toContainText('离线演示模式');
  await page.locator('#page-home [data-demo-banner] .db-go').first().click();
  await expect(page.locator('#wz-presets .wz-preset')).toHaveCount(7);
  await expect(page.locator('#wz-presets')).toContainText('通义千问');
  await page.click('#wz-presets [data-p=ollama]');
  await expect(page.locator('#s-base')).toHaveValue('http://127.0.0.1:11434/v1');
  await page.fill('#s-base', 'http://127.0.0.1:9/v1');
  await page.click('#btn-test-llm');
  await expect(page.locator('#wz-result')).toHaveClass(/bad/, { timeout: 25000 });
  await expect(page.locator('#wz-result')).toContainText('无法连接');
  await page.click('#wz-presets [data-p=mock]');
  await expect(page.locator('#s-provider')).toHaveValue('mock');
});

test('v1.2：意图候选无英文家族标识；方案技术细节默认折叠', async () => {
  await page.click('#act-home');
  await page.fill('#home-prompt', '给 VS Code 写个插件，统计当前文件的代码行数并显示在状态栏');
  await page.click('#btn-home-go');
  await expect(page.locator('#intent-cands .cand.sel')).toBeVisible();
  const subs = await page.locator('#intent-cands .cand-sub').allTextContents();
  for (const s of subs) expect(s).not.toMatch(/vscode-ext|browser-ext|python-dcc|saas-app|generic/);
  await page.click('#btn-plan');
  await expect(page.locator('#plan-knowledge .tech-details')).not.toHaveAttribute('open', '');
  await expect(page.locator('#plan-knowledge .plain-lead')).toBeVisible();
});

test('v1.2：打包后显示安装向导 + 发布说明；快照文件级对比与单文件恢复；项目资料', async () => {
  await page.evaluate(() => PluginIDE.openProject('ai-first-md'));
  await page.click('#tabs [data-tab=overview]');
  await expect(page.locator('#pd-install')).toContainText('如何安装到', { timeout: 15000 });
  await expect(page.locator('#pd-install')).toContainText('加载已解压的扩展程序');
  await expect(page.locator('#pd-install [data-act=reveal]')).toBeVisible();
  await expect(page.locator('#pd-install .publish-explain')).toContainText('开发者账号');
  // 项目资料
  await page.fill('#doc-title', '业务规则'); await page.fill('#doc-text', '导出的 Markdown 文件名必须带日期');
  await page.click('#btn-doc-add');
  await expect(page.locator('#doc-list')).toContainText('业务规则');
  // 快照对比
  const f = path.join(WS, 'ai-first-md', 'README.md'); const orig = fs.readFileSync(f, 'utf8');
  await page.click('#tabs [data-tab=versions]');
  await expect(page.locator('#cp-list .btn-cpdiff').first()).toBeVisible({ timeout: 10000 });
  fs.writeFileSync(f, orig + '\nE2E 临时改动\n');
  await page.locator('#cp-list .btn-cpdiff').first().click();
  await expect(page.locator('#dlg-cp')).toBeVisible();
  await page.locator('#cp-files .cf-file', { hasText: 'README.md' }).click();
  await expect(page.locator('#cp-diff')).toContainText('E2E 临时改动');
  await page.click('#btn-cp-file');
  await expect.poll(() => fs.readFileSync(f, 'utf8')).not.toContain('E2E 临时改动');
});

test('v1.3：环境检测页列出本机软件（假安装 VS Code / Blender）+ 厂商库标记已安装', async () => {
  await page.click('#nav [data-view=env]');
  await expect(page.locator('#page-title')).toHaveText('环境检测');
  const vs = page.locator('#env-table tr[data-key=vscode]');
  await expect(vs).toContainText('已安装', { timeout: 15000 }); await expect(vs).toContainText('1.105.1'); await expect(vs).toContainText(FAKE.bin);
  await expect(page.locator('#env-table tr[data-key=blender]')).toContainText('4.5.3');
  await page.check('#env-only'); await expect(page.locator('#env-table tr[data-key=figma]')).toHaveCount(0); await page.uncheck('#env-only');
  await page.click('#btn-env-scan'); await expect(page.locator('#btn-env-scan')).toBeEnabled({ timeout: 20000 });
  expect(+(await page.textContent('#env-count'))).toBeGreaterThanOrEqual(4);
  await page.click('#nav [data-view=vendors]'); await page.fill('#vendor-q', 'Blender');
  await expect(page.locator('#vendor-list li[data-id=blender] .inst-pill')).toBeVisible();
  await page.click('#vendor-list li[data-id=blender]'); await expect(page.locator('#vendor-detail .vd-host')).toContainText('本机已安装');
});

test('v1.3：一键安装并打开测试（VS Code，SSE 步骤）+ 卸载清理', async () => {
  await page.evaluate(() => PluginIDE.openProject('e2e-vscode')); await page.click('#tabs [data-tab=overview]');
  const box = page.locator('#pd-hostinstall');
  await expect(box).toContainText('本机已安装', { timeout: 15000 }); await expect(box).toContainText('Visual Studio Code');
  await box.locator('.hi-go').click();
  await expect(box.locator('.hi-result')).toContainText('已安装到 Visual Studio Code', { timeout: 30000 });
  await expect(box.locator('.hi-steps li.st-ok')).toHaveCount(3);
  await expect.poll(() => FAKE.calls()).toMatch(/code --install-extension .*e2e-vscode-0\.0\.1\.vsix/);
  await expect.poll(() => FAKE.calls()).toMatch(/code --new-window/);
  await box.locator('.hi-un[data-k=vscode]').click();
  await expect(box.locator('.hi-result')).toContainText('已卸载', { timeout: 15000 });
  await expect.poll(() => FAKE.calls()).toMatch(/--uninstall-extension .*e2e-vscode/);
});

test('v1.3：未安装的宿主给出通俗手动步骤（Excel 在 Linux 上不存在）', async () => {
  await page.evaluate(() => PluginIDE.openProject('e2e-office')); await page.click('#tabs [data-tab=overview]');
  const box = page.locator('#pd-hostinstall');
  await expect(box).toContainText('没有检测到', { timeout: 15000 });
  await expect(box.locator('.hi-go')).toBeDisabled();
  await expect(box.locator('.hi-manual')).toContainText('上传我的加载项');
});

test('v1.3：真实 Chrome —— 独立配置 + DevTools 协议加载扩展', async () => {
  test.skip(!['/usr/bin/google-chrome', '/usr/bin/chromium'].some(f => fs.existsSync(f)), '本机无 Chrome');
  await page.evaluate(() => PluginIDE.openProject('e2e-chrome')); await page.click('#tabs [data-tab=overview]');
  const box = page.locator('#pd-hostinstall');
  await expect(box).toContainText('Chrome', { timeout: 15000 });
  await box.locator('.hi-go').click();
  await expect(box.locator('.hi-result')).toContainText('已安装到', { timeout: 45000 });
  await expect(box.locator('.hi-steps')).toContainText('扩展已加载，ID：');
  const prof = fs.readdirSync(path.join(DATA, 'host-profiles')).find(d => d.startsWith('e2e-chrome'));
  await expect.poll(() => { try { return fs.readFileSync(path.join(DATA, 'host-profiles', prof, 'Default', 'Preferences'), 'utf8').includes(path.join(WS, 'e2e-chrome', 'build')); } catch { return false; } }, { timeout: 20000 }).toBeTruthy();
  await box.locator('.hi-un').first().click();
  await expect(box.locator('.hi-result')).toContainText('已卸载', { timeout: 15000 });
});
