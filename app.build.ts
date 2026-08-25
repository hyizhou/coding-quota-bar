/**
 * 编译时配置
 * 定义应用支持哪些 Provider，修改后需重新编译生效。
 * 显示名称统一走 i18n（locales 文件中 providers.{key}），不在此配置。
 */
export default {
  providers: [
    { key: 'zhipu', available: true, envVar: 'Z_AI_API_KEY', baseUrl: 'https://open.bigmodel.cn', websiteUrl: 'https://bigmodel.cn/' },
    { key: 'minimax', available: true, envVar: 'MINIMAX_API_KEY', baseUrl: 'https://www.minimaxi.com', websiteUrl: 'https://www.minimaxi.com/' },
    { key: 'deepseek', available: true, envVar: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com', websiteUrl: 'https://platform.deepseek.com/' },
    { key: 'mimo', available: true, envVar: '', baseUrl: 'https://platform.xiaomimimo.com', websiteUrl: 'https://platform.xiaomimimo.com/console/plan-manage' },
    { key: 'codex', available: true, envVar: '', baseUrl: 'https://chatgpt.com', websiteUrl: 'https://chatgpt.com/' },
    { key: 'opencode-go', available: true, envVar: 'OPENCODE_API_KEY', baseUrl: 'https://opencode.ai', websiteUrl: 'https://opencode.ai/auth' },
  ],
} as const;
