// 无边框窗口的窗口控制按钮（最小化/最大化/关闭）
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('winCtl', {
  min: () => ipcRenderer.send('win', 'min'), max: () => ipcRenderer.send('win', 'max'), close: () => ipcRenderer.send('win', 'close'),
});
