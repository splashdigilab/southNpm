/**
 * useFabricBrush
 *
 * Fabric.js 以動態 import 載入，讓編輯器主 bundle 不包含 ~500KB 的 Fabric.js，
 * 顯著降低低端手機因 JS 解析/執行過重而崩潰的機率。
 * Fabric.js 只在使用者首次呼叫 init() 時才開始下載（瀏覽器通常會快取，後續載入幾乎免費）。
 *
 * 書法筆刷（毛筆感）：以 perfect-freehand 依書寫速度模擬提按，產生「中間粗、起收筆尖鋒」
 * 的筆畫外框多邊形再填色（非等寬向量線）。Level 2 另加邊緣粗糙（飛白感）與宣紙墨韻紋理。
 */
import { getStroke } from 'perfect-freehand'

// ── 橡皮擦路徑取樣距離平方（避免每個 touchmove 都新增 Path 物件）
const MIN_ERASER_DIST_SQ = 9 // ≥ 3px 才累積下一個點

type Pt = [number, number]

/** 將 perfect-freehand 的外框點轉成 SVG path 字串（官方建議寫法：以中點當錨、兩端為控制點） */
function getSvgPathFromStroke(points: Pt[]): string {
  if (!points.length) return ''
  const first = points[0]!
  const d: (string | number)[] = ['M', first[0], first[1], 'Q']
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i]!
    const p1 = points[(i + 1) % points.length]!
    d.push(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
  }
  d.push('Z')
  return d.join(' ')
}

/** 邊緣粗糙化：以索引為種子的決定性擾動，讓填好的筆畫邊緣不再是乾淨向量線（毛筆飛白感） */
function roughenOutline(points: Pt[], amp: number): Pt[] {
  if (amp <= 0) return points
  return points.map(([x, y], i) => {
    const n = Math.sin((i + 1) * 12.9898) * 43758.5453
    const r = n - Math.floor(n) // 0..1 決定性偽隨機
    const a = r * Math.PI * 2
    return [x + Math.cos(a) * amp * r, y + Math.sin(a) * amp * r] as Pt
  })
}

/** 產生宣紙/墨韻顆粒材質：滿版墨色 + 散布半透明孔洞（飛白），作為筆畫填充 pattern 來源 */
function makeInkGrainCanvas(color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const size = 90
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = color
  g.fillRect(0, 0, size, size)
  // destination-out：在墨層上鑿出細小透明孔，模擬乾筆飛白與宣紙吸墨的顆粒感
  g.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = Math.random() * 1.4
    g.globalAlpha = Math.random() * 0.45
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

function drawBrushCursor(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save()
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** 標記橡皮擦路徑所屬的筆畫 ID，undo 時一次移除同筆畫 */
const ERASER_STROKE_KEY = '__eraserStrokeId'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

export function useFabricBrush(onPathCreated?: () => void) {
  let fabricCanvas: AnyObj = null
  let inkBrush: AnyObj = null
  let eraserBrush: AnyObj = null
  const redoStack: AnyObj[] = []
  let onUndoRedoChange: (() => void) | null = null
  let initialWidth = 0
  let initialHeight = 0
  let _isMinimized = false

  const getPathObjects = (): AnyObj[] =>
    fabricCanvas?.getObjects().filter((obj: AnyObj) => obj?.isType?.('Path', 'path')) ?? []

  /**
   * 非同步初始化：動態載入 Fabric.js，首次呼叫後 Vite 會快取成獨立 chunk。
   * 後續所有 set* 方法均做 null 防護，在 init 完成前呼叫只是 no-op，不會崩潰。
   */
  const init = async (canvasEl: HTMLCanvasElement | null, width: number, height: number): Promise<void> => {
    if (!canvasEl || !import.meta.client) return
    if (fabricCanvas) return // 防止重複初始化

    initialWidth = width
    initialHeight = height

    // ── 動態載入 Fabric.js（不進入主 bundle）
    const { Canvas, PencilBrush, Path, Pattern } = await import('fabric')

    // ── 橡皮擦筆刷：繼承 PencilBrush，使用 destination-out 混合模式
    //    關鍵修正：onMouseMove 加入距離門檻，避免每個 touchmove 點都新增 Path 物件
    class EraserBrush extends PencilBrush {
      _currentStrokeId = 0
      _lastAddedPoint: { x: number; y: number } | null = null

      override _setBrushStyles(ctx: CanvasRenderingContext2D) {
        super._setBrushStyles(ctx)
        ctx.strokeStyle = 'rgba(255, 255, 255, 1)'
      }

      override _saveAndTransform(ctx: CanvasRenderingContext2D) {
        super._saveAndTransform(ctx)
        ctx.globalCompositeOperation = 'destination-out'
      }

      override _render(ctx: CanvasRenderingContext2D = (this as AnyObj).canvas.contextTop) {
        const points: AnyObj[] = (this as AnyObj)._points
        if (points.length > 0) {
          const p = points[points.length - 1]
          if (p) {
            this._saveAndTransform(ctx)
            ctx.globalCompositeOperation = 'source-over'
            drawBrushCursor(ctx, p.x, p.y, (this as AnyObj).width / 2)
            ctx.restore()
          }
        }
      }

      override onMouseDown(pointer: AnyObj, ev: AnyObj) {
        this._currentStrokeId += 1
        this._lastAddedPoint = null
        super.onMouseDown(pointer, ev)
        ;(this as AnyObj).canvas.renderTop()
      }

      override onMouseMove(pointer: AnyObj, ev: AnyObj) {
        super.onMouseMove(pointer, ev)
        const points: AnyObj[] = (this as AnyObj)._points
        if (points.length >= 2) {
          const p1 = points[points.length - 2]
          const p2 = points[points.length - 1]
          if (p1 && p2) {
            // 距離門檻：避免每個微小移動都累積 Path 物件
            const dx = p2.x - p1.x
            const dy = p2.y - p1.y
            if (dx * dx + dy * dy >= MIN_ERASER_DIST_SQ) {
              const pathData: AnyObj = [['M', p1.x, p1.y], ['L', p2.x, p2.y]]
              const path = (this as AnyObj).createPath(pathData)
              ;(path as AnyObj)[ERASER_STROKE_KEY] = this._currentStrokeId
              ;(this as AnyObj).canvas.add(path)
              this._lastAddedPoint = p2
            }
          }
        }
        if (points.length > 0) {
          ;(this as AnyObj).canvas.renderTop()
        }
        ;(this as AnyObj).canvas.requestRenderAll()
      }

      override onMouseUp(ev: AnyObj) {
        const canvas: AnyObj = (this as AnyObj).canvas
        if (!canvas._isMainEvent(ev.e)) return true
        ;(this as AnyObj).drawStraightLine = false
        ;(this as AnyObj).oldEnd = undefined
        this._lastAddedPoint = null
        canvas.clearContext(canvas.contextTop)
        canvas.requestRenderAll()
        canvas.fire('path:created', { path: undefined as AnyObj })
        return false
      }

      override createPath(pathData: AnyObj): AnyObj {
        const path = super.createPath(pathData)
        path.set({
          fill: null,
          stroke: 'rgba(255, 255, 255, 1)',
          globalCompositeOperation: 'destination-out'
        })
        return path
      }
    }

    // ── 書法筆刷：繼承 PencilBrush 沿用點蒐集與事件流程，但改以 perfect-freehand
    //    產生「依速度提按 + 起收筆尖鋒」的外框多邊形再填色（毛筆感）。
    class InkBrush extends PencilBrush {
      // perfect-freehand 參數
      thinning = 0.62      // 速度→粗細變化幅度（越大粗細對比越強）
      smoothing = 0.55
      streamline = 0.5
      inkOpacity = 1       // 不透明：墨色實心，不帶透明度
      roughness = 0.09     // 邊緣粗糙比例（毛筆飛白感），相對於筆刷大小
      _grainPattern: AnyObj = null // 宣紙墨韻 pattern（依顏色快取）

      // 強制每次移動都整筆重繪（填色外框會隨新點全域改變，不能用增量畫線）
      override needsFullRender() { return true }

      _buildOutline(roughen: boolean): string {
        const pts: Pt[] = ((this as AnyObj)._points as AnyObj[]).map((p) => [p.x, p.y] as Pt)
        if (pts.length === 0) return ''
        const size = (this as AnyObj).width as number
        const outline = getStroke(pts, {
          size,
          thinning: this.thinning,
          smoothing: this.smoothing,
          streamline: this.streamline,
          simulatePressure: true, // 無觸控壓力時，依點距（=速度）模擬提按
          start: { taper: size * 2, cap: true },
          end: { taper: size * 2, cap: true }
        }) as Pt[]
        if (!outline.length) return ''
        const finalPts = roughen ? roughenOutline(outline, size * this.roughness) : outline
        return getSvgPathFromStroke(finalPts)
      }

      _inkFill(): AnyObj {
        if (!this._grainPattern) {
          const src = makeInkGrainCanvas((this as AnyObj).color)
          if (src) this._grainPattern = new Pattern({ source: src, repeat: 'repeat' })
        }
        return this._grainPattern ?? (this as AnyObj).color
      }

      // 即時預覽：填滿目前筆畫外框（乾淨填色，落筆放開後才套粗糙邊與紋理）
      override _render(ctx: CanvasRenderingContext2D = (this as AnyObj).canvas.contextTop) {
        const d = this._buildOutline(false)
        if (!d) return
        this._saveAndTransform(ctx)
        ctx.globalAlpha = this.inkOpacity
        ctx.fillStyle = (this as AnyObj).color
        ctx.fill(new Path2D(d))
        ctx.restore()
      }

      // 放開後：以粗糙邊外框 + 墨韻 pattern 建立正式 Path 物件
      override _finalizeAndAddPath() {
        const canvas: AnyObj = (this as AnyObj).canvas
        const ctx = canvas.contextTop
        ctx.closePath()
        const d = this._buildOutline(true)
        if (!d) { canvas.requestRenderAll(); return }
        const path = new Path(d, {
          fill: this._inkFill(),
          stroke: null,
          strokeWidth: 0,
          opacity: this.inkOpacity
        })
        canvas.clearContext(ctx)
        canvas.fire('before:path:created', { path })
        canvas.add(path)
        canvas.requestRenderAll()
        path.setCoords()
        canvas.fire('path:created', { path })
      }
    }

    fabricCanvas = new Canvas(canvasEl, {
      width,
      height,
      isDrawingMode: true,
      backgroundColor: 'transparent',
      selection: false,
      controlsAboveOverlay: false,
      preserveObjectStacking: true
    })

    fabricCanvas.on('path:created', () => {
      redoStack.length = 0
      onUndoRedoChange?.()
      if (onPathCreated) onPathCreated()
    })

    inkBrush = new InkBrush(fabricCanvas)
    inkBrush.color = '#241F20'
    inkBrush.width = 8

    eraserBrush = new EraserBrush(fabricCanvas)
    eraserBrush.color = 'rgba(255, 255, 255, 1)'
    eraserBrush.width = 16

    fabricCanvas.freeDrawingBrush = inkBrush
  }

  const setDrawingMode = (enabled: boolean) => {
    if (fabricCanvas) fabricCanvas.isDrawingMode = enabled
  }

  const setEraserMode = (enabled: boolean) => {
    if (!fabricCanvas || !inkBrush || !eraserBrush) return
    fabricCanvas.freeDrawingBrush = enabled ? eraserBrush : inkBrush
  }

  const setBrushColor = (color: string) => {
    if (inkBrush) {
      inkBrush.color = color
      inkBrush._grainPattern = null // 顏色變更時讓墨韻 pattern 依新色重建
    }
  }

  const setBrushWidth = (width: number) => {
    if (inkBrush) inkBrush.width = width
  }

  const setEraserWidth = (width: number) => {
    if (eraserBrush) eraserBrush.width = width
  }

  const exportToDataURL = (): string | null => {
    if (!fabricCanvas) return null
    return fabricCanvas.toDataURL({ format: 'png', quality: 1, multiplier: 1 })
  }

  const setOnUndoRedoChange = (cb: (() => void) | null) => {
    onUndoRedoChange = cb
  }

  const undo = () => {
    if (!fabricCanvas) return
    const paths = getPathObjects()
    const last = paths[paths.length - 1]
    if (!last) return
    const strokeId = (last as AnyObj)[ERASER_STROKE_KEY] as number | undefined
    if (strokeId !== undefined) {
      const toRemove = paths.filter((p) => (p as AnyObj)[ERASER_STROKE_KEY] === strokeId)
      toRemove.reverse()
      for (const p of toRemove) {
        fabricCanvas.remove(p)
        redoStack.push(p)
      }
    } else {
      fabricCanvas.remove(last)
      redoStack.push(last)
    }
    fabricCanvas.renderAll()
    onUndoRedoChange?.()
  }

  const redo = () => {
    if (!fabricCanvas || redoStack.length === 0) return
    const lastPopped = redoStack.pop()!
    const strokeId = (lastPopped as AnyObj)[ERASER_STROKE_KEY] as number | undefined
    const toAdd: AnyObj[] = [lastPopped]
    if (strokeId !== undefined) {
      while (redoStack.length > 0) {
        const next = redoStack[redoStack.length - 1]
        if ((next as AnyObj)[ERASER_STROKE_KEY] === strokeId) {
          toAdd.push(redoStack.pop()!)
        } else {
          break
        }
      }
      toAdd.reverse()
    }
    for (const p of toAdd) {
      fabricCanvas.add(p)
    }
    fabricCanvas.renderAll()
    onUndoRedoChange?.()
  }

  const canUndo = () => getPathObjects().length > 0
  const canRedo = () => redoStack.length > 0

  const loadFromDataURL = async (dataUrl: string): Promise<void> => {
    if (!fabricCanvas) return
    try {
      redoStack.length = 0
      fabricCanvas.clear()
      fabricCanvas.backgroundColor = 'transparent'
      const { FabricImage } = await import('fabric')
      const img = await FabricImage.fromURL(dataUrl)
      if (img.width && img.height) {
        const w = fabricCanvas.getWidth()
        const h = fabricCanvas.getHeight()
        if (initialWidth === 0 || initialHeight === 0) {
          initialWidth = w
          initialHeight = h
        }
        const scale = Math.min(w / img.width, h / img.height)
        img.set({
          left: w / 2,
          top: h / 2,
          originX: 'center',
          originY: 'center',
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false
        })
        fabricCanvas.add(img)
        fabricCanvas.renderAll()
      }
      onUndoRedoChange?.()
    } catch (e) {
      console.error('Failed to load drawing:', e)
    }
  }

  const clear = () => {
    if (fabricCanvas) {
      redoStack.length = 0
      fabricCanvas.clear()
      fabricCanvas.backgroundColor = 'transparent'
      initialWidth = fabricCanvas.getWidth()
      initialHeight = fabricCanvas.getHeight()
      fabricCanvas.renderAll()
      onUndoRedoChange?.()
    }
  }

  const resize = (width: number, height: number) => {
    if (!fabricCanvas || width <= 0 || height <= 0) return
    if (initialWidth === 0 || initialHeight === 0) {
      initialWidth = width
      initialHeight = height
      fabricCanvas.setDimensions({ width, height })
      fabricCanvas.renderAll()
      return
    }

    const scaleRatio = width / initialWidth
    if (Math.abs(scaleRatio - 1) < 0.001) return

    const objects = fabricCanvas.getObjects()
    for (const obj of objects) {
      const currentLeft = obj.left ?? 0
      const currentTop = obj.top ?? 0
      const currentScaleX = obj.scaleX ?? 1
      const currentScaleY = obj.scaleY ?? 1
      obj.set({
        left: currentLeft * scaleRatio,
        top: currentTop * scaleRatio,
        scaleX: currentScaleX * scaleRatio,
        scaleY: currentScaleY * scaleRatio
      })
      obj.setCoords()
    }

    initialWidth = width
    initialHeight = height
    fabricCanvas.setDimensions({ width, height })
    fabricCanvas.renderAll()
  }

  const isInitialized = () => !!fabricCanvas

  /**
   * 最小化畫布：透過 Fabric.js setDimensions 將 canvas 縮為 1×1，
   * 釋放 GPU backing store（~1.4MB），離開繪圖模式時呼叫。
   * 使用官方 API 確保 Fabric.js 內部 width/height 與 DOM 保持同步，
   * 避免後續 restoreCanvas 呼叫 setWidth 時因「值未變」而跳過 DOM 更新。
   */
  const minimizeCanvas = () => {
    if (!fabricCanvas || _isMinimized) return
    fabricCanvas.setDimensions({ width: 1, height: 1 })
    _isMinimized = true
  }

  /**
   * 恢復畫布：僅在 minimizeCanvas 呼叫過的情況才執行，
   * 避免第一次進入繪圖 tab 時觸發不必要的 setDimensions + renderAll。
   */
  const restoreCanvas = () => {
    if (!fabricCanvas || !_isMinimized || !initialWidth || !initialHeight) return
    fabricCanvas.setDimensions({ width: initialWidth, height: initialHeight })
    fabricCanvas.renderAll()
    _isMinimized = false
  }

  const dispose = () => {
    if (fabricCanvas) {
      redoStack.length = 0
      onUndoRedoChange = null
      _isMinimized = false
      fabricCanvas.dispose()
      fabricCanvas = null
      inkBrush = null
      eraserBrush = null
    }
  }

  return {
    init,
    setDrawingMode,
    setEraserMode,
    setBrushColor,
    setBrushWidth,
    setEraserWidth,
    exportToDataURL,
    loadFromDataURL,
    clear,
    resize,
    dispose,
    minimizeCanvas,
    restoreCanvas,
    isInitialized,
    getCanvas: () => fabricCanvas,
    undo,
    redo,
    canUndo,
    canRedo,
    setOnUndoRedoChange
  }
}
