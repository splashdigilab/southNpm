<template>
  <div v-if="!isCanvasReady" class="p-canvas-loading" role="status" aria-live="polite">
    <div class="p-canvas-loading__spinner" aria-hidden="true"></div>
    <p class="p-canvas-loading__text">Loading...</p>
  </div>
  <div
    v-else-if="!hasUserStarted"
    class="p-canvas-start"
    role="dialog"
    aria-modal="true"
    aria-labelledby="p-canvas-start-title"
  >
    <h1 id="p-canvas-start-title" class="p-canvas-start__title">大螢幕展示</h1>
    <p class="p-canvas-start__hint">請點擊「開始」以啟用播放（含插播影片聲音）。</p>
    <button type="button" class="p-canvas-start__btn" @click="beginCanvasSession">開始</button>
  </div>
  <div v-show="isCanvasReady && hasUserStarted" class="p-wall" :style="{ '--note-scale': noteScale }">
    <!-- 固定 445:250 比例的展示舞台，置中、不超出螢幕，外圍以黑色填滿 -->
    <div class="p-wall__stage">
      <!-- 單一展示區：固定 N 個格位，超出數量時最舊往上淡出、最新往上淡入 -->
      <div class="p-wall__zone" ref="zoneRef">
        <div
          v-for="(slot, i) in slots"
          :key="i"
          class="p-wall__slot"
          :style="slotStyle(slot)"
        >
          <Transition name="note-up">
            <div
              v-if="slotNote[i]"
              :key="getId(slotNote[i])"
              class="p-wall__note"
            >
              <div class="p-wall__note-inner" :style="{ transform: `rotate(${slot.rot}deg)` }">
                <StickyNote :note="slotNote[i]" />
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <!-- 插播影片：全螢幕覆蓋 -->
    <div
      v-show="showInterstitial && interstitialSrc"
      class="p-wall__interstitial"
      aria-hidden="true"
    >
      <video
        ref="videoRef"
        class="p-wall__interstitial-video"
        :src="interstitialSrc || undefined"
        preload="auto"
        playsinline
        @ended="onInterstitialVideoEnded"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import StickyNote from '~/components/StickyNote.vue'
import { useFirestore } from '~/composables/useFirestore'
import {
  getInterstitialSlotKey,
  clampInterstitialIntervalMinutes,
  parseInterstitialScheduleEnabled
} from '~/composables/useConductor'
import type { QueueHistoryItem, QueuePendingItem } from '~/types'

definePageMeta({ layout: false })

type Note = QueueHistoryItem | QueuePendingItem

/* ─── URL 參數 ─── */
const route = useRoute()
/** 畫面最多顯示的便利貼數量；超出才會淘汰最舊的 */
const capacity = computed(() => Math.max(1, Number(route.query.count) || 16))
const noteScale = computed(() => Number(route.query.scale ?? route.query.liveScale) || 0.95)

/* ─── Firestore ─── */
const { $firestore } = useNuxtApp()
const db = $firestore as any
const { listenToHistory, listenToPendingQueue, moveToHistory } = useFirestore()

const getId = (n: Note | null | undefined): string => (n ? (n.id ?? n.token ?? '') : '')

/* ─── 狀態 ─── */
const isCanvasReady = ref(false)
const hasUserStarted = ref(false)

/* ─── 展示格位（固定 N 個位置，position 穩定不重排） ─── */
interface Slot { left: number; top: number; size: number; rot: number }
const zoneRef = ref<HTMLElement | null>(null)
const slots = ref<Slot[]>([])
/** 每個格位目前的便利貼（null = 空）；改變即觸發該格位的淡入/淡出 */
const slotNote = reactive<(Note | null)[]>([])
/** 空格填入順序（打散，避免一開始都擠在中央） */
let emptyFillOrder: number[] = []

const slotStyle = (slot: Slot) => ({
  left: `${slot.left}px`,
  top: `${slot.top}px`,
  width: `${slot.size}px`,
  height: `${slot.size}px`
})

/* ══════════════════════════════════════════════
   不重疊散布座標（Fermat 螺旋 + 碰撞檢測）
   ══════════════════════════════════════════════ */
const PADDING = 40
const VIRTUAL_ITEM_SIZE = 550
/** 物件之間額外保留的間距（虛擬單位，>0 確保彼此不接觸） */
const VIRTUAL_GAP = 30
const SPIRAL_C = 35

interface VPos { x: number; y: number }

function getGridKey(x: number, y: number, cell: number): string {
  return `${Math.floor(x / cell)},${Math.floor(y / cell)}`
}
function isColliding(pos: VPos, grid: Map<string, VPos[]>, cell: number, radius: number): boolean {
  const cx = Math.floor(pos.x / cell)
  const cy = Math.floor(pos.y / cell)
  const diamSq = (radius * 2) ** 2
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ns = grid.get(`${cx + dx},${cy + dy}`)
      if (ns) for (const e of ns) {
        const ddx = pos.x - e.x, ddy = pos.y - e.y
        if (ddx * ddx + ddy * ddy < diamSq) return true
      }
    }
  }
  return false
}
/**
 * 以 collisionRadius（便利貼外接圓半徑 + 半間距）做碰撞檢測；
 * 任意旋轉角度的方形都被其外接圓涵蓋，故圓不重疊 ⇒ 方形必不重疊。
 *
 * aspect = 目標區域寬高比。螺旋點在「碰撞檢測前」即依此比例做等面積拉伸
 * （x×√aspect、y÷√aspect），使最終只需等比縮放即可填滿區域、無需破壞
 * 不重疊保證的非等比壓縮。
 */
function calcVirtualPositions(count: number, collisionRadius: number, aspect: number): VPos[] {
  const cell = collisionRadius * 2
  const sx = Math.sqrt(aspect)
  const sy = 1 / sx
  const positions: VPos[] = []
  const grid = new Map<string, VPos[]>()
  let spiralIndex = 0
  for (let i = 0; i < count; i++) {
    let cur: VPos = { x: 0, y: 0 }
    if (i > 0) {
      let found = false
      while (!found) {
        const r = SPIRAL_C * Math.sqrt(spiralIndex)
        const theta = spiralIndex * 137.508 * (Math.PI / 180)
        cur = { x: r * Math.cos(theta) * sx, y: r * Math.sin(theta) * sy }
        if (!isColliding(cur, grid, cell, collisionRadius)) found = true
        spiralIndex++
      }
    } else {
      spiralIndex++
    }
    positions.push(cur)
    const key = getGridKey(cur.x, cur.y, cell)
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(cur)
  }
  return positions
}

/** 依容量計算固定 N 個格位（穩定座標，不隨數量重排） */
function recomputeSlots() {
  const zone = zoneRef.value
  if (!zone) return
  const n = capacity.value
  const zoneW = zone.clientWidth - PADDING * 2
  const zoneH = zone.clientHeight - PADDING * 2
  if (zoneW <= 0 || zoneH <= 0 || n <= 0) return

  // 便利貼實際佔位（含 noteScale），碰撞與邊界皆以此為準
  const itemSize = VIRTUAL_ITEM_SIZE * noteScale.value
  const collisionRadius = (itemSize * Math.SQRT2 + VIRTUAL_GAP) / 2
  const positions = calcVirtualPositions(n, collisionRadius, zoneW / zoneH)

  let minX = positions[0]!.x - itemSize / 2
  let maxX = positions[0]!.x + itemSize / 2
  let minY = positions[0]!.y - itemSize / 2
  let maxY = positions[0]!.y + itemSize / 2
  for (let i = 1; i < positions.length; i++) {
    const p = positions[i]!
    minX = Math.min(minX, p.x - itemSize / 2)
    maxX = Math.max(maxX, p.x + itemSize / 2)
    minY = Math.min(minY, p.y - itemSize / 2)
    maxY = Math.max(maxY, p.y + itemSize / 2)
  }

  const virtualW = maxX - minX
  const virtualH = maxY - minY

  // 點雲已預先拉伸成接近區域比例，僅做等比縮放即可填滿，不破壞不重疊保證
  const scale = Math.min((zoneW / virtualW) || 1, (zoneH / virtualH) || 1)
  const size = Math.max(40, itemSize * scale)

  const prevRot = slots.value.map(s => s.rot)
  const next: Slot[] = positions.map((p, i) => {
    const cx = (p.x - minX) * scale
    const cy = (p.y - minY) * scale
    return {
      left: Math.max(0, Math.min(cx - size / 2, zoneW - size)) + PADDING,
      top: Math.max(0, Math.min(cy - size / 2, zoneH - size)) + PADDING,
      size,
      rot: prevRot[i] ?? (Math.random() - 0.5) * 12 // rot 穩定，不因重算而跳動
    }
  })

  slots.value = next
  // 初始化 slotNote 長度與空格填入順序（保留既有的便利貼）
  if (slotNote.length !== n) {
    slotNote.length = n
    for (let i = 0; i < n; i++) if (slotNote[i] === undefined) slotNote[i] = null
  }
  emptyFillOrder = shuffle([...Array(n).keys()])
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

/* ══════════════════════════════════════════════
   展示資料：歷史驅動畫面、pending 即時轉入歷史
   ══════════════════════════════════════════════ */
let unsubHistory: (() => void) | null = null
let unsubPending: (() => void) | null = null
const promotedIds = new Set<string>()

/** 依最新歷史清單，計算要淡出（最舊）與淡入（最新）的格位，crossfade 在同一格位完成 */
function applyHistory(items: Note[]) {
  if (!slots.value.length) return
  const n = capacity.value
  const incoming = items.slice(0, n)
  const incomingIds = new Set(incoming.map(getId))

  const presentIds = new Set<string>()
  const removedSlots: number[] = []
  for (let i = 0; i < n; i++) {
    const note = slotNote[i]
    if (!note) continue
    const id = getId(note)
    if (incomingIds.has(id)) presentIds.add(id)
    else removedSlots.push(i) // 已掉出畫面（最舊）→ 待淡出
  }

  // 新到的（最新）：反轉成由舊到新，讓最新的最後填入
  const added = incoming.filter(note => !presentIds.has(getId(note))).reverse()

  const emptySlots = emptyFillOrder.filter(i => !slotNote[i] && !removedSlots.includes(i))
  // 優先重用「最舊淡出」的格位 → 同一格位完成 最舊往上淡出 + 最新往上淡入
  const freeQueue = [...removedSlots, ...emptySlots]

  for (const note of added) {
    const slot = freeQueue.shift()
    if (slot === undefined) break
    slotNote[slot] = note
  }

  // 沒有被新便利貼接手的淘汰格位 → 清空（單純往上淡出）
  for (const i of removedSlots) {
    const note = slotNote[i]
    if (note && !incomingIds.has(getId(note))) slotNote[i] = null
  }

  broadcastState()
}

/** 廣播目前畫面上的便利貼（精簡：僅 id/token/font），供編輯器避免同字重複 */
function broadcastState() {
  const notes = slotNote.filter(Boolean) as Note[]
  const live_grid = notes.map(n => ({
    id: getId(n),
    token: n.token ?? getId(n),
    status: n.status ?? 'played',
    style: { font: n.style?.font ?? null }
  }))
  setDoc(doc(db, 'system', 'current_state'), {
    mode: notes.length ? 'live' : 'idle',
    now_playing: null,
    live_grid,
    updated_at: Date.now()
  }).catch(e => console.error('[wall] broadcast', e))
}

/* ══════════════════════════════════════════════
   插播影片
   ══════════════════════════════════════════════ */
const interstitialSrc = ref<string | null>(null)
const interstitialIntervalMinutes = ref(clampInterstitialIntervalMinutes(undefined))
const interstitialScheduleEnabled = ref(false)
const showInterstitial = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)
let unsubCanvasVideo: (() => void) | null = null
let interstitialArmTimer: ReturnType<typeof setInterval> | null = null
let lastPlayedSlotKey = ''
const interstitialPreload = new Map<string, Promise<void>>()

const applyCanvasVideoConfig = (data?: {
  videoUrl?: string
  interstitialIntervalMinutes?: number
  interstitialScheduleEnabled?: boolean
}) => {
  if (!data) {
    interstitialSrc.value = null
    interstitialIntervalMinutes.value = clampInterstitialIntervalMinutes(undefined)
    interstitialScheduleEnabled.value = false
    return
  }
  const u = data.videoUrl
  interstitialSrc.value = typeof u === 'string' && u.length > 0 ? u : null
  interstitialIntervalMinutes.value = clampInterstitialIntervalMinutes(data.interstitialIntervalMinutes)
  interstitialScheduleEnabled.value = parseInterstitialScheduleEnabled(data.interstitialScheduleEnabled)
}

const preloadVideo = (url: string): Promise<void> => {
  if (interstitialPreload.has(url)) return interstitialPreload.get(url)!
  const p = new Promise<void>((resolve, reject) => {
    const video = document.createElement('video')
    let done = false
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('timeout')) }, 12000)
    const cleanup = () => {
      if (done) return
      done = true
      window.clearTimeout(timeout)
      video.removeEventListener('canplaythrough', onReady)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
      video.src = ''
      video.load()
    }
    const onReady = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); reject(new Error('error')) }
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.addEventListener('canplaythrough', onReady, { once: true })
    video.addEventListener('loadeddata', onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.src = url
    video.load()
  }).catch((e) => { interstitialPreload.delete(url); throw e })
  interstitialPreload.set(url, p)
  return p
}

const isAutoplayNotAllowed = (e: unknown): boolean =>
  e instanceof DOMException && e.name === 'NotAllowedError'

const playInterstitial = async () => {
  if (!interstitialSrc.value) return
  showInterstitial.value = true
  try { await preloadVideo(interstitialSrc.value) } catch { /* 直接嘗試播放 */ }
  await nextTick()
  const v = videoRef.value
  if (!v) { showInterstitial.value = false; return }
  v.currentTime = 0
  v.muted = false
  try {
    await v.play()
  } catch (e) {
    if (!isAutoplayNotAllowed(e)) { onInterstitialVideoEnded(); return }
    try { v.muted = true; await v.play() } catch { onInterstitialVideoEnded() }
  }
}

const onInterstitialVideoEnded = () => {
  videoRef.value?.pause()
  showInterstitial.value = false
}

/* ══════════════════════════════════════════════
   啟動
   ══════════════════════════════════════════════ */
const beginCanvasSession = async () => {
  if (hasUserStarted.value) return
  hasUserStarted.value = true
  await nextTick()
  recomputeSlots()

  // 載入畫面：歷史驅動展示
  unsubHistory = listenToHistory(capacity.value, (items) => {
    applyHistory(items as Note[])
  })

  // pending 即時轉入歷史（轉入後會經由 history listener 淡入畫面）
  unsubPending = listenToPendingQueue((items) => {
    for (const it of items) {
      const id = getId(it)
      if (!id || promotedIds.has(id)) continue
      promotedIds.add(id)
      moveToHistory(it).catch((e) => {
        promotedIds.delete(id)
        console.warn('[wall] moveToHistory 失敗', e)
      })
    }
  })

  // 插播排程：每秒檢查，命中時段才播放（與 canvas 既有間隔規則一致）
  interstitialArmTimer = setInterval(() => {
    if (!interstitialScheduleEnabled.value || showInterstitial.value) return
    const d = new Date()
    if (d.getSeconds() !== 0) return
    const nMin = interstitialIntervalMinutes.value
    const totalM = d.getHours() * 60 + d.getMinutes()
    if (totalM % nMin !== 0) return
    const slotKey = getInterstitialSlotKey(d, nMin)
    if (slotKey === lastPlayedSlotKey) return
    lastPlayedSlotKey = slotKey
    void playInterstitial()
  }, 1000)
}

let onResize: (() => void) | null = null

onMounted(async () => {
  document.body.style.margin = '0'
  document.body.style.overflow = 'hidden'

  try {
    const initialSnap = await getDoc(doc(db, 'system', 'canvas_video'))
    applyCanvasVideoConfig(initialSnap.exists() ? (initialSnap.data() as any) : undefined)
  } catch (e) {
    console.warn('[wall] 讀取初始插播設定失敗', e)
  }

  unsubCanvasVideo = onSnapshot(doc(db, 'system', 'canvas_video'), (snap) => {
    applyCanvasVideoConfig(snap.exists() ? (snap.data() as any) : undefined)
    if (interstitialScheduleEnabled.value && interstitialSrc.value) {
      void preloadVideo(interstitialSrc.value).catch(() => {})
    }
  })

  onResize = () => recomputeSlots()
  window.addEventListener('resize', onResize)

  isCanvasReady.value = true
})

onUnmounted(() => {
  unsubHistory?.(); unsubHistory = null
  unsubPending?.(); unsubPending = null
  unsubCanvasVideo?.(); unsubCanvasVideo = null
  if (interstitialArmTimer) { clearInterval(interstitialArmTimer); interstitialArmTimer = null }
  if (onResize) { window.removeEventListener('resize', onResize); onResize = null }
  document.body.style.margin = ''
  document.body.style.overflow = ''
})
</script>

<style scoped>
.p-wall {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #000;
}

/* 固定 445:250 比例的舞台：在不超出螢幕的前提下盡量放大並置中 */
.p-wall__stage {
  position: absolute;
  inset: 0;
  margin: auto;
  width: min(100vw, 100vh * 445 / 250);
  aspect-ratio: 445 / 250;
  max-width: 100vw;
  max-height: 100vh;
  overflow: hidden;
  background: #fff url('/canvasBg.png') center / cover no-repeat;
}

.p-wall__zone {
  position: absolute;
  inset: 0;
}

.p-wall__slot {
  position: absolute;
}

.p-wall__note {
  position: absolute;
  inset: 0;
  will-change: transform, opacity;
}

.p-wall__note-inner {
  position: absolute;
  inset: 0;
  transform-origin: center center;
}

/* 淡入/淡出：皆為「往上位移 + 透明度」，不做橫向飛行 */
.note-up-enter-active,
.note-up-leave-active {
  transition: opacity 0.9s ease, transform 0.9s ease;
}
/* 最新：自下方往上淡入 */
.note-up-enter-from {
  opacity: 0;
  transform: translateY(48px);
}
/* 最舊：原位往上淡出 */
.note-up-leave-to {
  opacity: 0;
  transform: translateY(-48px);
}
/* 離場期間絕對定位，與進場者重疊在同一格位 crossfade */
.note-up-leave-active {
  position: absolute;
  inset: 0;
}

.p-wall__interstitial {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.p-wall__interstitial-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
