# Coding Quota Bar

[![GitHub release](https://img.shields.io/github/v/release/hyizhou/coding-quota-bar)](https://github.com/hyizhou/coding-quota-bar/releases/latest)
[![GitHub downloads](https://img.shields.io/github/downloads/hyizhou/coding-quota-bar/total)](https://github.com/hyizhou/coding-quota-bar/releases)
[![Microsoft Store](https://img.shields.io/badge/Microsoft_Store-%E8%8E%B7%E5%8F%96-0078D4?logo=windows)](https://apps.microsoft.com/detail/9P6D6QRN7G7D)
![license](https://img.shields.io/github/license/hyizhou/coding-quota-bar)

Windows 托盘工具，实时监控各 AI 平台 Coding Plan 用量。

图标直接显示剩余百分比，颜色预警，一眼掌握额度，无需打开网页后台，不打断编码流程。

## 预览

![使用](img/1.gif)

## 功能

### 托盘图标实时显示

托盘图标直接展示剩余百分比，颜色随阈值变化：

- **绿色** — 剩余 > 50%，放心用
- **黄色** — 剩余 20%-50%，注意控制
- **红色** — 剩余 < 20%，省着点

显示规则可配置：所有账户中最低 / 最高，或固定跟随某一账户，默认取最低。

鼠标悬浮或点击图标即可弹出详情面板，查看各平台的详细用量。

### 多平台支持

| 平台 | 认证方式 | 监控内容 |
|------|----------|----------|
| **智谱 AI** | API Key | 5 小时 / 周积分额度（v3 积分制）或次数额度（v1/v2）、MCP 用量、订阅代际（V1/V2/V3）、用量趋势图表、模型性能、预估费用 |
| **DeepSeek** | API Key / 网页登录 | 账户余额（总余额/赠送/充值）、月度用量、自定义预算进度条、API 与网页服务 90 天运行状态 |
| **MiniMax** | API Key | 5 小时 / 周额度（百分比制） |
| **MiMo** | 网页登录 | 套餐总用量、月度用量、Token 用量估算、账户余额 |
| **OpenCode Go** | API Key | 5 小时滚动窗口、周额度、月额度 |
| **Codex** | 读取本机 Codex CLI 登录 | 主窗口/次窗口限流、代码审查额度、Credits 余额、限流重置次数、使用统计、订阅到期 |
| **OpenRouter** | API Key（多 Key） | Key 限额与有效期、总余额、今日/本周/本月消费、累计充值与消费 |
| **Qoder** | 网页登录 / 手动粘贴 Cookie | big model credits 额度（主额度 + 共享额度合并）、重置倒计时，支持国际站/国内站 |

### 多账户管理

支持同一平台配置多个 API Key，例如同时监控工作号和测试号。多账户时自动显示切换标签页，托盘图标默认显示额度最低的账户。

### 用量趋势图表

- **Token 用量柱状图** — 7 天每小时粒度
- **MCP 工具调用统计** — 搜索、网页阅读、ZRead 等使用频次
- **模型性能折线图** — 解码速度和成功率趋势
- **智谱用量统计页** — 近一年每日用量热力图、本月/本周用量与上期对比、连续使用天数
- **预估费用** — 按 Token 用量估算 API 等价金额

### 服务状态监控

DeepSeek 用户可实时查看 API 服务和网页对话服务的运行状态，包括当前状态、90 天运行历史和 uptime 百分比。

### 其他特性

- **自动定时刷新** — 可配置 1-30 分钟刷新间隔
- **并发测试** — 对智谱 Coding Plan 的 OpenAI / Anthropic 接口发起可配置并发请求，统计首字延迟、输出速度与历史记录
- **API Key 加密** — 使用 Windows safeStorage 系统级加密
- **开机自启动**
- **深色/浅色主题** — 跟随系统或手动切换
- **国际化** — 中文 / 英文
- **自动更新** — 检测新版本后提示下载

## 技术栈

Electron 34 + Vue 3 + TypeScript + Vite 7

**架构亮点**：

- Provider 插件模式 — 各 AI 平台独立实现，注册表动态加载
- 多账户并行调度 — 不同服务商并行请求，同服务商串行避免限流
- 纯代码生成托盘图标 — 5x7 位图字体渲染，无外部图片依赖
- 编译时配置（`app.build.ts`）控制 Provider 可用性，运行时配置管理用户数据

## 安装

- [GitHub Releases](https://github.com/hyizhou/coding-quota-bar/releases) — NSIS 安装包，支持应用内自动更新
- Microsoft Store — 商店版（MSIX），数据与 NSIS 版相互独立

### 从源码构建

```bash
git clone https://github.com/hyizhou/coding-quota-bar.git
cd coding-quota-bar
npm install
npm run dev           # 开发模式
npm run package:win   # 打包 Windows 安装程序
```

## License

MIT
