import { net } from 'electron';
import { safeErrorMessage } from './utils/security';

/**
 * HTTP 响应
 */
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * HTTP 请求选项
 */
export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

/**
 * HTTP 客户端
 * 使用 Electron/Chromium 网络栈，以便跟随系统代理和证书配置
 */
export class HttpClient {
  /**
   * 发送 HTTP 请求
   */
  static async request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const timeoutMs = options.timeout || 12000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await net.fetch(url, {
        method: options.method || 'GET',
        // 合并请求头；默认带 Connection: close 禁用 keep-alive 连接复用，
        // 避免 Chromium 连接池偶发复用"已被服务端静默关闭的僵尸连接"
        // 导致请求挂死直至超时（实测会出现 ~10s 的 UND_ERR_CONNECT_TIMEOUT）。
        // 代价是每次请求多几十毫秒建连，换来彻底消除间歇性超时。
        headers: { 'Connection': 'close', ...(options.headers || {}) },
        body: options.body,
        signal: controller.signal,
      });

      // 根据响应头编码解码 body，优先用 content-charset，兜底 utf-8
      const raw = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || '';
      const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
      const charset = charsetMatch ? charsetMatch[1].trim().toLowerCase() : 'utf-8';

      let body: string;
      if (charset === 'utf-8' || charset === 'utf8') {
        body = raw.toString('utf-8');
      } else {
        // GBK 等编码：用 TextDecoder 支持
        const decoder = new TextDecoder(charset);
        body = decoder.decode(raw);
      }

      // 收集响应头
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        headers,
        body
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('HTTP request timeout');
      }
      throw new Error(`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 发送 GET 请求
   */
  static async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request(url, { method: 'GET', headers });
  }

  /**
   * 发送 POST 请求
   */
  static async post(
    url: string,
    body: string,
    headers?: Record<string, string>
  ): Promise<HttpResponse> {
    return this.request(url, {
      method: 'POST',
      body,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * 解析 JSON 响应
   */
  static async getJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.get(url, headers);
    if (response.status >= 400) {
      throw new Error(safeErrorMessage(`HTTP ${response.status}: ${response.body}`, 200));
    }
    try {
      return JSON.parse(response.body) as T;
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error}`);
    }
  }
}

/**
 * 判断错误信息是否为值得重试的瞬时网络错误
 * 主要是连接被关闭/重置、网络变化、超时等可恢复的传输层故障
 */
function isTransientNetworkError(message: string): boolean {
  return /ERR_CONNECTION_(CLOSED|RESET|REFUSED|FAILED)|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_SOCKET_NOT_CONNECTED|ECONNRESET|ETIMEDOUT|ENOTFOUND|network|timeout/i.test(message);
}

/**
 * 创建带重试的 HTTP 客户端
 */
export class HttpClientWithRetry {
  private maxRetries: number;
  private retryDelay: number;

  constructor(maxRetries = 3, retryDelay = 1000) {
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 计算第 attempt 次重试（从 0 开始）的退避时间
   * 线性退避 + 随机抖动，瞬时网络错误给更长退避以等待坏连接/代理恢复
   */
  private backoff(attempt: number, isTransient: boolean): number {
    const base = this.retryDelay * (attempt + 1);
    const multiplier = isTransient ? 1.5 : 1;
    const jitter = Math.random() * this.retryDelay;
    return Math.round(base * multiplier + jitter);
  }

  /**
   * 带重试的 GET 请求
   */
  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await HttpClient.get(url, headers);
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries) {
          const msg = lastError.message || '';
          const transient = isTransientNetworkError(msg);
          const wait = this.backoff(attempt, transient);
          console.warn(
            `[HttpClient] Retry ${attempt + 1}/${this.maxRetries} for ${url} after ${wait}ms${transient ? ' (transient network error)' : ''}`
          );
          await this.delay(wait);
        }
      }
    }

    throw lastError;
  }

  /**
   * 带重试的 JSON GET 请求
   */
  async getJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.get(url, headers);
    if (response.status >= 400) {
      throw new Error(safeErrorMessage(`HTTP ${response.status}: ${response.body}`, 200));
    }
    try {
      return JSON.parse(response.body) as T;
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error}`);
    }
  }
}
