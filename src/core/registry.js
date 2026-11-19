const fs = require('fs'), path = require('path');
const FAMILIES = require('./families');
const DOCS = { 'visual-studio-code':'https://code.visualstudio.com/api','chrome':'https://developer.chrome.com/docs/extensions','firefox':'https://extensionworkshop.com','edge':'https://learn.microsoft.com/microsoft-edge/extensions-chromium/','safari':'https://developer.apple.com/safari/extensions/','blender':'https://docs.blender.org/manual/en/latest/advanced/extensions/','photoshop':'https://developer.adobe.com/photoshop/uxp/','figma':'https://www.figma.com/plugin-docs/','obsidian':'https://docs.obsidian.md','wordpress':'https://developer.wordpress.org/plugins/','shopify':'https://shopify.dev/docs/apps','slack':'https://api.slack.com','notion':'https://developers.notion.com','jira':'https://developer.atlassian.com','unity-editor':'https://docs.unity3d.com/Manual/','unreal-engine':'https://dev.epicgames.com/documentation/unreal-engine','sketch':'https://developer.sketch.com','revit':'https://aps.autodesk.com/developer/overview/revit','autocad':'https://aps.autodesk.com/developer/overview/autocad','maya':'https://help.autodesk.com/view/MAYAUL/2025/ENU/','houdini':'https://www.sidefx.com/docs/houdini/','cinema-4d':'https://developers.maxon.net','word':'https://learn.microsoft.com/office/dev/add-ins/','excel':'https://learn.microsoft.com/office/dev/add-ins/' };
const slug = s => s.toLowerCase().replace(/\([^)]*\)/g, m => m).normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'');
const CUSTOM_FILE = () => path.join(process.env.PLUGIN_IDE_DATA || path.join(require('os').homedir(), '.plugin-ide'), 'custom-vendors.json');

function loadBuiltin() {
  const txt = fs.readFileSync(path.join(__dirname, 'vendors.data.txt'), 'utf8');
  const out = [], seen = new Set();
  for (const line of txt.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [family, category, company, names] = line.split('|');
    for (const name of names.split(',').map(s => s.trim()).filter(Boolean)) {
      let id = slug(name); if (seen.has(id)) id = slug(company + '-' + name);
      if (seen.has(id)) continue; seen.add(id);
      out.push({ id, name, company, category, family, docs: DOCS[id] || FAMILIES[family].docs, builtin: true });
    }
  }
  return out;
}
let BUILTIN = loadBuiltin();
function loadCustom() { try { return JSON.parse(fs.readFileSync(CUSTOM_FILE(), 'utf8')); } catch { return []; } }
function all() { return [...BUILTIN, ...loadCustom()]; }
function resolve(id) {
  const v = all().find(x => x.id === id); if (!v) return null;
  const base = FAMILIES[v.family] || FAMILIES.generic;
  return { ...base, ...v, ...(v.overrides || {}) };
}
function addCustom(def) {
  const list = loadCustom().filter(x => x.id !== def.id);
  list.push({ ...def, builtin: false, custom: true });
  fs.mkdirSync(path.dirname(CUSTOM_FILE()), { recursive: true });
  fs.writeFileSync(CUSTOM_FILE(), JSON.stringify(list, null, 2));
  return resolve(def.id);
}
module.exports = { all, resolve, addCustom, FAMILIES, slug };
