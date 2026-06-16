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
  <div v-show="isCanvasReady && hasUserStarted" class="p-wall">
    <!-- 固定 445:250 比例的展示舞台，置中、不超出螢幕，外圍以黑色填滿 -->
    <div class="p-wall__stage">
      <!-- 左側 12×12 paper.webp 格陣：依 font 編號決定固定格位（font-01 右上 → font-144 左下） -->
      <div ref="gridRef" class="p-wall__grid">
        <div
          v-for="i in TOTAL_CELLS"
          :key="i"
          class="p-wall__cell"
          :data-cell="i - 1"
          :style="cellGridStyle(i - 1)"
        >
          <!-- 不用淡入：聚光飛入動畫結束時與聚光元素「同一影格」原子交換，避免落定瞬間閃一下 -->
          <div
            v-if="gridNotes[i - 1]"
            :key="getId(gridNotes[i - 1])"
            class="p-wall__cell-note"
          >
            <StickyNote :note="noteAt(i - 1)" />
          </div>
        </div>
      </div>

      <!-- 聚光區：新上傳的字先在畫面右側中段放大，10 秒後飛回左側自己的格子 -->
      <div
        v-if="spotlightNote"
        ref="spotlightRef"
        class="p-wall__spotlight"
        :key="getId(spotlightNote)"
      >
        <div class="p-wall__cell-note">
          <StickyNote :note="spotlightNote" />
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
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'
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

/* ─── 格陣設定 ─── */
const GRID_COLS = 12
const GRID_ROWS = 12
const TOTAL_CELLS = GRID_COLS * GRID_ROWS // 144
/** 新字在右下角放大停留的時間，到時才縮回自己的格子 */
const SPOTLIGHT_HOLD_MS = 10000

/* ─── Firestore ─── */
const { $firestore } = useNuxtApp()
const db = $firestore as any
const { listenToHistory, listenToPendingQueue, moveToHistory } = useFirestore()

// 以穩定的 token 當識別（doc id 會因 self-healing 刪孤兒／去重而改變，會害同一張被當成新字重播）
const getId = (n: Note | null | undefined): string => (n ? (n.token ?? n.id ?? '') : '')

/** 取 playedAt 的毫秒；serverTimestamp 尚未解析時為 null（代表剛寫入＝真的剛上傳） */
function playedAtMs(n: Note | null | undefined): number | null {
  const p = (n as QueueHistoryItem | undefined)?.playedAt as any
  if (!p) return null
  if (typeof p.toMillis === 'function') return p.toMillis()
  if (p instanceof Date) return p.getTime()
  if (typeof p === 'number') return p
  return null
}

/** 只有「最近上傳」的字才播聚光；超過此秒數視為舊資料（含時鐘誤差留餘裕） */
const SPOTLIGHT_RECENT_MS = 60_000

/** 取出格位上的便利貼（模板於 v-if 已保證非空），讓型別收斂為 Note 供 StickyNote 使用 */
const noteAt = (idx: number): Note => gridNotes[idx] as Note

/** 由 note.style.font（如 "font-37"）取出 1~144 的編號；無效則回傳 null */
function fontNumberOf(n: Note | null | undefined): number | null {
  const f = n?.style?.font
  if (typeof f !== 'string') return null
  const m = /font-0*(\d+)/.exec(f)
  if (!m) return null
  const num = Number(m[1])
  return Number.isFinite(num) && num >= 1 && num <= TOTAL_CELLS ? num : null
}

/**
 * 格位填法：由右上往下，最左邊是最後一列。
 *   font-01 → 右上角；font-12 → 最右一列最下；font-13 → 右邊第二列最上；font-144 → 左下角。
 * 以 0-based 格位 idx（= font 編號 − 1）換算 CSS grid 的欄/列（1-based，欄由左數）。
 */
function cellGridStyle(idx: number) {
  const colFromRight = Math.floor(idx / GRID_ROWS) // 0 = 最右一列
  const row = idx % GRID_ROWS                       // 0 = 最上
  return {
    gridColumn: String(GRID_COLS - colFromRight),
    gridRow: String(row + 1)
  }
}

/* ─── 狀態 ─── */
const isCanvasReady = ref(false)
const hasUserStarted = ref(false)

const gridRef = ref<HTMLElement | null>(null)
const spotlightRef = ref<HTMLElement | null>(null)

/** 144 個固定格位目前的便利貼（null = 空） */
const gridNotes = reactive<(Note | null)[]>(new Array(TOTAL_CELLS).fill(null))
/** 已放進格子或已排入聚光佇列的 id，避免重複處理 */
const knownIds = new Set<string>()
let initialized = false

/* ─── 聚光佇列 ─── */
const spotlightNote = ref<Note | null>(null)
const spotQueue: Note[] = []
let spotlightBusy = false
let spotlightTimer: ReturnType<typeof setTimeout> | null = null
let currentTween: { kill: () => void } | null = null

/* ══════════════════════════════════════════════
   展示資料：歷史驅動格陣，pending 即時轉入歷史
   ══════════════════════════════════════════════ */
let unsubHistory: (() => void) | null = null
let unsubPending: (() => void) | null = null
const promotedIds = new Set<string>()

function applyHistory(items: Note[]) {
  const valid = items.filter(it => fontNumberOf(it) != null)

  // 首次載入：所有既有的字直接出現在格子裡，不播放放大動畫
  if (!initialized) {
    for (const it of valid) {
      const idx = fontNumberOf(it)! - 1
      // 先標記為已知：同 font 的較舊重複字會被 continue 跳過，若不在此記錄就會被
      // 下一次快照當成「新字」排進聚光佇列重播（font-116、font-11 先跑的成因）
      knownIds.add(getId(it))
      if (gridNotes[idx]) continue
      gridNotes[idx] = it
    }
    initialized = true
    broadcastState()
    return
  }

  // 之後第一次看到的字（依序 舊→新）
  const fresh = valid.filter(it => !knownIds.has(getId(it))).reverse()
  if (!fresh.length) return
  const now = Date.now()
  let queued = false
  for (const it of fresh) {
    knownIds.add(getId(it))
    const ms = playedAtMs(it)
    // ms == null：剛寫入、serverTimestamp 尚未解析 → 真的剛上傳，播聚光
    // 近 SPOTLIGHT_RECENT_MS 內：真的新上傳，播聚光
    // 否則：舊資料因 limit 視窗位移／快取補進而首次被看到 → 直接落格，不重播聚光
    if (ms == null || now - ms < SPOTLIGHT_RECENT_MS) {
      spotQueue.push(it)
      queued = true
    } else {
      const idx = fontNumberOf(it)! - 1
      if (!gridNotes[idx]) gridNotes[idx] = it
    }
  }
  broadcastState()
  if (queued) void processSpotlightQueue()
}

async function processSpotlightQueue() {
  if (spotlightBusy || !spotQueue.length) return
  spotlightBusy = true

  const note = spotQueue.shift()!
  spotlightNote.value = note
  await nextTick()

  // 右下角放大停留 SPOTLIGHT_HOLD_MS
  await new Promise<void>(resolve => {
    spotlightTimer = setTimeout(resolve, SPOTLIGHT_HOLD_MS)
  })
  spotlightTimer = null

  await flyToCell(note)

  spotlightBusy = false
  void processSpotlightQueue()
}

/** FLIP：把聚光中的便利貼從右下角縮放平移到它在格陣中的目標格位，完成後落定格子 */
async function flyToCell(note: Note) {
  const idx = fontNumberOf(note)! - 1
  const commit = () => {
    gridNotes[idx] = note
    spotlightNote.value = null
    broadcastState()
  }

  const spotEl = spotlightRef.value
  const cellEl = gridRef.value?.querySelector(`[data-cell="${idx}"]`) as HTMLElement | null
  if (!spotEl || !cellEl) { commit(); return }

  // 清掉進場 CSS 動畫，避免其 transform 蓋過 GSAP 的 inline transform 造成「瞬移」
  spotEl.style.animation = 'none'

  const s = spotEl.getBoundingClientRect()
  const t = cellEl.getBoundingClientRect()
  if (!s.width || !t.width) { commit(); return }

  const dx = (t.left + t.width / 2) - (s.left + s.width / 2)
  const dy = (t.top + t.height / 2) - (s.top + s.height / 2)
  const scale = t.width / s.width

  try {
    const { gsap } = await import('gsap')
    await new Promise<void>(resolve => {
      currentTween = gsap.to(spotEl, {
        x: dx,
        y: dy,
        scale,
        duration: 0.85,
        ease: 'power3.inOut',
        onComplete: () => resolve()
      })
    })
  } catch {
    /* 動畫失敗就直接落定 */
  } finally {
    currentTween = null
  }
  commit()
}

/** 廣播目前畫面上的便利貼（精簡：僅 id/token/font），供編輯器避免同字重複 */
function broadcastState() {
  const live = [...gridNotes, spotlightNote.value].filter(Boolean) as Note[]
  const live_grid = live.map(n => ({
    id: getId(n),
    token: n.token ?? getId(n),
    status: n.status ?? 'played',
    style: { font: n.style?.font ?? null }
  }))
  setDoc(doc(db, 'system', 'current_state'), {
    mode: live.length ? 'live' : 'idle',
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

  // 載入畫面：歷史驅動格陣（最多 144 格）
  unsubHistory = listenToHistory(TOTAL_CELLS, (items) => {
    applyHistory(items as Note[])
  })

  // pending 即時轉入歷史（轉入後會經由 history listener 進入格陣）
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

onMounted(async () => {
  document.body.style.margin = '0'
  document.body.style.overflow = 'hidden'

  // 背景預載 GSAP，讓第一個聚光飛入時不需等待動態載入
  if (typeof window !== 'undefined') import('gsap').catch(() => {})

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

  isCanvasReady.value = true
})

onUnmounted(() => {
  unsubHistory?.(); unsubHistory = null
  unsubPending?.(); unsubPending = null
  unsubCanvasVideo?.(); unsubCanvasVideo = null
  if (interstitialArmTimer) { clearInterval(interstitialArmTimer); interstitialArmTimer = null }
  if (spotlightTimer) { clearTimeout(spotlightTimer); spotlightTimer = null }
  currentTween?.kill()
  document.body.style.margin = ''
  document.body.style.overflow = ''
})
</script>
