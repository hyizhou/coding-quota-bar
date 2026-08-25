# 订阅套餐 & 余量查询方法（GLM / MiniMax / DeepSeek / OpenCode Go）

> 适用范围：`coding-quota-bar` 项目 `src/providers/*` 实现
> 更新时间：2026-08-18
> 本文档整理自各平台官方文档与实际接口调试，供贡献者参考

四个 provider 都实现同一接口 `Provider.fetchUsage(config: ProviderConfig): Promise<UsageResult>`，统一返回 `{ used, total, expiresAt, details: { quotas, ... } }`。下面对每个平台的鉴权方式、关键端点、响应结构、套餐/余量类型逐一拆解。

---

## 目录

1. [GLM（智谱 Zhipu）](#1-glm智谱-zhipu)
2. [MiniMax（MiniMax M3 / Token Plan）](#2-minimaxminimax-m3--token-plan)
3. [DeepSeek](#3-deepseek)
4. [OpenCode Go](#4-opencode-go)
5. [通用实现细节](#5-通用实现细节)
6. [复现命令速查](#6-复现命令速查)

---

## 1. GLM（智谱 Zhipu）

**实现文件**：`src/providers/zhipu.ts`（`ZhipuProvider`）
**定价参考**：`src/providers/zai-pricing.json`（外部 JSON，热更新）
**默认 baseUrl**：`https://bigmodel.cn`（可在 Settings 改）
**鉴权方式**：Bearer API Key（`Authorization: Bearer <apiKey>`）
**API Key 申请**：https://bigmodel.cn/usercenter/apikeys

### 1.1 接口清单（5 类，1 个关键 + 9 个辅助）

| 序号 | 端点 | 用途 | 关键响应字段 |
|---|---|---|---|
| ① | `GET /api/monitor/usage/quota/limit` | **主配额**（关键请求，单独重试 5 次） | `data.limits[]` |
| ② | `GET /api/monitor/usage/model-usage?startTime=YYYY-MM-DD HH:mm:ss&endTime=...` | 模型 token 用量 | `data.tokensUsage[]` / `modelDataList[]` |
| ③ | `GET /api/monitor/usage/tool-usage?startTime=&endTime=` | 工具调用量（MCP） | `data.networkSearchCount` / `webReadMcpCount` / `zreadMcpCount` |
| ④ | `GET /api/monitor/usage/model-performance-day?startTime=&endTime=` | 模型性能（TPS/成功率） | `liteDecodeSpeed` / `proMaxDecodeSpeed` / `successRate` |
| ⑤ | `GET /api/biz/subscription/list?pageSize=9999&pageNum=1` | 订阅信息 | `data[].productName / status / currentRenewTime / nextRenewTime` |

时间范围约定：≤7 天返回**小时级**数据（`x_time` 形如 `2026-08-18 14:00`），>7 天返回**天级**数据（`2026-08-18`）。

实际请求示例（PowerShell）：

```powershell
$headers = @{ 'Authorization' = 'Bearer <GLM_KEY>' }
Invoke-RestMethod -Uri 'https://bigmodel.cn/api/monitor/usage/quota/limit' -Headers $headers
```

### 1.2 套餐等级识别

`quota/limit` 响应顶层 `data.level` 字段返回当前账号的等级（如 `pro` / `max` / `lite`），用作 UI 上的「老/新 GLM-xxx」标签前缀：

```ts
// zhipu.ts:553
plan: hasWeeklyLimit ? `新 ${level.toUpperCase()}` : `老 ${level.toUpperCase()}`,
```

判断逻辑：若 `limits[]` 中存在 `type=TOKENS_LIMIT && unit=1 && number=7`，说明是「周限额」新套餐（GLM-5.1 之后）。

### 1.3 配额条目（limits[]）结构

```ts
interface ZhipuLimitItem {
  type: string;        // 'TOKENS_LIMIT' | 'TIME_LIMIT' | 其他
  unit: number;        // 重置周期单位：1=天, 3=小时, 5=月
  number: number;      // 重置周期数值
  usage?: number;      // 总额度（仅 TIME_LIMIT 有）
  currentValue?: number;// 已用量（仅 TIME_LIMIT 有）
  remaining?: number;  // 剩余量（仅 TIME_LIMIT 有）
  percentage: number;  // 已用百分比 0-100
  nextResetTime: number; // 下次重置（毫秒时间戳）
  usageDetails?: Array<{ modelCode: string; usage: number }>;
}
```

- **TOKENS_LIMIT**：Token 配额。
  - `unit=3, number=N` → `quota.tokensLimit`（N 小时窗口）
  - `unit=1, number=1` → `quota.tokensLimitDaily`（日窗口）
  - `unit=1, number=7` → 周限额（新套餐）
  - `unit=5, number=1` → 月限额
  - UI 标签靠 i18n 键 `quota.tokensLimit` / `quota.tokensLimitDaily` 翻译。
- **TIME_LIMIT**：MCP 工具调用次数限制，标签 `quota.mcpUsage`。

### 1.4 周期换算（小时）

```ts
const periodHours =
  item.unit === 3 ? item.number :                  // 小时
  item.unit === 1 ? item.number * 24 :             // 天
  item.unit === 5 ? item.number * 30 * 24 :        // 月
  item.number * 24;                                // 兜底
```

### 1.5 订阅信息

`/api/biz/subscription/list` 返回数组中筛 `status === 'VALID'` 的那条，得到：

| 字段 | 说明 |
|---|---|
| `productName` | 产品名（如「GLM-5 Coding Pro」） |
| `status` | 订阅状态 |
| `currentRenewTime` | 当前周期开始时间 |
| `nextRenewTime` | 下次续费/重置时间 |
| `autoRenew` | `1`=自动续费，`0`=手动 |
| `actualPrice` | 实际付费 |
| `renewPrice` | 续费价格 |
| `billingCycle` | 计费周期 |

### 1.6 费用估算

按 `zai-pricing.json` 里的 `tokenRatio: { cache, input, output }`（默认 0.1 / 0.4 / 0.5）加权每档价格，得到「等效单价（元/百万 token）」。未知模型自动兜底到 `fallbackModel`（默认 GLM-5.1）。完整价格表在 JSON 文件里，热更新无需改代码。

### 1.7 实现要点

- **限流并发**：`runLimitedAllSettled(auxRequests, 2)` —— 同时最多 2 路请求，避免对同一 host 瞬间打出 10 条连接触发 `ERR_CONNECTION_CLOSED`。
- **关键请求双保险**：主配额用 `criticalClient = HttpClientWithRetry(5, 1200)`，辅助请求用普通 `(3, 1000)`。
- **失败容忍**：辅助请求 9 条全失败也不会让主面板无数据，只是对应卡片不显示。
- **大小写不敏感**模型名匹配：API 可能返回 `glm-5.2` 或 `GLM-5.2`，都查得到。

---

## 2. MiniMax（MiniMax M3 / Token Plan）

**实现文件**：`src/providers/minimax.ts`（`MiniMaxProvider`）
**默认 baseUrl**：`https://www.minimaxi.com`
**鉴权方式**：Bearer API Key
**API Key 申请**：https://www.minimaxi.com/user-center/basic-information/interface-key

### 2.1 接口清单（只 1 个端点）

| 端点 | 用途 |
|---|---|
| `GET {baseUrl}/v1/token_plan/remains` | 拉所有模型额度 |

> baseUrl 自动处理：配置写 `https://api.minimaxi.com/v1` 或 `/anthropic/v1` 都会规整到 `/v1/token_plan/remains`。

实际请求示例：

```powershell
$headers = @{ 'Authorization' = 'Bearer <MINIMAX_KEY>' }
Invoke-RestMethod -Uri 'https://www.minimaxi.com/v1/token_plan/remains' -Headers $headers
```

### 2.2 响应结构

```ts
interface MiniMaxRemainsResponse {
  model_remains?: MiniMaxModelRemains[];
  base_resp?: { status_code?: number; status_msg?: string };
}

interface MiniMaxModelRemains {
  start_time?: number;                       // 区间开始（秒或毫秒）
  end_time?: number;                         // 区间结束
  remains_time?: number;                     // 剩余时长
  current_interval_total_count?: number;     // 区间总额
  current_interval_usage_count?: number;     // 区间已用（或剩余）
  model_name?: string;                       // 'general' | 'video' | ...
  current_interval_status?: number;          // 1=有限, 3=无限
  current_interval_remaining_percent?: number;
  current_weekly_total_count?: number;       // 周总额
  current_weekly_usage_count?: number;
  current_weekly_status?: number;
  current_weekly_remaining_percent?: number;
  weekly_start_time?: number;
  weekly_end_time?: number;
  weekly_remains_time?: number;
  interval_boost_permille?: number;          // 区间加成（千分位，2000=2x）
  weekly_boost_permille?: number;
}
```

### 2.3 配额类型

每个模型返回 2 条 `QuotaItem`（按顺序）：

| 标签键 | 周期 | 字段 |
|---|---|---|
| `quota.minimaxDaily`（普通）/ `quota.minimaxDailyUnlimited`（无限） | **5 小时滚动** | `current_interval_*` |
| `quota.minimaxWeekly` / `quota.minimaxWeeklyUnlimited` | **自然周** | `current_weekly_*` |

> 注意：标签名虽是「Daily / Weekly」，但 MiniMax 实际周期是 5 小时滚动（`interval`）和自然周（`weekly`）。i18n 里可能把「Daily」翻译成「日」或「区间」。

### 2.4 状态码语义

| `current_interval_status` | 含义 |
|---|---|
| `1` | 有限额度（按 `*_total_count` + `*_percent` 显示） |
| `3` | 无限额度（隐藏进度条，标 `hideBar: true`） |

### 2.5 加成（boost_permille）

千分位。`2000` = 2 倍配额，`1000` = 1 倍（无加成）。仅 `general` 模型的 `interval_boost_permille` 会有非 1000 的值，UI 通过 `labelParams.boostPermille` 透传给 i18n。

### 2.6 特殊处理：video 模型的次数计数

```ts
// minimax.ts:193
function deriveUsedCount(total, usageOrRemainingCount, remainingPercent) {
  // MiniMax 的 usage_count 在部分返回里实际表示「剩余次数」而非已用
  // 用百分比对账判断是哪种
  ...
}
```

`video` 模型通常返回「N 次/天」的具体计数（如 0/3），会自动从 `total_count` + `*_percent` 反推已用。

### 2.7 托盘显示

托盘只显示一个百分比 = `100 - min(general.current_interval_remaining, general.current_weekly_remaining)`（取两个非无限窗口中剩余最少的那个）。

### 2.8 实现要点

- **无并发**：只有 1 个端点，单请求 3 次重试。
- **URL 兼容**：baseUrl 支持 `/v1` / `/anthropic/v1` / 裸域名三种写法，自动规整到 `/v1/token_plan/remains`。
- **时间戳双格式**：`n < 1e12` 当作秒，否则当毫秒。

---

## 3. DeepSeek

**实现文件**：`src/providers/deepseek.ts`（`DeepSeekProvider`）
**辅助文件**：`src/main/deepseek-auth.ts`（webToken 提取与刷新）
**鉴权方式**：**两种模式互斥**

| 模式 | 触发条件 | 适用场景 |
|---|---|---|
| `apikey` | `config.authMode === 'apikey'`（默认） | API Key 即可，查余额 |
| `weblogin` | `config.authMode === 'weblogin'` | 网页登录后查月度明细 |

`authMode` 由登录流程切换（`deepseek-auth.ts:88`）。

### 3.1 模式 A：API Key 查余额

**端点**：`GET https://api.deepseek.com/user/balance`
**鉴权**：`Authorization: Bearer <apiKey>`

```powershell
$headers = @{ 'Authorization' = 'Bearer <DS_KEY>' }
Invoke-RestMethod -Uri 'https://api.deepseek.com/user/balance' -Headers $headers
```

**响应**：

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "100.00",
      "granted_balance": "20.00",
      "topped_up_balance": "80.00"
    }
  ]
}
```

UI 展示：
- `quota.deepseekTotalBalance`（总额）
- `quota.deepseekGranted`（赠款，>0 时显示）
- `quota.deepseekToppedUp`（充值，>0 时显示）
- 都是 `hideBar: true`，纯数字卡。

### 3.2 模式 B：WebLogin 查明细

**baseUrl**：`https://platform.deepseek.com`
**Token 来源**：`localStorage.userToken` 的 `.value` 字段

登录流程（`deepseek-auth.ts`）：

1. 弹出 `BrowserWindow`，`partition: persist:deepseek-<accountId>` 隔离 session
2. 导航限制：只允许 `https://platform.deepseek.com/*`
3. 加载 `https://platform.deepseek.com`，轮询 `executeJavaScript('localStorage.getItem("userToken")')`
4. 解析 `JSON.parse(...).value` → 写入 `account.webToken` + `authMode='weblogin'` + `webUserAgent`

**自动刷新**：`deepseekRefreshToken()` 用隐藏窗口（`show: false`）重跑同样流程，最多轮询 10 秒。

**关键 header**（平台有反爬，缺一不可）：

```ts
{
  'Authorization': `Bearer ${token}`,
  'User-Agent': '<webUserAgent>',    // 用登录时的真实 UA
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://platform.deepseek.com/usage',
  'Origin': 'https://platform.deepseek.com',
}
```

#### 3.2.1 内部 API（3 个）

| 端点 | 用途 | 响应关键字段 |
|---|---|---|
| `GET /api/v0/users/get_user_summary` | 用户概要 | `biz_data.current_token / monthly_usage / monthly_costs[] / normal_wallets[] / bonus_wallets[]` |
| `GET /api/v0/usage/amount?month=<1-12>&year=<YYYY>` | 月度模型 token 用量 | `biz_data.days[].data[].usage[]`（type: REQUEST / PROMPT_CACHE_HIT_TOKEN / PROMPT_CACHE_MISS_TOKEN / RESPONSE_TOKEN） |
| `GET /api/v0/usage/cost?month=&year=` | 月度费用 | `biz_data[0].days[].data[].usage[]`（type: amount） |

#### 3.2.2 公共响应壳

```ts
interface InternalApiData<T> {
  code: number;     // 0=OK, 40002=TOKEN_EXPIRED
  msg?: string;
  data?: { biz_code: number; biz_msg: string; biz_data: T };
}
```

**`code === 40002` = TOKEN_EXPIRED**，触发 `deepseekRefreshToken()` 自动重登。

#### 3.2.3 月度 token 分类

| `usage[].type` | 含义 |
|---|---|
| `REQUEST` | 请求次数 |
| `PROMPT_CACHE_HIT_TOKEN` | 缓存命中 token |
| `PROMPT_CACHE_MISS_TOKEN` | 缓存未命中 token |
| `RESPONSE_TOKEN` | 输出 token |

UI 的「模型 token 明细」按模型分组展示 4 类。

#### 3.2.4 跨月查询

`fetchMonthModelHistory(config, month, year)` 提供按月拉取能力，IPC 通道 `deepseek-fetch-month-usage`，用于 TokenChart 翻月。

### 3.3 服务状态（两模式共用）

| 端点 | 用途 |
|---|---|
| `GET https://status.deepseek.com/api/v2/summary.json` | 当前组件状态 + 计划维护 |
| `GET https://status.deepseek.com/api/v2/incidents.json` | 历史事件（90 天） |

`fetchServiceStatus()` 合并两者，按 `components[].id` 匹配事件/维护，输出过去 90 天的日级 status（`operational` / `degraded` / `outage` / `maintenance`）+ uptime%。**5 分钟内存缓存**。

### 3.4 实现要点

- **模式路由**：`fetchUsage()` 看 `config.authMode` 切 A/B 路径。
- **错误转换**：捕获 `TOKEN_EXPIRED` → 返回 `error: 'TOKEN_EXPIRED'`，UI 触发自动重登；不抛错给上层。
- **并行拉明细**：summary 单发 + amount/cost 并发（`Promise.all`）。
- **三处 baseUrl**：`api.deepseek.com`（API Key 模式）/ `platform.deepseek.com`（weblogin 模式）/ `status.deepseek.com`（状态页）。

---

## 4. OpenCode Go

**实现文件**：`src/providers/opencode-go.ts`（`OpenCodeGoProvider`）
**鉴权方式**：Bearer API Key
**API Key 申请**：https://opencode.ai/auth
**配套环境变量**：`OPENCODE_API_KEY`（文档约定，实际读 Settings）

### 4.1 接口清单（只 1 个端点）

| 端点 | 用途 |
|---|---|
| `GET https://opencode.ai/zen/go/v1/usage` | 拉三窗口用量 |

实际请求示例：

```powershell
$headers = @{ 'Authorization' = 'Bearer <OC_GO_KEY>'; 'Accept' = 'application/json' }
Invoke-RestMethod -Uri 'https://opencode.ai/zen/go/v1/usage' -Headers $headers
```

### 4.2 响应结构

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 0,  "resetsAt": "2026-08-18T19:00:00+00:00" },
    "weekly":  { "status": "ok", "percent": 11, "resetsAt": "2026-08-17T00:00:00+00:00" },
    "monthly": { "status": "ok", "percent": 5,  "resetsAt": "2026-09-01T00:00:00+00:00" }
  }
}
```

```ts
interface OpenCodeGoWindow {
  status: string;     // 'ok' 才入库
  percent: number;    // 已用百分比 0-100
  resetsAt: string;   // ISO 时间戳
}
```

### 4.3 三个窗口

| 键 | UI 标签 | 实际周期 | limitType |
|---|---|---|---|
| `rolling` | `quota.opencodeGo5h` | 5 小时滚动 | `5h` |
| `weekly` | `quota.opencodeGoWeekly` | 自然周 | `weekly` |
| `monthly` | `quota.opencodeGoMonthly` | 自然月 | `monthly` |

固定渲染顺序：`rolling → weekly → monthly`（`WINDOW_ORDER` 常量），不依赖返回顺序。

### 4.4 套餐范围

OpenCode Go 套餐覆盖 8 个精选模型：Grok 4.5 / Kimi K3 / GLM 5.2 / MiniMax M3 / DeepSeek V4 Pro-Flash / GPT 5.6 Luna / Hy3 / MiMo-V2.5。API 当前**不暴露分模型用量**，只能看到三窗口总百分比。

### 4.5 实现要点

- **60s 进程级缓存**：`responseCache: Map<apiKey, {at, resp}>`，避免短刷新间隔的重复请求。rolling 窗口 60s 内变化 < 1%，对用户不可见。
- **无效窗口过滤**：`status !== 'ok'` 直接 `continue`，不出现在 UI。
- **托盘显示**：取三个窗口中**剩余最少**的那个百分比，符合「最紧额度」逻辑。
- **错误**：响应无 `usage` 块 → 抛 `[OpenCode Go] Invalid API response: missing usage block`；无 ok 窗口 → 抛 `[OpenCode Go] No usable window data in response`；401/403 由 `HttpClientWithRetry` 抛 `HTTP 401: ...`。

### 4.6 与 OpenCode Zen 的区别

| 维度 | Zen | Go |
|---|---|---|
| 计费 | 预付费余额 | 订阅（首月 $5，之后 $10/月） |
| API 路径前缀 | `/zen/v1/*` | `/zen/go/v1/*` |
| 是否覆盖 | 全模型 | 8 个精选 |
| 配额维度 | 余额扣减 | 5h 窗口 + 周 + 月 |

**踩坑记录**：用 Zen 端点去查 Go 订阅 key 会被 401 拒绝；用 Go 端点查 Zen key 同样 401。两个体系隔离。

---

## 5. 通用实现细节

### 5.1 Provider 接口契约

```ts
// src/shared/types.ts
interface Provider {
  name: string;
  fetchUsage(config: ProviderConfig): Promise<UsageResult>;
}

interface UsageResult {
  used: number;       // 托盘主百分比（已用）
  total: number;      // 托盘分母（一般 100）
  expiresAt: string;  // ISO，下一次重置
  details: {
    quotas: QuotaItem[];
    [其他面板字段]?: any;
  };
}

interface QuotaItem {
  label: string;             // i18n 键
  labelParams?: Record<string, string | number>;
  used: number;
  total: number;
  usageRate: number;         // 0-100，已用百分比
  resetAt: string;           // ISO
  startAt?: string;          // 区间开始（部分 provider 用）
  periodHours?: number;
  limitType?: string;        // 'tokens' | 'mcp' | '5h' | 'weekly' | 'monthly' | 'daily' ...
  displayUnit?: 'percent' | 'count';
  hideBar?: boolean;         // 隐藏进度条（纯数值卡）
  currency?: string;         // DeepSeek 用
}
```

### 5.2 HttpClientWithRetry

`src/main/http.ts` 实现，所有 provider 共用：

```ts
new HttpClientWithRetry(maxRetries, baseDelayMs)
// 默认构造：3 次重试，1 秒基础退避
// 关键请求（如 zhipu quota）：5 次重试，1.2 秒基础退避
```

退避策略：指数退避（`baseDelay * 2^attempt`）。

### 5.3 时区与时间戳

- **智谱**：`nextResetTime` 是毫秒时间戳。
- **MiniMax**：`start_time / end_time` 可能是秒或毫秒（`n < 1e12` 判秒）。
- **DeepSeek / OpenCode Go**：`resetsAt` 是带时区 ISO（`Date.parse` 解析）。
- 全部统一输出 ISO（`toISOString()`）给 UI。

### 5.4 Provider 注册

```ts
// src/main/loader.ts
const PROVIDER_CLASSES = {
  'zhipu': ZhipuProvider,
  'minimax': MiniMaxProvider,
  'deepseek': DeepSeekProvider,
  'opencode-go': OpenCodeGoProvider,
  // 还有 mimo, codex, kimi
};
```

```ts
// app.build.ts
{ key: 'opencode-go', available: true, envVar: 'OPENCODE_API_KEY', baseUrl: 'https://opencode.ai', websiteUrl: 'https://opencode.ai/auth' }
```

`available: true` 决定 SettingsView 是否展示该 provider；`envVar` 是文档约定的环境变量名（不强制读取）；`baseUrl` 是默认 baseUrl；`websiteUrl` 是「获取 API Key」链接。

### 5.5 i18n 键

每个 provider 都有独立的 quota 标签键，渲染时由前端 i18n 翻译。所有键都在 `src/shared/locales/zh-CN.json` 和 `en-US.json` 双份维护，**写漏一份前端就显示 raw key**。

---

## 6. 复现命令速查

### 6.1 GLM 余额

```powershell
$env:GLM_KEY = 'your-api-key'
$headers = @{ 'Authorization' = "Bearer $env:GLM_KEY" }
Invoke-RestMethod -Uri 'https://bigmodel.cn/api/monitor/usage/quota/limit' -Headers $headers | ConvertTo-Json -Depth 8
```

### 6.2 MiniMax 余额

```powershell
$env:MINIMAX_KEY = 'your-api-key'
$headers = @{ 'Authorization' = "Bearer $env:MINIMAX_KEY" }
Invoke-RestMethod -Uri 'https://www.minimaxi.com/v1/token_plan/remains' -Headers $headers | ConvertTo-Json -Depth 6
```

### 6.3 DeepSeek 余额（API Key 模式）

```powershell
$env:DS_KEY = 'sk-...'
$headers = @{ 'Authorization' = "Bearer $env:DS_KEY" }
Invoke-RestMethod -Uri 'https://api.deepseek.com/user/balance' -Headers $headers
```

### 6.4 DeepSeek 明细（WebLogin 模式）

需先从浏览器登录 `https://platform.deepseek.com` → DevTools → `JSON.parse(localStorage.userToken).value` 提取 token。

```powershell
$token = '...'
$headers = @{
  'Authorization' = "Bearer $token"
  'User-Agent'    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
  'Referer'       = 'https://platform.deepseek.com/usage'
  'Origin'        = 'https://platform.deepseek.com'
}
# 概要
Invoke-RestMethod -Uri 'https://platform.deepseek.com/api/v0/users/get_user_summary' -Headers $headers
# 本月 token 用量
$month = (Get-Date).Month; $year = (Get-Date).Year
Invoke-RestMethod -Uri "https://platform.deepseek.com/api/v0/usage/amount?month=$month&year=$year" -Headers $headers
# 本月费用
Invoke-RestMethod -Uri "https://platform.deepseek.com/api/v0/usage/cost?month=$month&year=$year" -Headers $headers
```

### 6.5 OpenCode Go 用量

```powershell
$env:OPENCODE_GO_KEY = 'sk-...'
$headers = @{ 'Authorization' = "Bearer $env:OPENCODE_GO_KEY"; 'Accept' = 'application/json' }
Invoke-RestMethod -Uri 'https://opencode.ai/zen/go/v1/usage' -Headers $headers | ConvertTo-Json -Depth 6
```

### 6.6 服务状态（DeepSeek 专用）

```powershell
Invoke-RestMethod -Uri 'https://status.deepseek.com/api/v2/summary.json' | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri 'https://status.deepseek.com/api/v2/incidents.json' | ConvertTo-Json -Depth 4
```

---

## 附录 A：套餐类型速查

| Provider | 套餐识别字段 | 典型值 | 重置规则 |
|---|---|---|---|
| Zhipu | `quota/limit` 响应的 `data.level` + `hasWeeklyLimit`（`unit=1, number=7`） | `lite` / `pro` / `max` | 由 `unit` + `number` 决定（小时/天/周/月） |
| MiniMax | 无显式套餐字段，通过 status 区分有限/无限 | Token Plan | 5h 滚动 + 自然周 |
| DeepSeek | 余额即套餐额度 | 充值为 `topped_up_balance`，赠送为 `granted_balance` | 按量扣费，无重置 |
| OpenCode Go | `OPENCODE_API_KEY` 本身绑定 Go 订阅 | Go 订阅（$5/10） | 5h 滚动 + 自然周 + 自然月 |

## 附录 B：API Key 申请入口

| Provider | URL | 备注 |
|---|---|---|
| GLM | https://bigmodel.cn/usercenter/apikeys | 实名后开通 |
| MiniMax | https://www.minimaxi.com/user-center/basic-information/interface-key | 注册送试用 |
| DeepSeek | https://platform.deepseek.com/api_keys | 可仅 API Key 模式 |
| DeepSeek WebLogin | https://platform.deepseek.com | 登录后用 DevTools 提 token |
| OpenCode Go | https://opencode.ai/auth | 订阅后创建 key |

## 附录 C：错误码速查

| Provider | 错误码 / 信号 | 含义 | 处理 |
|---|---|---|---|
| Zhipu | `code !== 200` | 配额 API 错误 | 抛 `Quota API error: <msg>` |
| MiniMax | `base_resp.status_code !== 0` | 业务错误 | 抛 `API error: <status_msg>` |
| DeepSeek (web) | `code === 40002` | TOKEN_EXPIRED | 返回 `error: 'TOKEN_EXPIRED'`，触发自动重登 |
| DeepSeek (web) | `is_available === false` | 账号不可用 | 抛 `[DeepSeek] Account is not available` |
| OpenCode Go | HTTP 401/403 | key 错或过期 | 由 HttpClientWithRetry 抛 `HTTP 401: ...` |
| OpenCode Go | 响应无 `usage` | 端点路径错或 key 不属 Go | 抛 `Invalid API response: missing usage block` |

## 附录 D：相关源文件清单

| 文件 | 角色 |
|---|---|
| `src/providers/zhipu.ts` | GLM 套餐+明细 |
| `src/providers/zai-pricing.json` | GLM 模型定价表（热更新） |
| `src/providers/minimax.ts` | MiniMax 套餐+明细 |
| `src/providers/deepseek.ts` | DeepSeek 余额/明细/服务状态 |
| `src/main/deepseek-auth.ts` | DeepSeek webToken 提取/刷新/登出 |
| `src/providers/opencode-go.ts` | OpenCode Go 三窗口 |
| `src/main/http.ts` | `HttpClientWithRetry` 通用 HTTP 客户端 |
| `src/providers/index.ts` | 4 个 provider 的 re-export |
| `src/main/loader.ts` | provider class 注册表 |
| `app.build.ts` | provider 元数据（key / available / baseUrl / websiteUrl） |
| `src/shared/types.ts` | `Provider` / `UsageResult` / `QuotaItem` 类型定义 |
| `src/renderer/src/components/{Provider}Section.vue` | 每个 provider 的 UI 渲染 |
