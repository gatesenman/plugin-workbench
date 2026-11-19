// 用 Playwright 驱动 Electron 桌面应用截图（1280x800，覆盖主要页面 + 深色模式）
// 运行：xvfb-run -a -s "-screen 0 1440x900x24" node scripts/screenshots.js
const { _electron } = require('@playwright/test'), fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-ws-')), DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-d-'));
  const out = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out).filter(x => x.endsWith('.png'))) fs.unlinkSync(path.join(out, f));
  const exe = process.env.PLUGIN_IDE_EXE;
  const app = await _electron.launch({
    ...(exe ? { executablePath: path.resolve(exe), args: ['--no-sandbox'] } : { args: ['--no-sandbox', '.'] }),
    env: { ...process.env, PLUGIN_IDE_WORKSPACE: WS, PLUGIN_IDE_DATA: DATA, PLUGIN_IDE_LLM_PROVIDER: 'mock' },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('#log')?.textContent?.includes('[ready]'), { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(800, 600); w.setSize(1280, 800); w.center(); });
  await page.waitForTimeout(500);
  const vp = await page.evaluate(() => [innerWidth, innerHeight]); console.log('viewport', vp);
  const shot = async n => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(out, `${n}.png`) }); console.log(n); };
  const done = () => page.waitForFunction(() => /完成/.test(document.querySelector('#run-status')?.textContent || ''), { timeout: 30000 });
  const scrollTo = sel => page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'start' }), sel);

  await shot('01-home');
  await page.fill('#home-prompt', '做一个 Chrome 扩展，一键把当前网页保存为 Markdown，并支持快捷键');
  await page.click('#btn-home-go'); await page.waitForSelector('#intent-cands .cand.sel');
  await scrollTo('#flow-steps'); await shot('02-ai-intent');
  await page.click('#btn-plan'); await page.waitForSelector('#card-plan:not(.hidden)');
  await page.fill('#plan-name', 'web-to-markdown'); await scrollTo('#card-plan'); await shot('03-ai-plan');
  await page.click('#btn-run'); await done(); await scrollTo('#card-run'); await shot('04-ai-agent-steps');

  // 第二个项目：未知宿主 + 自动修复
  await page.click('#act-home');
  await page.fill('#home-prompt', '为我们公司内部的「Acme CAD」开发 Python 插件，导出 BOM 清单');
  await page.click('#btn-home-go'); await page.waitForSelector('#intent-cands .cand.sel');
  await page.click('#btn-plan'); await page.waitForSelector('#card-plan:not(.hidden)');
  await page.click('#btn-run'); await done();
  fs.writeFileSync(path.join(WS, await page.inputValue('#plan-name'), 'main.py'), 'def broken(:\n');
  await page.click('#btn-iterate');
  await page.waitForFunction(() => /完成/.test(document.querySelector('#run-status')?.textContent || '') && document.querySelectorAll('#agent-steps li').length > 2, { timeout: 30000 });
  await scrollTo('#card-run'); await shot('05-unknown-host-autofix');

  await page.click('#nav [data-view=projects]'); await shot('06-projects');
  await page.click('#proj-list li[data-n=web-to-markdown]');
  await page.fill('#chat-in', '添加一个批量导出功能'); await page.click('#btn-chat');
  await page.waitForSelector('#chat-actions button');
  await shot('07-project-detail-chat');
  await page.click('#tabs [data-tab=files]'); await page.click('#file-list li[data-f="popup.js"]'); await shot('08-project-files');
  await page.click('#tabs [data-tab=code]');
  try { await page.frameLocator('#ide-frame').locator('.monaco-workbench').waitFor({ timeout: 60000 }); await page.waitForTimeout(2500); } catch (e) { console.warn('code editor not ready:', e.message); }
  await shot('09-project-code-editor');
  await page.click('#nav [data-view=publish]'); await page.click('#publish-table tr[data-n=web-to-markdown] .pub-ship');
  await page.waitForFunction(() => document.querySelector('#publish-table tr[data-n=web-to-markdown]')?.textContent.includes('可发布'), { timeout: 30000 });
  await page.waitForTimeout(800);
  await shot('10-publish-center');
  await page.click('#nav [data-view=project]'); await page.click('#tabs [data-tab=versions]'); await shot('11-project-versions-snapshots');
  await page.click('#nav [data-view=vendors]'); await page.fill('#vendor-q', 'Adobe'); await page.waitForTimeout(200);
  await page.click('#vendor-list li >> nth=0'); await page.waitForSelector('#vendor-detail:not(.hidden)'); await shot('12-vendor-library');
  await page.click('#nav [data-view=settings]'); await shot('13-settings');
  await page.click('#btn-log'); await shot('14-activity-drawer'); await page.click('#btn-log-close');
  await page.click('#btn-theme');
  await page.click('#act-home'); await shot('15-dark-home');
  await page.click('#nav [data-view=project]'); await page.click('#tabs [data-tab=overview]'); await shot('16-dark-project-detail');
  await page.click('#nav [data-view=vendors]'); await shot('17-dark-vendor-library');
  await page.click('#btn-theme');

  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  setTimeout(() => process.exit(0), 3000);
})().catch(e => { console.error(e); process.exit(1); });
