/**
 * 编译时配置
 * 定义应用支持哪些 Provider，修改后需重新编译生效。
 * 显示名称统一走 i18n（locales 文件中 providers.{key}），不在此配置。
 */
export default {
  providers: [
    { key: 'zhipu', available: true, envVar: 'Z_AI_API_KEY', baseUrl: 'https://api.z.ai', websiteUrl: 'https://bigmodel.cn/' },
    { key: 'minimax', available: true, envVar: 'MINIMAX_API_KEY', baseUrl: 'https://www.minimaxi.com', websiteUrl: 'https://www.minimaxi.com/' },
    { key: 'deepseek', available: true, envVar: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com', websiteUrl: 'https://platform.deepseek.com/' },
    { key: 'kimi', available: false, envVar: 'KIMI_API_KEY', baseUrl: '', websiteUrl: '' },
    { key: 'mimo', available: true, envVar: '', baseUrl: 'https://platform.xiaomimimo.com', websiteUrl: 'https://platform.xiaomimimo.com/console/plan-manage' },
  ],
} as const;
