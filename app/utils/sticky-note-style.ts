import type { StickerInstance } from '~/types'

/**
 * 貼紙定位與變換樣式（編輯器與顯示端共用）
 */
export function getStickerStyle(sticker: StickerInstance) {
  return {
    left: `${sticker.x}%`,
    top: `${sticker.y}%`,
    transform: `translate(-50%, -50%) scale(${sticker.scale}) rotate(${sticker.rotation}deg)`,
    '--inverse-scale': 1 / sticker.scale
  }
}
