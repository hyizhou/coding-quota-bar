# MiniMax API 调用与用量查询说明

更新时间：2026-06-21

本文档说明本项目当前如何查询 MiniMax Token Plan 用量，并补充 MiniMax 模型调用接口的最新要点。核对来源以 MiniMax 官方文档为准：

- Token Plan FAQ（中文）：https://platform.minimaxi.com/docs/token-plan/faq
- Token Plan FAQ（英文）：https://platform.minimax.io/docs/token-plan/faq
- API Overview：https://platform.minimax.io/docs/api-reference/api-overview
- OpenAI SDK（中文）：https://platform.minimaxi.com/docs/api-reference/text-openai-api
- Anthropic SDK（中文）：https://platform.minimaxi.com/docs/api-reference/text-anthropic-api
- OpenAI Chat Completions：https://platform.minimax.io/docs/api-reference/text-chat-openai
- OpenAI Responses API：https://platform.minimax.io/docs/api-reference/responses-create
- Anthropic Messages：https://platform.minimax.io/docs/api-reference/text-chat-anthropic
- OpenAI SDK：https://platform.minimax.io/docs/api-reference/text-openai-api
- Anthropic SDK：https://platform.minimax.io/docs/api-reference/text-anthropic-api

## 0. 这次最新核对结论

截至 2026-06-21，MiniMax 官方文档仍然把 Token Plan 用量查询接口写作 `/v1/token_plan/remains`。普通按量 API Key 和 Token Plan 的 Subscription Key 仍是两套独立凭证，不能混用。模型调用接口方面，官方现在同时提供 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 三种兼容协议，其中 API Overview 明确把 Anthropic 兼容接口标为推荐方式。

本项目当前只查询 Token Plan 剩余额度，不在 MiniMax provider 里发起模型生成请求。因此代码正确性主要取决于：

- `apiKey` 填的是 Token Plan 的 Subscription Key。
- 用量查询请求走 `https://www.minimaxi.com/v1/token_plan/remains` 或 `https://www.minimax.io/v1/token_plan/remains`。
- 显示层把 `current_interval_remaining_percent` / `current_weekly_remaining_percent` 当作“剩余百分比”，不要再把加成后的总额度误显示成 `200%` 剩余。
- 次数型额度以 `total_count` 和 `remaining_percent` 交叉判断，避免把字段名里的 `usage_count` 误当作已用次数。

## 1. Key 类型

MiniMax 目前需要区分两类 Key：

| 类型 | 用途 | 说明 |
| --- | --- | --- |
| Subscription Key / Token Plan Key | Token Plan 套餐额度、已购 Credits | 官方文档说明该 Key 与普通按量计费 API Key 相互独立，不能混用。 |
| Pay-as-you-go API Key | 普通开放平台 API 按量计费 | 用账户余额按实际 token 或资源消耗计费。 |

本项目 MiniMax provider 的 `apiKey` 应填写 Token Plan 的 Subscription Key，因为当前实现查询的是 Token Plan 剩余额度。

如果后续要调用模型，也要先决定消耗哪种额度：

- 使用 Subscription Key 调用标准模型接口时，消耗 Token Plan 或已购 Credits。
- 使用普通 API Key 调用标准模型接口时，走账户余额按量计费。
- 查询 `/v1/token_plan/remains` 时应使用 Subscription Key；普通 API Key 不适合作为该接口的凭证。

## 2. Token Plan 用量查询接口

### 2.1 接口

中文站点：

```bash
curl --location 'https://www.minimaxi.com/v1/token_plan/remains' \
  --header 'Authorization: Bearer <Subscription Key>' \
  --header 'Content-Type: application/json'
```

国际站点：

```bash
curl --location 'https://www.minimax.io/v1/token_plan/remains' \
  --header 'Authorization: Bearer <Subscription Key>' \
  --header 'Content-Type: application/json'
```

本项目默认使用 `https://www.minimaxi.com/v1/token_plan/remains`，与中文官方文档一致。代码现在也兼容把 base URL 配成以下形式后自动归一化：

- `https://www.minimaxi.com`
- `https://www.minimaxi.com/v1`
- `https://api.minimaxi.com/v1`
- `https://api.minimaxi.com/anthropic`
- `https://api.minimaxi.com/anthropic/v1`
- `https://api.minimax.io/v1`
- `https://api.minimax.io/anthropic`
- `https://api.minimax.io/anthropic/v1`

最终都会拼成当前 host 下的 `/v1/token_plan/remains`。

### 2.2 官方已确认的用量规则

- Token Plan 现在是统一额度池，不再要求用户按模型分别计算额度。
- 文本、图片、语音等 Token Plan 覆盖范围内的模型用量共享同一套额度。
- 控制台用量条是用户侧判断剩余额度的主要依据。
- 套餐内额度受 5 小时窗口和周窗口控制。官方 FAQ 对文本模型说明为动态 5 小时滚动窗口，视频等模型仍以接口返回的窗口起止时间为准。
- 达到 5 小时或周额度上限后，可等待窗口重置、升级套餐、使用已购 Credits 覆盖合规超额用量，或切换普通按量计费 API Key。

### 2.3 当前实现解析的响应结构

官方 FAQ 给出了用量查询接口，但没有公开完整 JSON schema。项目按当前实际返回字段做防御式解析，核心结构如下：

```json
{
  "model_remains": [
    {
      "model_name": "general",
      "start_time": 1780279200000,
      "end_time": 1780297200000,
      "remains_time": 18000000,
      "current_interval_total_count": 0,
      "current_interval_usage_count": 0,
      "current_interval_status": 1,
      "current_interval_remaining_percent": 100,
      "current_weekly_total_count": 0,
      "current_weekly_usage_count": 0,
      "current_weekly_status": 1,
      "current_weekly_remaining_percent": 100,
      "weekly_start_time": 1780063200000,
      "weekly_end_time": 1780668000000,
      "weekly_remains_time": 604800000,
      "interval_boost_permille": 1000,
      "weekly_boost_permille": 1000
    }
  ],
  "base_resp": {
    "status_code": 0,
    "status_msg": ""
  }
}
```

### 2.4 字段说明

| 字段 | 类型 | 说明 | 项目处理 |
| --- | --- | --- | --- |
| `base_resp.status_code` | number | MiniMax 业务状态码，`0` 表示成功。 | 非 0 时抛出 API 错误。字段缺失但有 `model_remains` 时不直接失败。 |
| `base_resp.status_msg` | string | 错误或状态描述。 | 用于错误信息。 |
| `model_remains` | array | 各类别额度列表。 | 每个元素转换为 5 小时额度和周额度两张显示项。 |
| `model_name` | string | 常见值：`general`、`video`。 | `general` 显示为 `MiniMax`，`video` 显示为 `Video`。未知值直接显示原值。 |
| `start_time` / `end_time` | number | 5 小时窗口开始/结束时间。当前返回通常是毫秒时间戳。 | 转成 ISO 时间。若未来返回秒级时间戳，也会兼容。 |
| `weekly_start_time` / `weekly_end_time` | number | 周窗口开始/结束时间。 | 转成 ISO 时间。 |
| `current_interval_total_count` | number | 5 小时窗口次数总量。大于 0 时表示次数额度，例如 Video。 | 作为次数额度总量。 |
| `current_interval_usage_count` | number | 字段名像“已用次数”，但实际返回中可能是剩余次数。 | 结合 `remaining_percent` 自动判断是已用还是剩余，再转成已用次数。 |
| `current_interval_remaining_percent` | number | 5 小时窗口剩余百分比，0-100。 | 作为百分比显示和进度条的权威来源。 |
| `current_interval_status` | number | 观察到 `1` 为有限额度，`3` 为无限额度。 | `3` 显示为无限额度并隐藏进度条。 |
| `current_weekly_*` | number | 周窗口对应字段。 | 同 5 小时窗口。 |
| `interval_boost_permille` / `weekly_boost_permille` | number | 千分位加成，`1000` 表示 1x，`2000` 表示 2x。 | 仅作为显示补充，不再把 100% 剩余额度误显示为 200%。 |

### 2.5 本项目的显示映射

MiniMax 响应里混有两类额度，本项目现在显式标记 `displayUnit`：

| 场景 | 条件 | UI 显示 |
| --- | --- | --- |
| 百分比额度 | `total_count === 0` 且非无限额度 | 右侧显示剩余百分比，例如 `100%`；底部显示 `已用 0%`。 |
| 加成百分比额度 | `boost_permille > 1000` | 右侧仍显示接口返回的剩余百分比，例如 `100%`；底部显示 `总额度 200% · 已用 0%`。 |
| 次数额度 | `total_count > 0` | 右侧显示剩余次数，例如 `3`；底部显示 `0 / 3`。 |
| 无限额度 | `status === 3` | 右侧显示 `∞`，底部显示 `∞ 无限制`，隐藏进度条。 |

托盘图标只显示一个剩余百分比。MiniMax provider 现在取 `general` 模型的 5 小时窗口和周窗口中更紧张的非无限额度；如果二者都是无限额度，则显示 100。

## 3. MiniMax 模型调用接口

本项目当前只接入 MiniMax Token Plan 用量查询，没有在 provider 中发起模型生成请求。若后续要添加 MiniMax 模型调用，官方当前推荐以下三种接口。

### 3.1 OpenAI Chat Completions

Base URL：

```bash
export OPENAI_BASE_URL=https://api.minimaxi.com/v1
export OPENAI_API_KEY=<API Key 或 Subscription Key>
```

国际站点可使用 `https://api.minimax.io/v1`。中文站点文档当前使用 `https://api.minimaxi.com/v1`。

请求：

```bash
curl --request POST \
  --url https://api.minimaxi.com/v1/chat/completions \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "MiniMax-M3",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ],
    "max_completion_tokens": 1000
  }'
```

主要返回：

```json
{
  "id": "066a33a7d290378f8a9e57a055812afa",
  "object": "chat.completion",
  "created": 1780154535,
  "model": "MiniMax-M3",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "...",
        "name": "MiniMax AI",
        "audio_content": ""
      }
    }
  ],
  "usage": {
    "prompt_tokens": 1366,
    "completion_tokens": 293,
    "total_tokens": 1659,
    "prompt_tokens_details": {
      "cached_tokens": 114
    }
  },
  "total_characters": 12345,
  "input_sensitive": false,
  "output_sensitive": false,
  "input_sensitive_type": 0,
  "output_sensitive_type": 0,
  "output_sensitive_int": 0,
  "base_resp": {
    "status_code": 0,
    "status_msg": ""
  }
}
```

注意事项：

- 新集成优先使用 `max_completion_tokens`，`max_tokens` 是旧字段；两个字段都不传时，官方默认值为 `4096`。
- `MiniMax-M3` 支持文本、图片、视频输入；`M2.x` 系列只支持文本和工具调用内容块。
- `thinking` 省略时，Chat Completions 下 M3 默认启用思考内容；可传 `{ "type": "disabled" }` 关闭。
- `reasoning_split` 只改变思考内容的返回格式，不负责开启或关闭思考。开启后可从 `reasoning_content` 或 `reasoning_details` 读取思考内容，具体取决于请求配置。
- 流式请求可设置 `stream_options.include_usage=true` 以便在流里拿到 token 用量。
- `base_resp.status_code` 仍是 MiniMax 业务状态码；HTTP 成功不代表业务一定成功。
- 最新返回中可能包含 `total_characters`、`input_sensitive_type`、`output_sensitive_type`、`output_sensitive_int` 等安全/统计字段。调用方应按需读取，不要把未知字段当作错误。

### 3.2 OpenAI Responses API

MiniMax 官方文档现在列出了 OpenAI Responses API 兼容接口。

请求：

```bash
curl --request POST \
  --url https://api.minimaxi.com/v1/responses \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "MiniMax-M3",
    "input": "Hello!"
  }'
```

主要返回：

```json
{
  "id": "abc123",
  "object": "response",
  "created_at": 1764000000,
  "model": "MiniMax-M3",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Hello! I'm MiniMax. How can I help you today?",
          "annotations": []
        }
      ]
    }
  ],
  "output_text": "Hello! I'm MiniMax. How can I help you today?",
  "usage": {
    "input_tokens": 8,
    "input_tokens_details": {
      "cached_tokens": 0
    },
    "output_tokens": 14,
    "output_tokens_details": {
      "reasoning_tokens": 0
    },
    "total_tokens": 22
  },
  "parallel_tool_calls": true,
  "store": false,
  "truncation": "disabled"
}
```

相关接口：

```bash
curl --request POST \
  --url https://api.minimaxi.com/v1/responses/input_tokens \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "MiniMax-M3",
    "input": "Hello!"
  }'
```

返回：

```json
{
  "object": "response.input_tokens",
  "input_tokens": 8
}
```

Responses API 下 M3 的 `reasoning` 默认是关闭的；设置 `reasoning.effort` 为 `minimal`、`low`、`medium` 或 `high` 会启用思考输出，但官方说明这些值不会调节 M3 的推理深度。M2.x 模型的思考不能关闭。

返回处理建议：

- `status` 可能是 `completed`、`incomplete`、`failed` 等状态，业务代码应先判断状态，再读取 `output_text`。
- `output` 是结构化内容数组，可能包含 message、reasoning、function call 等不同类型；简单文本场景可直接读 `output_text`。
- `usage` 字段命名与 Chat Completions 不同：这里是 `input_tokens`、`output_tokens`、`total_tokens`。
- 失败或截断时可能出现 `error`、`incomplete_details` 等字段，调用方应保留原始响应用于排查。

### 3.3 Anthropic Messages

Base URL：

```bash
export ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
export ANTHROPIC_API_KEY=<API Key 或 Subscription Key>
```

国际站点可使用 `https://api.minimax.io/anthropic`。

请求：

```bash
curl --request POST \
  --url https://api.minimaxi.com/anthropic/v1/messages \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "MiniMax-M3",
    "max_tokens": 1000,
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "Hello!" }
        ]
      }
    ]
  }'
```

主要返回：

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "model": "MiniMax-M3",
  "content": [
    {
      "type": "text",
      "text": "..."
    }
  ],
  "usage": {
    "input_tokens": 1209,
    "output_tokens": 214,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 157
  },
  "stop_reason": "end_turn"
}
```

注意事项：

- Anthropic 兼容接口下，M3 的 `thinking` 默认关闭，可用 `thinking: {"type": "adaptive"}` 开启。
- 多轮工具或思考链路中，需要把完整的 assistant content blocks 原样追加回历史。
- `top_k`、`stop_sequences`、`mcp_servers` 等部分 Anthropic 参数会被忽略。
- 可用 `POST /anthropic/v1/messages/count_tokens` 估算输入 token。
- 认证推荐使用 `Authorization: Bearer <token>`；若同时传 `x-api-key`，需要明确约定优先级，避免调试时误用旧 Key。
- 返回 `usage` 使用 Anthropic 命名：`input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens`，不要复用 OpenAI 的 `prompt_tokens` / `completion_tokens` 解析逻辑。

## 4. 这次核对后的结论

1. 用量查询路径应使用 `/v1/token_plan/remains`。旧的 Coding Plan 命名接口不应再作为当前实现依据。
2. 中文官方站点使用 `www.minimaxi.com`，英文官方站点使用 `www.minimax.io`。项目默认 `www.minimaxi.com` 是合理的。
3. 官方没有公开 `token_plan/remains` 的完整响应 schema，所以代码不能强依赖所有字段必定存在。
4. `current_interval_usage_count` / `current_weekly_usage_count` 字段名不够可靠，当前实现用 `remaining_percent` 与 `total_count` 做一致性判断，避免把“剩余次数”显示成“已用次数”。
5. 100% 显示错误的主要原因不是接口，而是前端把加成后的总额度当成剩余百分比显示。现在百分比额度始终以接口的剩余百分比显示，加成只作为底部说明。
6. Chat Completions 最新返回中增加或公开了更多统计/安全字段，例如 `total_characters`、`input_sensitive_type`、`output_sensitive_type`、`output_sensitive_int`。当前项目未调用该接口，但后续接入时应做宽松解析。
7. Responses API 和 Anthropic Messages 的返回结构与 Chat Completions 明显不同，不能共用一套 `choices[0].message.content` 解析逻辑。
8. 如果后续增加 MiniMax 模型调用，OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 都是当前官方文档列出的有效方式；选择哪一种取决于上游工具协议。若没有历史包袱，优先考虑 Anthropic 兼容接口或 Responses API。
