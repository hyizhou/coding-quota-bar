import type { Provider, ProviderConfig } from '../shared/types';
import { ZhipuProvider } from '../providers/zhipu';
import { MiniMaxProvider } from '../providers/minimax';
import { KimiProvider } from '../providers/kimi';

/**
 * Provider 注册表
 * 所有可用的 Provider 类
 */
const PROVIDER_REGISTRY = {
  zhipu: ZhipuProvider,
  minimax: MiniMaxProvider,
  kimi: KimiProvider
} as const;

/**
 * Provider 类型
 */
export type ProviderType = keyof typeof PROVIDER_REGISTRY;

/**
 * 已加载的 Provider 实例
 */
export interface LoadedProvider {
  type: ProviderType;
  instance: Provider;
  config: ProviderConfig;
}

/**
 * Provider 加载器
 * 根据配置加载启用的 Provider
 */
export class ProviderLoader {
  /**
   * 根据配置加载所有启用的 Provider
   */
  static loadProviders(providerConfigs: Record<string, ProviderConfig>): LoadedProvider[] {
    const loaded: LoadedProvider[] = [];

    for (const [type, config] of Object.entries(providerConfigs)) {
      // 检查是否启用
      if (!config.enabled) {
        continue;
      }

      // 检查 Provider 是否存在
      const ProviderClass = PROVIDER_REGISTRY[type as ProviderType];
      if (!ProviderClass) {
        console.warn(`[Loader] Unknown provider type: ${type}`);
        continue;
      }

      // 创建实例
      try {
        const instance = new ProviderClass();
        loaded.push({
          type: type as ProviderType,
          instance,
          config
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
    newConfigs: Record<string, ProviderConfig>
  ): LoadedProvider[] {
    // 简单实现：关闭所有现有 Provider，重新加载
    // TODO: 优化为增量更新，只重新加载有变化的 Provider
    return this.loadProviders(newConfigs);
  }

  /**
   * 获取所有可用的 Provider 类型
   */
  static getAvailableTypes(): ProviderType[] {
    return Object.keys(PROVIDER_REGISTRY) as ProviderType[];
  }
}
