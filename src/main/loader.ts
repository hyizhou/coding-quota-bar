import type { Provider, ProviderConfig } from '../shared/types';
import { ZhipuProvider } from '../providers/zhipu';
import { MiniMaxProvider } from '../providers/minimax';
import { KimiProvider } from '../providers/kimi';
import buildConfig from '../../app.build';

/**
 * Provider 类映射
 */
const PROVIDER_CLASSES = {
  zhipu: ZhipuProvider,
  minimax: MiniMaxProvider,
  kimi: KimiProvider,
} as const;

/**
 * Provider 类型
 */
export type ProviderType = keyof typeof PROVIDER_CLASSES;

/**
 * 已加载的 Provider 实例
 */
export interface LoadedProvider {
  type: ProviderType;
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
   * 根据配置加载所有启用的 Provider
   */
  static loadProviders(providerConfigs: Record<string, ProviderConfig>): LoadedProvider[] {
    const availableKeys = new Set(getAvailableProviderKeys());
    const loaded: LoadedProvider[] = [];

    for (const [type, config] of Object.entries(providerConfigs)) {
      // 编译时未标记为 available 的直接跳过
      if (!availableKeys.has(type)) {
        continue;
      }

      // 用户未启用
      if (!config.enabled) {
        continue;
      }

      // 未配置 API Key 的跳过（无 key 无意义，不参与刷新和计算）
      if (!config.apiKey?.trim()) {
        continue;
      }

      // 检查 Provider 类是否存在
      const ProviderClass = PROVIDER_CLASSES[type as ProviderType];
      if (!ProviderClass) {
        console.warn(`[Loader] Unknown provider type: ${type}`);
        continue;
      }

      // 创建实例
      try {
        const instance = new ProviderClass();
        // 注入编译时配置的 baseUrl
        const buildEntry = buildConfig.providers.find(p => p.key === type);
        const providerConfig = {
          ...config,
          _baseUrl: buildEntry?.baseUrl || '',
        };
        loaded.push({
          type: type as ProviderType,
          instance,
          config: providerConfig,
        });
        console.log(`[Loader] Loaded provider: ${instance.name}`);
      } catch (error) {
        console.error(`[Loader] Failed to load provider ${type}:`, error);
      }
    }

    return loaded;
  }

  /**
   * 重新加载 Provider（配置更新时调用）
   */
  static reloadProviders(
    currentProviders: LoadedProvider[],
    newConfigs: Record<string, ProviderConfig>,
  ): LoadedProvider[] {
    return this.loadProviders(newConfigs);
  }
}
