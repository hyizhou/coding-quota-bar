/**
 * 基于 Electron net 模块（Chromium 网络栈）的 HTTP 客户端：
 * 自动遵循操作系统代理设置（含 PAC），适用于海外端点；
 * 内置整体超时与 settled 守卫，保证 Promise 必然 settle
 */
import { net } from 'electron';

export interface NetFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface NetFetchResult {
  status: number;
  body: string;
}

export function netFetch(url: string, options: NetFetchOptions = {}): Promise<NetFetchResult> {
  const { method = 'GET', headers, body, timeoutMs = 15000 } = options;
  return new Promise((resolve, reject) => {
    // 注意：net.request 只接受单参数（url 字符串或 options 对象），
    // 不存在 (url, options) 双参数形式——method 必须放进 options 对象
    const request = net.request({ url, method });
    let settled = false;
    // 整体超时兜底：响应停滞时 abort 并 reject，保证聚合链不会永久挂起
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      request.abort();
      reject(new Error('Net request timeout'));
    }, timeoutMs);
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        request.setHeader(key, value);
      }
    }
    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8');
        settle(() => resolve({ status: response.statusCode || 0, body: responseBody }));
      });
      response.on('error', (e) => settle(() => reject(e)));
    });
    request.on('error', (e) => settle(() => reject(e)));
    if (body) {
      request.write(body);
    }
    request.end();
  });
}
