import type { Timestamp } from 'firebase/firestore'

/**
 * 貼紙實例
 */
export interface StickerInstance {
  id: string
  type: string
  x: number
  y: number
  scale: number
  rotation: number
}

/**
 * 便利貼樣式配置
 */
export interface StickyNoteStyle {
  stickers?: StickerInstance[] // 貼紙
  drawing?: string // 手繪內容 data URL (base64 PNG)
  /** 各物件 id 的疊放順序（預覽/上傳/display 與編輯器一致）；無則沿用預設 */
  objectLayerOrder?: Record<string, number>
  /** 本次描紅所用字帖 id（public/font）；用於避免 LED 牆上同字重複，不渲染於便利貼 */
  font?: string
}

/**
 * 佇列項目狀態
 */
export type QueueStatus = 'waiting' | 'playing' | 'played'

/**
 * Token 狀態
 */
export type TokenStatus = 'unused' | 'used'

/**
 * 待處理佇列項目
 */
export interface QueuePendingItem {
  id?: string // Firestore document ID
  content: string
  style: StickyNoteStyle
  token: string
  timestamp: Timestamp
  status: 'waiting'
}

/**
 * 歷史紀錄項目
 */
export interface QueueHistoryItem {
  id?: string // Firestore document ID
  content: string
  style: StickyNoteStyle
  token: string
  timestamp: Timestamp
  status: 'played'
  playedAt: Timestamp
  /** 牆面 reset 時標記（不刪 DB）：編輯器後備讀 queue_history 時略過 */
  cleared?: boolean
}

/**
 * Token 文件
 */
export interface TokenDocument {
  id?: string // Firestore document ID
  status: TokenStatus
  createdAt: Timestamp
}

/**
 * 建立便利貼的表單資料
 */
export interface CreateNoteForm {
  content: string
  style: StickyNoteStyle
}

/**
 * 大螢幕推播狀態資料 (Conductor)
 */
export interface CurrentStateData {
  mode: 'live' | 'idle' | 'waiting'
  now_playing: QueueHistoryItem | QueuePendingItem | null
  live_grid: (QueueHistoryItem | QueuePendingItem)[]
  /** 牆面 reset 進行中：編輯器於此期間擋住進場，避免撞 reset */
  wall_resetting?: boolean
  updated_at: number
}
