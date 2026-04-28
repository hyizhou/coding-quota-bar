import type { Provider, ProviderConfig, ProviderTypeConfig } from '../shared/types';
import { ZhipuProvider } from '../providers/zhipu';
import { MiniMaxProvider } from '../providers/minimax';
import { KimiProvider } from '../providers/kimi';
import { DeepSeekProvider } from '../providers/deepseek';
import buildConfig from '../../app.build';

/**
 * Provider 类映射
 */
const PROVIDER_CLASSES = {
  zhipu: ZhipuProvider,
  minimax: MiniMaxProvider,
  kimi: KimiProvider,
  deepseek: DeepSeekProvider,
} as const;

/**
 * Provider 类型
 */
export type ProviderType = keyof typeof PROVIDER_CLASSES;

/**
 * 已加载的 Provider 实例（每个账户一个）
 */
export interface LoadedProvider {
  type: ProviderType;
  accountId: string;   // 稳定账户 ID（如 "a3f1b2c4"）
  instance: Provider;
  config: ProviderConfig;
}

/**
 * 从编译时配置获取可用的 provider key 列表
 */
export function getAvailableProviderKeys(): string[] {
  return buildConfig.providers
    .filter(p => p.available)
    .map(p => p.key);
}

/**
 * Provider 加载器
 * 根据配置加载启用的 Provider（仅限编译时标记为 available 的）
 */
export class ProviderLoader {
  /**
   * 根据配置加载所有启用的 Provider（支持多账户）
   */
  static loadProviders(providerConfigs: Record<string, ProviderTypeConfig>): LoadedProvider[] {
    const availableKeys = new Set(getAvailableProviderKeys());
    const loaded: LoadedProvider[] = [];

    for (const [type, providerConfig] of Object.entries(providerConfigs)) {
      // 编译时未标记为 available 的直接跳过
      if (!availableKeys.has(type)) {
        continue;
      }

      // 检查 Provider 类是否存在
      const ProviderClass = PROVIDER_CLASSES[type as ProviderType];
      if (!ProviderClass) {
        console.warn(`[Loader] Unknown provider type: ${type}`);
        continue;
      }

      const buildEntry = buildConfig.providers.find(p => p.key === type);

      // 遍历该 provider 下的所有账户
      for (const account of providerConfig.accounts) {
        // 用户未启用
        if (!account.enabled) {
          continue;
        }

        // 按认证模式检查必要凭证
        const authMode = account.authMode || 'apikey';
        if (authMode === 'apikey' && !account.apiKey?.trim()) {
          continue;
        }
        if (authMode === 'weblogin' && !account.webToken?.trim()) {
          continue;
        }

        try {
          const instance = new ProviderClass();
          loaded.push({
            type: type as ProviderType,
            accountId: account.id,
            instance,
            config: {
              enabled: true,
              apiKey: account.apiKey,
              _baseUrl: buildEntry?.baseUrl || '',
              authMode,
              webToken: account.webToken,
              webUserAgent: account.webUserAgent,
              accountId: account.id,
              ...(account.budget != null ? { budget: account.budget } : {}),
            },
          });
          console.log(`[Loader] Loaded provider: ${instance.name} (${account.label || account.id})`);
        } catch (error) {
          console.error(`[Loader] Failed to load provider ${type}:`, error);
        }
      }
    }

    return loaded;
  }

  /**
   * 重新加载 Provider（配置更新时调用）
   */
  static reloadProviders(
    currentProviders: LoadedProvider[],
    newConfigs: Record<string, ProviderTypeConfig>,
  ): LoadedProvider[] {
    return this.loadProviders(newConfigs);
  }
}
