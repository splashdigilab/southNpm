/**
 * 編輯器相關常數
 */

export const EDITOR_TABS = [
  { id: 'draw' as const, label: '書法', bg: '/tab-1.webp' },
  { id: 'sticker' as const, label: '貼紙', bg: '/tab-2.webp' }
] as const

export type EditorTabId = typeof EDITOR_TABS[number]['id']

/** 書法固定墨色（黑墨） */
export const CALLIGRAPHY_BRUSH_COLOR = '#241F20'

/**
 * 筆刷粗細：三種尺寸。
 * - value：實際筆刷大小（perfect-freehand size，600 虛擬座標下的 px）
 * - dot：選擇器按鈕內示意圓點直徑（px）
 * - ring：按鈕外圈直徑（px）
 */
export const BRUSH_SIZES = [
  { value: 34, label: '細', dot: 12, ring: 24 },
  { value: 52, label: '中', dot: 16, ring: 28 },
  { value: 72, label: '粗', dot: 20, ring: 32 }
] as const

/** 預設筆刷大小（中）：須為 BRUSH_SIZES 其中一個 value */
export const DEFAULT_BRUSH_SIZE = BRUSH_SIZES[1].value
