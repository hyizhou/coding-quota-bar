/**
 * 编译时配置
 * 定义应用支持哪些 Provider，修改后需重新编译生效。
 * 显示名称统一走 i18n（locales 文件中 providers.{key}），不在此配置。
 */
export default {
  providers: [
    { key: 'zhipu', available: true, envVar: 'Z_AI_API_KEY', baseUrl: 'https://api.z.ai' },
    { key: 'minimax', available: true, envVar: 'MINIMAX_API_KEY', baseUrl: '' },
    // kimi 暂未提供 coding plan 查询接口，禁用
    { key: 'kimi', available: false, envVar: 'KIMI_API_KEY', baseUrl: '' },
  ],
} as const;
