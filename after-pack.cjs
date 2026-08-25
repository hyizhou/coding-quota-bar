// electron-builder afterPack hook
// 在 NSIS 打包前清理 win-unpacked 目录，缩减安装包体积：
//   1. 删 locales/*.pak：只保留 en-US + zh-CN（兜底 + 主语言）
//   2. 删 vk_swiftshader.dll / vk_swiftshader_icd.json：软件渲染兜底
//      现代 Windows 都有 GPU 加速，几乎用不上；万一用户机器无 GPU，
//      会出现渲染异常，但本工具栏 UI 极简，GPU 缺失概率极低。
// 收益：~58MB locales + ~5MB swiftshader ≈ 节省 60MB+
// 体积：82.4MB → 预计 ~22MB
//
// 参考：https://www.electron.build/configuration/configuration#afterpack
module.exports = async function (context) {
  const fs = require('node:fs/promises');
  const path = require('node:path');

  const appOutDir = context.appOutDir; // e.g. .../win-unpacked
  console.log(`[after-pack] cleaning ${appOutDir}`);

  // ---- 1. 删 locales ----
  const localesDir = path.join(appOutDir, 'locales');
  const KEEP = new Set(['en-US.pak', 'zh-CN.pak']);

  let removedLocales = 0;
  let savedBytes = 0;
  try {
    const files = await fs.readdir(localesDir);
    for (const f of files) {
      if (!f.endsWith('.pak')) continue;
      if (KEEP.has(f)) continue;
      const p = path.join(localesDir, f);
      const stat = await fs.stat(p);
      await fs.unlink(p);
      removedLocales += 1;
      savedBytes += stat.size;
    }
    console.log(
      `[after-pack] locales: removed ${removedLocales} files, saved ${(savedBytes / 1024 / 1024).toFixed(1)} MB`
    );
  } catch (err) {
    // 目录不存在也无所谓（electron-builder 可能略过）
    console.warn(`[after-pack] locales cleanup skipped: ${err.message}`);
  }

  // ---- 2. 删 SwiftShader（软件渲染兜底）----
  const swiftshaderFiles = ['vk_swiftshader.dll', 'vk_swiftshader_icd.json'];
  let removedSwiftshader = 0;
  for (const f of swiftshaderFiles) {
    const p = path.join(appOutDir, f);
    try {
      const stat = await fs.stat(p);
      await fs.unlink(p);
      removedSwiftshader += 1;
      savedBytes += stat.size;
    } catch {
      /* 文件可能不存在 */
    }
  }
  if (removedSwiftshader > 0) {
    console.log(`[after-pack] swiftshader: removed ${removedSwiftshader} files`);
  }

  console.log(
    `[after-pack] done, total saved ~${(savedBytes / 1024 / 1024).toFixed(1)} MB`
  );
};
