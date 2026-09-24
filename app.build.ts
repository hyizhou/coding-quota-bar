/**
 * 编译时配置
 * 定义应用支持哪些 Provider，修改后需重新编译生效。
 * 显示名称统一走 i18n（locales 文件中 providers.{key}），不在此配置。
 */
export default {
  providers: [
    // overseasBaseUrl：海外站 API 基址（账户 region='global' 时启用），空串表示该服务商无海外站
    { key: 'zhipu', available: true, envVar: 'Z_AI_API_KEY', baseUrl: 'https://open.bigmodel.cn', overseasBaseUrl: 'https://api.z.ai', websiteUrl: 'https://bigmodel.cn/' },
    { key: 'minimax', available: true, envVar: 'MINIMAX_API_KEY', baseUrl: 'https://www.minimaxi.com', overseasBaseUrl: '', websiteUrl: 'https://www.minimaxi.com/' },
    { key: 'deepseek', available: true, envVar: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com', overseasBaseUrl: '', websiteUrl: 'https://platform.deepseek.com/' },
    { key: 'kimi', available: false, envVar: 'KIMI_API_KEY', baseUrl: '', overseasBaseUrl: '', websiteUrl: '' },
    { key: 'mimo', available: true, envVar: '', baseUrl: 'https://platform.xiaomimimo.com', overseasBaseUrl: '', websiteUrl: 'https://platform.xiaomimimo.com/console/plan-manage' },
    { key: 'opencode-go', available: true, envVar: 'OPENCODE_API_KEY', baseUrl: 'https://opencode.ai', overseasBaseUrl: '', websiteUrl: 'https://opencode.ai/auth' },
    { key: 'codex', available: true, envVar: '', baseUrl: 'https://chatgpt.com', overseasBaseUrl: '', websiteUrl: 'https://chatgpt.com/' },
    { key: 'openrouter', available: true, envVar: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai', overseasBaseUrl: '', websiteUrl: 'https://openrouter.ai/settings/keys' },
    { key: 'qoder', available: true, envVar: '', baseUrl: 'https://qoder.com', overseasBaseUrl: '', websiteUrl: 'https://qoder.com/account/usage' },
    { key: 'stepfun', available: true, envVar: '', baseUrl: 'https://platform.stepfun.com', overseasBaseUrl: 'https://platform.stepfun.ai', websiteUrl: 'https://platform.stepfun.com/account-overview' },
  ],
} as const;
