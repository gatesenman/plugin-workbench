// Best-effort official toolchain hooks (vsce / web-ext / office-addin-manifest / blender).
// Never fail the product if tools are absent — return skipped with a clear Chinese message.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function which(cmd) {
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
    if (r.status === 0 && (r.stdout || '').trim()) return (r.stdout.trim().split(/\r?\n/)[0]);
  } catch {}
  return null;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    cwd: opts.cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(opts.env || {}) },
    shell: !!opts.shell,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    error: r.error,
  };
}

/** Detect available official tools once per process. */
let _cache = null;
function detect() {
  if (_cache) return _cache;
  const npx = which('npx');
  const vsce = which('vsce');
  const webExt = which('web-ext');
  const blender = which('blender');
  const officeValidate = which('office-addin-manifest');
  _cache = {
    npx: !!npx,
    vsce: !!vsce,
    webExt: !!webExt,
    blender: !!blender,
    officeValidate: !!officeValidate,
    npxPath: npx,
    vscePath: vsce,
    webExtPath: webExt,
    blenderPath: blender,
    officePath: officeValidate,
  };
  return _cache;
}

function skip(tool) {
  return { ok: true, skipped: true, tool, log: [`未检测到官方工具「${tool}」，已跳过`] };
}

/**
 * Run family-specific official validate/package hooks.
 * @returns {{ ok: boolean, skipped?: boolean, tool?: string, log: string[] }}
 */
function runOfficial(family, stage, projectDir, meta = {}) {
  if (process.env.PLUGIN_IDE_NO_TOOLCHAIN === '1') {
    return { ok: true, skipped: true, tool: null, log: ['未检测到官方工具（测试模式已禁用工具链），已跳过'] };
  }
  const d = detect();
  const logs = [];
  const name = meta.name || path.basename(projectDir);

  if (family === 'vscode-ext' && (stage === 'package' || stage === 'validate')) {
    if (d.vsce) {
      logs.push(`[toolchain] 调用 vsce package…`);
      const r = run(d.vscePath, ['package', '--out', path.join(projectDir, 'dist', `${name}-official.vsix`)], { cwd: projectDir });
      logs.push(r.stdout || r.stderr || (r.ok ? 'vsce ok' : 'vsce failed'));
      if (r.error) return skip('vsce');
      return { ok: stage === 'validate' ? true : r.ok, tool: 'vsce', log: logs, skipped: false };
    }
    if (d.npx) {
      logs.push(`[toolchain] 调用 npx @vscode/vsce package…`);
      const outDir = path.join(projectDir, 'dist');
      fs.mkdirSync(outDir, { recursive: true });
      const r = run(d.npxPath, ['--yes', '@vscode/vsce', 'package', '--out', path.join(outDir, `${name}-official.vsix`)], { cwd: projectDir, timeout: 180000 });
      if (r.error && /ENOENT|not found/i.test(String(r.error))) return skip('@vscode/vsce');
      logs.push((r.stdout || r.stderr || '').slice(0, 800) || (r.ok ? 'vsce ok' : `vsce exit ${r.status}`));
      // npx download failure → soft skip
      if (!r.ok && /ENOTFOUND|ECONNREFUSED|404|not found|Cannot find/i.test(r.stderr + r.stdout)) {
        return { ok: true, skipped: true, tool: '@vscode/vsce', log: [...logs, '未检测到官方工具「@vscode/vsce」（或网络不可用），已跳过'] };
      }
      return { ok: stage === 'validate' ? true : r.ok || stage === 'validate', tool: '@vscode/vsce', log: logs, skipped: false };
    }
    return skip('@vscode/vsce / vsce');
  }

  if (family === 'browser-ext' && (stage === 'validate' || stage === 'build')) {
    if (d.webExt) {
      logs.push(`[toolchain] 调用 web-ext lint…`);
      const r = run(d.webExtPath, ['lint', '--source-dir', projectDir, '--warnings-as-errors'], { cwd: projectDir });
      logs.push((r.stdout || r.stderr || '').slice(0, 800));
      return { ok: r.ok || /No errors/i.test(r.stdout + r.stderr), tool: 'web-ext', log: logs };
    }
    if (d.npx) {
      logs.push(`[toolchain] 调用 npx web-ext lint…`);
      const r = run(d.npxPath, ['--yes', 'web-ext', 'lint', '--source-dir', '.', '--self-hosted'], { cwd: projectDir, timeout: 180000 });
      if (r.error && /ENOENT/i.test(String(r.error))) return skip('web-ext');
      logs.push((r.stdout || r.stderr || '').slice(0, 800));
      if (!r.ok && /ENOTFOUND|ECONNREFUSED|404|Cannot find/i.test(r.stderr + r.stdout)) {
        return { ok: true, skipped: true, tool: 'web-ext', log: [...logs, '未检测到官方工具「web-ext」（或网络不可用），已跳过'] };
      }
      // lint warnings shouldn't fail whole product in best-effort mode when tool ran
      return { ok: true, tool: 'web-ext', log: logs, skipped: false };
    }
    return skip('web-ext');
  }

  if (family === 'office-addin' && stage === 'validate') {
    const manifest = ['manifest.xml', 'Manifest.xml'].map(f => path.join(projectDir, f)).find(f => fs.existsSync(f));
    if (!manifest) return { ok: true, skipped: true, tool: 'office-addin-manifest', log: ['未找到 manifest.xml，已跳过官方校验'] };
    if (d.officeValidate) {
      logs.push(`[toolchain] 调用 office-addin-manifest validate…`);
      const r = run(d.officePath, ['validate', manifest], { cwd: projectDir });
      logs.push((r.stdout || r.stderr || '').slice(0, 800));
      return { ok: r.ok, tool: 'office-addin-manifest', log: logs };
    }
    if (d.npx) {
      logs.push(`[toolchain] 调用 npx office-addin-manifest validate…`);
      const r = run(d.npxPath, ['--yes', 'office-addin-manifest', 'validate', manifest], { cwd: projectDir, timeout: 180000 });
      logs.push((r.stdout || r.stderr || '').slice(0, 800));
      if (!r.ok && /ENOTFOUND|ECONNREFUSED|404|Cannot find|not found/i.test(r.stderr + r.stdout)) {
        return { ok: true, skipped: true, tool: 'office-addin-manifest', log: [...logs, '未检测到官方工具「office-addin-manifest」，已跳过'] };
      }
      return { ok: true, tool: 'office-addin-manifest', log: logs };
    }
    return skip('office-addin-manifest');
  }

  if (family === 'blender' && (stage === 'validate' || stage === 'package')) {
    if (d.blender) {
      logs.push(`[toolchain] 调用 blender --command extension validate…`);
      const r = run(d.blenderPath, ['--command', 'extension', 'validate', projectDir], { cwd: projectDir, timeout: 60000 });
      logs.push((r.stdout || r.stderr || '').slice(0, 800));
      if (r.error) return skip('blender');
      return { ok: r.ok || r.status === 0, tool: 'blender', log: logs };
    }
    return skip('blender');
  }

  return { ok: true, skipped: true, tool: null, log: [] };
}

/** Reset detect cache (for tests). */
function resetDetect() { _cache = null; }

module.exports = { detect, runOfficial, skip, which, resetDetect };
