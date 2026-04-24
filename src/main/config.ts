import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { app, safeStorage } from 'electron';
import type { AppConfig, ProviderConfig, ProviderTypeConfig, AccountConfig } from '../shared/types';
import { generateAccountId } from '../shared/types';
import { getAvailableProviderKeys } from './loader';
import { EventEmitter } from 'events';

/**
 * 配置管理器
 * 负责配置文件的读写和热加载
 */
export class ConfigManager extends EventEmitter {
  private configPath: string;
  private config: AppConfig | null = null;
  private watcher: fsSync.FSWatcher | null = null;
  private ignoreNextChange = false;

  constructor() {
    super();
    // 配置文件路径：用户数据目录 /config.json
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'config.json');
  }

  /**
   * 初始化配置管理器
   */
  async initialize(): Promise<AppConfig> {
    // 确保用户数据目录存在
    const userDataPath = app.getPath('userData');
    try {
      await fs.mkdir(userDataPath, { recursive: true });
    } catch (error) {
      console.error('[Config] Failed to create userData directory:', error);
    }

    // 尝试加载配置，如果不存在则创建默认配置
    try {
      await this.load();
      console.log('[Config] Loaded configuration from', this.configPath);
    } catch (error) {
      console.log('[Config] No existing config found, creating default');
      await this.createDefaultConfig();
    }

    // 监听配置文件变化
    this.watch();

    return this.config!;
  }

  /**
   * 加密单个 apiKey
   */
  private encryptApiKey(key: string): string {
    if (!key || !safeStorage.isEncryptionAvailable()) {
      return key;
    }
    const encrypted = safeStorage.encryptString(key);
    return 'enc:' + encrypted.toString('base64');
  }

  /**
   * 解密单个 apiKey，非加密格式直接返回（兼容旧配置）
   */
  private decryptApiKey(encrypted: string): string {
    if (!encrypted || !encrypted.startsWith('enc:')) {
      return encrypted;
    }
    try {
      const buffer = Buffer.from(encrypted.slice(4), 'base64');
      return safeStorage.decryptString(buffer);
    } catch {
      console.warn('[Config] Failed to decrypt apiKey, returning as-is');
      return encrypted;
    }
  }

  /**
   * 加密配置中所有 provider 的 apiKey（用于写入磁盘）
   */
  private encryptApiKeys(config: AppConfig): AppConfig {
    const encrypted = structuredClone(config);
    for (const provider of Object.values(encrypted.providers)) {
      const accounts = (provider as ProviderTypeConfig).accounts;
      if (Array.isArray(accounts)) {
        for (const account of accounts) {
          if (account.apiKey) {
            account.apiKey = this.encryptApiKey(account.apiKey);
          }
        }
      }
    }
    return encrypted;
  }

  /**
   * 解密配置中所有 provider 的 apiKey（用于读取磁盘后）
   * 兼容旧格式（apiKey 直接在 provider 上）和新格式（apiKey 在 accounts[] 内）
   * 注意：此兼容逻辑不可删除，旧版本用户升级时需用到
   */
  private decryptApiKeys(config: AppConfig): AppConfig {
    for (const provider of Object.values(config.providers)) {
      const accounts = (provider as any).accounts;
      if (Array.isArray(accounts)) {
        // 新格式：多账户
        for (const account of accounts) {
          if (account.apiKey) {
            account.apiKey = this.decryptApiKey(account.apiKey);
          }
        }
      } else if ((provider as any).apiKey) {
        // 旧格式：单账户（迁移前）
        (provider as any).apiKey = this.decryptApiKey((provider as any).apiKey);
      }
    }
    return config;
  }

  /**
   * 加载配置文件
   */
  private async load(): Promise<AppConfig> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const raw = JSON.parse(content) as AppConfig;
      this.config = this.decryptApiKeys(raw);

      // 迁移：旧格式 { enabled, apiKey } → 新格式 { accounts: [...] }
      let migrated = false;
      for (const [key, val] of Object.entries(this.config.providers)) {
        if (val && typeof (val as any).apiKey === 'string' && !Array.isArray((val as any).accounts)) {
          const old = val as any;
          (this.config.providers as any)[key] = {
            accounts: [{
              id: generateAccountId(),
              enabled: old.enabled ?? false,
              apiKey: old.apiKey ?? '',
              label: '',
            }]
          };
          migrated = true;
          console.log(`[Config] Migrated: converted provider "${key}" to multi-account format`);
        }
      }

      // 迁移：补齐编译时可用但配置文件中缺失的 provider
      for (const key of getAvailableProviderKeys()) {
        if (!this.config.providers[key]) {
          (this.config.providers as any)[key] = { accounts: [] };
          migrated = true;
          console.log(`[Config] Migrated: added missing provider "${key}"`);
        }
      }
      if (migrated) {
        await this.save(this.config);
      }

      this.emit('loaded', this.config);
      return this.config;
    } catch (error) {
      throw new Error(`Failed to load config from ${this.configPath}: ${error}`);
    }
  }

  /**
   * 保存配置文件
   */
  async save(config: AppConfig): Promise<void> {
    try {
      this.ignoreNextChange = true;
      const oldConfig = this.config;
      // 内存中保持明文，写入磁盘时加密
      this.config = config;
      const toWrite = this.encryptApiKeys(config);
      const content = JSON.stringify(toWrite, null, 2);
      await fs.writeFile(this.configPath, content, 'utf-8');
      console.log('[Config] Saved configuration to', this.configPath);
      this.emit('saved', config);
      this.emit('changed', config, oldConfig);
    } catch (error) {
      this.ignoreNextChange = false;
      console.error('[Config] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * 创建默认配置文件
   */
  private async createDefaultConfig(): Promise<void> {
    // 只为编译时可用的 provider 生成默认配置
    const providers: Record<string, ProviderTypeConfig> = {};
    for (const key of getAvailableProviderKeys()) {
      providers[key] = { accounts: [] };
    }

    const defaultConfig: AppConfig = {
      refreshInterval: 300, // 5 分钟
      providers,
      display: {
        colorThresholds: {
          green: 50,
          yellow: 20
        }
      },
      autoStart: false,
      language: 'zh-CN',
      theme: 'auto',
      autoCheckUpdate: true,
      autoCheckUpdateInterval: 14400,
      lastAutoCheckTime: null
    };

    await this.save(defaultConfig);
  }

  /**
   * 获取当前配置
   */
  getConfig(): AppConfig | null {
    return this.config;
  }

  /**
   * 更新配置（部分更新）
   */
  async updateConfig(updates: Partial<AppConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Config not initialized');
    }

    // 深度合并 providers：逐个合并每个 provider 的字段，避免丢失 enabled 等字段
    const mergedProviders = { ...this.config.providers };
    if (updates.providers) {
      for (const [key, value] of Object.entries(updates.providers)) {
        mergedProviders[key] = {
          ...mergedProviders[key],
          ...value
        };
      }
    }

    const newConfig: AppConfig = {
      ...this.config,
      ...updates,
      providers: mergedProviders,
      display: {
        ...this.config.display,
        ...updates.display,
        colorThresholds: {
          ...this.config.display.colorThresholds,
          ...updates.display?.colorThresholds
        }
      }
    };

    await this.save(newConfig);
  }

  /**
   * 监听配置文件变化
   */
  private watch(): void {
    try {
      this.watcher = fsSync.watch(this.configPath, { persistent: false }, (eventType: string) => {
        if (eventType === 'change') {
          // 延迟执行，确保文件写入完成
          setTimeout(async () => {
            if (this.ignoreNextChange) {
              this.ignoreNextChange = false;
              return;
            }
            console.log('[Config] Configuration file changed, reloading...');
            try {
              const old = this.config;
              await this.load();
              this.emit('changed', this.config, old);
            } catch (error) {
              console.error('[Config] Failed to reload config:', error);
            }
          }, 100);
        }
      });
      console.log('[Config] Watching configuration file for changes');
    } catch (error) {
      console.warn('[Config] Failed to watch config file:', error);
    }
  }

  /**
   * 停止监听配置文件变化
   */
  private unwatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * 销毁配置管理器
   */
  destroy(): void {
    this.unwatch();
    this.removeAllListeners();
  }
}
