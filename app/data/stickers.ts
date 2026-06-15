/**
 * Sticker 類型定義
 */
export interface StickerType {
  id: string
  defaultScale: number
  svgFile: string // 圖檔路徑
}

/**
 * 預設 Sticker 庫（public/decoration）
 */
export const STICKER_LIBRARY: StickerType[] = [
  { id: "decoration-01", defaultScale: 1, svgFile: "/decoration/decoration-01.svg" },
  { id: "decoration-02", defaultScale: 1, svgFile: "/decoration/decoration-02.svg" },
  { id: "decoration-03", defaultScale: 1, svgFile: "/decoration/decoration-03.svg" },
  { id: "decoration-04", defaultScale: 1, svgFile: "/decoration/decoration-04.svg" },
  { id: "decoration-05", defaultScale: 1, svgFile: "/decoration/decoration-05.svg" },
  { id: "decoration-06", defaultScale: 1, svgFile: "/decoration/decoration-06.svg" },
  { id: "decoration-07", defaultScale: 1, svgFile: "/decoration/decoration-07.svg" },
  { id: "decoration-08", defaultScale: 1, svgFile: "/decoration/decoration-08.svg" },
  { id: "decoration-09", defaultScale: 1, svgFile: "/decoration/decoration-09.svg" },
  { id: "decoration-10", defaultScale: 1, svgFile: "/decoration/decoration-10.svg" },
  { id: "decoration-11", defaultScale: 1, svgFile: "/decoration/decoration-11.svg" },
  { id: "decoration-12", defaultScale: 1, svgFile: "/decoration/decoration-12.svg" },
  { id: "decoration-13", defaultScale: 1, svgFile: "/decoration/decoration-13.svg" },
  { id: "decoration-14", defaultScale: 1, svgFile: "/decoration/decoration-14.svg" },
  { id: "decoration-15", defaultScale: 1, svgFile: "/decoration/decoration-15.svg" },
  { id: "decoration-16", defaultScale: 1, svgFile: "/decoration/decoration-16.svg" },
  { id: "decoration-17", defaultScale: 1, svgFile: "/decoration/decoration-17.svg" },
  { id: "decoration-18", defaultScale: 1, svgFile: "/decoration/decoration-18.svg" },
  { id: "decoration-19", defaultScale: 1, svgFile: "/decoration/decoration-19.svg" },
  { id: "decoration-20", defaultScale: 1, svgFile: "/decoration/decoration-20.svg" },
  { id: "decoration-21", defaultScale: 1, svgFile: "/decoration/decoration-21.svg" },
  { id: "decoration-22", defaultScale: 1, svgFile: "/decoration/decoration-22.svg" },
  { id: "decoration-23", defaultScale: 1, svgFile: "/decoration/decoration-23.svg" },
  { id: "decoration-24", defaultScale: 1, svgFile: "/decoration/decoration-24.svg" },
  { id: "decoration-25", defaultScale: 1, svgFile: "/decoration/decoration-25.svg" },
  { id: "decoration-26", defaultScale: 1, svgFile: "/decoration/decoration-26.svg" },
  { id: "decoration-27", defaultScale: 1, svgFile: "/decoration/decoration-27.svg" },
  { id: "decoration-28", defaultScale: 1, svgFile: "/decoration/decoration-28.svg" },
  { id: "decoration-29", defaultScale: 1, svgFile: "/decoration/decoration-29.svg" },
]

/**
 * 依 ID 取得 Sticker
 */
export const getStickerById = (id: string): StickerType | undefined =>
  STICKER_LIBRARY.find(s => s.id === id)
