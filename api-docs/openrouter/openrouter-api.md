# OpenRouter 用量查询 API

## 基础信息

| 项目 | 值 |
|------|-----|
| Host | `openrouter.ai` |
| 协议 | HTTPS |
| 认证 | Header `Authorization` 传 Bearer API Key |

### 通用请求头

```
Authorization: Bearer <api-key>
Accept: application/json
```

### API Key 获取

- 登录 [openrouter.ai](https://openrouter.ai) 后进入 Keys 页面（`openrouter.ai/settings/keys`）创建
- 创建时可命名，可选设置 Credit limit（消费上限，即接口 2 中的 `limit` 字段来源；不设则不限）
- Key 仅在创建时显示一次，需立即保存
- OpenRouter 为预付费模式：查询接口无需充值即可调用，但余额字段需有充值记录才有意义；未充值时 `is_free_tier` 为 `true` 且余额为 0

---

## 1. 余额/充值信息查询

```
GET /api/v1/credits
```

### 参数

无。

### 返回值示例

```json
{
  "data": {
    "total_credits": 120,
    "total_usage": 48.5
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.total_credits` | number / string | 累计充值金额（USD） |
| `data.total_usage` | number / string | 累计消耗金额（USD） |
| `data.balance` | number / string | 当前余额（USD）。存在时优先使用，此时 `total_credits` / `total_usage` 可能缺省；缺省时按 `total_credits - total_usage` 计算剩余额度 |

---

## 2. Key 用量/限额查询

```
GET /api/v1/key
```

### 参数

无。

### 返回值示例

```json
{
  "data": {
    "label": "sk-or-v1-d9b...fcc",
    "is_management_key": false,
    "is_provisioning_key": false,
    "limit": 25,
    "limit_reset": "daily",
    "limit_remaining": 25,
    "include_byok_in_limit": false,
    "usage": 0,
    "usage_daily": 0,
    "usage_weekly": 0,
    "usage_monthly": 0,
    "byok_usage": 0,
    "byok_usage_daily": 0,
    "byok_usage_weekly": 0,
    "byok_usage_monthly": 0,
    "is_free_tier": false,
    "expires_at": "2027-01-15T08:00:00.000Z",
    "creator_user_id": "user_xxxxx",
    "rate_limit": {
      "requests": -1,
      "interval": "10s",
      "note": "This field is deprecated and safe to ignore."
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.label` | string | Key 名称（掩码，如 `sk-or-v1-d9b...fcc`） |
| `data.is_management_key` | boolean | 是否管理 Key |
| `data.is_provisioning_key` | boolean | 是否 provisioning Key |
| `data.limit` | number / string | 预付限额（USD），未设置时为 0 或缺省 |
| `data.limit_reset` | string \| null | 限额重置周期标识，如 `"daily"`；未设置为 `null` |
| `data.limit_remaining` | number / string | 限额剩余（USD） |
| `data.include_byok_in_limit` | boolean | BYOK 消费是否计入限额 |
| `data.usage` | number / string | 限额内已用（USD），可能缺省，用 `limit - limit_remaining` 兜底 |
| `data.usage_daily` | number / string | 今日消费（USD），仅统计本 Key |
| `data.usage_weekly` | number / string | 本周消费（USD），仅统计本 Key |
| `data.usage_monthly` | number / string | 本月消费（USD），仅统计本 Key |
| `data.byok_usage` | number / string | 自带 Key（BYOK）累计消费（USD），独立计量 |
| `data.byok_usage_daily` / `_weekly` / `_monthly` | number / string | BYOK 今日 / 本周 / 本月消费（USD） |
| `data.is_free_tier` | boolean | 是否免费层（区分 Free Tier / Pay-as-you-go） |
| `data.expires_at` | string \| null | Key 过期时间，ISO 8601；不过期为 `null` |
| `data.creator_user_id` | string | 创建者用户 ID |
| `data.rate_limit` | object | 官方已标注 deprecated，忽略 |

---

## 统计口径

- `/api/v1/credits` 为**账户级**累计数据，`total_credits` / `total_usage` 覆盖账户全部 Key 与历史消费
- `/api/v1/key` 为**单 Key** 限额度量，`limit` / `usage_*` 仅针对当前 Key
- 两接口数字可能不一致（如账户已消费但当前 Key 未使用），属口径差异而非异常
- 设置 `limit_reset`（如 `daily`）时，`limit` 按该周期重置
- BYOK 消费记录在 `byok_usage*`，`include_byok_in_limit=false` 时不计入 `usage_*`

---

## 错误处理

| 状态码 | 说明 |
|--------|------|
| 401 | API Key 无效 |
| 403 | 无权限 |

- 两接口相互独立，任一失败可降级只用另一个
- 数字字段可能以 JSON number 或 string 返回，解析时需兼容

