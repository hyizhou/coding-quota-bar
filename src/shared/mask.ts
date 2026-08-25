// API Key 脱敏规则：主进程（get-config 返回给渲染进程）与设置页共用同一实现，
// 避免两端各自维护导致掩码格式漂移
export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length > 8) {
    return `${key.slice(0, 4)}${'*'.repeat(key.length - 8)}${key.slice(-4)}`
  }
  return '*'.repeat(key.length)
}
