// AI 开发/调试/聊天：多文件生成、补丁解析、结构化调试建议
const templates = require('./templates');
const llm = require('./llm');

/** 从 LLM 文本中提取多文件：支持 ### FILE: path + 代码块，或 ```file:path */
function extractFiles(text) {
  const files = [];
  if (!text) return files;
  const re1 = /###\s*FILE:\s*([^\n]+)\n```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re1.exec(text))) files.push({ path: m[1].trim(), content: m[2].replace(/\s*$/, '') + '\n' });
  if (files.length) return files;
  const re2 = /```file:([^\n]+)\n([\s\S]*?)```/g;
  while ((m = re2.exec(text))) files.push({ path: m[1].trim(), content: m[2].replace(/\s*$/, '') + '\n' });
  if (files.length) return files;
  const single = llm.extractCode(text);
  if (single) files.push({ path: null, content: single.endsWith('\n') ? single : single + '\n' });
  return files;
}

/** 提取 ### FIX: path + reason + 代码块 */
function extractFixes(text) {
  const fixes = [];
  if (!text) return fixes;
  const re = /###\s*FIX:\s*([^\n]+)\n(?:reason:\s*([^\n]*)\n)?```[a-zA-Z0-9_-]*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text))) {
    fixes.push({ path: m[1].trim(), reason: (m[2] || '').trim() || 'AI 建议修复', content: m[3].replace(/\s*$/, '') + '\n' });
  }
  return fixes;
}

/** 提取聊天中的动作块 ### ACTION: type ... ```json */
function extractActions(text) {
  const actions = [];
  if (!text) return actions;
  const re = /###\s*ACTION:\s*(\w+)\n```(?:json)?\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text))) {
    try { actions.push({ type: m[1].toLowerCase(), ...JSON.parse(m[2]) }); }
    catch { actions.push({ type: m[1].toLowerCase(), raw: m[2] }); }
  }
  return actions;
}

function formatFilesReply(files, summary) {
  let out = (summary || '【AI 开发】已生成/更新以下文件：') + '\n';
  for (const f of files) {
    out += `\n### FILE: ${f.path}\n\`\`\`\n${f.content.replace(/\n$/, '')}\n\`\`\`\n`;
  }
  return out;
}

function kw(s, ...words) { const t = (s || '').toLowerCase(); return words.some(w => t.includes(w.toLowerCase())); }

function enhanceFromRequirement(adapter, baseFiles, p, ask) {
  const files = { ...baseFiles };
  const name = p.name, dn = p.displayName, tpl = adapter.template || 'generic';
  const pyId = n => n.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
  const askOne = (ask || '').trim().replace(/\n/g, ' ').slice(0, 80);

  if (tpl === 'vscode') {
    let pkg = JSON.parse(files['package.json']);
    pkg.contributes = pkg.contributes || {};
    const cmd = `${name}.runFeature`;
    const cmdStatus = `${name}.showStats`;
    pkg.contributes.commands = [
      { command: cmd, title: `${dn}: 运行功能` },
      { command: cmdStatus, title: `${dn}: 显示统计` }
    ];
    pkg.contributes.configuration = {
      title: dn,
      properties: {
        [`${name}.enabled`]: { type: 'boolean', default: true, description: '启用插件' },
        [`${name}.outputChannel`]: { type: 'boolean', default: true, description: '在输出面板显示结果' },
        [`${name}.message`]: { type: 'string', default: askOne || 'Hello', description: '自定义提示文案' }
      }
    };
    pkg.contributes.keybindings = [
      { command: cmd, key: 'ctrl+shift+.', mac: 'cmd+shift+.', when: 'editorTextFocus' }
    ];
    const isDingtalk = kw(ask, '钉钉', 'dingtalk', 'dingding', '群机器人', 'webhook');
    if (isDingtalk) {
      pkg.contributes.commands = [
        { command: cmd, title: `${dn}: 发送选中代码到钉钉` },
        { command: cmdStatus, title: `${dn}: 查看 Webhook 配置` }
      ];
      pkg.contributes.menus = {
        'editor/context': [{ command: cmd, when: 'editorHasSelection', group: 'navigation@9' }]
      };
      pkg.contributes.configuration = {
        title: dn,
        properties: {
          [`${name}.enabled`]: { type: 'boolean', default: true, description: '启用插件' },
          [`${name}.webhook`]: { type: 'string', default: '', description: '钉钉群机器人 Webhook 地址' },
          [`${name}.secret`]: { type: 'string', default: '', description: '钉钉加签密钥（可选）' }
        }
      };
      files['package.json'] = JSON.stringify(pkg, null, 2) + '\n';
      files['extension.js'] =
`const vscode = require('vscode');
const https = require('https');
const http = require('http');
const { URL } = require('url');

/** ${dn} — 右键发送选中代码到钉钉群 */
function postJson(webhook, body) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(webhook); } catch (e) { reject(new Error('Webhook 不是合法 URL')); return; }
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function activate(context) {
  const cfg = () => vscode.workspace.getConfiguration('${name}');
  const channel = vscode.window.createOutputChannel('${dn}');
  context.subscriptions.push(channel);

  async function sendSelection() {
    if (!cfg().get('enabled', true)) {
      vscode.window.showWarningMessage('${dn} 已禁用');
      return;
    }
    const webhook = (cfg().get('webhook', '') || '').trim();
    if (!webhook) {
      const go = await vscode.window.showWarningMessage('未配置钉钉 Webhook，请先在设置中填写 ${name}.webhook', '打开设置');
      if (go) vscode.commands.executeCommand('workbench.action.openSettings', '${name}.webhook');
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showInformationMessage('没有打开的编辑器'); return; }
    const text = editor.document.getText(editor.selection).trim();
    if (!text) { vscode.window.showWarningMessage('请先选中要发送的代码'); return; }
    const lang = editor.document.languageId || 'text';
    const md = '### 代码分享\\n\`\`\`' + lang + '\\n' + text.slice(0, 3500) + '\\n\`\`\`\\n';
    const body = { msgtype: 'markdown', markdown: { title: '${dn}', text: md } };
    try {
      const r = await postJson(webhook, body);
      channel.appendLine('[dingtalk] HTTP ' + r.status + ' ' + r.body);
      vscode.window.showInformationMessage('${dn}: 已发送到钉钉群');
    } catch (e) {
      vscode.window.showErrorMessage('${dn}: 发送失败 — ' + e.message);
    }
  }

  context.subscriptions.push(vscode.commands.registerCommand('${cmd}', sendSelection));
  context.subscriptions.push(vscode.commands.registerCommand('${cmdStatus}', async () => {
    const webhook = (cfg().get('webhook', '') || '').trim();
    if (!webhook) { vscode.window.showWarningMessage('未配置 ${name}.webhook'); return; }
    vscode.window.showInformationMessage('Webhook 已配置：' + webhook.slice(0, 48) + (webhook.length > 48 ? '…' : ''));
  }));
}

function deactivate() {}
module.exports = { activate, deactivate };
`;
      files['test/extension.test.js'] =
`const assert = require('assert');
const ext = require('../extension.js');
describe('${name}', () => {
  it('exports activate/deactivate', () => {
    assert.equal(typeof ext.activate, 'function');
    assert.equal(typeof ext.deactivate, 'function');
  });
});
`;
      files['README.md'] =
`# ${dn}

${p.description || ask || ''}

## 功能

- 编辑器右键：「${dn}: 发送选中代码到钉钉」
- 设置 \`${name}.webhook\`（未配置时中文提示）
- Markdown 代码块发送选区

## 调试

按 F5 启动 Extension Development Host。
`;
    } else {
    files['extension.js'] =
`const vscode = require('vscode');

/** ${dn} — 由插件工坊 Mock AI 生成的可运行示例 */
function activate(context) {
  const cfg = () => vscode.workspace.getConfiguration('${name}');
  const channel = vscode.window.createOutputChannel('${dn}');
  context.subscriptions.push(channel);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = '${cmdStatus}';
  status.text = '$(sparkle) ${dn}';
  status.tooltip = ${JSON.stringify(askOne || dn)};
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(vscode.commands.registerCommand('${cmd}', async () => {
    if (!cfg().get('enabled', true)) {
      vscode.window.showWarningMessage('${dn} 已禁用，请在设置中开启');
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const text = editor ? editor.document.getText(editor.selection).trim() || editor.document.getText() : '';
    const lines = text ? text.split(/\\r?\\n/).length : 0;
    const words = text ? text.trim().split(/\\s+/).filter(Boolean).length : 0;
    const msg = cfg().get('message', 'Hello') + ' · 行 ' + lines + ' · 词 ' + words;
    if (cfg().get('outputChannel', true)) {
      channel.clear();
      channel.appendLine('[${dn}] ' + msg);
      channel.appendLine('需求: ' + ${JSON.stringify(askOne)});
      channel.show(true);
    }
    vscode.window.showInformationMessage(msg);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('${cmdStatus}', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showInformationMessage('没有打开的编辑器'); return; }
    const doc = editor.document;
    status.text = '$(file-code) ' + doc.lineCount + ' 行';
    vscode.window.showInformationMessage('${dn}: ' + doc.fileName + ' · ' + doc.lineCount + ' 行');
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
`;
    files['package.json'] = JSON.stringify(pkg, null, 2) + '\n';
    files['test/extension.test.js'] =
`const assert = require('assert');
const ext = require('../extension.js');
describe('${name}', () => {
  it('exports activate/deactivate', () => {
    assert.equal(typeof ext.activate, 'function');
    assert.equal(typeof ext.deactivate, 'function');
  });
});
`;
    files['README.md'] =
`# ${dn}

${p.description || ask || ''}

## 功能

- 命令「${dn}: 运行功能」：统计选区/全文行数与词数
- 命令「${dn}: 显示统计」：更新状态栏
- 快捷键 Ctrl+Shift+. （macOS Cmd+Shift+.）
- 设置项：\`${name}.enabled\` / \`${name}.message\` / \`${name}.outputChannel\`

## 调试

按 F5 启动 Extension Development Host，命令面板搜索「${dn}」。
`;
    }
  } else if (tpl === 'browser') {
    const isTranslate = kw(ask, '翻译', 'translate', '译文', '英译中');
    let man = JSON.parse(files['manifest.json'] || '{"manifest_version":3,"name":"","version":"0.0.1"}');
    man.name = dn;
    man.description = askOne || p.description || dn;
    man.action = man.action || { default_popup: 'popup.html', default_title: dn };
    man.permissions = [...new Set([...(man.permissions || []), 'storage', 'activeTab', 'scripting', ...(isTranslate ? ['contextMenus'] : [])])];
    man.commands = {
      'run-feature': { suggested_key: { default: isTranslate ? 'Ctrl+Shift+T' : 'Ctrl+Shift+Y', mac: isTranslate ? 'Command+Shift+T' : 'Command+Shift+Y' }, description: '运行 ' + dn }
    };
    man.options_ui = { page: 'options.html', open_in_tab: true };
    files['manifest.json'] = JSON.stringify(man, null, 2) + '\n';
    if (isTranslate) {
      files['popup.html'] =
`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${dn}</title>
  <style>
    body { font: 13px/1.45 system-ui, sans-serif; margin: 12px; width: 300px; color: #1a1a1a; }
    h1 { font-size: 15px; margin: 0 0 8px; }
    textarea { width: 100%; height: 72px; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px; }
    button { width: 100%; padding: 8px; margin-top: 8px; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
    button.secondary { background: #e5e7eb; color: #111; }
    #out { margin-top: 10px; white-space: pre-wrap; background: #f3f4f6; padding: 8px; border-radius: 6px; max-height: 180px; overflow: auto; font-size: 12px; }
    .hint { color: #6b7280; font: 12px/1.4 system-ui; margin: 0 0 8px; }
  </style>
</head>
<body>
  <h1>${dn}</h1>
  <p class="hint">选中网页文字后点「翻译成中文」；也可粘贴原文。</p>
  <textarea id="src" placeholder="原文（可留空，将读取当前选区）"></textarea>
  <button id="translate">翻译成中文</button>
  <button id="copy" class="secondary">复制译文</button>
  <div id="out"></div>
  <script src="popup.js"></script>
</body>
</html>
`;
      files['popup.js'] =
`/* ${dn} — 选中文字一键翻译成中文（Mock 演示翻译） */
const out = document.getElementById('out');
const srcEl = document.getElementById('src');
function setOut(t) { out.textContent = t; }

function mockTranslateToZh(text) {
  const t = (text || '').trim();
  if (!t) return '（没有可翻译的文本）';
  const zhRatio = (t.match(/[\u4e00-\u9fa5]/g) || []).length / Math.max(t.length, 1);
  if (zhRatio > 0.4) return '【译文】' + t;
  return '【译文·演示】' + t.split(/\\s+/).slice(0, 80).join(' ') + '\\n\\n—— 以上为离线 Mock 译文，请接入真实翻译服务。';
}

async function getSelectionFromPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error('无活动标签页');
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => (window.getSelection && String(window.getSelection())) || ''
  });
  return { text: result || '', tab };
}

async function doTranslate() {
  try {
    let text = (srcEl.value || '').trim();
    if (!text) {
      const { text: sel } = await getSelectionFromPage();
      text = sel;
      if (text) srcEl.value = text;
    }
    const zh = mockTranslateToZh(text);
    await chrome.storage.local.set({ lastTranslateSrc: text, lastTranslateZh: zh });
    setOut(zh);
  } catch (e) { setOut('错误: ' + e.message); }
}

document.getElementById('translate').addEventListener('click', doTranslate);
document.getElementById('copy').addEventListener('click', async () => {
  try {
    const { lastTranslateZh } = await chrome.storage.local.get({ lastTranslateZh: out.textContent || '' });
    const t = lastTranslateZh || out.textContent || '';
    await navigator.clipboard.writeText(t);
    setOut((out.textContent || t) + '\\n\\n（已复制译文）');
  } catch (e) { setOut('复制失败: ' + e.message); }
});
`;
      files['background.js'] =
`/* ${dn} service worker */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ enabled: true });
  chrome.contextMenus.create({ id: 'translate-selection', title: '翻译成中文', contexts: ['selection'] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'translate-selection') return;
  await chrome.storage.local.set({ lastTranslateSrc: info.selectionText || '', pendingTranslate: true });
  if (tab && chrome.action && chrome.action.openPopup) { try { await chrome.action.openPopup(); } catch (e) {} }
});
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'run-feature') { try { await chrome.action.openPopup(); } catch (e) {} }
});
`;
      files['options.html'] =
`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${dn} 设置</title>
<style>body{font:14px system-ui;margin:24px;max-width:480px}label{display:flex;gap:8px;align-items:center;margin:12px 0}</style></head>
<body><h1>${dn} 设置</h1>
<label><input type="checkbox" id="en" checked> 启用扩展</label>
<label>目标语言 <select id="lang"><option value="zh-CN" selected>简体中文</option><option value="en">English</option></select></label>
<p id="msg"></p><script src="options.js"></script></body></html>
`;
      files['options.js'] =
`chrome.storage.sync.get({ enabled: true, targetLang: 'zh-CN' }, (o) => {
  document.getElementById('en').checked = o.enabled;
  document.getElementById('lang').value = o.targetLang || 'zh-CN';
});
document.getElementById('en').onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked });
document.getElementById('lang').onchange = (e) => {
  chrome.storage.sync.set({ targetLang: e.target.value });
  document.getElementById('msg').textContent = '已保存';
};
`;
      files['README.md'] =
`# ${dn}

${ask || p.description || ''}

## 功能

- 选中网页文字 → 右键「翻译成中文」或弹出页翻译
- 复制译文；快捷键 Ctrl+Shift+T
- 选项页：启用开关与目标语言

## 加载

Chrome → 扩展程序 → 开发者模式 → 加载已解压的扩展程序。

> 离线 Mock 为演示译文，请接入真实翻译 API。
`;
    } else {
    files['popup.html'] =
`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${dn}</title>
  <style>
    body { font: 13px/1.4 system-ui, sans-serif; margin: 12px; width: 280px; color: #1a1a1a; }
    h1 { font-size: 15px; margin: 0 0 8px; }
    button { width: 100%; padding: 8px; margin-top: 8px; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
    button.secondary { background: #e5e7eb; color: #111; }
    #out { margin-top: 10px; white-space: pre-wrap; background: #f3f4f6; padding: 8px; border-radius: 6px; max-height: 160px; overflow: auto; font-size: 12px; }
    .row { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
  </style>
</head>
<body>
  <h1>${dn}</h1>
  <p id="hint">将当前页保存为 Markdown（示例实现）</p>
  <div class="row"><label><input type="checkbox" id="includeTitle" checked> 包含标题</label></div>
  <button id="save">保存为 Markdown</button>
  <button id="copy" class="secondary">复制到剪贴板</button>
  <div id="out"></div>
  <script src="popup.js"></script>
</body>
</html>
`;
    files['popup.js'] =
`/* ${dn} popup — Mock AI 完整示例 */
const out = document.getElementById('out');
function setOut(t) { out.textContent = t; }

async function pageToMarkdown() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error('无活动标签页');
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      title: document.title || '',
      url: location.href,
      body: ((document.body && document.body.innerText) || '').slice(0, 20000)
    })
  });
  const includeTitle = document.getElementById('includeTitle').checked;
  let md = '';
  if (includeTitle) md += '# ' + (result.title || 'Untitled') + '\\n\\n';
  md += '> 来源: ' + result.url + '\\n\\n';
  md += result.body.trim() + '\\n';
  return { md: md, title: result.title, tab: tab };
}

document.getElementById('save').addEventListener('click', async () => {
  try {
    const { md, title } = await pageToMarkdown();
    const key = 'md:' + Date.now();
    await chrome.storage.local.set({ [key]: md, lastMarkdown: md, lastTitle: title });
    setOut('已保存 (' + md.length + ' 字符)\\n\\n' + md.slice(0, 400) + (md.length > 400 ? '\\n…' : ''));
  } catch (e) { setOut('错误: ' + e.message); }
});

document.getElementById('copy').addEventListener('click', async () => {
  try {
    const { md } = await pageToMarkdown();
    await navigator.clipboard.writeText(md);
    setOut('已复制到剪贴板 (' + md.length + ' 字符)');
  } catch (e) { setOut('错误: ' + e.message); }
});

chrome.storage.sync.get({ enabled: true }, (o) => {
  if (!o.enabled) setOut('扩展已在选项页禁用');
});
`;
    files['background.js'] =
`/* ${dn} service worker */
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'run-feature') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id && chrome.action && chrome.action.openPopup) {
    try { await chrome.action.openPopup(); } catch (e) {}
  }
});
chrome.runtime.onInstalled.addListener(() => { chrome.storage.sync.set({ enabled: true }); });
`;
    files['options.html'] =
`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${dn} 设置</title>
<style>body{font:14px system-ui;margin:24px;max-width:480px}label{display:flex;gap:8px;align-items:center;margin:12px 0}</style></head>
<body><h1>${dn} 设置</h1>
<label><input type="checkbox" id="en" checked> 启用扩展</label>
<label>默认文件名前缀 <input id="prefix" value="clip"></label>
<p id="msg"></p><script src="options.js"></script></body></html>
`;
    files['options.js'] =
`chrome.storage.sync.get({ enabled: true, prefix: 'clip' }, (o) => {
  document.getElementById('en').checked = o.enabled;
  document.getElementById('prefix').value = o.prefix;
});
document.getElementById('en').onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked });
document.getElementById('prefix').onchange = (e) => {
  chrome.storage.sync.set({ prefix: e.target.value });
  document.getElementById('msg').textContent = '已保存';
};
`;
    files['README.md'] =
`# ${dn}

${ask || p.description || ''}

## 功能

- 弹出页：当前网页 → Markdown，可保存或复制
- 快捷键 Ctrl+Shift+Y
- 选项页：启用开关与文件名前缀

## 加载

Chrome → 扩展程序 → 开发者模式 → 加载已解压的扩展程序。
`;
    }
  } else if (tpl === 'blender') {
    const id = pyId(name);
    const ID = id.toUpperCase();
    files['__init__.py'] =
`bl_info = {
    "name": "${dn}",
    "author": "PluginWorkbench",
    "version": (0, 1, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > AI",
    "description": ${JSON.stringify(askOne || dn)},
    "category": "Object",
}

import bpy


class ${ID}_Props(bpy.types.PropertyGroup):
    prefix: bpy.props.StringProperty(name="前缀", default="OBJ_")
    start: bpy.props.IntProperty(name="起始编号", default=1, min=0)


class OBJECT_OT_${id}_rename(bpy.types.Operator):
    bl_idname = "object.${id}_rename"
    bl_label = "批量重命名选中物体"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        props = context.scene.${id}_props
        selected = [o for o in context.selected_objects]
        if not selected:
            self.report({'WARNING'}, "未选中物体")
            return {'CANCELLED'}
        for i, obj in enumerate(selected):
            obj.name = f"{props.prefix}{props.start + i:03d}"
        self.report({'INFO'}, f"已重命名 {len(selected)} 个物体")
        return {'FINISHED'}


class VIEW3D_PT_${id}(bpy.types.Panel):
    bl_label = "${dn}"
    bl_idname = "VIEW3D_PT_${id}"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "AI"

    def draw(self, context):
        layout = self.layout
        props = context.scene.${id}_props
        layout.prop(props, "prefix")
        layout.prop(props, "start")
        layout.operator("object.${id}_rename", icon='OUTLINER_OB_FONT')


classes = (${ID}_Props, OBJECT_OT_${id}_rename, VIEW3D_PT_${id})


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.${id}_props = bpy.props.PointerProperty(type=${ID}_Props)


def unregister():
    del bpy.types.Scene.${id}_props
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
`;
    files['tests/test_smoke.py'] =
`def test_bl_info_keys():
    import pathlib
    path = pathlib.Path(__file__).resolve().parents[1] / "__init__.py"
    text = path.read_text(encoding="utf-8")
    assert '"name"' in text and "register" in text
`;
    files['README.md'] =
`# ${dn}

${ask || p.description || ''}

## 功能

- 3D 视图侧栏「AI」面板
- 批量为选中物体添加前缀与编号

## 安装

编辑 → 偏好设置 → 插件 → 安装，或链接到 scripts/addons。
`;
  } else if (tpl === 'office') {
    const isWeekly = kw(ask, '周报', '摘要', 'weekly', 'summary', '汇报');
    files['taskpane.html'] =
`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="X-UA-Compatible" content="IE=Edge"/>
  <title>${dn}</title>
  <script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
  <style>
    body { font: 14px/1.45 'Segoe UI', system-ui, sans-serif; margin: 16px; color: #242424; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    button { background: #185abd; color: #fff; border: 0; border-radius: 4px; padding: 8px 14px; cursor: pointer; margin-right: 8px; margin-top: 8px; }
    button.secondary { background: #f3f2f1; color: #242424; }
    #out { margin-top: 12px; padding: 10px; background: #f3f2f1; border-radius: 4px; white-space: pre-wrap; min-height: 48px; }
    .risk { color: #a4262c; font-weight: 600; }
    label { display: block; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>${dn}</h1>
  <p>${isWeekly ? '读取当前工作表，一键生成周报摘要。' : 'Office 任务窗格示例：插入摘要、统计选区。'}</p>
  ${isWeekly ? '' : '<label>前缀 <input id="prefix" value="【摘要】" style="width:100%;padding:6px;box-sizing:border-box"></label>'}
  <button id="run">${isWeekly ? '生成周报摘要' : '插入到文档'}</button>
  <button id="copy" class="secondary">${isWeekly ? '复制摘要' : '统计选区'}</button>
  <div id="out">等待 Office.js…</div>
  <script src="taskpane.js"></script>
</body>
</html>
`;
    if (isWeekly) {
      files['taskpane.js'] =
`/* ${dn} — Excel 周报摘要（Mock） */
Office.onReady((info) => {
  const out = document.getElementById('out');
  out.textContent = '宿主: ' + (info.host || 'Excel') + ' · 需求: ' + ${JSON.stringify(askOne)};
  let lastSummary = '';

  function buildWeeklySummary(rows) {
    const flat = (rows || []).flat().map(c => (c == null ? '' : String(c).trim())).filter(Boolean);
    const sample = flat.slice(0, 12);
    const risk = flat.filter(x => /风险|延期|阻塞|缺|delay|risk/i.test(x));
    let s = '【周报摘要】\\n';
    s += '一、本周完成\\n';
    s += (sample.length ? sample.map((x, i) => '  ' + (i + 1) + '. ' + x).join('\\n') : '  （表格暂无数据，请先填写工作表）') + '\\n';
    s += '二、风险项\\n';
    s += (risk.length ? risk.map(x => '  ⚠ ' + x).join('\\n') : '  无明显风险') + '\\n';
    s += '三、下周计划\\n  1. 继续推进未完成项\\n  2. 同步相关干系人\\n';
    s += '—— 由 ${dn} 根据当前表格生成（Mock）';
    return s;
  }

  document.getElementById('run').onclick = async () => {
    try {
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        const range = sheet.getUsedRangeOrNullObject();
        range.load(['values', 'isNullObject']);
        await context.sync();
        const values = range.isNullObject ? [] : (range.values || []);
        lastSummary = buildWeeklySummary(values);
        out.innerHTML = lastSummary.replace(/二、风险项[\\s\\S]*?(?=三、|$)/, m => '<span class="risk">' + m + '</span>').replace(/\\n/g, '<br>');
      });
    } catch (e) {
      lastSummary = buildWeeklySummary([['示例任务 A'], ['风险：依赖未就绪'], ['示例任务 B']]);
      out.textContent = lastSummary + '\\n\\n（Excel API 不可用时的演示数据）\\n' + e.message;
    }
  };

  document.getElementById('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(lastSummary || out.textContent || '');
      out.textContent = (lastSummary || out.textContent) + '\\n\\n（已复制）';
    } catch (e) { out.textContent = '复制失败: ' + e.message; }
  };
});
`;
    } else {
      files['taskpane.js'] =
`/* ${dn} taskpane — Mock AI 完整示例 */
Office.onReady((info) => {
  const out = document.getElementById('out');
  out.textContent = '宿主: ' + (info.host || 'Office') + ' · 需求: ' + ${JSON.stringify(askOne)};

  document.getElementById('run').onclick = async () => {
    const prefix = (document.getElementById('prefix') && document.getElementById('prefix').value) || '';
    try {
      await Word.run(async (context) => {
        const range = context.document.getSelection();
        range.insertText(prefix + '由 ${dn} 生成的内容\\n', Word.InsertLocation.end);
        await context.sync();
      });
      out.textContent = '已插入文本';
    } catch (e) {
      try {
        await Excel.run(async (context) => {
          const range = context.workbook.getSelectedRange();
          range.values = [[prefix + 'OK']];
          await context.sync();
        });
        out.textContent = '已写入选中单元格';
      } catch (e2) {
        out.textContent = '错误: ' + (e2.message || e.message);
      }
    }
  };

  document.getElementById('copy').onclick = async () => {
    try {
      await Word.run(async (context) => {
        const range = context.document.getSelection();
        range.load('text');
        await context.sync();
        const t = range.text || '';
        out.textContent = '字符 ' + t.length + ' · 词约 ' + (t.trim() ? t.trim().split(/\\s+/).length : 0);
      });
    } catch (e) {
      out.textContent = '统计失败: ' + e.message;
    }
  };
});

function aiFeature() { return true; }
`;
    }
    files['commands.html'] =
`<!doctype html><html><head><meta charset="utf-8"><script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script></head>
<body><script>
Office.onReady(() => {
  Office.actions.associate('runFeature', async () => {
    return Office.context.document.setSelectedDataAsync('Hello from ${dn}');
  });
});
</script></body></html>
`;
    files['README.md'] =
`# ${dn}

${ask || p.description || ''}

## 功能

${isWeekly
  ? '- 任务窗格：一键生成周报摘要（本周完成 / 风险项 / 下周计划）\n- 复制摘要到剪贴板'
  : '- 任务窗格：插入摘要文本、统计选区\n- commands.html 关联功能区按钮（需在 manifest 中声明）'}

## 调试

使用 \`office-addin-debugging\` 或在 Office 中通过「旁加载」清单。
`;
  } else {
    const entry = files['extension.js'] ? 'extension.js'
      : files['main.py'] ? 'main.py'
      : files['index.js'] ? 'index.js'
      : files['__init__.py'] ? '__init__.py'
      : files['server.js'] ? 'server.js'
      : Object.keys(files).find(f => /\.(js|py)$/.test(f));
    if (entry) {
      const isPy = entry.endsWith('.py');
      const c = isPy ? '#' : '//';
      let code = files[entry].replace(/\s*$/, '');
      if (!code.includes('AI:')) {
        code += `\n\n${c} AI: ${askOne}\n`;
        code += isPy
          ? `def ai_feature(ctx=None):\n    """${askOne.slice(0, 60)}"""\n    print("ai_feature:", ${JSON.stringify(askOne)})\n    return {"ok": True, "message": ${JSON.stringify(askOne)}}\n`
          : `function aiFeature(input) {\n  const message = ${JSON.stringify(askOne)};\n  console.log('aiFeature', message, input);\n  return { ok: true, message, at: Date.now() };\n}\nmodule.exports = Object.assign(module.exports || {}, { aiFeature });\n`;
        files[entry] = code + (code.endsWith('\n') ? '' : '\n');
      }
    }
    if (kw(ask, 'test', '测试') && !Object.keys(files).some(f => f.includes('test'))) {
      files['test/smoke.js'] = `// stub test\nmodule.exports = { ok: true };\n`;
    }
    if (kw(ask, '缺货', '预警', '库存', 'stock', 'alert', 'sidebar', '侧边栏')) {
      const entryPy = files['main.py'] ? 'main.py' : null;
      const entryJs = files['index.js'] ? 'index.js' : (files['extension.js'] ? 'extension.js' : null);
      if (entryPy) {
        files[entryPy] =
`# ${dn} — 缺货预警侧边栏（Mock）
SAFE_STOCK = 10

def list_stock_alerts(items=None, threshold=SAFE_STOCK):
    """返回低于安全库存的 SKU 预警列表，按紧急程度排序。"""
    items = items or [
        {"sku": "SKU-1001", "name": "螺丝 M3", "qty": 3, "suggest": 50},
        {"sku": "SKU-2044", "name": "轴承 608", "qty": 0, "suggest": 20},
        {"sku": "SKU-3300", "name": "垫片", "qty": 12, "suggest": 0},
    ]
    alerts = []
    for it in items:
        qty = int(it.get("qty", 0))
        if qty < threshold:
            alerts.append({
                "sku": it.get("sku"),
                "name": it.get("name"),
                "qty": qty,
                "suggest": it.get("suggest") or max(threshold - qty, 0),
                "level": "critical" if qty <= 0 else "warn",
            })
    alerts.sort(key=lambda x: (0 if x["level"] == "critical" else 1, x["qty"]))
    return alerts

def render_sidebar(alerts=None):
    alerts = alerts if alerts is not None else list_stock_alerts()
    lines = ["# 缺货预警", f"共 {len(alerts)} 项"]
    for a in alerts:
        lines.append(f"- [{a['level']}] {a['sku']} {a['name']}: 库存 {a['qty']} · 建议补货 {a['suggest']}")
    return "\\n".join(lines)

def ai_feature(ctx=None):
    """${(askOne || '缺货预警').slice(0, 60)}"""
    return {"ok": True, "sidebar": render_sidebar(), "alerts": list_stock_alerts()}

if __name__ == "__main__":
    print(render_sidebar())
`;
      } else if (entryJs) {
        files[entryJs] =
`/** ${dn} — 缺货预警侧边栏（Mock） */
const SAFE_STOCK = 10;
function listStockAlerts(items, threshold = SAFE_STOCK) {
  const data = items || [
    { sku: 'SKU-1001', name: '螺丝 M3', qty: 3, suggest: 50 },
    { sku: 'SKU-2044', name: '轴承 608', qty: 0, suggest: 20 },
    { sku: 'SKU-3300', name: '垫片', qty: 12, suggest: 0 }
  ];
  return data.filter(it => it.qty < threshold).map(it => ({
    ...it,
    suggest: it.suggest || Math.max(threshold - it.qty, 0),
    level: it.qty <= 0 ? 'critical' : 'warn'
  })).sort((a, b) => (a.level === 'critical' ? 0 : 1) - (b.level === 'critical' ? 0 : 1) || a.qty - b.qty);
}
function renderSidebar(alerts) {
  const list = alerts || listStockAlerts();
  return ['# 缺货预警', '共 ' + list.length + ' 项'].concat(
    list.map(a => '- [' + a.level + '] ' + a.sku + ' ' + a.name + ': 库存 ' + a.qty + ' · 建议补货 ' + a.suggest)
  ).join('\\n');
}
function aiFeature() {
  return { ok: true, sidebar: renderSidebar(), alerts: listStockAlerts() };
}
module.exports = Object.assign(module.exports || {}, { aiFeature, listStockAlerts, renderSidebar });
`;
      }
      files['README.md'] = `# ${dn}\n\n${ask || p.description || ''}\n\n## 功能\n\n- 侧边栏展示缺货 SKU\n- 低于安全库存高亮预警\n- 建议补货量与紧急程度排序\n`;
    }
    if (!files['README.md']) files['README.md'] = `# ${dn}\n\n${ask || p.description}\n`;
  }
  return files;
}

function refineSingleFile(file, code, ask) {
  const isPy = file.endsWith('.py');
  const c = isPy ? '#' : '//';
  const base = (code || '').replace(/\s*$/, '');
  const add = isPy
    ? `\n\n${c} AI: ${ask.trim().replace(/\n/g, ' ')}\ndef ai_feature():\n    """${ask.trim().slice(0, 60)}"""\n    return True\n`
    : `\n\n${c} AI: ${ask.trim().replace(/\n/g, ' ')}\nfunction aiFeature() {\n  // TODO: ${ask.trim().slice(0, 60)}\n  return true;\n}\n`;
  return base + add;
}

/**
 * Mock 多文件开发：基于模板 + 需求关键词。
 * mode: 'project' | 'refine'
 */
function mockMultiFileDev({ adapter, projectName, displayName, description, ask, existingFiles, focusPath, focusContent }) {
  const p = {
    name: projectName,
    displayName: displayName || projectName.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' '),
    description: description || ask || `${adapter.name} plugin`,
    vendorName: adapter.name
  };

  // 迭代 refine：修错误 / 单文件追加
  if (kw(ask, 'fix', '修复', 'error', '错误', 'SyntaxError') && focusPath && focusContent != null) {
    const fixed = tryFixContent(focusPath, focusContent, ask);
    const files = [{ path: focusPath, content: fixed, action: 'update' }];
    return { reply: formatFilesReply(files, '【Mock AI】已根据错误尝试修复：'), files };
  }

  // 有焦点文件且需求像“追加功能”，优先单文件 refine（E2E 兼容）
  const refineLike = focusPath && (kw(ask, '添加', '增加', 'append', '功能', '计数', 'command', '命令') || ask.length < 80);
  if (refineLike && existingFiles && existingFiles[focusPath] != null) {
    const content = refineSingleFile(focusPath, existingFiles[focusPath], ask);
    const out = [{ path: focusPath, content: content.endsWith('\n') ? content : content + '\n', action: 'update' }];
    // 仅当明确提到 settings/test/命令 时追加关联文件，避免误开多文件预览打断单文件流程
    if (kw(ask, 'setting', '配置', 'settings', 'test', '测试', 'command', '命令', 'cmd')) {
      const base = { ...existingFiles, [focusPath]: out[0].content };
      const enhanced = enhanceFromRequirement(adapter, base, p, ask);
      for (const [fp, fc] of Object.entries(enhanced)) {
        if (fp === focusPath) continue;
        const nc = fc.endsWith('\n') ? fc : fc + '\n';
        if (existingFiles[fp] === nc) continue;
        if (!existingFiles[fp] || existingFiles[fp] !== nc)
          out.push({ path: fp, content: nc, action: existingFiles[fp] ? 'update' : 'create' });
      }
    }
    return { reply: formatFilesReply(out, `【Mock AI】已根据需求更新 ${focusPath}：`), files: out };
  }

  // 全项目生成
  let base = templates.render(adapter, p);
  if (existingFiles && Object.keys(existingFiles).length) {
    base = { ...base, ...existingFiles };
  }
  const enhanced = enhanceFromRequirement(adapter, base, p, ask || description || '');
  const files = Object.entries(enhanced).map(([path, content]) => ({
    path,
    content: content.endsWith('\n') ? content : content + '\n',
    action: existingFiles && existingFiles[path] != null ? 'update' : 'create'
  }));
  return { reply: formatFilesReply(files, `【Mock AI】已为 ${adapter.name}（${adapter.family}）生成多文件项目：`), files };
}

function tryFixContent(file, content, ask) {
  let c = content;
  // 常见 E2E 坏语法：function (( {
  if (/function\s*\(\s*\(/.test(c) || /function\s*\(\s*\(\s*\{/.test(c)) {
    c = `// fixed by AI debug\ndocument.getElementById('b')?.addEventListener('click', () => {\n  document.body.append(' ✓');\n});\n`;
  }
  // 未闭合括号/引号的简单兜底
  if (/SyntaxError|Unexpected|py_compile/i.test(ask) || !c.trim()) {
    if (file.endsWith('.js')) c = `// AI fix for ${file}\nconsole.log('fixed');\n`;
    if (file.endsWith('.py')) c = `# AI fix for ${file}\ndef main():\n    print("fixed")\n`;
  }
  // 平衡简易花括号
  const opens = (c.match(/\{/g) || []).length, closes = (c.match(/\}/g) || []).length;
  if (opens > closes && file.endsWith('.js')) c = c.replace(/\s*$/, '') + '\n'.repeat(1) + '}'.repeat(opens - closes) + '\n';
  if (!c.includes('AI:') && !c.includes('fixed by AI')) {
    const isPy = file.endsWith('.py');
    c = c.replace(/\s*$/, '') + (isPy ? '\n# AI fix applied\n' : '\n// AI fix applied\n');
  }
  return c.endsWith('\n') ? c : c + '\n';
}

function mockDebugStructured(ctx) {
  const tips = [];
  const fixes = [];
  const fileErr = ctx.match(/✗\s+([^\n]+)\n([\s\S]*?)(?=\n\s*[✓✗\[]|$)/);
  // 收集带错误的文件
  const errFiles = [...ctx.matchAll(/✗\s+(\S+)/g)].map(m => m[1]);
  for (const f of errFiles) {
    tips.push(`文件 ${f} 构建失败，请检查语法（括号/缩进/引号是否闭合）。`);
    // 尝试从上下文取源码
    const srcM = ctx.match(new RegExp(`---\\s*${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)(?=\\n--- |\\n\\[|$)`));
    const src = srcM ? srcM[1].slice(0, 8000) : '';
    if (src || /popup\.js|function\s*\(/.test(ctx)) {
      const content = tryFixContent(f, src || "function (( {", ctx);
      fixes.push({ path: f, reason: `修复 ${f} 的语法错误`, content });
    }
  }
  if (/missing manifest field|缺少/.test(ctx)) {
    const field = (ctx.match(/missing manifest field:\s*(\S+)/) || [])[1];
    tips.push(`清单缺少必填字段${field ? ' ' + field : ''}，请按适配器 manifestRequired 补齐。`);
  }
  if (/console\.log/.test(ctx)) tips.push('发布前建议移除多余的 console.log 调试输出（警告级）。');
  if (!tips.length) tips.push('未发现阻断性问题，可以继续打包。');

  let reply = '【Mock AI 调试建议】\n- ' + tips.join('\n- ');
  if (fixes.length) {
    reply += '\n\n可一键应用的修复：';
    for (const fx of fixes) {
      reply += `\n### FIX: ${fx.path}\nreason: ${fx.reason}\n\`\`\`\n${fx.content.replace(/\n$/, '')}\n\`\`\`\n`;
    }
  }
  return { reply, tips, fixes };
}

function mockChatContextual({ message, vendor, files, selectedFile, selectedContent, lastBuild }) {
  const actions = [];
  let reply = `【Mock AI】当前上下文：厂商 ${vendor?.name || '未选'}（${vendor?.family || '-'}）`;
  if (files?.length) reply += `，项目文件 ${files.length} 个`;
  if (selectedFile) reply += `，已选 ${selectedFile}`;
  if (lastBuild) reply += `，上次构建 ${lastBuild.ok ? '成功' : '失败'}`;
  reply += `。\n\n收到：「${message.slice(0, 200)}」\n`;

  if (kw(message, '创建文件', 'create file', '新建文件')) {
    const pathM = message.match(/(?:文件|file)\s*[「"'`]?([a-zA-Z0-9_\-./]+)[」"'`]?/i) || message.match(/([a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-./]+)/);
    const fp = pathM ? pathM[1] : 'src/new-feature.js';
    actions.push({ type: 'create_file', path: fp, content: `// created by AI chat\nexport function feature() { return true; }\n` });
    reply += `\n将创建文件 ${fp}。确认后应用。\n### ACTION: create_file\n\`\`\`json\n${JSON.stringify({ path: fp, content: actions[0].content })}\n\`\`\`\n`;
  } else if (kw(message, '构建', 'build')) {
    actions.push({ type: 'run_build' });
    reply += '\n建议执行构建。\n### ACTION: run_build\n```json\n{}\n```\n';
  } else if (kw(message, '校验', 'validate', '验证')) {
    actions.push({ type: 'run_validate' });
    reply += '\n建议执行 AI 校验。\n### ACTION: run_validate\n```json\n{}\n```\n';
  } else if (kw(message, '打包', 'package')) {
    actions.push({ type: 'run_package' });
    reply += '\n建议执行打包。\n### ACTION: run_package\n```json\n{}\n```\n';
  } else if (kw(message, '修复', 'fix') && lastBuild && !lastBuild.ok) {
    reply += '\n检测到上次构建失败，请打开「AI 调试」面板或运行校验以获取一键修复。';
  } else if (kw(message, 'patch', '修改', '更新') && selectedFile) {
    const content = refineSingleFile(selectedFile, selectedContent || '', message);
    actions.push({ type: 'patch_file', path: selectedFile, content });
    reply += `\n将补丁应用到 ${selectedFile}。\n### ACTION: patch_file\n\`\`\`json\n${JSON.stringify({ path: selectedFile, content })}\n\`\`\`\n`;
  } else if (files?.length && kw(message, '添加', '增加', '实现', '支持', '迭代', 'add ', 'implement')) {
    actions.push({ type: 'agent_iterate', prompt: message });
    reply += '\n我可以按这个需求迭代：生成代码 → 构建 → 失败自动修复（写盘前自动建检查点，可撤销）。\n### ACTION: agent_iterate\n```json\n' + JSON.stringify({ prompt: message }) + '\n```\n';
  } else {
    reply += '当前为离线 Mock。可尝试：「创建文件 src/foo.js」「运行构建」「修复错误」，或在设置中配置 OpenAI 兼容 API（DeepSeek / OpenAI / Ollama）。';
  }
  return { reply, actions };
}

const DEV_SYSTEM = (a) => `[TASK:DEV] 你是 ${a.name} 插件开发专家（语言 ${a.language}，运行时 ${a.runtime}，清单 ${a.manifest}，家族 ${a.family}）。
根据用户需求生成或更新完整插件项目的多个文件。严格用以下格式输出每个文件：
### FILE: 相对路径
\`\`\`语言
完整文件内容
\`\`\`
必须包含清单、入口、README；适用时包含测试桩。不要省略已有文件中的必要部分。中文注释 OK。`;

const DEBUG_SYSTEM = `[TASK:DEBUG] 你是插件调试专家。分析构建/校验日志与代码，用中文给出简明问题列表。
若能直接修复某文件，额外输出：
### FIX: 相对路径
reason: 一句话原因
\`\`\`
完整修复后的文件内容
\`\`\``;

const CHAT_SYSTEM = `你是插件全生命周期 IDE 的中文 AI 助手。结合用户给出的厂商、项目文件、选中文件、构建结果作答。
若建议执行操作，用下列格式（可多条）：
### ACTION: create_file|patch_file|run_build|run_validate|run_package|agent_iterate
\`\`\`json
{ ... }
\`\`\`
create_file/patch_file 需 path 与 content；run_* 可为 {}；agent_iterate 需 prompt（触发 生成→构建→自动修复 循环）。`;

module.exports = {
  extractFiles, extractFixes, extractActions, formatFilesReply,
  mockMultiFileDev, mockDebugStructured, mockChatContextual, tryFixContent,
  refineSingleFile, enhanceFromRequirement, DEV_SYSTEM, DEBUG_SYSTEM, CHAT_SYSTEM
};
