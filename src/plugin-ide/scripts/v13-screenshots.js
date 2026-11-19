// v1.3 截图：环境检测页、厂商库已安装标记、一键安装并打开测试（假安装 VS Code + 真实 Chrome）、手动步骤回退
const { _electron } = require('@playwright/test'); const path = require('path'), fs = require('fs'), os = require('os');
(async () => {
  const WS = fs.mkdtempSync(path.join(os.tmpdir(), 's-')), D = fs.mkdtempSync(path.join(os.tmpdir(), 'd-')), FAKE = require('../tests/fixtures/fakehosts')();
  const app = await _electron.launch({ args: ['--no-sandbox', '.'], env: { ...process.env, ...FAKE.env, PLUGIN_IDE_WORKSPACE: WS, PLUGIN_IDE_DATA: D, PLUGIN_IDE_LLM_PROVIDER: 'mock' } });
  const p = await app.firstWindow(); await p.setViewportSize({ width: 1440, height: 900 }); await p.locator('#log').filter({ hasText: '[ready]' }).waitFor({ state: 'attached', timeout: 60000 });
  const O = 'screenshots/v1.3/'; const s = n => p.screenshot({ path: O + n });
  await p.click('#nav [data-view=env]'); await p.locator('#env-table tr[data-key=vscode] .tag-ok').waitFor({ timeout: 20000 }); await s('01-env-detect.png');
  await p.check('#env-only'); await s('02-env-installed-only.png');
  await p.click('#nav [data-view=vendors]'); await p.fill('#vendor-q', 'Blender'); await p.click('#vendor-list li[data-id=blender]'); await p.locator('#vendor-detail .vd-host').waitFor(); await s('03-vendor-installed-badge.png');
  const mk = async (v, n) => { await p.evaluate(async ([v, n]) => { const f = (u, b) => fetch('/api' + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json()); await f('/projects', { vendorId: v, name: n }); await f(`/projects/${n}/build`); await f(`/projects/${n}/package`); }, [v, n]); };
  await mk('visual-studio-code', 'line-counter'); await p.evaluate(() => PluginIDE.openProject('line-counter')); await p.click('#tabs [data-tab=overview]');
  const box = p.locator('#pd-hostinstall'); await box.locator('.hi-go').waitFor(); await box.scrollIntoViewIfNeeded(); await s('04-hostinstall-ready.png');
  await box.locator('.hi-go').click(); await box.locator('.hi-result .wz-result').waitFor({ timeout: 30000 }); await box.scrollIntoViewIfNeeded(); await s('05-hostinstall-vscode-done.png');
  await mk('chrome', 'page-notes'); await p.evaluate(() => PluginIDE.openProject('page-notes')); await p.click('#tabs [data-tab=overview]');
  const b2 = p.locator('#pd-hostinstall'); await b2.locator('.hi-go').waitFor(); await b2.locator('.hi-go').click(); await b2.locator('.hi-result .wz-result').waitFor({ timeout: 45000 }); await b2.scrollIntoViewIfNeeded(); await s('06-hostinstall-chrome-real.png');
  await b2.locator('.hi-un').first().click(); await b2.locator('.hi-result').filter({ hasText: '已卸载' }).waitFor(); await s('07-uninstall-cleanup.png');
  await mk('excel', 'sales-helper'); await p.evaluate(() => PluginIDE.openProject('sales-helper')); await p.click('#tabs [data-tab=overview]');
  const b3 = p.locator('#pd-hostinstall'); await b3.locator('.hi-manual').waitFor(); await b3.scrollIntoViewIfNeeded(); await s('08-manual-fallback.png');
  await app.evaluate(({ app }) => app.quit()).catch(() => {}); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
