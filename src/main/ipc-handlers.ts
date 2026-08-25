import { ipcMain, app, shell, dialog } from 'electron';
import { writeFile, readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { ConfigManager } from './config';
import type { Scheduler } from './scheduler';
import type { ConcurrencyTestConfig, ProviderTypeConfig, WindowPinMode } from '../shared/types';
import { ConcurrencyTestEngine } from './concurrency-test';
import { DeepSeekProvider } from '../providers/deepseek';
import { MiMoProvider } from '../providers/mimo';
import { ZhipuProvider } from '../providers/zhipu';
import { MiniMaxProvider } from '../providers/minimax';
import { CodexProvider } from '../providers/codex';
import { OpenCodeGoProvider } from '../providers/opencode-go';
import { getAvailableProviderKeys } from './loader';
import { buildUsageData } from './data-transform';
import { isSafeExternalUrl } from './utils/security';
import buildConfig from '../../app.build';
import type { Provider, ProviderConfig } from '../shared/types';

/**
 * Provider class map for test-connection
 */
const PROVIDER_CLASSES: Record<string, new () => Provider> = {
  zhipu: ZhipuProvider,
  minimax: MiniMaxProvider,
  deepseek: DeepSeekProvider,
  mimo: MiMoProvider,
  codex: CodexProvider,
  'opencode-go': OpenCodeGoProvider,
};
import {
  showPopupWindow,
  getPopupWindow,
  setWindowPinMode,
  getPopupMode,
  notifyHoverState,
  destroyPopupWindow,
  showFeedbackWindow,
} from './popup-manager';
import { deepseekWebLogin, deepseekWebLogout } from './deepseek-auth';
import { mimoWebLogin, mimoWebLogout } from './mimo-auth';
import { checkForUpdate, downloadUpdate, getUpdateStatus } from './update-manager';

let _getConfigManager: () => ConfigManager | null = () => null;
let _getScheduler: () => Scheduler | null = () => null;

export function setIpcHandlersDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getScheduler: () => Scheduler | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getScheduler = deps.getScheduler;
}

/**
 * 设置 IPC 通信处理器
 */
export function setupIpcHandlers(): void {
  // 监听 renderer 的鼠标悬浮状态
  ipcMain.on('popup-hover-state', (_, hovering: boolean) => {
    notifyHoverState(hovering);
  });

  // 渲染进程准备好后显示弹窗
  ipcMain.on('show-popup', () => {
    showPopupWindow('pinned');
  });

  // 窗口固定状态切换（三态：不固定 / 固定置顶 / 固定不置顶）
  ipcMain.on('set-window-pinned', (_, mode: WindowPinMode) => {
    if (mode !== 'unpinned' && getPopupMode() === 'hover') {
      showPopupWindow('pinned');
    }
    setWindowPinMode(mode);
    getPopupWindow()?.webContents.send('window-pinned-state', mode);
  });

  // 获取当前用量数据
  ipcMain.handle('get-usage-data', () => {
    return buildUsageData();
  });

  // 手动刷新
  ipcMain.handle('refresh-usage', async () => {
    const scheduler = _getScheduler();
    if (!scheduler) return null;
    await scheduler.refresh();
    return buildUsageData();
  });

  // 获取配置（脱敏：apiKey 只传前4后4，webToken 只传布尔值）
  ipcMain.handle('get-config', () => {
    const config = _getConfigManager()?.getConfig();
    if (!config) return null;
    const sanitized = JSON.parse(JSON.stringify(config)) as typeof config;
    for (const provider of Object.values(sanitized.providers)) {
      const accounts = (provider as any).accounts;
      if (!Array.isArray(accounts)) continue;
      for (const account of accounts) {
        if (account.apiKey && account.apiKey.length > 8) {
          account.apiKey = `${account.apiKey.slice(0, 4)}${'*'.repeat(account.apiKey.length - 8)}${account.apiKey.slice(-4)}`;
        } else if (account.apiKey) {
          account.apiKey = '*'.repeat(account.apiKey.length);
        }
        (account as any).hasWebToken = !!(account as any).webToken;
        delete (account as any).webToken;
        delete (account as any).webUserAgent;
      }
    }
    return { ...sanitized, isPackaged: app.isPackaged, updateStatus: getUpdateStatus() };
  });

  // 获取可用的 provider 列表（编译时配置）
  ipcMain.handle('get-available-providers', () => {
    return getAvailableProviderKeys();
  });

  // 更新配置
  ipcMain.handle('update-config', async (_, updates) => {
    const configManager = _getConfigManager();
    if (!configManager) return null;
    await configManager.updateConfig(updates);
    return configManager.getConfig();
  });

  // 获取应用版本号
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // 检查更新
  ipcMain.handle('check-for-update', async () => {
    await checkForUpdate();
  });

  // 下载更新
  ipcMain.handle('download-update', async () => {
    await downloadUpdate();
  });

  // 重启并安装更新
  ipcMain.handle('quit-and-install', () => {
    destroyPopupWindow();
    autoUpdater.quitAndInstall();
  });

  // 用系统浏览器打开链接（白名单校验，防止 XSS 触发任意 file://）
  ipcMain.handle('open-external', async (_, url: string) => {
    if (!isSafeExternalUrl(url)) {
      console.warn('[Security] Blocked open-external for unsafe URL:', url.slice(0, 80));
      return { success: false, error: 'URL not allowed' };
    }
    await shell.openExternal(url);
    return { success: true };
  });

  // 并发测试：启动
  ipcMain.handle('concurrency-test-start', async (_, config: ConcurrencyTestConfig) => {
    const cfg = _getConfigManager()?.getConfig();
    if (!cfg) throw new Error('Config not loaded');

    const providerConfig = cfg.providers[config.providerKey] as ProviderTypeConfig | undefined;
    const account = providerConfig?.accounts?.find(a => a.enabled && a.apiKey?.trim());
    if (!account?.apiKey) throw new Error('No API key configured');

    return ConcurrencyTestEngine.run(config, account.apiKey, (info) => {
      const popup = getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('concurrency-test-progress', info);
      }
    }, (info) => {
      const popup = getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('concurrency-test-stream', info);
      }
    }, (info) => {
      const popup = getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('concurrency-test-first-content', info);
      }
    });
  });

  // 并发测试：获取历史记录
  ipcMain.handle('concurrency-test-history', async (_, providerKey: string) => {
    return ConcurrencyTestEngine.loadHistory(providerKey);
  });

  // 并发测试：删除历史记录
  ipcMain.handle('concurrency-test-delete', async (_, providerKey: string, id: string) => {
    await ConcurrencyTestEngine.deleteResult(providerKey, id);
  });

  // 打开反馈群窗口
  ipcMain.on('show-feedback', () => {
    console.log('[Feedback] show-feedback received');
    try {
      showFeedbackWindow();
    } catch (e) {
      console.error('[Feedback] Error:', e);
    }
  });

  // DeepSeek 网页登录
  ipcMain.handle('deepseek-web-login', async (_, accountId: string) => {
    return await deepseekWebLogin(accountId);
  });

  // DeepSeek 网页登出
  ipcMain.handle('deepseek-web-logout', async (_, accountId: string) => {
    await deepseekWebLogout(accountId);
  });

  // DeepSeek 按月获取模型历史数据
  ipcMain.handle('deepseek-fetch-month-usage', async (_, accountId: string, year: number, month: number) => {
    const scheduler = _getScheduler() as any;
    const loaded = scheduler?.providers as import('./loader').LoadedProvider[] | undefined;
    const empty = { tokens: [], costs: [] };
    if (!loaded) return empty;
    const provider = loaded.find((p: any) => p.accountId === accountId && p.instance instanceof DeepSeekProvider);
    if (!provider) return empty;
    try {
      return await (provider.instance as DeepSeekProvider).fetchMonthModelHistory(provider.config, month, year);
    } catch (e) {
      console.warn('[DeepSeek] Failed to fetch month usage:', e);
      return empty;
    }
  });

  // MiMo 网页登录
  ipcMain.handle('mimo-web-login', async (_, accountId: string) => {
    return await mimoWebLogin(accountId);
  });

  // MiMo 网页登出
  ipcMain.handle('mimo-web-logout', async (_, accountId: string) => {
    await mimoWebLogout(accountId);
  });

  // MiMo 按月获取模型历史数据
  ipcMain.handle('mimo-fetch-month-usage', async (_, accountId: string, year: number, month: number) => {
    const scheduler = _getScheduler() as any;
    const loaded = scheduler?.providers as import('./loader').LoadedProvider[] | undefined;
    if (!loaded) return [];
    const provider = loaded.find((p: any) => p.accountId === accountId && p.instance instanceof MiMoProvider);
    if (!provider) return [];
    try {
      return await (provider.instance as MiMoProvider).fetchMonthModelHistory(provider.config, month, year);
    } catch (e) {
      console.warn('[MiMo] Failed to fetch month usage:', e);
      return [];
    }
  });

  /**
   * 测试 provider 连接：调一次 fetchUsage 验证有效性
   * 入参：{ providerKey, accountId?, apiKey?, authMode?, webToken?, webUserAgent? }
   *  - 传 accountId：用 configManager 里保存的（明文）key 测试
   *  - 传 apiKey：直接用新 key 测试（无需先保存）
   * 返回：{ ok, error?, latencyMs, sample? }
   */
  ipcMain.handle('test-provider-connection', async (_, params: {
    providerKey: string;
    accountId?: string;
    apiKey?: string;
    authMode?: 'apikey' | 'weblogin';
    webToken?: string;
    webUserAgent?: string;
  }): Promise<{ ok: boolean; error?: string; latencyMs: number; sample?: { used: number; total: number; level: string } }> => {
    const start = Date.now();
    const ProviderClass = PROVIDER_CLASSES[params.providerKey];
    if (!ProviderClass) {
      return { ok: false, error: `Unknown provider: ${params.providerKey}`, latencyMs: 0 };
    }

    const buildEntry = buildConfig.providers.find((p: typeof buildConfig.providers[number]) => p.key === params.providerKey);

    // 解析最终使用的 key / token
    let apiKey = params.apiKey || '';
    let webToken = params.webToken;
    let webUserAgent = params.webUserAgent;
    if (params.accountId) {
      const cfg = _getConfigManager()?.getConfig();
      const providerCfg = cfg?.providers?.[params.providerKey] as ProviderTypeConfig | undefined;
      const account = providerCfg?.accounts?.find((a: any) => a.id === params.accountId);
      if (account) {
        if (!apiKey) apiKey = account.apiKey || '';
        if (!webToken) webToken = account.webToken;
        if (!webUserAgent) webUserAgent = account.webUserAgent;
      }
    }

    const config: ProviderConfig = {
      enabled: true,
      apiKey,
      _baseUrl: buildEntry?.baseUrl || '',
      authMode: params.authMode || 'apikey',
      webToken,
      webUserAgent,
      accountId: params.accountId,
    };

    try {
      const instance = new ProviderClass();
      // 8s 超时：网络卡死时不让按钮永远转圈
      let timeoutHandle: NodeJS.Timeout | undefined
      const result = await Promise.race([
        instance.fetchUsage(config),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('连接超时（8s）')), 8000)
        }),
      ]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      })
      return {
        ok: true,
        latencyMs: Date.now() - start,
        sample: {
          used: result.used,
          total: result.total,
          level: result.level || '',
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cleanMsg = msg.replace(/^\[[\w-]+\]\s*/, '');
      return { ok: false, error: cleanMsg, latencyMs: Date.now() - start };
    }
  });

  /**
   * === Tier 2: 导出配置 ===
   * sanitize=true（默认）：脱敏 API Key（保留前 4 后 4）+ 删除 webToken/webUserAgent
   * sanitize=false：包含完整 key（用于本地备份、跨设备迁移）
   * 用户在对话框选保存位置
   */
  ipcMain.handle('export-config', async (_, options: { sanitize?: boolean } = {}): Promise<{ ok: boolean; path?: string; error?: string }> => {
    const config = _getConfigManager()?.getConfig();
    if (!config) return { ok: false, error: 'No config to export' };

    const sanitize = options.sanitize !== false;
    const exportData = JSON.parse(JSON.stringify(config)) as typeof config;
    if (sanitize) {
      for (const provider of Object.values(exportData.providers)) {
        const accounts = (provider as any).accounts;
        if (!Array.isArray(accounts)) continue;
        for (const account of accounts) {
          if (account.apiKey) {
            if (account.apiKey.length > 8) {
              account.apiKey = `${account.apiKey.slice(0, 4)}${'*'.repeat(Math.max(4, account.apiKey.length - 8))}${account.apiKey.slice(-4)}`;
            } else if (account.apiKey) {
              account.apiKey = '*'.repeat(account.apiKey.length);
            }
          }
          delete account.webToken;
          delete account.webUserAgent;
        }
      }
      // 加上元信息：脱敏标记 + 导出时间 + 应用版本
      (exportData as any)._exportMeta = {
        sanitized: true,
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
      };
    } else {
      (exportData as any)._exportMeta = {
        sanitized: false,
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        warning: 'Contains plaintext API keys. Keep this file secure.',
      };
    }

    try {
      const result = await dialog.showSaveDialog({
        title: '导出配置',
        defaultPath: `coding-quota-bar-config-${new Date().toISOString().slice(0, 10)}${sanitize ? '' : '-FULL'}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, error: '已取消' };
      await writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf8');
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * === Tier 2: 导入配置 ===
   * 用户在对话框选文件 → 校验结构 → 弹确认（包含覆盖/合并选项）→ 写入
   * 简化版：直接覆盖（用户主动操作，覆盖前弹确认）
   */
  ipcMain.handle('import-config', async (): Promise<{ ok: boolean; canceled?: boolean; config?: any; error?: string; isSanitized?: boolean }> => {
    try {
      const result = await dialog.showOpenDialog({
        title: '导入配置',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
      const filePath = result.filePaths[0];
      const content = await readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      if (!data.providers || typeof data.providers !== 'object') {
        return { ok: false, error: '文件格式错误：缺少 providers 字段' };
      }
      const isSanitized = (data._exportMeta as any)?.sanitized === true;
      // 返回原始数据让渲染层弹确认；不直接覆盖
      return { ok: true, config: data, isSanitized };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * === Tier 2: 确认导入（弹了"确认覆盖"对话框后调用）===
   */
  ipcMain.handle('confirm-import-config', async (_, data: any): Promise<{ ok: boolean; error?: string }> => {
    const configManager = _getConfigManager();
    if (!configManager) return { ok: false, error: 'ConfigManager 未初始化' };
    try {
      // 提取可写字段
      const updates: any = {}
      if (data.providers) updates.providers = data.providers
      if (data.refreshInterval != null) updates.refreshInterval = data.refreshInterval
      if (data.autoStart != null) updates.autoStart = data.autoStart
      if (data.popupTrigger != null) updates.popupTrigger = data.popupTrigger
      if (data.memorySavingMode != null) updates.memorySavingMode = data.memorySavingMode
      if (data.rememberPopupPosition != null) updates.rememberPopupPosition = data.rememberPopupPosition
      if (data.showEstimatedCost != null) updates.showEstimatedCost = data.showEstimatedCost
      if (data.language != null) updates.language = data.language
      if (data.trayDisplayRule != null) updates.trayDisplayRule = data.trayDisplayRule
      if (data.autoCheckUpdate != null) updates.autoCheckUpdate = data.autoCheckUpdate
      if (data.display != null) updates.display = data.display
      await configManager.updateConfig(updates)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  });

  /**
   * === Tier 3: 诊断面板 ===
   * - get-config-path: 返回配置文件绝对路径
   * - ping-all-providers: 并发测试所有启用的 provider（用已保存 key）
   */
  ipcMain.handle('get-config-path', async (): Promise<string> => {
    try {
      return _getConfigManager()?.getConfigPath?.() ?? ''
    } catch {
      return ''
    }
  })

  ipcMain.handle('reload-config', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await _getConfigManager()?.reload?.()
      // 通知 scheduler 重新加载
      _getScheduler()?.refresh?.()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('open-config-folder', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const configPath = _getConfigManager()?.getConfigPath?.() ?? ''
      if (!configPath) return { ok: false, error: '未找到配置文件路径' }
      // 用 shell 打开所在目录
      const { shell } = await import('electron')
      await shell.showItemInFolder(configPath)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * === Tier 3: 错误日志 ===
   * 渲染层上报 error/unhandledrejection → 主进程追加到 log 文件
   * 诊断页 "查看日志" 按钮读取最近 200 行
   * log 文件: <userData>/renderer-errors.log
   */
  const RENDERER_LOG = join(app.getPath('userData'), 'renderer-errors.log')

  /**
   * 写 log 前 redact 敏感字段，防止 console.error('Failed:', apiKey)
   * 这种开发误用把明文 key 写进用户本地 log 文件
   * 规则：1) 替换 32+ 字符 hex 串为 ***；2) 替换 sk-xxx 格式为 ***；
   *       3) 替换 Bearer xxx 为 ***；4) 替换 key=xxx / apiKey: "xxx" 形式
   */
  function redactSensitive(s: string): string {
    return s
      .replace(/[0-9a-fA-F]{32,}/g, '[REDACTED-hex]')
      .replace(/sk-[a-zA-Z0-9_\-]{20,}/g, '[REDACTED-sk]')
      .replace(/Bearer [a-zA-Z0-9_\-\.]{20,}/g, 'Bearer [REDACTED]')
      .replace(/(api[Kk]ey|webToken|password|secret|token|key)['"]?\s*[:=]\s*['"]?[^,;\s}"']{16,}/g, '$1=[REDACTED]')
  }

  ipcMain.on('renderer-error', (_, payload: { message: string; stack?: string; source?: string }) => {
    const safePayload = {
      ts: new Date().toISOString(),
      source: payload.source,
      message: redactSensitive(payload.message ?? ''),
      stack: payload.stack ? redactSensitive(payload.stack) : undefined,
    }
    const line = JSON.stringify(safePayload) + '\n'
    appendFile(RENDERER_LOG, line, 'utf8').catch(e => console.error('[Log] failed:', e))
  })

  ipcMain.handle('get-renderer-log', async (): Promise<{ path: string; tail: string[] }> => {
    try {
      const content = await readFile(RENDERER_LOG, 'utf8')
      const lines = content.split('\n').filter(Boolean)
      return { path: RENDERER_LOG, tail: lines.slice(-200) }
    } catch {
      return { path: RENDERER_LOG, tail: [] }
    }
  })

  ipcMain.handle('open-renderer-log', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await shell.openPath(RENDERER_LOG)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
