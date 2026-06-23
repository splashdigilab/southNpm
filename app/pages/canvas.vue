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
      <!-- 背景影片：自動播放、循環、靜音；亮度由 JS 隨播放進度微調（前段不變、後段微亮） -->
      <video
        ref="bgVideoRef"
        class="p-wall__bg-video"
        src="/canvasBg.mp4"
        autoplay
        loop
        muted
        playsinline
        aria-hidden="true"
      />
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
            :class="{ 'is-leaving': resetting }"
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

      <!-- idle 招呼：沒有字在右側聚光展示時，猴子走入畫面招呼觀眾；有字進來時走出畫面 -->
      <div v-if="showIdleOverlay" class="p-wall__reset-stage">
        <div class="p-wall__reset-group" :class="{ 'is-in': idleMonkeyIn }">
          <img
            src="/monkey.webp"
            alt=""
            aria-hidden="true"
            class="p-wall__reset-monkey"
          />
          <Transition name="p-wall-reset-chat">
            <div v-if="idleChatIn" class="p-wall__reset-chat">
              <img src="/chat.webp" alt="" aria-hidden="true" class="p-wall__reset-chat-bg" />
              <div class="p-wall__reset-chat-text">
                <p class="p-wall__reset-chat-main">{{ IDLE_TEXT }}</p>
              </div>
            </div>
          </Transition>
        </div>
      </div>

      <!-- 測試模式 reset：猴子走入畫面 → 對話框逐字顯示（猴子與對話框同一容器一起移動） -->
      <div v-if="showResetOverlay" class="p-wall__reset-stage">
        <div class="p-wall__reset-group" :class="{ 'is-in': monkeyIn }">
          <img
            src="/monkey.webp"
            alt=""
            aria-hidden="true"
            class="p-wall__reset-monkey"
          />
          <Transition name="p-wall-reset-chat">
            <div v-if="chatIn" class="p-wall__reset-chat">
              <img src="/chat.webp" alt="" aria-hidden="true" class="p-wall__reset-chat-bg" />
              <div class="p-wall__reset-chat-text">
                <p class="p-wall__reset-chat-main">{{ typedMain }}</p>
                <p class="p-wall__reset-chat-sub">{{ typedSub }}</p>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <!-- reset 綠幕去背動畫：WebGL chroma key，順向→清空→反向 -->
    <canvas
      v-show="showResetVideo"
      ref="chromaCanvasRef"
      class="p-wall__reset-chroma"
      aria-hidden="true"
    />
    <video
      ref="chromaVideoRef"
      class="p-wall__reset-chroma-src"
      src="/resetAnimation.mp4"
      preload="auto"
      muted
      playsinline
      aria-hidden="true"
    />

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
import { useChromaVideo } from '~/composables/useChromaVideo'
import {
  getInterstitialSlotKey,
  clampInterstitialIntervalMinutes,
  parseInterstitialScheduleEnabled
} from '~/composables/useConductor'
import { TEST_FONT_COUNT } from '~/data/fonts'
import type { QueueHistoryItem, QueuePendingItem } from '~/types'

definePageMeta({ layout: false })

type Note = QueueHistoryItem | QueuePendingItem

/* ─── 格陣設定 ─── */
const GRID_COLS = 12
const GRID_ROWS = 12
const TOTAL_CELLS = GRID_COLS * GRID_ROWS // 144
/** 新字在右下角放大停留的時間，到時才縮回自己的格子 */
const SPOTLIGHT_HOLD_MS = 10000

/* ─── 測試模式 ─── */
/** 測試版：只要前 TEST_CAPACITY 格都填滿，就進入 reset 流程。
 *  字數統一由 fonts.ts 的 TEST_FONT_COUNT 控制（編輯器可選字池與此處同源）。 */
const TEST_MODE = true
const TEST_CAPACITY = TEST_FONT_COUNT
/** 對話框文字打完後的停留時間 */
const RESET_TEXT_HOLD_MS = 4000

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
const bgVideoRef = ref<HTMLVideoElement | null>(null)

/** 144 個固定格位目前的便利貼（null = 空） */
const gridNotes = reactive<(Note | null)[]>(new Array(TOTAL_CELLS).fill(null))
/** 已放進格子或已排入聚光佇列的 id，避免重複處理 */
const knownIds = new Set<string>()
let initialized = false

/**
 * 測試模式：已經 reset（離場清掉）過的字 token。
 * reset 只清畫面、不刪資料庫，所以 queue_history 仍保留那些字；若不記錄，
 * 每次重整初次載入又會把它們填回前 N 格而再次觸發 reset。
 * 用 localStorage 持久化（大螢幕固定一台機器），載入時把這些 token 標為已知但不上牆。
 */
const CLEARED_TOKENS_KEY = 'npm_wall_cleared_tokens'
const loadClearedTokens = (): string[] => {
  if (typeof window === 'undefined') return []
  try {
    const arr = JSON.parse(localStorage.getItem(CLEARED_TOKENS_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
const clearedTokens = new Set<string>(loadClearedTokens())
const persistClearedTokens = () => {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(CLEARED_TOKENS_KEY, JSON.stringify([...clearedTokens])) } catch { /* ignore */ }
}

/* ─── 聚光佇列 ─── */
const spotlightNote = ref<Note | null>(null)
const spotQueue: Note[] = []
let spotlightBusy = false
let spotlightTimer: ReturnType<typeof setTimeout> | null = null
let currentTween: { kill: () => void } | null = null

/* ─── 測試 reset 流程狀態 ─── */
/** reset 對話 stage（猴子 + 對話框）是否掛載 */
const showResetOverlay = ref(false)
/** 猴子是否已走入定位 */
const monkeyIn = ref(false)
/** 對話框是否淡入 */
const chatIn = ref(false)
/** 對話框主文字（逐字打出） */
const typedMain = ref('')
/** 對話框副文字（逐字打出） */
const typedSub = ref('')
/** 綠幕去背 canvas 是否顯示 */
const showResetVideo = ref(false)
/** 是否正在離場（觸發格內字的 CSS 離場動畫） */
const resetting = ref(false)
/** reset 流程是否進行中（避免重複觸發） */
let resetInProgress = false
let resetTimers: ReturnType<typeof setTimeout>[] = []

/* reset 對話文字內容（沿用原本的右側提示文字） */
const RESET_MAIN_TEXT = '謝謝大家的參與'
const RESET_SUB_TEXT = '稿紙即將更新！'

/* ─── idle 招呼猴子 ─── */
/** 沒有字在右側聚光展示時，猴子走入畫面的招呼台詞 */
const IDLE_TEXT = '快來一起完成千字文吧！'
/** idle 招呼 stage（猴子 + 對話框）是否掛載 */
const showIdleOverlay = ref(false)
/** idle 猴子是否已走入定位 */
const idleMonkeyIn = ref(false)
/** idle 對話框是否淡入 */
const idleChatIn = ref(false)
let idleTimers: ReturnType<typeof setTimeout>[] = []
/** 猴子走入畫面的動畫時間（需與 _canvas.scss 一致） */
const MONKEY_WALK_MS = 1400
/** 對話框淡入時間 */
const CHAT_IN_MS = 450

/* 綠幕去背影片 refs + controller */
const chromaCanvasRef = ref<HTMLCanvasElement | null>(null)
const chromaVideoRef = ref<HTMLVideoElement | null>(null)
const chroma = useChromaVideo({
  keyColor: [0, 1, 0], // 去背鍵色 #00FF00
  similarity: 0.42,
  smoothness: 0.09,
  spill: 0.15 // 加大去色範圍，壓掉半透明邊緣殘留的綠
})
let chromaReady = false

/** 計算前 TEST_CAPACITY 格已填入的數量 */
function filledTestCount(): number {
  let c = 0
  for (let i = 0; i < TEST_CAPACITY; i++) if (gridNotes[i]) c++
  return c
}

/** 前 N 格填滿就觸發 reset 流程（測試模式專用） */
function maybeTriggerReset() {
  if (!TEST_MODE || resetInProgress) return
  if (filledTestCount() >= TEST_CAPACITY) void runResetSequence()
}

/** 目前右側是否「有字在展示」（聚光中／飛行中／排隊中），或正在 reset */
function isDisplayingChar(): boolean {
  return (
    !!spotlightNote.value ||
    spotlightBusy ||
    spotQueue.length > 0 ||
    resetInProgress ||
    showResetOverlay.value
  )
}

/** idle 猴子走入畫面招呼（僅在沒有字展示時） */
function showIdleMonkey() {
  if (isDisplayingChar()) return
  // 已經在畫面中（走入完成）就不重來，避免重置 is-in 造成閃一下
  if (showIdleOverlay.value && idleMonkeyIn.value) return
  idleTimers.forEach(clearTimeout)
  idleTimers = []
  // 確保從「畫面外」起步：先清掉 is-in，再掛載 overlay
  idleMonkeyIn.value = false
  idleChatIn.value = false
  showIdleOverlay.value = true
  // 雙重 rAF：先讓瀏覽器把「畫面外」(translateX 140%) 的初始狀態畫出一幀，
  // 第二幀才加 is-in，transition 才會由畫面外滑入。
  // （單一 rAF 會因 Vue 的 class 變更為非同步套用，首幀就停在定位 → 瞬間出現）
  nextTick(() => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!showIdleOverlay.value) return
    idleMonkeyIn.value = true
    // 走到定位後對話框才淡入（與 reset 同步驟）
    idleTimers.push(setTimeout(() => { idleChatIn.value = true }, MONKEY_WALK_MS))
  })))
}

/** idle 猴子走出畫面（有字進來或進入 reset 時） */
function hideIdleMonkey() {
  if (!showIdleOverlay.value) return
  idleTimers.forEach(clearTimeout)
  idleTimers = []
  idleChatIn.value = false
  idleMonkeyIn.value = false
  // 走出畫面（transition 結束）後卸載
  idleTimers.push(setTimeout(() => { showIdleOverlay.value = false }, MONKEY_WALK_MS))
}

/** 依目前是否有字展示，決定 idle 猴子進場／退場 */
function updateIdleMonkey() {
  if (isDisplayingChar()) hideIdleMonkey()
  else showIdleMonkey()
}

const wait = (ms: number) =>
  new Promise<void>(resolve => {
    resetTimers.push(setTimeout(resolve, ms))
  })

/**
 * Reset 流程：
 *   1. 猴子走入畫面（CSS slide-in）。
 *   2. 對話框淡入，主／副文字逐字打出，停留 RESET_TEXT_HOLD_MS。
 *   3. 綠幕去背影片順向播放；播完同時清空格陣並移除猴子/對話框/文字。
 *   4. 綠幕去背影片反向播放，露出清空後的畫面，結束。
 * 注意：knownIds 不清除，避免 history listener 把同一批字當新字重新補回畫面。
 */
async function runResetSequence() {
  resetInProgress = true

  // 進入 reset：先收掉 idle 招呼猴子，避免與 reset 猴子重疊
  idleTimers.forEach(clearTimeout)
  idleTimers = []
  showIdleOverlay.value = false
  idleMonkeyIn.value = false
  idleChatIn.value = false

  // 1. 猴子走入畫面
  showResetOverlay.value = true
  await nextTick()
  await wait(50)
  monkeyIn.value = true
  await wait(MONKEY_WALK_MS)

  // 2. 對話框淡入：文字直接整段帶出（與 idle 招呼一致，不再逐字打字）
  typedMain.value = RESET_MAIN_TEXT
  typedSub.value = RESET_SUB_TEXT
  chatIn.value = true
  await wait(CHAT_IN_MS)
  await wait(RESET_TEXT_HOLD_MS)

  // 3. 綠幕去背影片順向播放
  showResetVideo.value = true
  await nextTick()
  if (chromaReady) await chroma.playForward()

  // 順向播完的同時：清空格陣（只清畫面，保留 knownIds）並移除對話 stage
  for (const n of gridNotes) if (n) clearedTokens.add(getId(n))
  if (spotlightNote.value) clearedTokens.add(getId(spotlightNote.value))
  persistClearedTokens()
  for (let i = 0; i < gridNotes.length; i++) gridNotes[i] = null
  spotlightNote.value = null
  showResetOverlay.value = false
  monkeyIn.value = false
  chatIn.value = false
  typedMain.value = ''
  typedSub.value = ''
  resetting.value = false
  broadcastState()
  await nextTick()

  // 4. 綠幕去背影片反向播放，露出已清空的畫面
  if (chromaReady) await chroma.playReverse()
  showResetVideo.value = false

  resetInProgress = false
  // reset 後畫面清空、沒有字展示 → 猴子走入招呼
  updateIdleMonkey()
}

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
      // 已 reset 過的字：標為已知但不上牆，避免重整後又填滿前 N 格再次觸發 reset
      // （以 TEST_MODE 為閘，避免日後切回正式 144 字版時誤用 localStorage 殘留的標記）
      if (TEST_MODE && clearedTokens.has(getId(it))) continue
      if (gridNotes[idx]) continue
      gridNotes[idx] = it
    }
    initialized = true
    broadcastState()
    maybeTriggerReset()
    // 載入完成且沒有字在右側聚光展示 → 猴子走入招呼
    updateIdleMonkey()
    return
  }

  // 之後第一次看到的字（依序 舊→新）
  const fresh = valid.filter(it => !knownIds.has(getId(it))).reverse()
  if (!fresh.length) return
  const now = Date.now()
  let queued = false
  for (const it of fresh) {
    knownIds.add(getId(it))
    // 已 reset 過的字：標為已知後直接略過，不重播也不上牆
    if (TEST_MODE && clearedTokens.has(getId(it))) continue
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

/**
 * 處理 queue_history 中「移出快照」的文件：區分「真的被刪」與「被擠出 limit 視窗」。
 * 只有經 getDoc 確認文件確實不存在（＝被後台刪除）時，才把它從牆上格陣／聚光區拿掉，
 * 並從 knownIds 移除（之後若同字重新上傳可再次播放聚光）。拿掉後重新廣播，
 * 讓編輯器讀到的 live_grid 不再含此字，該字帖即釋放回可選池。
 */
async function handleRemovedHistoryIds(ids: string[]) {
  let changed = false
  for (const id of ids) {
    try {
      const snap = await getDoc(doc(db, 'queue_history', id))
      if (snap.exists()) continue // 文件還在，只是離開視窗 → 牆面不動
    } catch {
      continue // 確認失敗就保守不動，避免誤刪牆上的字
    }
    const matches = (n: Note | null | undefined): boolean =>
      !!n && (n.id === id || n.token === id || getId(n) === id)
    for (let i = 0; i < gridNotes.length; i++) {
      const n = gridNotes[i]
      if (matches(n)) {
        knownIds.delete(getId(n))
        gridNotes[i] = null
        changed = true
      }
    }
    if (matches(spotlightNote.value)) {
      knownIds.delete(getId(spotlightNote.value))
      spotlightNote.value = null
      changed = true
    }
  }
  if (changed) broadcastState()
}

async function processSpotlightQueue() {
  if (spotlightBusy || !spotQueue.length) return
  spotlightBusy = true

  const note = spotQueue.shift()!
  spotlightNote.value = note
  // 有字進來：猴子退出螢幕畫面
  hideIdleMonkey()
  // 從排隊移到聚光：重新廣播，確保 live_grid 仍含此字（避免落格前的空窗讓 editor 重複發字）
  broadcastState()
  await nextTick()

  // 右下角放大停留 SPOTLIGHT_HOLD_MS
  await new Promise<void>(resolve => {
    spotlightTimer = setTimeout(resolve, SPOTLIGHT_HOLD_MS)
  })
  spotlightTimer = null

  await flyToCell(note)

  spotlightBusy = false
  // 佇列清空且沒有 reset 進行：沒有字在展示 → 猴子走入招呼
  if (!spotQueue.length) updateIdleMonkey()
  void processSpotlightQueue()
}

/** FLIP：把聚光中的便利貼從右下角縮放平移到它在格陣中的目標格位，完成後落定格子 */
async function flyToCell(note: Note) {
  const idx = fontNumberOf(note)! - 1
  const commit = () => {
    gridNotes[idx] = note
    spotlightNote.value = null
    broadcastState()
    maybeTriggerReset()
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

/**
 * 廣播目前「佔用中」的便利貼（精簡：僅 id/token/font），供編輯器避免同字重複。
 * 必須包含「飛行中」的字：聚光中(spotlightNote) 與 排隊等聚光(spotQueue)。
 * 這些字已送出、已從 queue_pending 移進 queue_history，但還沒飛到左邊格子；
 * 若不一起廣播，editor 讀 live_grid 時會漏掉它們（整段聚光約 10 秒）而把同一個字重複發出。
 */
function broadcastState() {
  const live = [...gridNotes, spotlightNote.value, ...spotQueue].filter(Boolean) as Note[]
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
  unsubHistory = listenToHistory(
    TOTAL_CELLS,
    (items) => { applyHistory(items as Note[]) },
    // 後台刪除便利貼時，把它從牆上拿掉並重新廣播，讓該字帖釋放回編輯器可選池
    (removedIds) => { void handleRemovedHistoryIds(removedIds) }
  )

  // pending 即時轉入歷史（轉入後會經由 history listener 進入格陣）
  unsubPending = listenToPendingQueue((items) => {
    for (const it of items) {
      const id = getId(it)
      if (!id || promotedIds.has(id)) continue
      promotedIds.add(id)
      moveToHistory(it).catch((e) => {
        // 永久性失敗（多半是 drawing 過大／queue_history 缺索引豁免）→ 別重試，
        // 否則每次 pending 快照都重送同一筆，洗版錯誤又無濟於事；留在 promotedIds 直接略過。
        const code = e?.code
        const permanent = code === 'failed-precondition' || code === 'invalid-argument' || code === 'permission-denied'
        if (permanent) {
          console.error('[wall] moveToHistory 永久失敗，略過此筆', id, code)
        } else {
          // 暫時性錯誤（網路等）→ 放回去下次重試
          promotedIds.delete(id)
          console.warn('[wall] moveToHistory 暫時失敗，稍後重試', e)
        }
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

/* ══════════════════════════════════════════════
   背景影片亮度：隨播放進度微調（前段維持原亮度，越接近結尾才微微調亮）
   ══════════════════════════════════════════════ */
/** 影片播到結尾相對起始的最大增亮幅度（0 = 不變；0.18 ≈ 微微調亮） */

onMounted(async () => {
  document.body.style.margin = '0'
  document.body.style.overflow = 'hidden'

  // 背景影片：靜音自動播放（保險再呼叫一次 play），並啟動亮度隨進度微調
  bgVideoRef.value?.play().catch(() => {})

  // 背景預載 GSAP，讓第一個聚光飛入時不需等待動態載入
  if (typeof window !== 'undefined') import('gsap').catch(() => {})

  // 初始化 reset 綠幕去背（WebGL chroma key）；失敗則整段流程跳過影片
  if (chromaCanvasRef.value && chromaVideoRef.value) {
    try {
      chromaReady = await chroma.init(chromaCanvasRef.value, chromaVideoRef.value)
    } catch (e) {
      console.warn('[wall] chroma video 初始化失敗', e)
      chromaReady = false
    }
  }

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
  resetTimers.forEach(clearTimeout); resetTimers = []
  idleTimers.forEach(clearTimeout); idleTimers = []
  if (bgBrightnessRaf != null) { cancelAnimationFrame(bgBrightnessRaf); bgBrightnessRaf = null }
  currentTween?.kill()
  chroma.destroy()
  document.body.style.margin = ''
  document.body.style.overflow = ''
})
</script>
