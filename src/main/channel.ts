/**
 * 发行渠道识别与数据隔离：区分 GitHub（NSIS）版与微软商店（MSIX）版
 * - 商店版更新由微软商店托管，应用内不提供任何更新入口与开机自启能力
 * - 商店版 userData 重定向到包专属目录，与 NSIS 版完全分离，卸载随包清除
 */
import { app } from 'electron';
import * as path from 'node:path';

/**
 * 是否为微软商店（MSIX）版本
 * process.windowsStore 由 Electron 在打包身份下自动置 true；
 * CQB_STORE=1 供开发模式模拟商店版行为
 */
export function isStoreBuild(): boolean {
  return process.windowsStore === true || process.env.CQB_STORE === '1';
}

/**
 * 从可执行文件路径解析 MSIX 包族名（PFN）
 * 安装目录形如 C:\Program Files\WindowsApps\<Name>_<ver>_<arch>__<hash>\...
 * PFN = <Name>_<hash>
 */
function getPackageFamilyName(): string {
  let dir = path.dirname(process.execPath);
  for (;;) {
    const m = path.basename(dir).match(/^(.+)_(\d+(?:\.\d+){3})_([A-Za-z0-9]+)__(.+)$/);
    if (m) return `${m[1]}_${m[4]}`;
    dir = path.dirname(dir);
  }
}

/**
 * 商店版数据隔离：userData 重定向到包专属目录
 * %LOCALAPPDATA%\Packages\<PFN>\LocalState\Roaming\<应用名>
 * 该目录随包生命周期管理，卸载商店版即整体清除，不留残留；
 * 仅真实 MSIX 环境（process.windowsStore）启用，CQB_STORE=1 开发模拟不改变数据路径
 */
export function applyStoreDataIsolation(): void {
  if (process.windowsStore !== true) return;

  const isolated = path.join(
    process.env.LOCALAPPDATA!,
    'Packages',
    getPackageFamilyName(),
    'LocalState',
    'Roaming',
    'coding-quota-bar'
  );
  app.setPath('userData', isolated);
  app.setPath('crashDumps', path.join(isolated, 'CrashDumps'));
}
