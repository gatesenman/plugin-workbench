#!/usr/bin/env node
const fs = require('fs');
const ResEdit = require('resedit');
const exePath = process.argv[2];
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const icons = res.entries.filter((e) => e.type === 3); // RT_ICON = 3, RT_GROUP_ICON = 14
const groups14 = res.entries.filter((e) => e.type === 14);
console.log(JSON.stringify({
  file: exePath,
  size: fs.statSync(exePath).size,
  iconGroups: groups.length,
  rt_group_icon: groups14.length,
  rt_icon: icons.length,
  groupIds: groups.map((g) => g.id),
  iconSizes: groups.flatMap((g) => g.icons.map((i) => `${i.width}x${i.height}`)),
}, null, 2));
if (!groups.length || !icons.length) process.exit(2);
