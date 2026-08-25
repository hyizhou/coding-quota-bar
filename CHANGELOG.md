# Changelog
## [1.6.0] - 2026-08-18
### Added
- 智谱 GLM-5.3 定价条目（暂沿用 GLM-5.2 官方价）+ 兜底模型升级到 GLM-5.2
- 设置页"测试连接"按钮：API Key 旁加 ⚡，后端调 fetchUsage 验证有效性，显示耗时/错误
- 设置页 Provider 卡片状态徽标：标题旁加 🟢/🟡/⚪ 小圆点显示多账号总状态
- 设置页未保存提示：顶部黄色横幅 + 立即保存按钮 + 离开页面 beforeunload 警告
- 设置页颜色配置重做：阈值带滑块 + 3 张实时预览卡 + 颜色选择器
- 设置页顶部搜索框 + section 可点击折叠：7 个 provider 5 个 toggle 4 个 select 全可过滤
- 设置页导入/导出：脱敏/完整两种导出，导入前弹确认卡防误覆盖
- 设置页诊断面板：显示配置文件路径 + 打开目录 + 重新加载 + 批量 ping 所有 provider
- 主面板数字平滑过渡（useAnimatedNumber composable）：rAF + easeOutCubic，涨/跌配 ↑↓ 箭头
- 主面板 HSL 渐变进度条：连续色阶替代离散三色，绿(142°) → 黄 → 红(0°)
- 主面板 Footer 状态点：按刷新时间颜色编码（< 1min 绿 / 1-5min 黄脉冲 / > 5min 红脉冲）
- 主面板 QuotaCard 预估爆仓时间：(100 - usageRate) / burnRatePerHour，< 2h 红闪烁 / < 8h 黄
- 主面板 Insights 洞察模块：周对比 + 主力模型 + 高峰时段（数据确定算法，不调 LLM）
- 7 个新 IPC：test-provider-connection / export-config / import-config / confirm-import-config / get-config-path / reload-config / open-config-folder

### Fixed
- 修复分模型费用明细与总费用不一致的 bug：之前 STATIC_MODEL_RATES 不含运行时模型，改用 buildRuntimeModelRates 走同 getPricing() 兜底，保证"总额 = 明细加总"
- 修正 GLM-5.2/5.3 定价口径：GLM-5.2 采用官方价（cache 2 / input 8 / output 28），GLM-5.3 官方未定价，暂沿用 GLM-5.2 价格，公布后校准；× 1.25 估算仅作为更未来代际模型的兜底策略

### Merged
- 合并上游 v1.4.3 – v1.5.1 全部改动：弹窗窗口三态固定/纵向调整尺寸/重置大小、MiMo 套餐过期与补偿额度修复、智谱到期徽章与 GLM-5.2-HighSpeed 定价、DeepSeek 状态页 Flashcat 适配、图表类型修复
- OpenCode Go 采用官方 API（`/zen/go/v1/usage` + API Key）实现，替代上游的隐藏窗口网页抓取方案（性能更好、解析更稳）

### Changed
- 智谱 Provider 暴露 periodHours 到 QuotaItem（从 ZhipuLimitItem.unit/number 计算）
- package.json 添加 devDependencies 字段（electron / electron-vite / electron-builder / vite / typescript / @types/node / @vitejs/plugin-vue / tsx）+ scripts（dev/build/start/typecheck/pack/dist/verify:*）
- 颜色滑块用 `change` 而非 `input` 事件节流，避免拖动时高频触发自动保存
- 阈值滑块加 ARIA 属性（role="slider" + aria-valuenow），状态点/状态徽标加 aria-label，icon-btn 加 tabindex
- 全局 window.onerror 监听 → 主进程写 log 文件，诊断页加"查看日志"按钮
- .gitignore 加 release-v*/ 模式防误 commit 380MB 包体

## [1.5.1] - 2026-08-18
### Added
- 固定窗口按钮升级为三态切换：不固定 → 固定且置顶 → 固定且不置顶
- 弹窗支持调整高度：可拖动窗口下边缘纵向拉伸，大小可被记忆
- 托盘右键菜单新增「重置窗口大小」：一键恢复默认窗口尺寸
- 智谱新模型 GLM-5.3 可估算所用 Token 费用

### Fixed
- 修复多显示器窗口裁切问题
- 修复智谱套餐过期后不正确显示已过期问题

## [1.5.0] - 2026-07-24
### Added
- 新增 Codex（ChatGPT）用量监控：主/次窗口限流、代码审查额度、Credits 余额、订阅到期
- 新增「多服务商总览」视图：多账户时聚合各平台主额度与重置倒计时
- 新增 MiMo 每月用量图表，支持月份切换；本月用量卡片悬停展开 Token 估算与各模型可用额度
- 新增弹窗位置记忆（拖动后保持）与「记住窗口位置」设置项
- 额度显示单位区分（百分比 / 次数），MiniMax 计数类额度直接显示剩余次数
- 补齐中英文 i18n：总览卡片、额度单位、MiniMax「5 小时额度」等文案

### Fixed
- 修复智谱在部分国内网络下不可达：baseUrl 切换至 open.bigmodel.cn（中国节点直连）
- 修复 MiniMax 新版 API 字段缺失导致解析异常，正确区分已用/剩余次数
- 修复设置页 API Key 输入框脱敏掩码被误写回、污染密钥的问题
- 修复 DeepSeek 费用图表类型错误、用量为 0 时图表异常隐藏、图表数据被 budget IPC 阻塞
- 修复 Codex 刷新 token 后未写回 auth.json 导致重复刷新
- 修复打包版未做单实例锁，可能启动多个进程
- 修复服务商 Tab 栏溢出窗口

### Changed
- 请求层迁移到 Electron net 网络栈，统一跟随系统代理；新增瞬时网络错误识别与线性退避重试
- 托盘图标支持高 DPI 2x 渲染，三位数使用窄字体防贴边
- 智谱辅助数据请求改为限流并发（2 路）+ allSettled，关键请求使用更高重试次数
- 默认禁用远程更新检查，移除自动发布配置
## [1.5.0] - 2026-06-24
### Added
- 添加 opencode go 套餐支持

## [1.4.5] - 2026-06-17
### Fixed
- DeepSeek 部分显示异常的修复
### Added
- GLM 5.2 API价格更新

## [1.4.4] - 2026-06-11
## Fixed
- 修复 MiMo 套餐过期显示问题

## [1.4.3] - 2026-06-07
### Fixed
- 修复Deepseek无使用量时显示空白的问题
- 适配Minimax新查询格式

### Added
- 添加Mimo用量图表和Token值估算功能

## [1.4.2] - 2026-05-07
### Fixed
- 修复智谱周额度显示异常问题

## [1.4.1] - 2026-05-06
### Fixed
- 修复 Mimo 额度使用量超过总额度时进度条显示异常问题
- 页面可以记忆上次选择的标签，不会因为关闭页面而丢失

## [1.4.0] - 2026-04-30
### Added
- 添加 XiaoMi MiMo 平台支持
- 余额显示、会员级别显示
- MiMo 按月每日 Token 用量图表（Cache Hit / Cache Miss / Output 堆叠柱状图 + Requests 折线）

### Fixed
- 修复并发测试中 token 计算错误的问题
- 修改minimax显示逻辑，总额度为0的额度项目不显示

## [1.3.2] - 2026-04-28
### Fixed
- 安全修复：
  - 渲染器不再能获得完整key，增强安全性
  - 登录窗口添加导航白名单限制，仅允许 platform.deepseek.com

### Added
- 添加智谱Coding Plan接口并发测试功能，终于可以知道官方到底给了几个并发
  - 可选择OpenAI和Anthropic两种接口
  - 可选择GLM-5.1到GLM4.5-Air各个模型
  - 可见到每个请求首字延迟、token速度、总花费时间
  - 测试结果保存到历史记录
- 扩大多服务商切换箭头的鼠标触发区域

## [1.3.1] - 2026-04-27
### Fixed
- 修复更新功能的一些bug

## [1.3.0] - 2026-04-27
### Added
- DeepSeek 新增网页登录方式，可展示官网同等详细的数据

## [1.2.4] - 2026-04-25
### Added
- 新增 DeepSeek 服务商，支持余额显示与服务状态监控
- 新增自动检查更新功能，可选择关闭

## [1.2.3] - 2026-04-24
### Added
- 智谱 API 等价费用估算，可在设置中切换开关

### Changed
- 多服务商切换改为浮动箭头触发展开，不影响排版

## [1.2.2] - 2026-04-20
### Changed
- 修改反馈群聊链接

### Fixed
- 修复群聊二维码没有打包的问题

## [1.2.1] - 2026-04-19
### Fixed
- 修复更新时提示先关闭应用问题

### Added
- 设置页面添加反馈群链接

## [1.2.0] - 2026-04-19
### Added
- 新增 MiniMax 服务商支持
- 添加图标额度显示设置：支持选择最少额度、最多额度或指定账户

## [1.1.3] - 2026-04-18
### Added
- 窗口固定功能：标题栏新增图钉按钮，固定后点击外部不会关闭窗口
- 智谱订阅信息浮窗展示

### Development
- CQB_DEVTOOLS 环境变量：启用后自动打开 DevTools 调试面板
- 提取 FloatingTooltip 通用浮窗组件，统一毛玻璃风格

## [1.1.2] - 2026-04-17
### Added
- 用量统计图表新增「本日」和「24h」时间维度标签页

### Fixed
- 开发模式下跳过开机自启注册，防止将 electron.exe 路径写入系统启动项

## [1.1.1] - 2026-04-16
### Changed
- 添加系统健康度统计表
- 修复骨架屏没有正确渲染的问题

## [1.1.0] - 2026-04-15
### Changed
- 添加多账户支持，配置文件格式有所变动
- 修复图标异常显示100%的问题

## [1.0.2] - 2026-04-15
### Changed
- 添加弹窗触发方式切换选项

## [1.0.1] - 2026-04-15
### Changed
- 添加内存节省模式选项，减少内存占用
- 修改开发用环境变量，统一所用前缀

## [1.0.0] - 2026-04-14
### Changed
- 检查更新按钮在检测到新版本后，可下载并更新版本
- 添加项目仓库链接于页面

## [0.9.1] - 2026-04-14
### Changed
- CI 改为 tag 触发自动构建并发布 Release

### Removed
- 移除页面开发模式横幅
- 移除未使用的 SharedQuotaItem 导入和 isPinned 变量

## [0.9.0] - 2026-04-14
### Added
- 初始打包版本
