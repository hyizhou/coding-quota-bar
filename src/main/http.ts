import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';

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
 * 使用 Node.js 原生 http/https 模块，避免引入额外依赖
 */
export class HttpClient {
  /**
   * 发送 HTTP 请求
   */
  static async request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqOptions: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeout || 10000
      };

      const req = client.request(reqOptions, (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          // 根据响应头编码解码 body，优先用 content-charset，兜底 utf-8
          const raw = Buffer.concat(chunks);
          const contentType = res.headers['content-type'] || '';
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
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              headers[key] = value;
            } else if (Array.isArray(value)) {
              headers[key] = value.join(', ');
            }
          }

          resolve({
            status: res.statusCode || 0,
            headers,
            body
          });
        });
      });

      req.on('error', (error: Error) => {
        reject(new Error(`HTTP request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('HTTP request timeout'));
      });

      // 发送请求体
      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
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
      throw new Error(`HTTP ${response.status}: ${response.body}`);
    }
    try {
      return JSON.parse(response.body) as T;
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error}`);
    }
  }
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
          console.warn(`[HttpClient] Retry ${attempt + 1}/${this.maxRetries} for ${url}`);
          await this.delay(this.retryDelay * (attempt + 1));
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
      throw new Error(`HTTP ${response.status}: ${response.body}`);
    }
    try {
      return JSON.parse(response.body) as T;
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error}`);
    }
  }
}
