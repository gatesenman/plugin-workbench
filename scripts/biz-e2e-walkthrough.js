/**
 * 业务人员（产品经理）人格端到端走查
 * 路径：首页自然语言 → 意图 → 轻改方案 → Agent → 迭代 → 打包/dry-run 发布
 * 运行：cd /workspace/plugin-ide && xvfb-run -a -s "-screen 0 1440x900x24" node scripts/biz-e2e-walkthrough.js
 */
const { _electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots', 'biz-e2e');
const ART_DIR = path.join(OUT, 'artifacts');
const REPORT_JSON = path.join(OUT, 'results.json');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ART_DIR, { recursive: true });

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-ws-'));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-data-'));

const friction = [];
const scenarios = [];
let shotIdx = 0;

function note(sev, area, msg, scenario) {
  friction.push({ severity: sev, area, msg, scenario: scenario || null, at: new Date().toISOString() });
  console.log(`[${sev}] ${area}: ${msg}`);
}

(async () => {
  const exe = process.env.PLUGIN_IDE_EXE;
  const app = await _electron.launch({
    ...(exe
      ? { executablePath: path.resolve(exe), args: ['--no-sandbox'] }
      : { args: ['--no-sandbox', '.'] }),
    env: {
      ...process.env,
      PLUGIN_IDE_WORKSPACE: WS,
      PLUGIN_IDE_DATA: DATA,
      PLUGIN_IDE_LLM_PROVIDER: 'mock',
    },
  });
  app.process().stderr.on('data', (d) => process.stderr.write('[electron] ' + d));
  const page = await app.firstWindow();
  await page.waitForFunction(
    () => document.querySelector('#log')?.textContent?.includes('[ready]'),
    undefined,
    { timeout: 120000 }
  );
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(800, 600);
    w.setSize(1280, 800);
    w.center();
  });
  await page.waitForTimeout(400);

  const shot = async (name) => {
    shotIdx++;
    const file = `${String(shotIdx).padStart(2, '0')}-${name}.png`;
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
    console.log('shot', file);
    return file;
  };
  const scrollTo = (sel) =>
    page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), sel);
  const waitDone = (ms = 120000) =>
    page.waitForFunction(
      () => /完成/.test(document.querySelector('#run-status')?.textContent || ''),
      undefined,
      { timeout: ms }
    );
  const text = async (sel) => (await page.locator(sel).textContent().catch(() => '')) || '';
  const val = async (sel) => page.inputValue(sel).catch(() => '');
  const visible = async (sel) => page.locator(sel).isVisible().catch(() => false);

  // —— 冷启动检查 ——
  await page.click('#act-home');
  const homeShot = await shot('00-home-cold');
  if (!(await visible('#home-prompt'))) note('P0', '首页', '首页输入框不可见', 'boot');
  if (!(await visible('#btn-home-go'))) note('P0', '首页', '开始按钮不可见', 'boot');
  const goLabel = await text('#btn-home-go');
  if (!/开始/.test(goLabel)) note('P1', '文案', `开始按钮文案非中文: ${goLabel}`, 'boot');

  const SCENARIOS = [
    {
      id: 'chrome-translate',
      title: 'Chrome 扩展 · 选中文字一键翻译',
      prompt: '做一个浏览器扩展，选中网页文字后一键翻译成中文',
      expectVendor: /Chrome|浏览器/i,
      expectUnknown: false,
      planEdit: {
        name: 'biz-translate-zh',
        summary: '选中网页文字后一键翻译成中文',
        features:
          '选中网页文字后右键或悬浮按钮翻译\n一键翻译成中文\n可选目标语言设置\n保留原文对照显示',
        accept:
          '选中任意网页文字后可触发翻译\n翻译结果以中文展示\n扩展可在 Chrome 加载已解压目录安装',
      },
      iterate: '增加一个「复制译文」按钮，并支持快捷键 Ctrl+Shift+T',
      expectArtExt: /\.zip$/,
      inspectHints: ['manifest.json', 'popup'],
      mockExpectKeywords: [/翻译|translate|zh/i],
      mockFailIf: [/保存为 Markdown|pageToMarkdown/],
    },
    {
      id: 'vscode-dingtalk',
      title: 'VS Code 扩展 · 选中代码发钉钉群',
      prompt: '做一个 VS Code 插件，右键把选中代码发给同事钉钉群',
      expectVendor: /Visual Studio Code|VS Code|Code/i,
      expectUnknown: false,
      planEdit: {
        name: 'biz-code-to-dingtalk',
        summary: '右键把选中代码发给同事钉钉群',
        features:
          '编辑器右键菜单：发送选中代码到钉钉\n可配置 Webhook / 群机器人地址\n发送前可预览消息\n支持代码块 Markdown 格式',
        accept:
          '右键菜单可见发送命令\n未配置 webhook 时有明确中文提示\n构建通过并可打包为 .vsix',
      },
      iterate: '加上设置项 dingtalk.webhook，未配置时弹窗提示去设置',
      expectArtExt: /\.vsix$/,
      inspectHints: ['extension.vsixmanifest', 'extension/package.json'],
      mockExpectKeywords: [/dingtalk|钉钉|webhook|选中/i],
      mockFailIf: [],
    },
    {
      id: 'excel-weekly',
      title: 'Office Excel · 一键生成周报摘要',
      prompt: '做一个 Excel 插件，把当前表格一键生成周报摘要',
      expectVendor: /Excel/i,
      expectUnknown: false,
      planEdit: {
        name: 'biz-excel-weekly',
        summary: '当前表格一键生成周报摘要',
        features:
          '任务窗格按钮：生成周报摘要\n读取当前工作表已用区域\n输出结构化周报（本周完成/风险/下周计划）\n可复制摘要到剪贴板',
        accept: '任务窗格可打开\n点击后生成中文摘要\n清单 manifest.xml 校验通过',
      },
      iterate: '摘要里加上「风险项」小节，并用红色高亮提示',
      expectArtExt: /\.zip$/,
      inspectHints: ['manifest.xml', 'taskpane'],
      mockExpectKeywords: [/周报|摘要|weekly|summary/i],
      mockFailIf: [],
    },
    {
      id: 'acme-inventory',
      title: '未知宿主 · Acme 库存系统侧边栏',
      prompt: '给『Acme 库存系统』做一个侧边栏插件，显示缺货预警',
      expectVendor: /Acme|新宿主/i,
      expectUnknown: true,
      planEdit: {
        name: 'biz-acme-stock-alert',
        summary: 'Acme 库存系统侧边栏：缺货预警',
        features:
          '侧边栏面板展示缺货 SKU 列表\n低于安全库存阈值时高亮预警\n支持刷新与导出预警清单\n可配置安全库存阈值',
        accept: '新宿主适配器已写入目录\n侧边栏可渲染预警列表\n构建与清单校验通过',
      },
      iterate: '预警项增加「建议补货量」字段，并按紧急程度排序',
      expectArtExt: /\.zip$/,
      inspectHints: ['plugin.json'],
      mockExpectKeywords: [/缺货|预警|库存|stock|alert/i],
      mockFailIf: [],
    },
    {
      id: 'blender-rename',
      title: 'Blender · 一键整理场景物体命名',
      prompt: '给 Blender 做一个一键整理场景物体命名的插件',
      expectVendor: /Blender/i,
      expectUnknown: false,
      planEdit: {
        name: 'biz-blender-rename',
        summary: '一键整理场景物体命名',
        features:
          '面板按钮：整理选中物体命名\n按类型加前缀（Mesh_/Light_/Cam_）\n去除非法字符与重复后缀\n操作可撤销',
        accept: '在 Blender 中可启用插件\n点按钮后物体命名规范化\n打包为 addon zip',
      },
      iterate: '增加「仅处理选中物体」开关，默认开启',
      expectArtExt: /\.zip$/,
      inspectHints: ['__init__.py', 'blender_manifest.toml'],
      mockExpectKeywords: [/rename|命名|物体|prefix/i],
      mockFailIf: [],
    },
  ];

  for (const sc of SCENARIOS) {
    console.log('\n====', sc.id, '====');
    const rec = {
      id: sc.id,
      title: sc.title,
      prompt: sc.prompt,
      pass: false,
      steps: {},
      shots: [],
      artifact: null,
      artifactList: null,
      projectDir: null,
      mockQuality: 'unknown',
      notes: [],
    };
    try {
      await page.click('#act-home');
      await page.waitForTimeout(200);
      await page.fill('#home-prompt', sc.prompt);
      rec.shots.push(await shot(`${sc.id}-01-prompt`));

      // 像业务人员：点开始，不选手动厂商 id
      await page.click('#btn-home-go');
      await page.waitForSelector('#card-intent:not(.hidden)', { timeout: 20000 });
      await scrollTo('#card-intent');
      rec.shots.push(await shot(`${sc.id}-02-intent`));

      const candText = await text('#intent-cands');
      const selText = await text('#intent-cands .cand.sel');
      rec.steps.intent = { selected: selText.trim().slice(0, 120), all: candText.slice(0, 400) };
      if (!sc.expectVendor.test(selText) && !(sc.expectUnknown && /新宿主/.test(selText))) {
        note('P0', '意图匹配', `期望匹配 ${sc.expectVendor}，实际选中「${selText.trim()}」`, sc.id);
        rec.notes.push('意图匹配不符合预期');
      }
      if (sc.expectUnknown && !/新宿主/.test(selText)) {
        note('P0', '未知宿主', '未触发「新宿主」自动扩展候选', sc.id);
      }
      if (!sc.expectUnknown && /__manual__|手动指定/.test(selText) && !sc.expectVendor.test(selText)) {
        note('P1', '意图匹配', '落到手动指定，业务人员会懵', sc.id);
      }
      // 检查是否有英文 jargon 裸露
      if (/\bfamily\b|\badapter\b|\bmanifest\b/i.test(candText) && /家族|清单/.test(candText) === false) {
        note('P2', '文案', '意图卡片出现未翻译英文 jargon', sc.id);
      }
      // 「家族 xxx」对业务人员偏技术
      if (/家族\s+\w+/.test(candText)) {
        note('P2', '文案', '意图候选展示「家族 xxx」，半技术用户可能不懂', sc.id);
      }

      await page.click('#btn-plan');
      await page.waitForSelector('#card-plan:not(.hidden)', { timeout: 20000 });
      await scrollTo('#card-plan');
      rec.shots.push(await shot(`${sc.id}-03-plan-before-edit`));

      // PM 轻改方案
      await page.fill('#plan-name', sc.planEdit.name);
      await page.fill('#plan-summary', sc.planEdit.summary);
      await page.fill('#plan-features', sc.planEdit.features);
      await page.fill('#plan-accept', sc.planEdit.accept);
      rec.shots.push(await shot(`${sc.id}-04-plan-edited`));

      const know = await text('#plan-knowledge');
      if (!know || know.trim().length < 20) {
        note('P1', '方案页', '宿主知识面板为空或过短', sc.id);
      }
      // 项目名 pattern 是否对中文不友好（我们用英文 slug，应 OK）
      const nameVal = await val('#plan-name');
      if (nameVal !== sc.planEdit.name) {
        note('P1', '方案页', `项目名填写后被改写为 ${nameVal}`, sc.id);
      }

      await page.click('#btn-run');
      // 运行中应有步骤
      await page.waitForSelector('#card-run:not(.hidden)', { timeout: 15000 });
      await page.waitForTimeout(800);
      rec.shots.push(await shot(`${sc.id}-05-agent-running`));
      await waitDone(120000);
      await scrollTo('#card-run');
      rec.shots.push(await shot(`${sc.id}-06-agent-done`));

      const status = (await text('#run-status')).trim();
      const stepsHtml = await text('#agent-steps');
      rec.steps.run = { status, steps: stepsHtml.slice(0, 800) };
      if (!/完成/.test(status)) {
        note('P0', 'Agent', `未完成: ${status}`, sc.id);
      }
      if (/失败|错误|Error/i.test(status) && !/通过/.test(status)) {
        note('P0', 'Agent', `最终状态失败: ${status}`, sc.id);
      }
      if (sc.expectUnknown && !/准备宿主适配器|自动扩展/.test(stepsHtml)) {
        note('P1', '未知宿主', '步骤日志未明确写出自动扩展新宿主', sc.id);
      }

      const projDir = path.join(WS, sc.planEdit.name);
      rec.projectDir = projDir;
      if (!fs.existsSync(projDir)) {
        note('P0', '产物', `项目目录不存在: ${projDir}`, sc.id);
        throw new Error('no project dir');
      }
      const meta = JSON.parse(fs.readFileSync(path.join(projDir, '.pluginide.json'), 'utf8'));
      rec.steps.metaStages = meta.stages;
      if (!meta.stages?.validate?.ok && !meta.stages?.build?.ok) {
        note('P0', '构建/校验', 'build/validate 均未通过', sc.id);
      }

      // 检查 SPEC
      const specPath = path.join(projDir, 'SPEC.md');
      if (!fs.existsSync(specPath)) note('P1', 'SPEC', '缺少 SPEC.md', sc.id);
      else {
        const spec = fs.readFileSync(specPath, 'utf8');
        if (!spec.includes(sc.planEdit.features.split('\n')[0].slice(0, 8))) {
          note('P2', 'SPEC', 'SPEC 未反映用户编辑的功能点（可能被覆盖）', sc.id);
        }
      }

      // Mock 质量：扫关键源码
      const walkFiles = (dir, acc = []) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'build' || ent.name === '.checkpoints') continue;
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) walkFiles(p, acc);
          else if (/\.(js|ts|py|html|xml|json|md)$/i.test(ent.name)) acc.push(p);
        }
        return acc;
      };
      const srcFiles = walkFiles(projDir);
      const blob = srcFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
      const hitExpect = (sc.mockExpectKeywords || []).some((re) => re.test(blob));
      const hitFail = (sc.mockFailIf || []).some((re) => re.test(blob));
      if (hitFail) {
        rec.mockQuality = 'fail-business';
        note(
          'P1',
          'Mock 质量',
          '生成内容与需求明显不符（例如翻译需求却生成 Markdown 保存），业务人员会以为做完了但功能不对',
          sc.id
        );
      } else if (!hitExpect) {
        rec.mockQuality = 'weak';
        note('P1', 'Mock 质量', '离线 Mock 未体现需求关键词，演示可信度低', sc.id);
      } else {
        rec.mockQuality = 'ok-demo';
      }

      // 空代码页？试一下切到代码 tab（项目详情）
      await page.click('#nav [data-view=project]').catch(() => {});
      await page.waitForTimeout(300);
      if (await visible('#tabs [data-tab=code]')) {
        await page.click('#tabs [data-tab=code]');
        await page.waitForTimeout(1500);
        const ideSrc = await page.getAttribute('#ide-frame', 'src').catch(() => null);
        if (!ideSrc) note('P1', '代码页', '内嵌编辑器 iframe 无 src', sc.id);
        rec.shots.push(await shot(`${sc.id}-07-code-tab`));
        // 回首页结果卡（若还在）
        await page.click('#act-home').catch(() => {});
        await page.waitForTimeout(200);
      }

      // 迭代
      if (!(await visible('#iter-prompt'))) {
        // 可能还在 project 页，需要确保 run 卡可见
        await page.click('#act-home');
        await page.waitForTimeout(300);
      }
      if (await visible('#iter-prompt')) {
        await page.fill('#iter-prompt', sc.iterate);
        await page.click('#btn-iterate');
        await waitDone(120000);
        await scrollTo('#card-run');
        rec.shots.push(await shot(`${sc.id}-08-iterate`));
        rec.steps.iterate = (await text('#run-status')).trim();
      } else {
        note('P0', '迭代', '迭代输入框不可见，无法对话迭代', sc.id);
      }

      // 打包 + dry-run 发布
      if (await visible('#btn-ship')) {
        await page.click('#btn-ship');
        await page
          .waitForFunction(
            () => document.querySelector('#flow-steps li[data-k=ship]')?.classList.contains('done'),
            undefined,
            { timeout: 60000 }
          )
          .catch(() => note('P0', '发布', '打包/发布步骤未完成', sc.id));
        rec.shots.push(await shot(`${sc.id}-09-ship`));
      } else {
        note('P0', '发布', '缺少「打包发布」按钮', sc.id);
      }

      // 读产物
      const meta2 = JSON.parse(fs.readFileSync(path.join(projDir, '.pluginide.json'), 'utf8'));
      const artRel = meta2.artifact?.file;
      if (!artRel) {
        note('P0', '产物', '元数据无 artifact.file', sc.id);
      } else {
        const art = path.join(projDir, artRel);
        rec.artifact = art;
        if (!fs.existsSync(art)) note('P0', '产物', `产物文件不存在: ${art}`, sc.id);
        else {
          const dest = path.join(ART_DIR, path.basename(art));
          fs.copyFileSync(art, dest);
          let list = '';
          try {
            list = execSync(`unzip -l "${art}"`, { encoding: 'utf8' });
          } catch (e) {
            note('P0', '产物', `无法 unzip 检查: ${e.message}`, sc.id);
          }
          rec.artifactList = list.slice(0, 1500);
          for (const h of sc.inspectHints) {
            if (!list.includes(h)) note('P1', '产物内容', `zip 内缺少预期条目含「${h}」`, sc.id);
          }
          if (sc.expectArtExt && !sc.expectArtExt.test(art)) {
            note('P1', '产物格式', `期望 ${sc.expectArtExt}，得到 ${path.extname(art)}`, sc.id);
          }
          // 业务人员观感：有无 README / 安装说明
          const hasReadme =
            fs.existsSync(path.join(projDir, 'README.md')) || /README/i.test(list);
          if (!hasReadme) note('P2', '可安装性信任', '缺少 README，非工程师难判断如何安装', sc.id);
        }
      }

      // dry-run publish 记录
      const pub = fs
        .readdirSync(path.join(projDir, 'dist'))
        .filter((f) => f.startsWith('publish-'));
      if (!pub.length) note('P1', '发布', '无 publish-*.json dry-run 记录', sc.id);

      rec.pass =
        /完成/.test(rec.steps.run?.status || '') &&
        !!rec.artifact &&
        fs.existsSync(rec.artifact || '') &&
        !friction.some((f) => f.scenario === sc.id && f.severity === 'P0');
    } catch (e) {
      note('P0', '走查崩溃', e.stack || e.message, sc.id);
      rec.notes.push(String(e.message || e));
      rec.shots.push(await shot(`${sc.id}-ERROR`).catch(() => null));
    }
    scenarios.push(rec);
  }

  // 发布中心总览
  await page.click('#nav [data-view=publish]');
  await page.waitForTimeout(500);
  await shot('99-publish-center');

  const summary = {
    when: new Date().toISOString(),
    workspace: WS,
    data: DATA,
    scenarios,
    friction,
    p0: friction.filter((f) => f.severity === 'P0'),
    p1: friction.filter((f) => f.severity === 'P1'),
    p2: friction.filter((f) => f.severity === 'P2'),
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(summary, null, 2));
  console.log('\nWrote', REPORT_JSON);
  console.log('P0', summary.p0.length, 'P1', summary.p1.length, 'P2', summary.p2.length);
  console.log(
    'Pass',
    scenarios.filter((s) => s.pass).length,
    '/',
    scenarios.length
  );

  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  setTimeout(() => process.exit(0), 2000);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
