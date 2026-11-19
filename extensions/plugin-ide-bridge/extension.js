// 内嵌 IDE 内置扩展：把生命周期命令接入命令面板，调用宿主后端 API
const vscode = require('vscode'), path = require('path');
function activate(ctx) {
  const out = vscode.window.createOutputChannel('Plugin IDE');
  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100); sb.text = '$(rocket) Plugin IDE'; sb.command = 'pluginIde.build'; sb.show();
  for (const st of ['build', 'validate', 'package', 'publish']) ctx.subscriptions.push(vscode.commands.registerCommand('pluginIde.' + st, async () => {
    const f = vscode.workspace.workspaceFolders?.[0]; if (!f) return vscode.window.showWarningMessage('请先打开插件项目');
    const r = await fetch(`${process.env.PLUGIN_IDE_API}/api/projects/${path.basename(f.uri.fsPath)}/${st}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: true }) });
    const j = await r.json(); out.appendLine((j.log || [j.error]).join('\n')); out.show(true);
    vscode.window.showInformationMessage(`Plugin IDE ${st}: ${j.ok ? '成功' : '失败'}`);
  }));
}
module.exports = { activate };
