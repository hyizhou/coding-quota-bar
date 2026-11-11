# 千问 / 阿里云百炼 Token Plan 用量查询说明

更新时间：2026-11-11

本文档说明本项目如何查询阿里云百炼（Model Studio）Token Plan 个人版的用量。接口形态核对自官方 `bailian-cli`（`bl` 2.8.4，`bl usage token-plan` / `bl auth login --console`），并以真实账户实测确认。

参考：

- Token Plan 个人版 FAQ：https://help.aliyun.com/zh/model-studio/token-plan-personal-faq
- 百炼 CLI 安装与鉴权：https://help.aliyun.com/zh/model-studio/cli/installation

## 0. 结论

- **Token Plan 的 `sk-sp-` 套餐 Key 查不到用量。** 实测 `token-plan.{region}.maas.aliyuncs.com` 下所有用量类路径均 404；`modelstudio.{region}.aliyuncs.com/tokenplan/subscription/stats` 要求 AK/SK 签名（`MissingDate`），且只覆盖团队版；DashScope `/api/v1/quotas` 直接拒绝该 Key。
- 用量只能经 **百炼控制台 CLI 网关** 查询，鉴权为 **控制台 access token**（浏览器登录控制台后由 `console-login` 页面回传）。官方 `bl usage token-plan` 走的就是这条链路。
- 网关只返回 **已用比例 + 重置时间**；套餐 Credits 总额需另查 `quota-config` 按套餐规格换算。

## 1. 获取控制台 access token（console-login）

1. 主进程在 `127.0.0.1` 随机端口启动一次性回调服务，生成随机 `state`。
2. 打开登录页（注意 `notice` 参数里第二个 `?` 原样拼接，与官方 CLI 一致）：

   ```
   {控制台 origin}/console-login?notice=127.0.0.1:{port}?state={state}
   ```

   官方 CLI 额外加 `&needapikey=true` 让页面顺带创建一个普通按量 API Key；本项目不需要，故不传。

3. 用户在控制台登录（已登录则页面加载即回传）后，页面向 `http://127.0.0.1:{port}/?state={state}` 回传凭证：
   - 先发 CORS 预检（`OPTIONS`），可能带 `Access-Control-Request-Private-Network: true`，需回 `Access-Control-Allow-Private-Network: true`。
   - `Origin` 为控制台 origin，其余来源一律 403；`state` 不匹配回 400。
   - `access_token` 可能出现在查询参数、JSON（顶层或 `data` 内）、`x-www-form-urlencoded` 或 `multipart/form-data` 中（字段名 `access_token` / `accessToken`）。
4. 收到 token 后用网关调一次 `usage` 校验（`NotLogined` 视为无效），通过后写入账户 `webToken`（ConfigManager 落盘时 `safeStorage` 加密）。

| 站点 | 控制台 origin | 网关 host | action | region |
| --- | --- | --- | --- | --- |
| 国内站（`region: 'cn'`） | `https://bailian.console.aliyun.com` | `bailian-cs.console.aliyun.com` | `BroadScopeAspnGateway` | `cn-beijing` |
| 国际站（`region: 'global'`） | `https://modelstudio.console.alibabacloud.com` | `bailian-singapore-cs.alibabacloud.com` | `IntlBroadScopeAspnGateway` | `ap-southeast-1` |

access token 为 36 位 UUID 形态，无 refresh token。失效后本项目用隐藏窗口复用 `persist:qwen-{accountId}` 中的控制台 Cookie 静默重走第 1 节流程；Cookie 也失效时提示用户重新登录（失败后 30 分钟内不再静默重试）。

## 2. 网关请求

```
POST https://{网关 host}/cli/api.json?action={action}&product=sfm_bailian&api={encodeURIComponent(api)}
Authorization: Bearer {access token}
Content-Type: application/x-www-form-urlencoded

params={JSON}&region={region}
```

`params` 为 JSON 字符串：

```json
{
  "Api": "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage",
  "V": "1.0",
  "Data": {
    "cornerstoneParam": {
      "protocol": "V2",
      "console": "ONE_CONSOLE",
      "productCode": "p_efm",
      "switchUserType": 3,
      "consoleSite": "BAILIAN_ALIYUN"
    }
  }
}
```

### 2.1 响应信封

成功（业务数据在 `data.DataV2.data.data`）：

```json
{
  "code": "200",
  "data": {
    "DataV2": {
      "ret": ["SUCCESS::接口调用成功"],
      "data": {
        "msg": "Success.",
        "code": "SUCCESS",
        "data": { "per1MonthPercentage": 0.13456812875, "per1MonthResetTime": 1796918400000 },
        "success": true
      }
    },
    "success": true,
    "errorCode": ""
  },
  "successResponse": true
}
```

未登录 / token 无效 / token 过期（HTTP 仍为 200）：

```json
{
  "code": "200",
  "data": {
    "success": false,
    "errorCode": "BailianGateway.Login.NotLogined",
    "errorMsg": "BailianGateway.Login.NotLogined"
  },
  "successResponse": true
}
```

`errorCode` 含 `NotLogined` → 本项目返回 `TOKEN_EXPIRED`，触发静默刷新 / 重新登录提示。

## 3. 三个接口

| api | 用途 | 业务数据示例 |
| --- | --- | --- |
| `zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage` | 各窗口已用比例 | `{ "per1MonthPercentage": 0.1346, "per1MonthResetTime": 1796918400000 }` |
| `zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription` | 套餐规格、状态、起止时间 | `{ "specCode": "standard", "status": "VALID", "remainingDays": 29, "startTime": 1794282059000, "endTime": 1796918400000, "autoRenewFlag": false }` |
| `zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config` | 各规格 Credits 总额 | `{ "lite": { "five_hour": 700, "monthly": 20000 }, "essential": { "five_hour": 1800, "monthly": 45000 }, "standard": { "five_hour": 3000, "monthly": 80000 }, "pro": { "five_hour": 12000, "monthly": 200000 }, "addon_quota": { "extrabundle": 20000 } }` |

### 3.1 usage 字段

- 字段名模式 `per{N}{Hour|Day|Week|Month}{Percentage|ResetTime}`（与官方 CLI 解析一致），实测个人版当前只返回 `per1Month`；`per5Hour` 等窗口出现时按同一规则解析。
- `Percentage` 为 **已用比例 0~1**；`ResetTime` 为 epoch 毫秒。
- 本周期尚无消耗时可能不返回任何窗口（官方 CLI 输出 `hasQuotaData: false`）。

### 3.2 展示换算

- QuotaItem 统一按百分比口径：`used = usageRate = Percentage × 100`，`total = 100`。
- 窗口 → `quota-config` 字段：`per5Hour → five_hour`、`per1Week → weekly`、`per1Month → monthly`；用 `subscription.specCode` 取对应规格总额，`usedCredits = round(Percentage × 总额)`，放入 `labelParams.usedCredits / totalCredits`。
- `quota-config` 为静态表，进程级缓存 6 小时；`subscription` / `quota-config` 失败只降级为纯百分比展示，不影响用量。
- 托盘取最紧张窗口的使用率；`level` 为规格名首字母大写（如 `Standard`），`expiresAt` 为订阅到期时间。
