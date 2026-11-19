// 在 Linux 上造「假安装」：PATH 中放假的 code / blender / obsidian / maya，调用参数记录到 $FAKE_HOST_LOG
const fs = require('fs'), path = require('path'), os = require('os');
module.exports = function makeFakeHosts(root = fs.mkdtempSync(path.join(os.tmpdir(), 'fakehosts-'))) {
  const bin = path.join(root, 'bin'), log = path.join(root, 'calls.log'); fs.mkdirSync(bin, { recursive: true });
  const mk = (n, ver) => { const f = path.join(bin, n); fs.writeFileSync(f, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${ver}"; exit 0; fi\necho "${n} $*" >> "${log}"\n${n === 'code' ? 'echo "Extension installed"' : ''}\nexit 0\n`); fs.chmodSync(f, 0o755); };
  mk('code', '1.105.1\\nabc\\nx64'); mk('blender', 'Blender 4.5.3 LTS'); mk('obsidian', '1.9.10'); mk('maya', 'Maya 2026');
  const home = path.join(root, 'home'), cfg = path.join(home, '.config', 'obsidian'), vault = path.join(root, 'MyVault');
  fs.mkdirSync(cfg, { recursive: true }); fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'obsidian.json'), JSON.stringify({ vaults: { a1: { path: vault, ts: Date.now(), open: true } } }));
  const env = { PATH: bin + ':' + process.env.PATH, PLUGIN_IDE_FAKE_HOSTS: '1', XDG_CONFIG_HOME: path.join(home, '.config'), PLUGIN_IDE_HOME: home, FAKE_HOST_LOG: log };
  return { root, bin, log, vault, env, calls: () => { try { return fs.readFileSync(log, 'utf8'); } catch { return ''; } } };
};
