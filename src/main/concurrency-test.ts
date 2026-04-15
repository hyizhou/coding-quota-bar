import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { ApiFormat, ConcurrencyTestConfig, ConcurrencyTestResult, RequestMetrics } from '../shared/types';

/**
 * 累计统计
 */
interface StreamStats {
  firstChunkTime: number;
  hasReceivedContent: boolean;
  estimatedTokens: number;   // 逐 chunk 累计估算
  reportedTokens: number;    // API 报告的真实 token 数
}

function newStats(): StreamStats {
  return { firstChunkTime: 0, hasReceivedContent: false, estimatedTokens: 0, reportedTokens: 0 };
}

function markFirstContent(stats: StreamStats): void {
  if (!stats.hasReceivedContent) {
    stats.firstChunkTime = performance.now();
    stats.hasReceivedContent = true;
  }
}

/** 中文一字一个 token，英文一个单词一个 token */
function estimateTokens(text: string): number {
  let count = 0;
  for (const ch of text) {
    // CJK 统一汉字 + 中文标点
    if (
      (ch >= '\u4e00' && ch <= '\u9fff') ||
      (ch >= '\u3400' && ch <= '\u4dbf') ||
      (ch >= '\u3000' && ch <= '\u303f') ||
      (ch >= '\uff00' && ch <= '\uffef')
    ) {
      count++;
    }
  }
  // 非中文字符按空格分词计单词数
  const nonChinese = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g, ' ');
  const words = nonChinese.split(/\s+/).filter(w => w.length > 0);
  count += words.length;
  return count;
}

/** 复述用固定文本，减少模型输出随机性 */
const PARAPHRASE_TEXT = '人工智能是计算机科学的一个重要分支，它致力于研究和开发能够模拟人类智能行为的系统与技术。从语音识别到自然语言处理，从图像分析到自动驾驶，人工智能正在深刻改变着我们的生活方式和工作模式。近年来，大语言模型的发展尤为迅速，它们能够理解和生成自然语言文本，在编程辅助、内容创作、知识问答等领域展现出强大的能力。这些模型通过海量数据训练，学会了语言的规律和知识，能够根据上下文进行推理和创作。随着技术的不断进步，人工智能将在更多领域发挥重要作用，为人类社会带来更多便利和可能性。';

/** 构建请求 messages：让模型复述固定文字 */
function buildMessages(): Array<{ role: string; content: string }> {
  return [{ role: 'user', content: `请原样复述以下内容，不要添加任何额外文字：\n${PARAPHRASE_TEXT}` }];
}

function finalTokenCount(stats: StreamStats): number {
  // 始终用自身估算（CJK 1字=1token，英文1词=1token），API 报告值通常偏高
  return stats.estimatedTokens;
}

/**
 * OpenAI 格式的 SSE chunk
 */
interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    completion_tokens?: number;
  };
}

/**
 * Anthropic 格式的 SSE event
 */
interface AnthropicContentDelta {
  type: 'content_block_delta';
  delta?: { type?: string; text?: string };
}

interface AnthropicMessageDelta {
  type: 'message_delta';
  delta?: { stop_reason?: string };
  usage?: { output_tokens?: number };
}

type AnthropicSSEEvent = AnthropicContentDelta | AnthropicMessageDelta | { type: string };

/**
 * 单次流式请求结果
 */
interface StreamResult {
  success: boolean;
  ttftMs: number;
  totalMs: number;
  tokenCount: number;
  tokensPerSec: number;
  error?: string;
}

/** OpenAI 兼容接口 */
const API_BASE_OPENAI = 'https://open.bigmodel.cn/api/coding/paas/v4';
/** Anthropic 兼容接口 */
const API_BASE_ANTHROPIC = 'https://open.bigmodel.cn/api/anthropic';

const MAX_HISTORY = 20;

/**
 * 并发测试引擎
 */
export class ConcurrencyTestEngine {
  static async run(
    config: ConcurrencyTestConfig,
    apiKey: string,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<ConcurrencyTestResult> {
    const startTime = Date.now();
    let completed = 0;
    const total = config.concurrency;

    const promises = Array.from({ length: total }, () =>
      executeStreamRequest(config.model, apiKey, config.apiFormat).then((result) => {
        completed++;
        onProgress?.(completed, total);
        return result;
      }),
    );

    const outcomes = await Promise.allSettled(promises);

    const metrics: RequestMetrics[] = [];
    const errors: string[] = [];

    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') {
        const r = outcome.value;
        metrics.push({
          success: r.success,
          ttftMs: r.ttftMs,
          totalMs: r.totalMs,
          tokensPerSec: r.tokensPerSec,
          tokenCount: r.tokenCount,
          error: r.error,
        });
        if (r.error && !errors.includes(r.error)) errors.push(r.error);
      } else {
        const msg = outcome.reason?.message || String(outcome.reason);
        metrics.push({
          success: false, ttftMs: 0, totalMs: 0, tokensPerSec: 0, tokenCount: 0, error: msg,
        });
        if (!errors.includes(msg)) errors.push(msg);
      }
    }

    const successMetrics = metrics.filter(m => m.success);
    const totalTimeMs = Date.now() - startTime;

    const result: ConcurrencyTestResult = {
      id: generateId(),
      providerKey: config.providerKey,
      model: config.model,
      concurrency: config.concurrency,
      successCount: successMetrics.length,
      failCount: metrics.length - successMetrics.length,
      totalTimeMs,
      timestamp: new Date(startTime).toISOString(),
      errors,
      avgTtftMs: avg(successMetrics.map(m => m.ttftMs)),
      avgTokensPerSec: avg(successMetrics.map(m => m.tokensPerSec)),
      minTtftMs: min(successMetrics.map(m => m.ttftMs)),
      maxTtftMs: max(successMetrics.map(m => m.ttftMs)),
      avgTotalMs: avg(successMetrics.map(m => m.totalMs)),
      requestDetails: metrics,
    };

    await ConcurrencyTestEngine.saveResult(result);

    return result;
  }

  static async loadHistory(providerKey: string): Promise<ConcurrencyTestResult[]> {
    const filePath = getHistoryPath();
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, ConcurrencyTestResult[]>;
      return data[providerKey] || [];
    } catch {
      return [];
    }
  }

  static async deleteResult(providerKey: string, id: string): Promise<void> {
    const filePath = getHistoryPath();
    let data: Record<string, ConcurrencyTestResult[]> = {};

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      data = JSON.parse(content);
    } catch {
      return;
    }

    if (!data[providerKey]) return;
    data[providerKey] = data[providerKey].filter(r => r.id !== id);
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  static async saveResult(result: ConcurrencyTestResult): Promise<void> {
    const filePath = getHistoryPath();
    let data: Record<string, ConcurrencyTestResult[]> = {};

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      data = JSON.parse(content);
    } catch {
      // 文件不存在
    }

    const key = result.providerKey;
    if (!data[key]) data[key] = [];

    const toSave: ConcurrencyTestResult = { ...result };
    delete toSave.requestDetails;

    data[key].unshift(toSave);
    if (data[key].length > MAX_HISTORY) {
      data[key] = data[key].slice(0, MAX_HISTORY);
    }

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

/**
 * 执行单次流式请求，根据 apiFormat 选择不同接口
 */
function executeStreamRequest(model: string, apiKey: string, apiFormat: ApiFormat): Promise<StreamResult> {
  if (apiFormat === 'anthropic') {
    return executeAnthropicStream(model, apiKey);
  }
  return executeOpenAIStream(model, apiKey);
}

/**
 * OpenAI 兼容格式流式请求
 * POST {API_BASE_OPENAI}/chat/completions
 * SSE: data: {"choices":[{"delta":{"content":"..."}}]}
 */
function executeOpenAIStream(model: string, apiKey: string): Promise<StreamResult> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const stats = newStats();

    const body = JSON.stringify({
      model,
      messages: buildMessages(),
      max_tokens: 512,
      stream: true,
      stream_options: { include_usage: true },
    });

    const url = new URL(`${API_BASE_OPENAI}/chat/completions`);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream',
      },
      timeout: 30000,
    };

    let settled = false;
    const wallTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        resolve(makeError(startTime, 'Timeout (30s)'));
      }
    }, 30000);

    const req = https.request(options, (res) => {
      let buffer = '';

      if (res.statusCode && res.statusCode >= 400) {
        let errBody = '';
        res.on('data', (chunk: Buffer) => { errBody += chunk.toString(); });
        res.on('end', () => {
          settled = true;
          clearTimeout(wallTimer);
          resolve(makeError(startTime, `HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`));
        });
        return;
      }

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const parsed: OpenAIStreamChunk = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              markFirstContent(stats);
              stats.estimatedTokens += estimateTokens(delta.content);
            }
            if (parsed.usage?.completion_tokens) {
              stats.reportedTokens = parsed.usage.completion_tokens;
            }
          } catch {
            // 忽略解析错误
          }
        }
      });

      res.on('end', () => {
        settled = true;
        clearTimeout(wallTimer);
        resolve(makeStreamResult(startTime, stats));
      });

      res.on('error', (err) => {
        settled = true;
        clearTimeout(wallTimer);
        resolve(makeError(startTime, err.message));
      });
    });

    req.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(wallTimer); resolve(makeError(startTime, err.message)); }
    });
    req.on('timeout', () => {
      if (!settled) { settled = true; clearTimeout(wallTimer); req.destroy(); resolve(makeError(startTime, 'Connection timeout')); }
    });
    req.write(body);
    req.end();
  });
}

/**
 * Anthropic 兼容格式流式请求
 * POST {API_BASE_ANTHROPIC}/v1/messages
 * SSE: event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"..."}}
 */
function executeAnthropicStream(model: string, apiKey: string): Promise<StreamResult> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const stats = newStats();

    const body = JSON.stringify({
      model,
      max_tokens: 512,
      stream: true,
      messages: buildMessages(),
      thinking: { type: 'disabled' },
    });

    const url = new URL(`${API_BASE_ANTHROPIC}/v1/messages`);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Accept': 'text/event-stream',
      },
      timeout: 30000,
    };

    let settled = false;
    const wallTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        resolve(makeError(startTime, 'Timeout (30s)'));
      }
    }, 30000);

    const req = https.request(options, (res) => {
      let buffer = '';

      if (res.statusCode && res.statusCode >= 400) {
        let errBody = '';
        res.on('data', (chunk: Buffer) => { errBody += chunk.toString(); });
        res.on('end', () => {
          settled = true;
          clearTimeout(wallTimer);
          resolve(makeError(startTime, `HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`));
        });
        return;
      }

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('event: ')) {
            continue;
          }

          if (!trimmed.startsWith('data: ')) continue;

          try {
            const parsed: AnthropicSSEEvent = JSON.parse(trimmed.slice(6));

            if (parsed.type === 'content_block_delta') {
              const text = (parsed as AnthropicContentDelta).delta?.text;
              if (text) {
                markFirstContent(stats);
                stats.estimatedTokens += estimateTokens(text);
              }
            } else if (parsed.type === 'message_delta') {
              const outputTokens = (parsed as AnthropicMessageDelta).usage?.output_tokens;
              if (outputTokens) {
                stats.reportedTokens = outputTokens;
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      });

      res.on('end', () => {
        settled = true;
        clearTimeout(wallTimer);
        resolve(makeStreamResult(startTime, stats));
      });

      res.on('error', (err) => {
        settled = true;
        clearTimeout(wallTimer);
        resolve(makeError(startTime, err.message));
      });
    });

    req.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(wallTimer); resolve(makeError(startTime, err.message)); }
    });
    req.on('timeout', () => {
      if (!settled) { settled = true; clearTimeout(wallTimer); req.destroy(); resolve(makeError(startTime, 'Connection timeout')); }
    });
    req.write(body);
    req.end();
  });
}

function makeStreamResult(
  startTime: number,
  stats: StreamStats,
): StreamResult {
  const totalMs = performance.now() - startTime;
  if (!stats.hasReceivedContent) {
    return { success: false, ttftMs: 0, totalMs: Math.round(totalMs), tokenCount: 0, tokensPerSec: 0, error: 'No content received (possibly rate limited)' };
  }
  const ttftMs = stats.firstChunkTime - startTime;
  const outputMs = totalMs - ttftMs;
  const tokenCount = finalTokenCount(stats);
  const tokensPerSec = outputMs > 0 ? (tokenCount / outputMs) * 1000 : 0;
  return {
    success: true,
    ttftMs: Math.round(ttftMs),
    totalMs: Math.round(totalMs),
    tokenCount,
    tokensPerSec: Math.round(tokensPerSec * 10) / 10,
  };
}

function makeError(startTime: number, error: string): StreamResult {
  return { success: false, ttftMs: 0, totalMs: Math.round(performance.now() - startTime), tokenCount: 0, tokensPerSec: 0, error };
}

function getHistoryPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'concurrency-test-history.json');
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function min(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.min(...values);
}

function max(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}
