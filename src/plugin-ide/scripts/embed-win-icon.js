#!/usr/bin/env node
/** Embed build/icon.ico into a Windows PE (.exe) as RT_GROUP_ICON / RT_ICON. No wine required. */
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

const exePath = process.argv[2];
const icoPath = process.argv[3] || path.join(__dirname, '..', 'build', 'icon.ico');
if (!exePath || !fs.existsSync(exePath)) {
  console.error('Usage: node scripts/embed-win-icon.js <app.exe> [icon.ico]');
  process.exit(1);
}
if (!fs.existsSync(icoPath)) {
  console.error('Missing icon:', icoPath);
  process.exit(1);
}

const exeBuf = fs.readFileSync(exePath);
const exe = ResEdit.NtExecutable.from(exeBuf, { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));

// Prefer replacing existing group; Electron default icon group is often 1 or 101
const existing = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
let groupId = existing.length ? existing[0].id : 1;
const lang = existing.length ? existing[0].lang : 1033;

ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  groupId,
  lang,
  iconFile.icons.map((item) => item.data)
);

// Also set basic version strings so Explorer shows product name
try {
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (viList.length) {
    const vi = viList[0];
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      FileDescription: '插件工坊 PluginWorkbench',
      ProductName: 'PluginWorkbench',
      CompanyName: 'PluginWorkbench',
      LegalCopyright: 'PluginWorkbench',
      InternalName: 'PluginWorkbench',
      OriginalFilename: path.basename(exePath),
    });
    vi.outputToResourceEntries(res.entries);
  }
} catch (e) {
  console.warn('version info skip:', e.message);
}

res.outputResource(exe);
const out = Buffer.from(exe.generate());
fs.writeFileSync(exePath, out);
console.log('Embedded icon into', exePath, `(groupId=${groupId}, icons=${iconFile.icons.length}, bytes=${out.length})`);
