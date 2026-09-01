/**
 * 发行渠道识别：区分 GitHub（NSIS）版与微软商店（MSIX）版
 * 商店版更新由微软商店托管，应用内不提供任何更新入口与开机自启能力
 */

/**
 * 是否为微软商店（MSIX）版本
 * process.windowsStore 由 Electron 在打包身份下自动置 true；
 * CQB_STORE=1 供开发模式模拟商店版行为
 */
export function isStoreBuild(): boolean {
  return process.windowsStore === true || process.env.CQB_STORE === '1';
}
