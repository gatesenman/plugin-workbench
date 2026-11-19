// Electron 桌面外壳：启动后端 + 内嵌代码编辑器，加载宿主 UI
const { app, BrowserWindow, Menu, shell, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
process.env.PLUGIN_IDE_NODE = process.execPath;
if (process.env.PLUGIN_IDE_HEADLESS_GPU !== '0') app.disableHardwareAcceleration();

// Windows 任务栏分组 + 通知；必须在 ready 前设置
if (process.platform === 'win32') {
  app.setAppUserModelId('com.pluginworkbench.app');
}

/** 解析应用图标：开发态用 build/，打包后优先 resources、其次 app 内拷贝 */
function resolveAppIcon() {
  const cands = [
    path.join(APP_ROOT, 'build', 'icon.png'),
    path.join(APP_ROOT, 'build', 'icon.ico'),
    path.join(APP_ROOT, 'ui', 'assets', 'app-icon.png'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.png'),
    path.join(process.resourcesPath || '', 'icon.ico'),
  ];
  for (const p of cands) {
    if (p && fs.existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return { path: p, image: img };
      } catch {}
    }
  }
  return null;
}

let handle;
app.whenReady().then(async () => {
  const iconInfo = resolveAppIcon();
  const frameless = process.env.PLUGIN_IDE_FRAME !== '1';
  const winOpts = {
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    title: '插件工坊',
    backgroundColor: '#f8fafc',
    frame: !frameless,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: frameless ? path.join(__dirname, 'preload.js') : undefined,
    },
  };
  if (iconInfo) winOpts.icon = iconInfo.image;
  const win = new BrowserWindow(winOpts);
  if (iconInfo && process.platform === 'darwin') app.dock?.setIcon(iconInfo.image);

  ipcMain.on('win', (_e, a) => {
    if (a === 'min') win.minimize();
    else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (a === 'close') win.close();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }, { role: 'quit', label: '退出' }] },
    { label: '帮助', submenu: [{ label: '关于插件工坊', click: () => shell.openExternal('https://github.com/coder/code-server') }] },
  ]));

  win.once('ready-to-show', () => win.show());
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<body style="background:#f8fafc;color:#334155;font-family:Segoe UI,PingFang SC,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;gap:8px">' +
    '<div style="width:40px;height:40px;border:3px solid #e2e8f0;border-top-color:#4f46e5;border-radius:50%;animation:s 0.8s linear infinite"></div>' +
    '<style>@keyframes s{to{transform:rotate(360deg)}}</style>' +
    '<h2 style="font-weight:600;font-size:16px;margin:0">插件工坊</h2>' +
    '<p style="color:#888;margin:0;font-size:12px">正在启动…</p></body>'
  ));
  const { start } = require(path.join(APP_ROOT, 'src', 'server', 'server.js'));
  handle = await start({ port: 0, appRoot: APP_ROOT });
  await win.loadURL(`http://127.0.0.1:${handle.port}/`);
});
app.on('before-quit', () => { if (handle) handle.close(); });
app.on('window-all-closed', () => app.quit());
