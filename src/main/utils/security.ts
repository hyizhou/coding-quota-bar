/**
 * 安全工具：错误信息脱敏 + 外部 URL 白名单
 * 用于防止敏感信息（API key / Bearer token / query 参数）泄漏到 UI 和日志
 */

/**
 * 已知的 provider 域名白名单（仅允许这些 host 通过 shell.openExternal 打开）
 * 任何不在白名单中的 host 会被拒绝
 */
const ALLOWED_EXTERNAL_HOSTS = new Set<string>([
  'api.deepseek.com',
  'platform.deepseek.com',
  'www.minimaxi.com',
  'open.bigmodel.cn',
  'bigmodel.cn',
  'platform.xiaomimimo.com',
  'chatgpt.com',
  'opencode.ai',
  'github.com',  // 用于错误反馈
]);

/**
 * 校验 URL 是否可以安全通过 shell.openExternal 打开
 * - 必须 https:
 * - host 必须在白名单中
 * - 拒绝 file:// javascript: data: blob: 等危险协议
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 清理错误信息中的敏感串
 * - 替换 `Authorization: Bearer xxx` → `Authorization: Bearer [REDACTED]`
 * - 替换 query string 中的 `apiKey=xxx`、`token=xxx`、`key=xxx` → `xxx=[REDACTED]`
 * - 替换 JSON body 里的 `"apiKey":"xxx"` 同类
 */
export function safeErrorMessage(input: unknown, maxLength = 200): string {
  if (input == null) return '';
  let text: string;
  if (input instanceof Error) text = input.message;
  else if (typeof input === 'string') text = input;
  else text = String(input);

  let cleaned = text
    // Bearer / Basic auth
    .replace(/(Bearer\s+)[A-Za-z0-9\-_\.=]+/gi, '$1[REDACTED]')
    // Query string 参数（apiKey / token / key / secret / password）
    .replace(/([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|key|secret|password)=)([^&\s"']+)/gi, '$1[REDACTED]')
    // JSON 字段值
    .replace(/("(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|key|secret|password)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    // X-API-Key / X-Auth-Token 等 header
    .replace(/(X-[A-Z][A-Za-z-]*:\s*)([A-Za-z0-9\-_\.]+)/g, '$1[REDACTED]');

  // 截断过长错误（避免 response body 整段贴进 UI）
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength) + '...';
  }
  return cleaned;
}
