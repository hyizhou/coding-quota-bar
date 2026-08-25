/**
 * Coding Quota Bar 共享色板（单一真相源）
 * 所有进程（main/renderer）的颜色常量都从这里导入。
 *
 * 设计目标：在 Windows 默认蓝色系统托盘背景下保持高对比度。
 * 旧色板 green #22C55E 在蓝色背景下偏暗 → 升级为更亮的 #4ADE80。
 * 加载动画原色 RGB(140,160,190) 偏蓝（在蓝底上隐形）→ 改为中性灰 RGB(200,200,200)。
 *
 * @module shared/colors
 */

/** 状态色 hex 字符串（main 进程 tray.ts 像素渲染用） */
export const COLORS = {
  green: '#4ADE80',
  yellow: '#FACC15',
  red: '#F87171',
  gray: '#94A3B8',
} as const;

/** 进度条渐变色对：[亮端, 主色]，对应 CSS linear-gradient(90deg, light, main) */
export const COLOR_GRADIENTS = {
  green: { light: '#86EFAC', main: COLORS.green },
  yellow: { light: '#FDE047', main: COLORS.yellow },
  red: { light: '#FCA5A5', main: COLORS.red },
  gray: { light: '#CBD5E1', main: COLORS.gray },
} as const;

/** 深色变体（错误文字、强调色等小面积使用） */
export const COLOR_DARK = {
  red: '#EF4444',
  yellow: '#CA8A04',
} as const;

/** 加载弧线 RGB 三元组（中性灰，避免与蓝色托盘混淆） */
export const LOADING_COLOR_RGB = {
  r: 200,
  g: 200,
  b: 200,
} as const;

/**
 * 旧色板 → 新色板映射，便于审计和回滚追溯。
 * 仅用于查阅，不要在运行时代码中引用。
 */
export const COLOR_MIGRATION_MAP = {
  '#22C55E': COLORS.green,
  '#22c55e': COLORS.green,
  '#F59E0B': COLORS.yellow,
  '#f59e0b': COLORS.yellow,
  '#EF4444': COLORS.red,
  '#ef4444': COLORS.red,
  '#888888': COLORS.gray,
  '#888': COLORS.gray,
  '#dc2626': COLOR_DARK.red,
  '#DC2626': COLOR_DARK.red,
  '#EAB308': COLOR_DARK.yellow,
} as const;

// ============================================================================
// CSS 自定义属性（渲染进程注入用）
// ============================================================================

/**
 * CSS 自定义属性字符串，在 App.vue 的非 scoped <style> 块注入到 :root
 * 渲染进程的 Vue 组件通过 var(--cqb-*) 引用这些变量
 *
 * 命名约定：--cqb-{颜色名}[-{变体}]
 * - --cqb-green / --cqb-yellow / --cqb-red / --cqb-gray：主色
 * - --cqb-green-light / --cqb-red-light 等：渐变亮端
 * - --cqb-red-dark / --cqb-yellow-dark：深色文字用
 *
 * 使用示例（Vue 组件中）：
 * ```vue
 * <style scoped>
 * .progress-bar {
 *   background: linear-gradient(90deg, var(--cqb-green-light), var(--cqb-green));
 * }
 * </style>
 * ```
 */
export const COLOR_CSS_VARS = `:root {
  /* 主色板 */
  --cqb-green: ${COLORS.green};
  --cqb-yellow: ${COLORS.yellow};
  --cqb-red: ${COLORS.red};
  --cqb-gray: ${COLORS.gray};

  /* 渐变亮端 */
  --cqb-green-light: ${COLOR_GRADIENTS.green.light};
  --cqb-yellow-light: ${COLOR_GRADIENTS.yellow.light};
  --cqb-red-light: ${COLOR_GRADIENTS.red.light};
  --cqb-gray-light: ${COLOR_GRADIENTS.gray.light};

  /* 深色变体（文字用） */
  --cqb-red-dark: ${COLOR_DARK.red};
  --cqb-yellow-dark: ${COLOR_DARK.yellow};
}`;
