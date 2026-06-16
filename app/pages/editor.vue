<template>
  <div class="p-editor">
      <!-- Header -->
      <AppHeader show-help relative @back="goBack" @help="showTutorialModal = true" />

      <!-- 活動介紹滿版 overlay：載入時顯示，loading 完後按「開始」關閉 -->
      <Transition name="intro-fade">
        <div v-if="showIntroOverlay" class="p-index__intro-overlay p-editor__intro-overlay">
          <div class="p-index__intro-card">
            <img src="/logo.svg" alt="故宮南院 Logo" class="p-index__intro-logo" />
            <div class="p-index__intro-desc p-index__intro-rules">
              <p style="text-align: center">歡迎來到 故宮南院 數位便利貼！<br>在這裡，您可以創作專屬於您的留言內容，<br>與大家一起分享參觀故宮南院的感動。</p>
              <label class="p-index__intro-terms">
                <input type="checkbox" v-model="termsAccepted" />
                <span>我已閱讀並了解上述介紹</span>
              </label>
            </div>
            <button
              type="button"
              class="p-index__intro-btn c-btn c-btn--primary"
              :disabled="loading"
              @click="onStartClick"
            >
              <span v-if="loading" class="p-index__intro-btn-inner">
                <span class="p-index__intro-spinner" aria-hidden="true" />
                載入中...
              </span>
              <span v-else>開始</span>
            </button>
          </div>
        </div>
      </Transition>

    <!-- Tutorial Modal -->
    <EditorTutorialModal v-model="showTutorialModal" />

    <AppModal
      v-model="showTermsModal"
      title="提示"
      message="請先閱讀並同意活動規範"
      confirm-text="確定"
      cancel-text=""
      @confirm="showTermsModal = false"
    />

    <!-- Draft Modal -->
    <AppModal
      v-model="showDraftModal"
      icon="📝"
      title="發現草稿"
      message="您有一份未完成的草稿，要繼續編輯還是重新開始？"
      confirmText="使用草稿"
      cancelText="重新開始"
      @confirm="handleDraftDecision(true)"
      @cancel="handleDraftDecision(false)"
    />

    <!-- Exit Confirmation Modal -->
    <AppModal
      v-model="showExitModal"
      title="確定離開？"
      message="目前的進度已經為您自動儲存為草稿。確定要離開編輯器嗎？"
      confirmText="確定離開"
      cancelText="留在本頁"
      @confirm="handleExitConfirm"
      @cancel="showExitModal = false"
    />

    <!-- Alert Modal -->
    <AppModal
      v-model="showAlertModal"
      :icon="alertIcon"
      :title="alertTitle"
      :message="alertMessage"
      :confirmText="alertConfirmText"
      :cancelText="''"
      @confirm="handleAlertConfirm"
    />

    <!-- Submit Confirmation Modal -->
    <AppModal
      v-model="showSubmitModal"
      title="確認上傳"
      message="請確認您的便利貼樣貌，上傳後將無法修改。"
      :loading="isSubmitting"
      @confirm="confirmSubmit"
      @cancel="showSubmitModal = false"
    >
      <template #preview>
        <StickyNote v-if="previewNoteData" :note="previewNoteData" />
      </template>
    </AppModal>

    <!-- Clear All Confirmation Modal -->
    <AppModal
      v-model="showClearAllModal"
      icon="⚠️"
      title="確認清除"
      message="確定要清除畫面上所有的內容嗎？此動作無法復原。"
      confirmText="確定清除"
      cancelText="取消"
      @confirm="confirmClearAll"
      @cancel="showClearAllModal = false"
    />

    <!-- Canvas Area -->
    <div class="p-editor__canvas-section">
      <div
        ref="canvasRef"
        class="p-editor__canvas-container"
        :class="{ 'is-draw-mode': drawMode }"
        @click="deselectAll"
        @mousedown="onCanvasMouseDown"
        @touchstart.capture="onCanvasTouchStart"
        @touchmove.capture="onCanvasTouchMove"
        @touchend.capture="onCanvasTouchEnd"
        @touchcancel.capture="onCanvasTouchEnd"
      >
        <!-- 虛擬縮放層：永遠固定 600px 大小 -->
        <div class="p-editor__canvas-scaler" :style="scalerStyle">
          <!-- 內容層：貼紙圖片、手繪 -->
          <div class="p-editor__canvas p-editor__canvas--stage">
          <!-- 描紅字帖：九宮格中央的半透明範字（僅編輯器顯示，不會上傳/上牆/匯出） -->
          <img
            v-if="selectedFontUrl"
            :src="selectedFontUrl"
            class="p-editor__font-guide"
            alt=""
            aria-hidden="true"
            draggable="false"
          />
          <!-- 貼紙圖片；點擊可進入貼紙編輯 -->
          <div
            v-for="sticker in stickers"
            :key="sticker.id"
            class="p-editor__sticker-content"
            :class="{ 'is-sticker-clickable': !drawMode }"
            :style="[getStickerStyle(sticker), { zIndex: getObjectZIndex(sticker.id) }]"
            @click.stop="selectSticker(sticker.id)"
            @touchstart.stop="() => { if (!isTwoFingerGesture) selectSticker(sticker.id) }"
          >
            <img
              v-if="getStickerById(sticker.type)?.svgFile"
              :src="getStickerById(sticker.type)?.svgFile"
              :alt="getStickerById(sticker.type)?.id"
              class="p-editor__sticker-img"
            />
          </div>

          <!-- 手繪層 (Fabric.js) -->
          <div
            ref="drawingLayerRef"
            class="p-editor__drawing-layer"
            :class="{ 'is-active': drawMode }"
            :style="{
              pointerEvents: drawMode ? 'auto' : 'none',
              zIndex: getObjectZIndex('drawing-layer')
            }"
          >
            <!-- Fabric.js canvas：始終留在 DOM（init 需要），縮小後視覺空白 -->
            <canvas ref="drawingCanvasRef" class="p-editor__drawing-canvas" />
            <!-- 非繪圖模式時，用已儲存的 PNG 靜態預覽蓋住空白的縮小 canvas -->
            <img
              v-if="!drawMode && drawingData"
              :src="drawingData"
              class="p-editor__drawing-preview"
              alt=""
              draggable="false"
            />
          </div>
        </div>

        <!-- UI 層：編輯框置頂，不被裁切（繪圖模式時隱藏以便手繪） -->
        <div class="p-editor__canvas-ui" :style="{ pointerEvents: drawMode ? 'none' : undefined }">
          <!-- 中心對齊參考線 -->
          <div
            v-if="showVerticalCenterGuide"
            class="p-editor__guide-line p-editor__guide-line--vertical"
            aria-hidden="true"
          />
          <div
            v-if="showHorizontalCenterGuide"
            class="p-editor__guide-line p-editor__guide-line--horizontal"
            aria-hidden="true"
          />

          <!-- 貼紙編輯框：在貼紙 tab，或 default 狀態且有選取貼紙時顯示 -->
          <div
            v-for="sticker in stickers"
            :key="`ui-${sticker.id}`"
            v-show="showStickerEditFrame && selectedStickerId === sticker.id"
            class="p-editor__edit-frame p-editor__edit-frame--sticker"
            :data-sticker-id="sticker.id"
            :class="{
              'is-selected': selectedStickerId === sticker.id,
              'is-dragging': draggingStickerId === sticker.id,
              'is-transforming': transformingStickerId === sticker.id
            }"
            :style="[getStickerStyle(sticker), { zIndex: getObjectZIndex(sticker.id) }]"
            @mousedown="onStickerMouseDown($event, sticker)"
            @touchstart="onStickerTouchStart($event, sticker)"
            @click.stop="onStickerClick(sticker.id)"
          >
            <button
              class="p-editor__edit-frame-delete"
              @click.stop="removeSticker(sticker.id)"
              @touchstart.stop="onDeleteStickerTouch($event, sticker.id)"
              aria-label="刪除"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>

    <!-- 一鍵清除：在 control-panel 外、tab 上方，與 tab 同顯示條件；v-if + transition 才有漸變 -->
    <transition name="p-editor-top-actions">
      <div
        v-if="!drawMode && activeTab !== 'sticker'"
        class="p-editor__top-actions"
      >
        <button
          type="button"
          class="p-editor__clear-btn"
          @click="handleClearAll"
          aria-label="清除全部"
        >
          <img src="/resetBtn.png" alt="清除全部" class="p-editor__clear-btn-icon" />
        </button>
      </div>
    </transition>

    <!-- Control Panel -->
    <div class="p-editor__control-panel">
      <!-- Tab Bar（操作繪圖或貼紙時隱藏；v-if + transition 才會有出現/消失動畫） -->
      <transition name="p-editor-tab-bar">
        <div v-if="!drawMode && activeTab !== 'sticker'" class="p-editor__tab-bar">
          <button
            v-for="tab in EDITOR_TABS"
            :key="tab.id"
            class="p-editor__tab-btn"
            :class="{ 'is-active': activeTab === tab.id }"
            @click="handleTabClick(tab.id)"
          >
            <img :src="tab.bg" :alt="tab.label" class="p-editor__tab-bg" />
            <span class="p-editor__tab-label">{{ tab.label }}</span>
          </button>
        </div>
      </transition>

      <!-- Tab: 書法 -->
      <transition name="p-editor-tab">
        <div v-if="activeTab === 'draw'" class="p-editor__tab-content">
          <div class="p-editor__control-section">
            <h3 class="p-editor__control-title">筆刷粗細</h3>
            <div class="p-editor__brush-sizes">
              <button
                v-for="size in BRUSH_SIZES"
                :key="size.value"
                type="button"
                class="p-editor__brush-size"
                :class="{ 'is-active': brushWidth === size.value }"
                :style="{ width: size.ring + 'px', height: size.ring + 'px' }"
                :aria-label="size.label"
                @click="brushWidth = size.value"
              >
                <span
                  class="p-editor__brush-size-dot"
                  :style="{ width: size.dot + 'px', height: size.dot + 'px' }"
                />
              </button>
            </div>
          </div>
        </div>
      </transition>

      <!-- Tab: 貼紙 -->
      <transition name="p-editor-tab">
        <div v-if="activeTab === 'sticker'" class="p-editor__tab-content">
          <div class="p-editor__control-section">
            <h3 class="p-editor__control-title">選擇貼紙</h3>
            <div class="p-editor__sticker-grid">
            <button
              v-for="sticker in STICKER_LIBRARY"
              :key="sticker.id"
              class="p-editor__sticker-btn"
              @click="addSticker(sticker.id)"
            >
              <img
                v-if="sticker.svgFile"
                :src="sticker.svgFile"
                :alt="sticker.id"
                loading="lazy"
                class="p-editor__sticker-btn-img"
              />
            </button>
          </div>
          </div>
        </div>
      </transition>
    </div>

    <!-- Hidden node for high-res export (html-to-image)：只在實際分享時才掛載，避免長時間佔用 GPU 記憶體
         注意：不能使用 visibility:hidden，否則 html-to-image 會輸出透明圖片；改用 off-screen + opacity:0 -->
    <div
      v-if="showExportNode"
      style="position: fixed; left: -9999px; top: -9999px; pointer-events: none; opacity: 0;"
    >
      <div ref="exportNodeRef" style="width: 1080px; height: 1080px; background: transparent; display: flex; justify-content: center; align-items: center;">
        <div style="width: 100%; height: 100%; position: relative;">
          <StickyNote :note="previewNoteData" style="position: absolute; left: 0; top: 0; transform: none; width: 100%; height: 100%;" />
        </div>
      </div>
    </div>

    <!-- Bottom Actions -->
    <div class="p-editor__bottom-actions">
      <!-- 繪圖模式：上一步 / 完成繪圖 / 下一步 -->
      <template v-if="drawMode">
        <button
          type="button"
          class="p-editor__draw-btn p-editor__draw-btn--undo"
          :disabled="!drawCanUndo"
          @click="fabricBrush.undo()"
        >
          <img src="/resetBtn.png" alt="上一步" class="p-editor__draw-btn-icon" />
        </button>
        <button
          type="button"
          class="p-editor__action-btn p-editor__action-btn--primary p-editor__action-btn--complete"
          @click="activeTab = null"
        >
          完成書法
        </button>
        <button
          type="button"
          class="p-editor__draw-btn p-editor__draw-btn--redo"
          :disabled="!drawCanRedo"
          @click="fabricBrush.redo()"
        >
          <img src="/resetBtn.png" alt="下一步" class="p-editor__draw-btn-icon p-editor__draw-btn-icon--redo" />
        </button>
      </template>

      <!-- 貼紙模式：完成（回到 default，編輯框消失） -->
      <template v-else-if="activeTab === 'sticker'">
        <button
          type="button"
          class="p-editor__action-btn p-editor__action-btn--primary p-editor__action-btn--full"
          @click="completeStickerEditing"
        >
          完成
        </button>
      </template>

      <!-- default 狀態：上傳大螢幕（草稿自動儲存） -->
      <template v-else>
        <!-- 下載 / 分享便利貼按鈕已隱藏 -->
        <button
          v-if="false"
          type="button"
          class="p-editor__action-btn p-editor__action-btn--share"
          :disabled="isSubmitting || isSharing"
          @click="handleShare"
        >
          {{ isSharing ? '處理中...' : '下載 / 分享便利貼' }}
        </button>
        <button
          type="button"
          class="p-editor__action-btn p-editor__action-btn--primary p-editor__action-btn--full"
          :disabled="isSubmitting || isSharing"
          @click="openSubmitModal"
        >
          上傳大螢幕
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { StickerInstance, DraftData, StickyNoteStyle } from '~/types'
import { getStickerById, STICKER_LIBRARY } from '~/data/stickers'
import { EDITOR_TABS, CALLIGRAPHY_BRUSH_COLOR, BRUSH_SIZES, DEFAULT_BRUSH_SIZE } from '~/data/editor-config'
import { FONT_LIST, getFontUrl } from '~/data/fonts'
import { getStickerStyle } from '~/utils/sticky-note-style'
import { useStickerInteraction } from '~/composables/useStickerInteraction'
import { useCanvasPinch } from '~/composables/useCanvasPinch'
import { useStorage } from '~/composables/useStorage'
import { useFirestore } from '~/composables/useFirestore'
import { useFabricBrush } from '~/composables/useFabricBrush'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '#imports'
import { doc, getDoc, getDocs, onSnapshot, collection, query, orderBy, limit } from 'firebase/firestore'
import StickyNote from '~/components/StickyNote.vue'
import AppModal from '~/components/AppModal.vue'
import EditorTutorialModal from '~/components/EditorTutorialModal.vue'

definePageMeta({ ssr: false })

useHead({
  meta: [
    // interactive-widget=overlays-content：iOS 鍵盤以疊加方式顯示，不壓縮 layout viewport。
    { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=overlays-content' }
  ],
  bodyAttrs: { class: 'is-editor-page' }
})

const route = useRoute()
const router = useRouter()
const { $firestore } = useNuxtApp()
const db = $firestore as any
const { saveDraft, loadDraft, clearDraft, saveToken, loadToken, clearToken } = useStorage()

// Loading state
const loading = ref(true)
const showIntroOverlay = ref(true)
const termsAccepted = ref(false)
const showTermsModal = ref(false)

const onStartClick = () => {
  if (loading.value) return
  if (!termsAccepted.value) {
    showTermsModal.value = true
    return
  }
  showIntroOverlay.value = false

  // 顯示教學或草稿邏輯移至開始之後
  checkInitialModals()
}

// Editor State
const stickers = ref<StickerInstance[]>([])
const selectedStickerId = ref<string | null>(null)
const draggingStickerId = ref<string | null>(null)

// 描紅字帖：進入時隨機挑一張（避開 LED 牆上已出現的字），作為九宮格稿紙的書寫導引
const selectedFontId = ref<string | null>(null)
const selectedFontUrl = computed(() => selectedFontId.value ? getFontUrl(selectedFontId.value) : '')

/** 牆面容量：歷史只取最新 N 筆，對應大螢幕 12×12 格陣目前顯示的字 */
const WALL_CAPACITY = 144

/**
 * 讀取目前「已上傳」所使用的字帖 id 集合，用於避免描紅字帖與牆上重複。
 * 直接讀 Firestore 權威來源（queue_history 最新 144 筆 + queue_pending 待播），
 * 不依賴 system/current_state（那只有大螢幕開著時才會更新，牆沒開就會抓不到而撞字）。
 */
const getUsedFonts = async (): Promise<Set<string>> => {
  const used = new Set<string>()
  const collectFonts = (docs: { data: () => any }[]) => {
    for (const d of docs) {
      const f = d.data()?.style?.font
      if (typeof f === 'string' && f) used.add(f)
    }
  }
  try {
    // 加上 timeout：離線/弱網/冷啟動時 getDocs 可能長時間不回應，不能卡住描紅底圖的顯示。
    // 逾時走 fallback（純隨機），常見的冷啟動逾時只印 debug、不噴錯誤堆疊。
    const TIMEOUT = Symbol('timeout')
    const historyQ = query(
      collection(db, 'queue_history'),
      orderBy('playedAt', 'desc'),
      limit(WALL_CAPACITY)
    )
    const pendingQ = query(collection(db, 'queue_pending'), limit(WALL_CAPACITY))
    const result = await Promise.race([
      Promise.all([getDocs(historyQ), getDocs(pendingQ)]),
      new Promise<typeof TIMEOUT>(resolve => setTimeout(() => resolve(TIMEOUT), 6000))
    ])
    if (result === TIMEOUT) {
      console.debug('[Editor] 讀取已用字逾時，描紅字帖改純隨機')
      return used
    }
    const [historySnap, pendingSnap] = result
    collectFonts(historySnap.docs)
    collectFonts(pendingSnap.docs)
  } catch (e) {
    // 讀不到（權限或網路）就視為無已用字，純隨機挑選
    console.warn('[Editor] 讀取已用字失敗，描紅字帖改純隨機', e)
  }
  return used
}

/** 純隨機挑一張字帖 */
const pickRandomFont = (): string | null => {
  const pool = FONT_LIST as readonly string[]
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}

/**
 * 隨機挑一張字帖，盡量避開螢幕上已有的字。
 * 重點：先立刻挑一張並顯示（描紅底圖一定會出現，不被 Firestore 延遲卡住），
 * 之後再讀取 LED 牆上已用字；只有在「剛好撞到已用字」時才換一張，避免無謂的閃動。
 */
const pickUniqueFont = async () => {
  const initial = pickRandomFont()
  selectedFontId.value = initial

  const used = await getUsedFonts()
  if (initial && used.has(initial)) {
    const available = FONT_LIST.filter(id => !used.has(id))
    if (available.length > 0) {
      selectedFontId.value = available[Math.floor(Math.random() * available.length)] ?? initial
    }
  }
}

// 每個物件（貼紙）各自疊放順序：點選時 bringToFront，完成後該物件維持最頂層
const objectZOrder = ref<Record<string, number>>({})
let zOrderCounter = 0
const getObjectZIndex = (id: string) => objectZOrder.value[id] ?? 1
const bringToFront = (id: string) => {
  zOrderCounter += 1
  objectZOrder.value = { ...objectZOrder.value, [id]: zOrderCounter }
}

const completeStickerEditing = () => {
  selectedStickerId.value = null
  activeTab.value = null
}

const canvasRef = ref<HTMLElement | null>(null)
const drawingLayerRef = ref<HTMLElement | null>(null)
const drawingCanvasRef = ref<HTMLCanvasElement | null>(null)

// IG 風格中心對齊參考線
const showVerticalCenterGuide = ref(false)
const showHorizontalCenterGuide = ref(false)

// Tab: 繪圖 | 貼紙
// 初始為 null；進入流程結束後再以「執行期切換」進入書法，
// 確保與使用者點「書法」分頁完全相同（避免 setup 期 immediate watcher 造成狀態/畫面不一致）
const activeTab = ref<'draw' | 'sticker' | null>(null)

const transformingStickerId = ref<string | null>(null)
const showDraftModal = ref(false)
const showTutorialModal = ref(false)
const showExitModal = ref(false)
const showSubmitModal = ref(false)

const showAlertModal = ref(false)
const alertIcon = ref('⚠️')
const alertTitle = ref('提示')
const alertMessage = ref('')
const alertConfirmText = ref('關閉')
const alertConfirmHandler = ref<(() => void | Promise<void>) | null>(null)

const handleAlertConfirm = async () => {
  const handler = alertConfirmHandler.value
  if (handler) {
    await handler()
    return
  }
  showAlertModal.value = false
}

const showAlert = (
  msg: string,
  title = '提示',
  icon = '⚠️',
  options?: {
    confirmText?: string
    onConfirm?: () => void | Promise<void>
  }
) => {
  alertIcon.value = icon
  alertTitle.value = title
  alertMessage.value = msg
  alertConfirmText.value = options?.confirmText || '關閉'
  alertConfirmHandler.value = options?.onConfirm || null
  showAlertModal.value = true
}

// Token 相關提示：標題、內文與 icon
const TOKEN_ALERT_TITLE = '只差最後一步！'
const TOKEN_ALERT_ICON = '🛍️'
const TOKEN_ALERT_MESSAGE = '目前您還沒有取得大螢幕的上傳權限。<br>請放心，剛剛的作品已經保存在您的手機裡了！<br>只要在店內消費，結帳時掃描店員提供的 QR Code，系統就會自動幫您一鍵發送上牆喔！'
const GPS_DENIED_MESSAGE = '需要開啟定位權限才能上傳大螢幕。<br><br>iPhone（Safari）：到「設定 > Safari > 定位」改為「允許」。<br>Android（Chrome）：到「瀏覽器網址列左側鎖頭/網站設定 > 位置」改為「允許」。<br><br>完成後回到此頁，點擊「重新詢問定位」再試一次。'
const GPS_OUTSIDE_MESSAGE = '您目前不在合法上傳區域內，請移動到店內指定範圍後再試。'
/** 設為 false 時略過上傳前 GPS／地理柵欄驗證 */
const ENABLE_GPS_VALIDATION = false
const TOKEN_DISABLED_SUBMIT_COOLDOWN_MS = 1 * 60 * 1000
const TOKEN_DISABLED_LAST_SUBMIT_AT_KEY = 'willmusic_token_disabled_last_submit_at'
const tokenRequiredForSubmit = ref(false)
let unsubTokenRequirement: (() => void) | null = null

const getTokenDisabledRemainingCooldownMs = (): number => {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(TOKEN_DISABLED_LAST_SUBMIT_AT_KEY)
    const lastSubmitAt = Number(raw)
    if (!Number.isFinite(lastSubmitAt) || lastSubmitAt <= 0) return 0
    const elapsed = Date.now() - lastSubmitAt
    return Math.max(0, TOKEN_DISABLED_SUBMIT_COOLDOWN_MS - elapsed)
  } catch {
    return 0
  }
}

const formatCooldownRemaining = (remainingMs: number): string => {
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds} 秒`
  if (seconds <= 0) return `${minutes} 分鐘`
  return `${minutes} 分 ${seconds} 秒`
}

const saveTokenDisabledSubmitTimestamp = () => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(TOKEN_DISABLED_LAST_SUBMIT_AT_KEY, String(Date.now()))
  } catch {
    // ignore storage write errors
  }
}

const isSharing = ref(false)
const showExportNode = ref(false)  // 控制 1080px export node 的掛載時機
const exportNodeRef = ref<HTMLElement | null>(null)

// 書法筆刷
const drawMode = ref(false)
const drawCanUndo = ref(false)
const drawCanRedo = ref(false)
// 固定墨色：不再提供顏色選擇，只能選筆刷粗細（三種尺寸）
const brushColor = CALLIGRAPHY_BRUSH_COLOR
const brushWidth = ref<number>(DEFAULT_BRUSH_SIZE)
const drawingData = ref<string | null>(null)

// 是否顯示貼紙編輯框：有選取貼紙 且 非繪圖狀態（繪圖 tab 時編輯框消失）
const showStickerEditFrame = computed(() => {
  return !!selectedStickerId.value && activeTab.value !== 'draw'
})

// ── 繪圖存檔防抖
let drawSaveTimer: ReturnType<typeof setTimeout> | null = null

// 僅在有實際筆畫時更新 drawingData；saveImmediately=true 時略過防抖（離開繪圖模式時使用）
const syncDrawingDataFromFabric = (saveImmediately = false) => {
  if (!fabricBrush.canUndo()) {
    return
  }
  const data = fabricBrush.exportToDataURL()
  if (data && data !== drawingData.value) {
    drawingData.value = data
    if (saveImmediately) {
      if (drawSaveTimer) { clearTimeout(drawSaveTimer); drawSaveTimer = null }
      saveDraftData()
    } else {
      if (drawSaveTimer) clearTimeout(drawSaveTimer)
      drawSaveTimer = setTimeout(() => {
        drawSaveTimer = null
        saveDraftData()
      }, 1500)
    }
  }
}

const fabricBrush = useFabricBrush(() => {
  syncDrawingDataFromFabric()
})
// 切換 tab 時同步繪圖模式
watch(activeTab, (tab) => {
  // 繪圖：進入/退出繪圖模式
  if (tab === 'draw') {
    drawMode.value = true
    // 恢復畫布尺寸（從 1×1 最小化還原為 600×600，重新分配 GPU backing store）
    fabricBrush.restoreCanvas()
    fabricBrush.setDrawingMode(true)
    bringToFront('drawing-layer')
  } else {
    if (drawMode.value) {
      // 離開繪圖模式：立即存檔（saveImmediately=true），不用防抖，避免資料遺失
      syncDrawingDataFromFabric(true)
      fabricBrush.setDrawingMode(false)
      // 最小化畫布：釋放 ~1.4MB GPU backing store
      fabricBrush.minimizeCanvas()
      // 使用者剛離開繪圖模式（例如按下完成），清除選取，確保沒有殘留的編輯框
      selectedStickerId.value = null
    }
    drawMode.value = false
  }
}, { immediate: true })

watch(brushWidth, (w) => {
  fabricBrush.setBrushWidth(w)
}, { immediate: false })

watch(drawMode, (v) => {
  if (v) {
    if (fabricBrush.isInitialized()) {
      fabricBrush.setOnUndoRedoChange(() => {
        drawCanUndo.value = fabricBrush.canUndo()
        drawCanRedo.value = fabricBrush.canRedo()
        syncDrawingDataFromFabric()
      })
      drawCanUndo.value = fabricBrush.canUndo()
      drawCanRedo.value = fabricBrush.canRedo()
    }
  }
})

// 畫面是否有內容（貼紙 / 繪圖任一存在）
const hasAnyContent = computed(() =>
  stickers.value.length > 0 ||
  !!drawingData.value
)

const MAX_STICKERS = 10

const addSticker = (stickerType: string) => {
  if (stickers.value.length >= MAX_STICKERS) {
    showAlert(
      `每張便利貼最多只能貼 ${MAX_STICKERS} 個貼紙喔！如果需要更多空間，可以先刪除一些。`,
      '貼紙數量達上限',
      '⚠️'
    )
    return
  }

  const newSticker: StickerInstance = {
    id: `sticker-${Date.now()}`,
    type: stickerType,
    x: 50 + (Math.random() - 0.5) * 20,
    y: 50 + (Math.random() - 0.5) * 20,
    scale: 3,
    rotation: (Math.random() - 0.5) * 30
  }
  stickers.value.push(newSticker)
  saveDraftData()
  // 選取新貼紙並切到貼紙 tab，讓編輯框出現
  selectedStickerId.value = newSticker.id
  bringToFront(newSticker.id)
  activeTab.value = 'sticker'
}

const selectSticker = (id: string) => {
  selectedStickerId.value = id
  bringToFront(id)
}

// Tab 點擊處理
const handleTabClick = (tabId: string) => {
  activeTab.value = tabId as any
}

const deselectAll = () => {
  if (lastCanvasDragEndAt.value && Date.now() - lastCanvasDragEndAt.value < 400) return
  selectedStickerId.value = null
}

// saveDraftData 需在 composable 之前定義（作為 callback）
const saveDraftData = () => {
  // 如果沒有任何有效內容（貼紙、繪圖皆為空），不存草稿
  const hasContent =
    stickers.value.length > 0 ||
    !!drawingData.value
  if (!hasContent) return

  const draft: DraftData = {
    stickers: stickers.value,
    drawing: drawingData.value ?? undefined,
    objectLayerOrder: { ...objectZOrder.value },
    font: selectedFontId.value ?? undefined,
    timestamp: Date.now()
  }
  saveDraft(draft)
}

const {
  onCanvasTouchStart,
  onCanvasTouchMove,
  onCanvasTouchEnd,
  onCanvasMouseDown,
  lastCanvasDragEndAt,
  isTwoFingerGesture
} = useCanvasPinch({
  canvasRef,
  drawMode,
  selectedStickerId,
  stickers,
  draggingStickerId,
  transformingStickerId,
  onStickerTransformEnd: saveDraftData,
  onStickerDragEnd: saveDraftData,
  showVerticalCenterGuide,
  showHorizontalCenterGuide
})

const {
  onStickerMouseDown,
  onStickerTouchStart,
  onStickerClick
} = useStickerInteraction({
  canvasRef,
  stickers,
  selectedStickerId,
  draggingStickerId,
  transformingStickerId,
  selectSticker,
  onDragEnd: saveDraftData,
  onTransformEnd: saveDraftData,
  isTwoFingerGesture
})

const removeSticker = (id: string) => {
  stickers.value = stickers.value.filter(s => s.id !== id)
  selectedStickerId.value = null
  saveDraftData()
}

// touchstart 上刪除貼紙：捲動中 touchstart 可能 cancelable=false，需先判斷再 preventDefault，
// 避免瀏覽器跳出 [Intervention] Ignored attempt to cancel a touchstart event 警告
const onDeleteStickerTouch = (e: TouchEvent, id: string) => {
  if (e.cancelable) e.preventDefault()
  removeSticker(id)
}

const loadDraftData = async (draft: DraftData) => {
  stickers.value = draft.stickers
  drawingData.value = draft.drawing ?? null
  // 續編草稿：沿用草稿當時的描紅字帖，維持同一個字
  if (draft.font) selectedFontId.value = draft.font

  await nextTick()
  if (draft.drawing) {
    await nextTick()
    fabricBrush.loadFromDataURL(draft.drawing)
  }

  // 還原物件前後順序
  const stickerIds = stickers.value.map(s => s.id)
  const orderFromDraft = draft.objectLayerOrder && Object.keys(draft.objectLayerOrder).length > 0
    ? { ...draft.objectLayerOrder }
    : null

  if (orderFromDraft) {
    const restored: Record<string, number> = {}
    for (const id of [...stickerIds, 'drawing-layer']) {
      const v = orderFromDraft[id]
      const n = typeof v === 'number' && !Number.isNaN(v) ? v : Number(v)
      if (!Number.isNaN(n)) restored[id] = n
    }
    if (Object.keys(restored).length > 0) {
      for (const id of stickerIds) {
        if (restored[id] == null) {
          const maxVal = Math.max(0, ...Object.values(restored))
          restored[id] = maxVal + 1
        }
      }
      objectZOrder.value = { ...restored }
      zOrderCounter = Math.max(0, ...Object.values(restored))
      await nextTick()
    } else {
      applyDefaultLayerOrder(stickerIds)
    }
  } else {
    applyDefaultLayerOrder(stickerIds)
  }
}

function applyDefaultLayerOrder(stickerIds: string[]) {
  const next: Record<string, number> = {}
  stickerIds.forEach((id, i) => { next[id] = i + 1 })
  objectZOrder.value = next
  zOrderCounter = stickerIds.length
}

const resetEditorToInitial = () => {
  stickers.value = []
  selectedStickerId.value = null
  activeTab.value = null
  drawingData.value = null
  objectZOrder.value = {}
  zOrderCounter = 0
  fabricBrush.clear()
}

const showClearAllModal = ref(false)

const handleClearAll = () => {
  if (!hasAnyContent.value) return
  showClearAllModal.value = true
}

const confirmClearAll = () => {
  resetEditorToInitial()
  clearDraft()
  showClearAllModal.value = false
  // 清空只清內容，保留目前的描紅字帖（不換字）
}

const handleDraftDecision = async (useDraft: boolean) => {
  if (useDraft) {
    showDraftModal.value = false
    const draft = loadDraft()
    if (draft) {
      await nextTick()
      await new Promise<void>(r => requestAnimationFrame(() => r()))
      await loadDraftData(draft)
    }
    // 草稿沒有記錄字帖（舊草稿）時，補挑一張
    if (!selectedFontId.value) pickUniqueFont()
    // 續編草稿也直接停在「書法」
    activeTab.value = 'draw'
  } else {
    resetEditorToInitial()
    clearDraft()
    showDraftModal.value = false
    // 重新開始：換一張新的描紅字帖，並停在「書法」
    pickUniqueFont()
    activeTab.value = 'draw'
  }
}

const isSubmitting = ref(false)

const openSubmitModal = () => {
  if (!hasAnyContent.value) {
    showAlert('請至少加入一個貼紙或繪圖')
    return
  }

  if (!tokenRequiredForSubmit.value) {
    const remainingCooldownMs = getTokenDisabledRemainingCooldownMs()
    if (remainingCooldownMs > 0) {
      showAlert(
        `每次上傳後需等待 1 分鐘。請於 ${formatCooldownRemaining(remainingCooldownMs)} 後再試。`,
        '上傳冷卻中',
        '⏱️'
      )
      return
    }
  }

  const token = loadToken()
  if (tokenRequiredForSubmit.value && !token) {
    showAlert(TOKEN_ALERT_MESSAGE, TOKEN_ALERT_TITLE, TOKEN_ALERT_ICON)
    return
  }

  showSubmitModal.value = true
}

const previewNoteData = computed(() => {
  const style: StickyNoteStyle = {
    stickers: stickers.value,
    objectLayerOrder: { ...objectZOrder.value }
  }
  if (drawingData.value) style.drawing = drawingData.value
  // 記錄本次描紅字帖（不渲染於便利貼，僅供 LED 牆避免同字重複）
  if (selectedFontId.value) style.font = selectedFontId.value

  return {
    id: 'preview',
    content: '',
    style: style,
    timestamp: Date.now(),
    status: 'waiting'
  } as any
})

const toRadians = (deg: number) => deg * (Math.PI / 180)

const calculateDistanceMeters = (
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
) => {
  const earthRadiusMeters = 6371000
  const dLat = toRadians(toLat - fromLat)
  const dLng = toRadians(toLng - fromLng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusMeters * c
}

type GeoErrorKind =
  | 'permission-denied'
  | 'position-unavailable'
  | 'timeout'
  | 'geolocation-unavailable'
  | 'geo-fence-fetch-failed'
  | 'geo-fence-config-invalid'
  | 'unknown'

type GeoError = Error & { kind?: GeoErrorKind; code?: number; cause?: unknown }

const createGeoError = (kind: GeoErrorKind, message: string, cause?: unknown): GeoError => {
  const error = new Error(message) as GeoError
  error.kind = kind
  error.cause = cause
  return error
}

const mapGeoErrorFromAny = (error: any): GeoError => {
  if (!error) return createGeoError('unknown', 'Unknown geolocation error')
  if (error.kind) return error as GeoError

  const code = Number(error?.code)
  if (code === 1) return createGeoError('permission-denied', 'Geolocation permission denied', error)
  if (code === 2) return createGeoError('position-unavailable', 'Geolocation position unavailable', error)
  if (code === 3) return createGeoError('timeout', 'Geolocation timeout', error)
  return createGeoError('unknown', error?.message || 'Unknown geolocation error', error)
}

const getCurrentPositionWithOptions = (options: PositionOptions): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      reject(createGeoError('geolocation-unavailable', 'Geolocation API not available'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      position => resolve(position),
      error => reject(mapGeoErrorFromAny(error)),
      options
    )
  })

const getCurrentPosition = (): Promise<GeolocationPosition> =>
  getCurrentPositionWithOptions({
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 0
  }).catch(async (error: any) => {
    const normalized = mapGeoErrorFromAny(error)
    // 手機在室內或節電模式下容易 high accuracy timeout；改用低精度 + 允許快取位置再嘗試一次。
    if (normalized.kind === 'position-unavailable' || normalized.kind === 'timeout') {
      return await getCurrentPositionWithOptions({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 120000
      })
    }
    throw normalized
  })

const requestGpsPermissionAgain = async () => {
  try {
    await getCurrentPosition()
    showAlertModal.value = false
    openSubmitModal()
  } catch (error: any) {
    const geoError = mapGeoErrorFromAny(error)
    if (geoError.kind === 'permission-denied') {
      showAlert(
        GPS_DENIED_MESSAGE,
        '需要定位權限',
        '📍',
        {
          confirmText: '重新詢問定位',
          onConfirm: requestGpsPermissionAgain
        }
      )
      return
    }
    if (
      geoError.kind === 'position-unavailable' ||
      geoError.kind === 'timeout' ||
      geoError.kind === 'geolocation-unavailable'
    ) {
      showAlert('無法取得目前位置，請確認定位服務已開啟並稍後再試。', '定位失敗', '📍')
      return
    }
    showAlert('定位驗證失敗，請稍後再試。', '定位失敗', '📍')
  }
}

const validateGeoFenceBeforeSubmit = async (): Promise<boolean> => {
  if (!ENABLE_GPS_VALIDATION) return true

  let geoFenceSnap
  try {
    geoFenceSnap = await getDoc(doc(db, 'system', 'editor_geo_fence'))
  } catch (error: any) {
    throw createGeoError('geo-fence-fetch-failed', error?.message || 'Failed to load geo fence config', error)
  }
  if (!geoFenceSnap.exists()) return true

  const data = geoFenceSnap.data() as {
    enabled?: boolean
    latitude?: number
    longitude?: number
    radiusMeters?: number
  }

  if (!data.enabled) return true

  const centerLat = Number(data.latitude)
  const centerLng = Number(data.longitude)
  const radiusMeters = Number(data.radiusMeters)
  const configValid =
    Number.isFinite(centerLat) &&
    Number.isFinite(centerLng) &&
    Number.isFinite(radiusMeters) &&
    radiusMeters > 0

  // 後台配置不完整時不擋使用者，避免手機端誤判為「定位驗證失敗」。
  if (!configValid) return true

  const position = await getCurrentPosition()
  const userLat = position.coords.latitude
  const userLng = position.coords.longitude
  const distance = calculateDistanceMeters(userLat, userLng, centerLat, centerLng)

  return distance <= radiusMeters
}

const confirmSubmit = async () => {
  if (isSubmitting.value) return

  if (!tokenRequiredForSubmit.value) {
    const remainingCooldownMs = getTokenDisabledRemainingCooldownMs()
    if (remainingCooldownMs > 0) {
      showSubmitModal.value = false
      showAlert(
        `每次上傳後需等待 1 分鐘。請於 ${formatCooldownRemaining(remainingCooldownMs)} 後再試。`,
        '上傳冷卻中',
        '⏱️'
      )
      return
    }
  }

  const tokenForSubmit = tokenRequiredForSubmit.value ? (loadToken() || undefined) : undefined
  if (tokenRequiredForSubmit.value && !tokenForSubmit) {
    showAlert(TOKEN_ALERT_MESSAGE, TOKEN_ALERT_TITLE, TOKEN_ALERT_ICON)
    return
  }

  isSubmitting.value = true

  try {
    const { createNote, checkTokenStatus } = useFirestore()

    // GPS 合法區域檢查：若後台開啟限制，必須位於指定半徑內才能送出
    let isWithinAllowedArea = false
    try {
      isWithinAllowedArea = await validateGeoFenceBeforeSubmit()
    } catch (geoError: any) {
      const normalizedGeoError = mapGeoErrorFromAny(geoError)
      showSubmitModal.value = false
      if (normalizedGeoError.kind === 'permission-denied') {
        showAlert(
          GPS_DENIED_MESSAGE,
          '需要定位權限',
          '📍',
          {
            confirmText: '重新詢問定位',
            onConfirm: requestGpsPermissionAgain
          }
        )
      } else if (
        normalizedGeoError.kind === 'position-unavailable' ||
        normalizedGeoError.kind === 'timeout' ||
        normalizedGeoError.kind === 'geolocation-unavailable'
      ) {
        showAlert('無法取得目前位置，請確認定位服務已開啟並稍後再試。', '定位失敗', '📍')
      } else if (normalizedGeoError.kind === 'geo-fence-fetch-failed') {
        showAlert('目前無法驗證定位（網路或服務暫時異常），請稍後再試。', '定位失敗', '📍')
      } else {
        showAlert('定位驗證失敗，請稍後再試。', '定位失敗', '📍')
      }
      isSubmitting.value = false
      return
    }

    if (!isWithinAllowedArea) {
      showSubmitModal.value = false
      showAlert(GPS_OUTSIDE_MESSAGE, '不在合法區域', '📍')
      isSubmitting.value = false
      return
    }

    // 1. 若啟用 token 驗證，先透過 checkTokenStatus 取得詳細錯誤原因
    const status = tokenRequiredForSubmit.value
      ? await checkTokenStatus(tokenForSubmit as string).catch(() => 'unknown')
      : 'valid'

    if (status === 'expired') {
      showSubmitModal.value = false
      showAlert(
        '這個 QR Code 已經超過 30 分鐘的有效期限囉！請向店員重新索取新的 QR Code。',
        '時間到了！',
        '⏳'
      )
      isSubmitting.value = false
      return
    }

    if (status === 'used') {
      showSubmitModal.value = false
      showAlert(
        '這個 QR Code 已經被使用過囉！如果還想再傳一張，請向店員重新索取新的 QR Code。',
        '已經用過囉！',
        '❌'
      )
      isSubmitting.value = false
      return
    }

    if (status === 'invalid') {
      showSubmitModal.value = false
      showAlert(
        '這個 QR Code 無效或不存在，請確認您掃描的是由店員提供的正確條碼。',
        '無效代碼',
        '❓'
      )
      isSubmitting.value = false
      return
    }

    // 2. 狀態正確(valid)或無法判別時，嘗試正式送出
    await createNote(
      { content: previewNoteData.value.content, style: previewNoteData.value.style },
      tokenForSubmit
    )

    // 上傳成功：清除草稿與快取的 Token
    clearDraft()
    if (!tokenRequiredForSubmit.value) {
      saveTokenDisabledSubmitTimestamp()
    }
    if (tokenRequiredForSubmit.value && tokenForSubmit) {
      clearToken() // 將 SessionStorage 中的 Token 刪除
    }

    // 如果網址上有 Token，把網址也清乾淨，避免重新整理再次讀取
    const query = { ...route.query }
    if (tokenRequiredForSubmit.value && query.token) {
      delete query.token
      // 使用 replace 避免在歷史紀錄中留存帶有 token 的網址
      await router.replace({ query })
    }

    showSubmitModal.value = false
    router.push('/queue-status')
  } catch (e: any) {
    showSubmitModal.value = false // 關閉「確認上傳」的 Modal，讓錯誤提示能正常顯示在最上層
    console.error('提交失敗:', e)

    // 如果因為 Firebase Rules 阻擋讀取 token 而拋錯，退回到這裡用泛用的錯誤提示
    if (
      tokenRequiredForSubmit.value &&
      (e?.code === 'permission-denied' || e?.message?.includes('Missing or insufficient permissions'))
    ) {
      showAlert(
        '您的專屬 QR Code 可能已失效 (超過限時 30 分鐘) 或已經被使用過。請向店員重新索取新的 QR Code！',
        '上傳授權失效',
        '⏳'
      )
    } else {
      showAlert(`提交失敗：${e?.message || '請稍後再試'}`)
    }
  } finally {
    isSubmitting.value = false
  }
}

import { toPng } from 'html-to-image'

const handleShare = async () => {
  if (isSharing.value) return
  isSharing.value = true

  try {
    // 1. 掛載 export node（只在此時才建立，避免長期佔用 GPU 記憶體）
    showExportNode.value = true
    await nextTick()
    // 讓瀏覽器完成 layout 與 paint（雙 RAF 確保背景圖都已渲染）
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

    if (!exportNodeRef.value) throw new Error('Export node not ready')

    // 2. 強制載入 export node 內所有圖片
    const exportImgs = Array.from(exportNodeRef.value.querySelectorAll('img'))
    for (const img of exportImgs) {
      img.loading = 'eager'
      img.decoding = 'sync'
      // 若圖片尚未開始載入（src 存在但 naturalWidth=0），重設 src 觸發載入
      if (!img.complete || img.naturalWidth === 0) {
        const src = img.src
        img.src = ''
        img.src = src
      }
    }
    // 等待所有圖片完成載入（含 base64 drawing 與 SVG 貼紙）
    await Promise.all(
      exportImgs.map(img => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve()
        return new Promise<void>(resolve => {
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
        })
      })
    )

    // 3. 針對 iOS 的預熱 Hack (Warm-up)
    await toPng(exportNodeRef.value, { cacheBust: true, pixelRatio: 0.5 }).catch(() => {})

    // 給予渲染緩衝時間
    await new Promise(resolve => setTimeout(resolve, 300))

    // 4. 正式輸出（pixelRatio 1.5：相較 2x 節省約 44% 記憶體，畫質在手機上仍充足）
    const dataUrl = await toPng(exportNodeRef.value, {
      pixelRatio: 1.5,
      cacheBust: true
    })

    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], 'npm-note.png', { type: 'image/png' })

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: '故宮南院 便利貼',
        text: '這是我剛畫好的便利貼！',
        files: [file]
      })
    } else {
      const link = document.createElement('a')
      link.download = 'npm-note.png'
      link.href = dataUrl
      link.click()
    }
  } catch (error: any) {
    // 使用者在系統分享面板按「取消」時，navigator.share 會丟 AbortError，不需要跳錯誤提示
    const name = error?.name || ''
    const message = error?.message || ''
    const isAbort =
      name === 'AbortError' ||
      message.includes('AbortError') ||
      message.includes('The user aborted') ||
      message.includes('canceled') ||
      message.includes('cancelled')

    if (isAbort) {
      console.warn('使用者取消分享/下載動作:', error)
    } else {
      console.error('分享失敗:', error)
      showAlert('圖片生成失敗，請稍後再試')
    }
  } finally {
    isSharing.value = false
    // 分享完成後立即卸載 export node，釋放 GPU 記憶體
    showExportNode.value = false
  }
}

const goBack = () => {
  if (hasAnyContent.value) {
    showExitModal.value = true
  } else {
    router.push('/')
  }
}

const handleExitConfirm = () => {
  saveDraftData()
  showExitModal.value = false
  router.push('/')
}

// Lifecycle
// initFabricBrush 改為 async：Fabric.js 動態載入，await init 後再設定筆刷參數
const initFabricBrush = async () => {
  if (typeof window === 'undefined' || !canvasRef.value || !drawingCanvasRef.value || !drawingLayerRef.value) return
  await fabricBrush.init(drawingCanvasRef.value, 600, 600)
  fabricBrush.setOnUndoRedoChange(() => {
    drawCanUndo.value = fabricBrush.canUndo()
    drawCanRedo.value = fabricBrush.canRedo()
    syncDrawingDataFromFabric()
  })
  fabricBrush.setBrushColor(brushColor)
  fabricBrush.setBrushWidth(brushWidth.value)
  fabricBrush.setDrawingMode(drawMode.value)
  if (drawingData.value) {
    await fabricBrush.loadFromDataURL(drawingData.value)
  }
  drawCanUndo.value = fabricBrush.canUndo()
  drawCanRedo.value = fabricBrush.canRedo()
}

const scalerStyle = ref({ transform: 'scale(1)' })
const VIRTUAL_SIZE = 600
let resizeObserver: ResizeObserver | null = null

// 編輯器一定會用到的關鍵圖片：全部載入完成後才允許按「開始」。
// 包含 CSS 背景（paper.webp）與尚未掛載到 DOM 的貼紙 SVG，這些都不會被 document.images 捕捉到。
const EDITOR_ASSETS: string[] = [
  '/paper.webp',
  '/resetBtn.png',
  ...EDITOR_TABS.map(t => t.bg),
  ...STICKER_LIBRARY.map(s => s.svgFile)
]

// 預載單一圖片；無論成功或失敗都 resolve（失敗不擋使用者），已快取者立即完成。
const preloadImage = (src: string) =>
  new Promise<void>(resolve => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = src
    if (img.complete) resolve()
  })

const preloadEditorAssets = () => Promise.all(EDITOR_ASSETS.map(preloadImage))

const checkInitialModals = async () => {
  await nextTick()
  // 檢查草稿（僅顯示 modal，不預先載入內容；等使用者選擇「使用草稿」才載入）
  const existingDraft = loadDraft()
  if (existingDraft) {
    showDraftModal.value = true
    // 字帖等使用者選擇「使用草稿/重新開始」後再決定（handleDraftDecision）
  } else {
    // 沒有草稿時，檢查是否看過教學
    const hasSeen = localStorage.getItem('hasSeenWillMusicTutorial')
    if (!hasSeen) {
      showTutorialModal.value = true
    }
    // 全新開始：隨機挑一張描紅字帖（避開 LED 牆上已有的字）
    pickUniqueFont()
  }

  // 初始化 Fabric 手繪
  initFabricBrush()

  // 一開始就進入「書法」：用執行期切換（等同點分頁），確保介面/按鈕與一般進入書法一致
  if (!existingDraft) activeTab.value = 'draw'
}

onMounted(async () => {
  // 在背景預載 Fabric.js（不 await，讓它在使用者閱讀規範的期間下載完畢）
  if (import.meta.client) {
    import('fabric').catch(() => {})
  }

  // waitForImages：加入 3 秒超時保護，防止 iOS 上部分圖片永遠不觸發 load/error 導致卡死
  const waitForImages = async () => {
    await nextTick()
    const images = Array.from(document.images)
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 3000))
    const allLoaded = Promise.all(
      images.map(img => {
        if (img.complete) return Promise.resolve()
        return new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
        })
      })
    )
    await Promise.race([allLoaded, timeout])
  }

  const windowLoaded = new Promise<void>(resolve => {
    if (document.readyState === 'complete') {
      resolve()
    } else {
      window.addEventListener('load', () => resolve(), { once: true })
    }
  })

  // 等待字體載入與最小延遲（加入 5 秒整體超時，防止字體 API 掛住）
  try {
    const fontsReady = Promise.race([
      document.fonts.ready,
      new Promise<void>(resolve => setTimeout(resolve, 5000))
    ])
    // 編輯器關鍵圖片（背景、貼紙、tab、按鈕）全部載入才開放「開始」；
    // 加 8 秒安全超時，避免單一資產載入失敗或弱網時永遠卡在載入中。
    const assetsReady = Promise.race([
      Promise.all([preloadEditorAssets(), waitForImages()]),
      new Promise<void>(resolve => setTimeout(resolve, 8000))
    ])
    await Promise.all([
      fontsReady,
      windowLoaded,
      assetsReady,
      new Promise(resolve => setTimeout(resolve, 800))
    ])
  } catch (e) {
    console.warn('Font loading error', e)
  }
  loading.value = false

  await nextTick()

  // 處理 Token
  const tokenFromQuery = route.query.token as string
  if (tokenFromQuery) {
    saveToken(tokenFromQuery)
  }

  // Token 驗證預設關閉；若後台有設定，則即時跟隨後台開關。
  unsubTokenRequirement = onSnapshot(doc(db, 'system', 'editor_token_requirement'), (snap) => {
    if (!snap.exists()) {
      tokenRequiredForSubmit.value = false
      return
    }
    const data = snap.data() as { enabled?: boolean }
    tokenRequiredForSubmit.value = data.enabled === true
  })

  // Scale observer（加防抖）
  if (canvasRef.value) {
    let resizeRafId: number | null = null
    resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry || entry.contentRect.width <= 0) return
      const newWidth = entry.contentRect.width
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId)
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null
        const scale = newWidth / VIRTUAL_SIZE
        if (scalerStyle.value.transform !== `scale(${scale})`) {
          scalerStyle.value = { transform: `scale(${scale})` }
        }
      })
    })
    resizeObserver.observe(canvasRef.value)
  }
})

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
  if (drawSaveTimer) { clearTimeout(drawSaveTimer); drawSaveTimer = null; saveDraftData() }
  unsubTokenRequirement?.()
  unsubTokenRequirement = null
  fabricBrush.dispose()
})
</script>
