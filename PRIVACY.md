# Privacy Policy / 隐私政策

**Coding Quota Bar**

## English

Last updated: 2026-09-01

Coding Quota Bar is an open-source desktop tray utility that displays usage of your AI Coding Plan subscriptions. This policy explains what data the app handles and where it goes.

**What is stored locally on your device**

- Provider API keys and web-login tokens you configure, saved in `config.json` under the app's user-data directory. API keys are encrypted with Windows `safeStorage`.
- A Codex access-token cache (`codex-auth-cache.json`, encrypted) to avoid refreshing tokens on every startup.
- DeepSeek / MiMo login cookies, stored by Electron session partitions on your device.

**What is transmitted, and to whom**

- Requests are sent only to the official APIs of the platforms you configure (e.g. bigmodel.cn, api.deepseek.com, platform.xiaomimimo.com, chatgpt.com, and the providers you enable), using the credentials you entered, for the sole purpose of fetching usage data.
- The app contains no telemetry, no analytics, and no third-party trackers.

**What we do not do**

- We do not collect, upload, or share your account data, API keys, or usage statistics with anyone.
- We do not read credentials of platforms you have not enabled.

**Source code**: https://github.com/hyizhou/coding-quota-bar — every claim above can be verified in the open repository.

## 中文

最后更新：2026-09-01

Coding Quota Bar 是一款开源桌面托盘工具，用于展示各 AI Coding Plan 套餐用量。本政策说明应用处理的数据及其去向。

**本地存储在你设备上的数据**

- 你主动配置的各平台 API Key 与网页登录 token，保存在应用用户数据目录的 `config.json` 中；API Key 使用 Windows `safeStorage` 加密。
- Codex 访问令牌缓存（`codex-auth-cache.json`，加密存储），避免每次启动都刷新令牌。
- DeepSeek / MiMo 登录 Cookie，由 Electron session 分区保存在你的设备上。

**数据传输对象与范围**

- 仅向你启用的各平台官方 API（如 bigmodel.cn、api.deepseek.com、platform.xiaomimimo.com、chatgpt.com 等）发起请求，使用你填写的凭据，且仅用于获取用量数据。
- 应用不含任何遥测、统计或第三方追踪代码。

**我们不会做的事**

- 不会收集、上传或向任何人共享你的账户数据、API Key 或用量统计。
- 不会读取你未启用的平台的任何凭据。

**源代码**：https://github.com/hyizhou/coding-quota-bar —— 以上内容均可在开源仓库中验证。
