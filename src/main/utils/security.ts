/**
 * 安全工具：外部链接白名单校验 + HTTP 错误信息脱敏
 * 白名单限制 renderer 的 open-external 只能打开已知域名，
 * 脱敏防止网关回显的凭证片段随错误文案进入 UI
 */
import buildConfig from '../../../app.build';

/** renderer UI 固定会打开的外部域名（provider 官网从 app.build.ts 动态提取） */
const FIXED_EXTERNAL_HOSTS = [
  'github.com',
  'status.deepseek.com',
  'applink.feishu.cn',
];

/** open-external 允许打开的外部域名：provider 官网 + 固定域名 */
const ALLOWED_EXTERNAL_HOSTS = new Set<string>(FIXED_EXTERNAL_HOSTS);
for (const provider of buildConfig.providers) {
  if (!provider.websiteUrl) continue;
  ALLOWED_EXTERNAL_HOSTS.add(new URL(provider.websiteUrl).hostname.toLowerCase());
}

/**
 * 校验 URL 是否允许通过 shell.openExternal 打开：
 * 必须是 https 且 host 在白名单内，拒绝 file:// javascript: 等危险协议
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 清理进入 UI 的错误文本：打码疑似凭证片段并截断过长内容，
 * 覆盖 Bearer token、sk- 前缀、32 位以上 hex 串、key/token 等字段赋值
 */
export function safeErrorMessage(text: string, maxLength = 200): string {
  const cleaned = text
    .replace(/(Bearer\s+)[A-Za-z0-9\-_.=]{16,}/gi, '$1[REDACTED]')
    .replace(/sk-[a-zA-Z0-9\-_]{16,}/g, '[REDACTED-sk]')
    .replace(/[0-9a-fA-F]{32,}/g, '[REDACTED-hex]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|webToken|password|secret|token|key)['"]?\s*[:=]\s*['"]?)[^,;\s}"']{16,}/gi, '$1[REDACTED]');
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) + '...' : cleaned;
}
