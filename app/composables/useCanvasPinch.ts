import { ref } from 'vue'
import type { Ref } from 'vue'
import type { StickerInstance } from '~/types'

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const SCALE_MIN = 1
const SCALE_MAX = 20
const RAD_TO_DEG = 180 / Math.PI

// 貼紙拖曳允許超出畫布邊界的範圍（中心點百分比）
const DRAG_MIN = -100
const DRAG_MAX = 200

export interface UseCanvasPinchOptions {
  canvasRef: Ref<HTMLElement | null>
  drawMode: Ref<boolean>
  selectedStickerId: Ref<string | null>
  stickers: Ref<StickerInstance[]>
  draggingStickerId: Ref<string | null>
  transformingStickerId: Ref<string | null>
  /** 貼紙縮放/旋轉結束的 callback（可選） */
  onStickerTransformEnd?: () => void
  /** 貼紙拖曳結束的 callback（可選） */
  onStickerDragEnd?: () => void
  /** 顯示垂直中心參考線（可選） */
  showVerticalCenterGuide?: Ref<boolean>
  /** 顯示水平中心參考線（可選） */
  showHorizontalCenterGuide?: Ref<boolean>
  /** 中心對齊 snap 門檻（百分比，預設 2%） */
  centerSnapThresholdPct?: number
  /** 旋轉 snap 門檻（角度，預設 5°） */
  rotationSnapThresholdDeg?: number
}

interface PinchState {
  stickerId: string
  initDist: number
  initAngle: number
  initScale: number
  initRotation: number
}

interface CanvasDragState {
  stickerId: string
  startX: number
  startY: number
  initX: number
  initY: number
  halfWidthPct: number
  halfHeightPct: number
}

const EMPTY_AREA_SELECTORS = [
  '.p-editor__sticker-content',
  'button'
]

/**
 * 畫布層級手勢：單指拖曳已選取貼紙、雙指縮放／旋轉
 * 有選取時在空白處拖曳即可移動；雙指不需觸碰物件即可縮放旋轉
 */
export function useCanvasPinch(options: UseCanvasPinchOptions) {
  const {
    canvasRef,
    drawMode,
    selectedStickerId,
    stickers,
    draggingStickerId,
    transformingStickerId,
    onStickerTransformEnd,
    onStickerDragEnd,
    showVerticalCenterGuide,
    showHorizontalCenterGuide,
    centerSnapThresholdPct = 2,
    rotationSnapThresholdDeg = 5
  } = options

  let pinchState: PinchState | null = null
  let canvasDragState: CanvasDragState | null = null
  const lastCanvasDragEndAt = ref(0)
  /** 雙指縮放／旋轉中：此期間不應因誤觸而切換選取其他物件 */
  const isTwoFingerGesture = ref(false)

  const hasSelection = () => selectedStickerId.value !== null

  const clearCenterGuides = () => {
    if (showVerticalCenterGuide) showVerticalCenterGuide.value = false
    if (showHorizontalCenterGuide) showHorizontalCenterGuide.value = false
  }

  const isPointerOnEmptyArea = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement
    if (!el?.closest) return true
    return EMPTY_AREA_SELECTORS.every(sel => !el.closest(sel))
  }

  const snapAngle = (angle: number): number => {
    const threshold = rotationSnapThresholdDeg
    if (threshold <= 0) return angle
    let norm = angle % 360
    if (norm < 0) norm += 360
    const candidates = [0, 90, 180, 270, 360]
    for (const base of candidates) {
      const diff = Math.abs(norm - base)
      if (diff <= threshold || Math.abs(diff - 360) <= threshold) {
        const delta = base - norm
        return angle + delta
      }
    }
    return angle
  }

  const applyPinch = (state: PinchState, scaleRatio: number, angleDelta: number) => {
    const scale = clamp(state.initScale * scaleRatio, SCALE_MIN, SCALE_MAX)
    const rotation = snapAngle(state.initRotation + angleDelta)
    const s = stickers.value.find(st => st.id === state.stickerId)
    if (s) {
      s.scale = scale
      s.rotation = rotation
    }
  }

  /**
   * 在「允許位置調整」的前提下，算出不超出畫布時允許的最大 scale。
   */
  const getMaxScaleForBounds = (el: HTMLElement, stickerId: string): number => {
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return SCALE_MAX

    const st = stickers.value.find(s => s.id === stickerId)
    if (!st) return SCALE_MAX
    const currentScale = st.scale
    const frameEl = el.querySelector(
      `.p-editor__edit-frame--sticker[data-sticker-id="${stickerId}"]`
    ) as HTMLElement | null
    if (!frameEl) return SCALE_MAX
    const fr = frameEl.getBoundingClientRect()
    const halfWidthPct = (fr.width / rect.width) * 50
    const halfHeightPct = (fr.height / rect.height) * 50

    const eps = 1e-6
    const maxScaleX = halfWidthPct > eps ? (50 * currentScale) / halfWidthPct : SCALE_MAX
    const maxScaleY = halfHeightPct > eps ? (50 * currentScale) / halfHeightPct : SCALE_MAX
    return Math.min(maxScaleX, maxScaleY, SCALE_MAX)
  }

  /** 依目前 DOM 實際尺寸，強制把目標貼紙完整限制在畫布內（給 pinch 縮放後使用） */
  const clampTargetWithinCanvas = (el: HTMLElement, stickerId: string) => {
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const st = stickers.value.find(s => s.id === stickerId)
    if (!st) return
    st.x = clamp(st.x, DRAG_MIN, DRAG_MAX)
    st.y = clamp(st.y, DRAG_MIN, DRAG_MAX)
  }

  const attachPinchListeners = (el: HTMLElement, t0: Touch, t1: Touch) => {
    const stickerId = selectedStickerId.value
    if (!stickerId) return
    const s = stickers.value.find(st => st.id === stickerId)
    if (!s) return

    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1
    const angle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX)

    pinchState = {
      stickerId,
      initDist: dist,
      initAngle: angle,
      initScale: s.scale,
      initRotation: s.rotation
    }
    transformingStickerId.value = stickerId

    // 在 pinch 開始時計算一次 maxScale（此值在 pinch 過程中為常數，無需每 frame 重算）
    const cachedMaxScale = getMaxScaleForBounds(el, stickerId)

    // RAF throttle：避免每個 touchmove 都同步計算並更新 DOM
    let pinchRafPending = false

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchState) return
      const a0 = e.touches[0]
      const a1 = e.touches[1]
      if (!a0 || !a1) return
      if (e.cancelable) e.preventDefault()

      if (pinchRafPending) return
      pinchRafPending = true

      const d = Math.hypot(a1.clientX - a0.clientX, a1.clientY - a0.clientY) || 1
      const a = Math.atan2(a1.clientY - a0.clientY, a1.clientX - a0.clientX)
      const scaleRatio = d / pinchState.initDist
      const angleDelta = (a - pinchState.initAngle) * RAD_TO_DEG
      const desiredScale = pinchState.initScale * scaleRatio
      const effectiveScale = clamp(desiredScale, SCALE_MIN, Math.min(cachedMaxScale, SCALE_MAX))
      const effectiveRatio = effectiveScale / pinchState.initScale

      requestAnimationFrame(() => {
        pinchRafPending = false
        if (!pinchState) return
        applyPinch(pinchState, effectiveRatio, angleDelta)
        clampTargetWithinCanvas(el, pinchState.stickerId)
      })
    }

    const onTouchEnd = () => {
      if (pinchState) {
        transformingStickerId.value = null
        onStickerTransformEnd?.()
      }
      pinchState = null
      isTwoFingerGesture.value = false
      el.removeEventListener('touchmove', onTouchMove, { capture: true })
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }

    el.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
  }

  const startCanvasDrag = (clientX: number, clientY: number, isTouch: boolean) => {
    const el = canvasRef.value
    if (!el) return
    clearCenterGuides()
    // 在拖曳開始時讀取一次 rect（避免在每個 touchmove 都觸發 forced layout）
    const cachedRect = el.getBoundingClientRect()
    if (!cachedRect.width || !cachedRect.height) return

    const getHalfSizePct = (frameEl: HTMLElement | null): { halfWidthPct: number; halfHeightPct: number } => {
      if (!frameEl) return { halfWidthPct: 5, halfHeightPct: 5 }
      const r = frameEl.getBoundingClientRect()
      return {
        halfWidthPct: (r.width / cachedRect.width) * 50,
        halfHeightPct: (r.height / cachedRect.height) * 50
      }
    }

    if (!selectedStickerId.value) return
    const s = stickers.value.find(st => st.id === selectedStickerId.value!)
    if (!s) return
    const frameEl = el.querySelector(
      `.p-editor__edit-frame--sticker[data-sticker-id="${s.id}"]`
    ) as HTMLElement | null
    const { halfWidthPct, halfHeightPct } = getHalfSizePct(frameEl)
    canvasDragState = {
      stickerId: s.id,
      startX: clientX,
      startY: clientY,
      initX: s.x,
      initY: s.y,
      halfWidthPct,
      halfHeightPct
    }
    draggingStickerId.value = s.id

    // RAF throttle：確保每幀最多更新一次，與螢幕刷新率同步（60fps）
    let dragRafPending = false

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!canvasDragState || !el) return
      if ('touches' in e && e.touches.length >= 2) return

      if (dragRafPending) return
      dragRafPending = true

      const x = 'touches' in e ? e.touches[0]?.clientX ?? canvasDragState.startX : (e as MouseEvent).clientX
      const y = 'touches' in e ? e.touches[0]?.clientY ?? canvasDragState.startY : (e as MouseEvent).clientY
      const deltaX = ((x - canvasDragState.startX) / cachedRect.width) * 100
      const deltaY = ((y - canvasDragState.startY) / cachedRect.height) * 100

      requestAnimationFrame(() => {
        dragRafPending = false
        if (!canvasDragState) return

        const center = 50
        const threshold = centerSnapThresholdPct

        // 允許貼紙拖出畫布邊界，僅保留中心 snap（不再用半寬/半高限制在畫布內）
        const applyPosition = (pos: { x: number; y: number }) => {
          let { x, y } = pos

          if (Math.abs(x - center) <= threshold) {
            x = center
            if (showVerticalCenterGuide) showVerticalCenterGuide.value = true
          } else if (showVerticalCenterGuide) {
            showVerticalCenterGuide.value = false
          }

          if (Math.abs(y - center) <= threshold) {
            y = center
            if (showHorizontalCenterGuide) showHorizontalCenterGuide.value = true
          } else if (showHorizontalCenterGuide) {
            showHorizontalCenterGuide.value = false
          }

          return {
            x: clamp(x, DRAG_MIN, DRAG_MAX),
            y: clamp(y, DRAG_MIN, DRAG_MAX)
          }
        }

        const st = stickers.value.find(item => item.id === canvasDragState!.stickerId)
        if (st) {
          const next = applyPosition({
            x: canvasDragState.initX + deltaX,
            y: canvasDragState.initY + deltaY
          })
          st.x = next.x
          st.y = next.y
        }
      })
    }

    const onEnd = () => {
      if (canvasDragState) {
        lastCanvasDragEndAt.value = Date.now()
        clearCenterGuides()
        draggingStickerId.value = null
        onStickerDragEnd?.()
      }
      canvasDragState = null
      if (isTouch) {
        el.removeEventListener('touchmove', onMove as (e: TouchEvent) => void, { capture: true })
        el.removeEventListener('touchend', onEnd)
        el.removeEventListener('touchcancel', onEnd)
      } else {
        document.removeEventListener('mousemove', onMove as (e: MouseEvent) => void)
        document.removeEventListener('mouseup', onEnd)
      }
    }

    if (isTouch) {
      el.addEventListener('touchmove', onMove as (e: TouchEvent) => void, { capture: true, passive: false })
      el.addEventListener('touchend', onEnd)
      el.addEventListener('touchcancel', onEnd)
    } else {
      document.addEventListener('mousemove', onMove as (e: MouseEvent) => void)
      document.addEventListener('mouseup', onEnd)
    }
  }

  const onCanvasTouchStart = (e: TouchEvent) => {
    if (drawMode.value) return
    const el = canvasRef.value
    if (!el) return

    // 刪除控制點：交給各自元件處理，這裡不攔截
    const targetEl = e.target as HTMLElement | null
    if (targetEl?.closest('.p-editor__edit-frame-delete, .p-editor__edit-frame-transform-handle')) {
      return
    }

    if (e.touches.length === 1) {
      const t = e.touches[0]
      if (!t) return
      if (hasSelection() && isPointerOnEmptyArea(e.target)) {
        if (e.cancelable) e.preventDefault()
        e.stopPropagation()
        startCanvasDrag(t.clientX, t.clientY, true)
      }
      return
    }

    if (e.touches.length !== 2) return
    const t0 = e.touches[0]
    const t1 = e.touches[1]
    if (!t0 || !t1) return

    isTwoFingerGesture.value = true
    if (e.cancelable) e.preventDefault()
    e.stopPropagation()
    attachPinchListeners(el, t0, t1)
  }

  /** 補捉「先放一指再放第二指」時在 touchmove 才出現的雙指 */
  const onCanvasTouchMove = (e: TouchEvent) => {
    if (drawMode.value || pinchState) return
    if (e.touches.length !== 2 || !hasSelection()) return
    const el = canvasRef.value
    if (!el) return
    const t0 = e.touches[0]
    const t1 = e.touches[1]
    if (!t0 || !t1) return

    isTwoFingerGesture.value = true
    if (e.cancelable) e.preventDefault()
    e.stopPropagation()
    attachPinchListeners(el, t0, t1)
  }

  const onCanvasTouchEnd = () => { }

  const onCanvasMouseDown = (e: MouseEvent) => {
    if (drawMode.value || !hasSelection()) return
    if (!isPointerOnEmptyArea(e.target)) return
    e.preventDefault()
    startCanvasDrag(e.clientX, e.clientY, false)
  }

  return {
    onCanvasTouchStart,
    onCanvasTouchMove,
    onCanvasTouchEnd,
    onCanvasMouseDown,
    lastCanvasDragEndAt,
    isTwoFingerGesture
  }
}
