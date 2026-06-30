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
              <p style="text-align: center">歡迎來到 故宮南院 藝字遊戲！<br>您將隨機抽到一個書法字帖，動動手指寫字後，再幫它加上趣味造型，創作出專屬字怪上傳大螢幕，快來跟大家一起共創千字文吧！</p>
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

      <!-- 字帖選擇 overlay：按「開始」後先選一個沒在牆上的字，已在牆上的字 disabled -->
      <Transition name="intro-fade">
        <div v-if="showFontPicker" class="p-editor__font-picker">
          <div class="p-editor__font-picker-card">
            <h2 class="p-editor__font-picker-title">選擇你要書寫的字</h2>
            <p class="p-editor__font-picker-hint">已出現在大螢幕上的字無法選擇，請挑一個還沒人寫過的字。</p>

            <div v-if="fontPickerLoading" class="p-editor__font-picker-loading">
              <span class="p-index__intro-spinner" aria-hidden="true" />
              <span>載入中...</span>
            </div>

            <p v-else-if="noFontAvailable" class="p-editor__font-picker-empty">
              目前所有的字都已經出現在大螢幕上了，請稍後再試或洽現場人員。
            </p>

            <div v-else class="p-editor__font-picker-grid">
              <button
                v-for="font in ACTIVE_FONT_LIST"
                :key="font"
                type="button"
                class="p-editor__font-picker-item"
                :class="{ 'is-selected': pickerSelectedFont === font }"
                :disabled="disabledFonts.has(font)"
                :aria-pressed="pickerSelectedFont === font"
                @click="pickerSelectedFont = font"
              >
                <img :src="getFontUrl(font)" :alt="font" loading="lazy" />
              </button>
            </div>

            <button
              type="button"
              class="p-index__intro-btn c-btn c-btn--primary p-editor__font-picker-confirm"
              :disabled="!pickerSelectedFont || fontPickerLoading || confirmingFont"
              @click="confirmFontSelection"
            >
              <span v-if="confirmingFont" class="p-index__intro-btn-inner">
                <span class="p-index__intro-spinner" aria-hidden="true" />
                確認中...
              </span>
              <span v-else>確認</span>
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
      confirm-button-class="c-button--danger"
      @confirm="showTermsModal = false"
    />

    <!-- Exit Confirmation Modal -->
    <AppModal
      v-model="showExitModal"
      title="確定離開？"
      message="離開後目前的內容將不會保留，確定要離開編輯器嗎？"
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
      confirm-button-class="c-button--danger"
      @confirm="handleAlertConfirm"
    />

    <!-- Submit Confirmation Modal -->
    <AppModal
      v-model="showSubmitModal"
      title="確認上傳"
      message="請確認您的字怪樣貌，上傳後將無法修改。"
      :loading="isSubmitting"
      @confirm="confirmSubmit"
      @cancel="showSubmitModal = false"
    >
      <template #preview>
        <div class="p-editor__submit-preview">
          <StickyNote v-if="previewNoteData" :note="previewNoteData" />
        </div>
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
              zIndex: 0
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

    <!-- 控制面板區：清除鈕以絕對定位浮在面板正上方，不佔版面、不影響畫布(九宮格底圖)大小 -->
    <div class="p-editor__panel-wrap">
    <!-- 一鍵清除：控制面板正上方靠右，書法與貼紙皆顯示；v-if + transition 才有漸變 -->
    <transition name="p-editor-top-actions">
      <div
        v-if="activeTab === 'draw' || activeTab === 'sticker'"
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
          class="p-editor__action-btn p-editor__action-btn--secondary p-editor__action-btn--complete"
          @click="goToStickerStep"
        >
          下一步
        </button>
        <button
          type="button"
          class="p-editor__draw-btn p-editor__draw-btn--redo"
          :disabled="!drawCanRedo"
          @click="fabricBrush.redo()"
        >
          <img src="/resetBtn.png" alt="重做" class="p-editor__draw-btn-icon p-editor__draw-btn-icon--redo" />
        </button>
      </template>

      <!-- 貼紙模式：左「繼續書寫」(藍) 回到書法，右「上傳大螢幕」(紅) 送出 -->
      <template v-else-if="activeTab === 'sticker'">
        <button
          type="button"
          class="p-editor__action-btn p-editor__action-btn--primary p-editor__action-btn--half"
          @click="backToDrawing"
        >
          繼續書寫
        </button>
        <button
          type="button"
          class="p-editor__action-btn p-editor__action-btn--secondary p-editor__action-btn--half"
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
import type { StickerInstance, StickyNoteStyle } from '~/types'
import { getStickerById, STICKER_LIBRARY } from '~/data/stickers'
import { EDITOR_TABS, CALLIGRAPHY_BRUSH_COLOR, BRUSH_SIZES, DEFAULT_BRUSH_SIZE } from '~/data/editor-config'
import { ACTIVE_FONT_LIST, getFontUrl, TEST_MODE } from '~/data/fonts'
import { getStickerStyle } from '~/utils/sticky-note-style'
import { useStickerInteraction } from '~/composables/useStickerInteraction'
import { useCanvasPinch } from '~/composables/useCanvasPinch'
import { useStorage } from '~/composables/useStorage'
import { useFirestore } from '~/composables/useFirestore'
import { useFontReservation } from '~/composables/useFontReservation'
import { useFabricBrush } from '~/composables/useFabricBrush'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '#imports'
import { doc, getDoc, getDocs, onSnapshot, collection, query, orderBy, limit } from 'firebase/firestore'
import StickyNote from '~/components/StickyNote.vue'
import AppModal from '~/components/AppModal.vue'
import EditorTutorialModal from '~/components/EditorTutorialModal.vue'

// alias /editor-test：同一份 component，useDbEnv 偵測到 `-test` 路徑後讀寫 test_* 資料
definePageMeta({ ssr: false, alias: ['/editor-test'] })

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
const { cn } = useDbEnv()
// 字帖預約：選好字就佔用，讓其他編輯器選不到；離開未送出即釋放，已送出則交給 TTL 回收
const fontReservation = useFontReservation()
/**
 * 是否已成功送出、把字交棒給牆面。
 * 送出後 note 會經 queue_pending →（canvas moveToHistory 刪除 pending、寫入 history）→ 聚光 → 落格，
 * 這段過渡期有個空窗：note 已從 queue_pending 刪掉、但牆面 live_grid 廣播尚未含它。
 * 此時若釋放預約，別的編輯器會兩邊都讀不到此字而重複發出。故送出後「不主動釋放」預約，
 * 改由 TTL 自動回收（約 1 分鐘，遠長於落格所需），確保整段過渡期此字仍被佔住、不被重複選到。
 */
let reservationHandedToWall = false
const { saveToken, loadToken, clearToken } = useStorage()

// Loading state
const loading = ref(true)
const showIntroOverlay = ref(true)
const termsAccepted = ref(false)
const showTermsModal = ref(false)

const onStartClick = async () => {
  if (loading.value) return
  if (!termsAccepted.value) {
    showTermsModal.value = true
    return
  }

  // 暫時隱藏手動選字 UI：按「開始」後直接從「還沒上牆的可選字」自動挑一個並佔用，
  // 成功才進入編輯器。（保留 openFontPicker / 字帖選擇 overlay 程式碼，方便日後再開啟手動選字）
  loading.value = true
  let claimed: string | null = null
  try {
    claimed = await autoSelectFont()
  } catch (e) {
    // 自動選字若意外拋錯（網路/Firestore 例外），務必解除 loading，避免按鈕永久卡在載入中
    console.error('[editor] 自動選字失敗', e)
  } finally {
    loading.value = false
  }
  if (!claimed) {
    // 牆面當下全滿：失效已用字快取，讓使用者稍後（牆清空後）在同一頁再按開始時重讀最新牆況，
    // 否則會一直沿用這次讀到的「全滿」結果而永遠跳出此提醒。
    invalidateUsedFontsCache()
    showAlert(
      '藝字遊戲正在準備新稿紙，請稍候…',
      '暫無可用的字帖',
    )
    return
  }
  selectedFontId.value = claimed
  fontReservation.startHeartbeat()
  showIntroOverlay.value = false
  enterEditor()
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
 *
 * 效能關鍵：`queue_history` 的 note 內含手繪 base64（單筆可數十 KB、最新 144 筆整包可達數 MB），
 * 但我們只需要每筆的 `style.font` 字串。Firestore Web SDK 無法只取單一欄位，整包讀下來會讓
 * 進編輯器/送出前卡好幾秒。所幸 `system/current_state.live_grid` 已由大螢幕端「精簡廣播」，
 * 每格只含 `{ id, token, status, style:{ font } }`（見 canvas.vue broadcastState），沒有手繪，
 * 且是「此刻牆上實際顯示」的權威來源。
 *
 * 因此分兩段：
 *   1. 先讀「輕量來源」：current_state.live_grid（牆上）＋ queue_pending（待播、平時量很小）。
 *   2. 只有當 live_grid 不可用（牆從未廣播／讀取失敗）時，才退回讀「重量級」queue_history。
 * 正常營運（大螢幕有在跑）時完全不會去讀 queue_history，省下數 MB 下載。
 * 過時只會多排除、不會造成撞字，安全。
 */
/**
 * wall_resetting 旗標的最大信任時效（毫秒）。
 * 健康的 reset 全程約十幾秒、且每階段都會重新廣播刷新 updated_at，故遠在此值內；
 * 超過代表大螢幕多半已在 reset 途中關閉而旗標卡住，改為忽略以免編輯器被永久鎖死。
 */
const RESET_FLAG_MAX_AGE_MS = 60_000

/**
 * live_grid 的最大信任時效（毫秒）。
 * 大螢幕在「正常模式」會持續心跳廣播刷新 updated_at（見 canvas.vue 的 broadcast 心跳），
 * 故健康運行時 live_grid 一定很新。但 ?intro 開場序列在「按第二次空白鍵揭幕前」整段都不廣播，
 * 此時 current_state.live_grid 是上一輪 session 的舊快照——若仍盲目信任，會把「實際在牆上的字」
 * 當成可選（改字時挑到已上牆的字而覆蓋他人）、或把使用者手上的空字當成已用（誤跳改字）。
 * 因此只有 updated_at 夠新時才信任 live_grid；過舊就退回讀權威來源 queue_history。
 * 此值需明顯大於大螢幕心跳間隔，容許數次漏拍而不誤判。
 */
const LIVE_GRID_MAX_AGE_MS = 40_000

/**
 * 上一次 getUsedFonts 是否「可信」：是否成功取得任一權威牆況
 *（reset 旗標／新鮮 live_grid／queue_history 後備）。三者都拿不到（弱網、高負載、大螢幕沒在廣播、
 * 持久化快取因磁碟等問題失效）時，used 只會剩 pending 甚至空集合 —— autoSelectFont 不可拿它當
 *「牆上沒這些字」的依據去選字，否則會選到牆上其實已經有的字（含較早寫、預約早已過期的字）。
 */
let lastWallReadAuthoritative = false
/**
 * 上一次 getUsedFonts 的資料來源。送出端據此判斷能否精準地「因撞牆而換字」：
 * 只有 'live_grid'（大螢幕即時廣播）最準；'history-fallback' 看不到大螢幕本機的 clearedTokens，易誤判。
 */
let lastWallReadSource: 'reset-all' | 'live_grid' | 'history-fallback' | 'none' = 'none'
const getUsedFonts = async (): Promise<Set<string>> => {
  // 本次是否取得到權威牆況（讀到任一權威來源才設 true，最後寫回 lastWallReadAuthoritative）
  let authoritative = false
  const used = new Set<string>()
  // [diag] 一次性診斷：記錄 used 的來源與 live_grid 新鮮度，用來釐清「選到牆上字」的真因。確認後可移除。
  let diagSource: 'reset-all' | 'live_grid' | 'history-fallback' | 'none' = 'none'
  let diagLiveGridAgeMs: number | null = null
  const collectFonts = (docs: { data: () => any }[], skipCleared = false) => {
    for (const d of docs) {
      const data = d.data()
      // 後備讀 queue_history 時略過 reset 標記為 cleared 的字：畫面已清掉、字帖已釋放，
      // 只是 DB 沒刪。不略過就會把這些舊字當成 used 而誤判無字可選。
      if (skipCleared && data?.cleared === true) continue
      const f = data?.style?.font
      if (typeof f === 'string' && f) used.add(f)
    }
  }
  const addFont = (f: unknown) => { if (typeof f === 'string' && f) used.add(f) }

  // 每個來源各自加上 timeout，避免離線/弱網/冷啟動卡住描紅底圖的顯示
  const withTimeout = <T,>(p: Promise<T>, ms = 6000): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ])

  const pendingQ = query(collection(db, cn('queue_pending')), limit(WALL_CAPACITY))

  // 第一段：輕量來源（current_state 廣播 + 待播佇列）。allSettled：任一失敗不影響其他來源。
  const [stateRes, pendingRes] = await Promise.allSettled([
    withTimeout(getDoc(doc(db, cn('system'), 'current_state'))),
    withTimeout(getDocs(pendingQ))
  ])

  let liveGridAvailable = false
  if (stateRes.status === 'fulfilled') {
    const snap = stateRes.value
    const state = snap.exists() ? (snap.data() as any) : null
    // 牆面 reset 進行中（含 live_grid 已清空但畫面尚未清乾淨的尾段）：一律當全滿，
    // 把所有可選字標為 used，讓編輯器擋住進場、顯示「正在準備新稿紙」而非進來撞 reset。
    // 但只信任「夠新」的旗標：若大螢幕在 reset 途中被關閉（finally 來不及執行），
    // wall_resetting 會卡在 true；用 updated_at 過期判斷，避免所有編輯器被永久鎖死。
    const updatedAt = Number(state?.updated_at)
    const resetFlagFresh =
      Number.isFinite(updatedAt) && Date.now() - updatedAt < RESET_FLAG_MAX_AGE_MS
    if (state?.wall_resetting === true && resetFlagFresh) {
      for (const id of ACTIVE_FONT_LIST) used.add(id)
      diagSource = 'reset-all'
      lastWallReadAuthoritative = true // 確知大螢幕正在 reset → 這是權威判斷（擋住進場）
      lastWallReadSource = 'reset-all'
      console.log('[Editor][diag] getUsedFonts: wall_resetting=true → 全部視為已用', { ageMs: Date.now() - updatedAt })
      return used
    }
    // 只有 updated_at 夠新時才信任 live_grid；過舊（多半是 ?intro 開場揭幕前不廣播、或大螢幕已關閉）
    // 就視為不可用，退回讀權威來源 queue_history，避免拿上一輪 session 的舊快照誤判可選字。
    const liveGridFresh =
      Number.isFinite(updatedAt) && Date.now() - updatedAt < LIVE_GRID_MAX_AGE_MS
    const liveGrid = state?.live_grid ?? null
    if (Array.isArray(liveGrid) && liveGridFresh) {
      liveGridAvailable = true // 牆有廣播過且夠新（含空陣列＝牆上目前沒字）→ 視為權威，不需重讀 history
      authoritative = true
      diagSource = 'live_grid'
      diagLiveGridAgeMs = Date.now() - updatedAt
      for (const g of liveGrid) addFont(g?.style?.font)
    }
  } else {
    console.debug('[Editor] 讀取 current_state 失敗，改讀 queue_history 避字', stateRes.reason)
  }
  if (pendingRes.status === 'fulfilled') collectFonts(pendingRes.value.docs)

  // 第二段（後備）：只有 live_grid 不可用時，才付出 queue_history 的重量級讀取。
  if (!liveGridAvailable) {
    diagSource = 'history-fallback'
    const historyQ = query(
      collection(db, cn('queue_history')),
      orderBy('playedAt', 'desc'),
      limit(WALL_CAPACITY)
    )
    try {
      // 後備是「重量級」讀取（queue_history 可達數 MB）且失敗就會擋住進場（非權威 → 暫無可用），
      // 故給它較寬的 timeout，讓牆機壅塞時也有機會讀成功變成權威來源，減少誤跳「暫無可用」。
      const historySnap = await withTimeout(getDocs(historyQ), 9000)
      collectFonts(historySnap.docs, true)
      authoritative = true // 成功讀到權威來源 queue_history（即使空的，也代表牆上目前沒字）
    } catch (e) {
      console.debug('[Editor] queue_history 後備讀取失敗', e)
    }
  }

  lastWallReadAuthoritative = authoritative
  lastWallReadSource = diagSource
  if (!used.size) console.debug('[Editor] 各來源皆無已用字，描紅字帖改純隨機')
  // [diag] 釐清「選到牆上字」用：來源、是否權威、live_grid 多舊、used 內容
  console.log('[Editor][diag] getUsedFonts', { source: diagSource, authoritative, liveGridAgeMs: diagLiveGridAgeMs, usedCount: used.size, usedFonts: [...used].sort() })
  return used
}

/** Fisher–Yates 洗牌（不改動原陣列）：讓逐一嘗試佔用的順序隨機 */
const shuffle = <T,>(arr: readonly T[]): T[] => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * 預先讀取「牆上已用字」：在 loading／活動介紹頁階段（按「開始」前）就先發動，
 * 讓使用者閱讀規範、勾選同意的這段時間把 Firestore 讀完，按「開始」打開字帖選擇時
 * 不需再等待，可直接標出哪些字已被用掉。
 */
let usedFontsPromise: Promise<Set<string>> | null = null
const prefetchUsedFonts = (): Promise<Set<string>> => {
  if (!usedFontsPromise) usedFontsPromise = getUsedFonts()
  return usedFontsPromise
}
/**
 * 使快取的「已用字」失效，讓下一次 prefetchUsedFonts 重新向 Firestore 讀取。
 * 用於「按開始失敗（牆面當下全滿）」後：使用者可能停在同一頁、等牆清空再按一次開始，
 * 若沿用上次按開始時讀到的快取會永遠判定無字可選，因此每次失敗都要重讀最新牆況。
 */
const invalidateUsedFontsCache = () => {
  usedFontsPromise = null
}

/**
 * 送出前要用到的「最新牆況＋預約」：在打開送出確認 modal 時就先發動讀取，
 * 讓使用者看預覽、點「確認上傳」的這段時間把 Firestore 讀完，confirmSubmit 不必再等網路往返。
 * 用「最新」而非沿用 prefetchUsedFonts 快取，避免送出時拿到過時牆況而撞字。
 */
let submitFontStatePromise: Promise<[Set<string>, Set<string>]> | null = null
const prefetchSubmitFontState = (): Promise<[Set<string>, Set<string>]> => {
  if (!submitFontStatePromise) {
    submitFontStatePromise = Promise.all([
      getUsedFonts(),
      fontReservation.getReservedFonts()
    ])
  }
  return submitFontStatePromise
}

/* ─── 字帖選擇（按開始後手動選一個沒在牆上的字）─── */
const showFontPicker = ref(false)
const fontPickerLoading = ref(false)
const confirmingFont = ref(false)
/** 已被用掉（牆上＋別人預約）而不可選的字 */
const disabledFonts = ref<Set<string>>(new Set())
/** 目前選取的字（預設為清單中第一個可選的字） */
const pickerSelectedFont = ref<string | null>(null)
/** 所有字都被用掉、目前無字可選（牆已滿） */
const noFontAvailable = computed(() => !fontPickerLoading.value && disabledFonts.value.size >= ACTIVE_FONT_LIST.length)

/** 重新計算不可選字集合，並把選取預設為第一個可選的字 */
const refreshDisabledFonts = async (fresh = false) => {
  const [used, reserved] = await Promise.all([
    fresh ? getUsedFonts() : prefetchUsedFonts(),
    fontReservation.getReservedFonts()
  ])
  disabledFonts.value = new Set<string>([...used, ...reserved])
  // 預設選最前面可被選擇的字
  if (!pickerSelectedFont.value || disabledFonts.value.has(pickerSelectedFont.value)) {
    pickerSelectedFont.value = ACTIVE_FONT_LIST.find(id => !disabledFonts.value.has(id)) ?? null
  }
}

/**
 * 自動選字（暫時取代手動選字 UI）：從「牆上已用＋別人預約」以外的可選字中隨機挑一個並原子佔用。
 * 取得回傳已佔用的字 id；若全部疑似被佔用，再嘗試從全清單搶一次（預約可能已過期釋放），
 * 仍搶不到代表牆已滿、回傳 null。
 */
const autoSelectFont = async (): Promise<string | null> => {
  // 測試版只開放少數幾個字，必須嚴格避開「牆上已顯示」的字，否則描紅字帖會跟 canvas 重複。
  // 進場決策一律「當下強制重讀」最新牆況：onMounted 的 prefetch 可能在 reset 開始前就快取，
  // 沿用會誤判（牆已滿卻當有空位／reset 中卻沒擋住）。故這裡丟掉快取改讀 fresh getUsedFonts()，
  // 確保 wall_resetting 與 live_grid 都是按下「開始」這一刻的真實狀態。
  invalidateUsedFontsCache()
  let [used, reserved] = await Promise.all([
    getUsedFonts(),
    fontReservation.getReservedFonts()
  ])
  // 失敗安全：連一個權威牆況都讀不到（弱網／高負載／大螢幕沒在廣播／持久化快取失效）時，
  // used 可能殘缺甚至空集合。此時若照樣選字，極可能挑到牆上其實已有的字（含較早寫、預約早已過期的字）。
  // 寧可回報「暫無可用」讓使用者稍後重試，也不要帶著沒把握的字進場 ——「連續上傳造成讀取逾時而撞到舊字」
  // 主要就是被這道關卡擋下（onStartClick 接到 null 會顯示「正在準備新稿紙」）。
  //
  // 但「偶發一次讀取失敗（timeout／弱網）」不該等同「牆滿」：先短暫重試幾次最新牆況，
  // 仍完全拿不到任一權威來源才放棄。安全性不變（最終仍以 lastWallReadAuthoritative 把關），
  // 只是把「牆其實有空位、只是這一刻沒讀到」而誤跳「暫無可用」的情況大幅減少。
  for (let retry = 0; !lastWallReadAuthoritative && retry < 2; retry++) {
    await new Promise(res => setTimeout(res, 600))
    invalidateUsedFontsCache()
    ;[used, reserved] = await Promise.all([
      getUsedFonts(),
      fontReservation.getReservedFonts()
    ])
  }
  if (!lastWallReadAuthoritative) {
    console.warn('[Editor] 進場讀取牆況不可靠（已重試仍失敗），暫不選字以免撞到牆上已有的字')
    return null
  }

  // 經「最新牆況複查」確認其實已在牆上的字：佔到後若複查發現在牆上，釋放它並記在這裡，下一輪排除、改挑別的。
  const provenOnWall = new Set<string>()

  // 最多把可選字輪一遍：每輪都排除「已複查確認在牆上」的字，逐步收斂到一個確認可用的字。
  for (let attempt = 0; attempt < ACTIVE_FONT_LIST.length; attempt++) {
    // 本分頁剛交棒、還沒在 live_grid 現身的字也要排除，否則「連續送字」會在過渡窗內又挑回它而撞字
    const handedOff = fontReservation.getRecentlyHandedOffFonts()
    const exclude = new Set<string>([...used, ...reserved, ...handedOff, ...provenOnWall])
    const candidates = shuffle(ACTIVE_FONT_LIST.filter(id => !exclude.has(id)))
    let claimed = await fontReservation.claimFont(candidates)
    // 後備：只排除「牆上正在顯示」的字(used)＋剛交棒＋已複查在牆上的字，允許搶可能已過期釋放的別人預約；
    // 但絕不去搶已經出現在 canvas 上、或自己剛送出的字，避免跟大螢幕重複。全在牆上 → 回傳 null。
    if (!claimed) {
      const retry = shuffle(
        ACTIVE_FONT_LIST.filter(id => !used.has(id) && !handedOff.has(id) && !provenOnWall.has(id))
      )
      claimed = await fontReservation.claimFont(retry)
    }
    if (!claimed) return null // 真的沒得選（牆滿／全被佔用）

    // ── 最終把關：修正「按開始仍有機率被派到牆上已有的字」的殘留破口 ──
    // used 只是「讀取那一刻」的快照，從讀 used 到 claimFont 完成之間有時間差；加上 live_grid 可能因牆面
    // 漏拍／剛落格的廣播尚未送達而短暫不含某字（其預約又恰好過期），就會佔到一個其實已在牆上的字。
    // 因此佔到後再用「當下最新牆況」複查一次：claimFont 花掉的時間通常已足夠讓牆面把該字廣播進 live_grid
    //（live_grid 過時時 getUsedFonts 會退回讀權威來源 queue_history）。確認不在牆上才採用，否則釋放、排除、重挑。
    invalidateUsedFontsCache()
    const freshUsed = await getUsedFonts()
    // 複查讀取不可靠時：初次讀取已是權威、且 claimed 不在其中（讀取到佔用之間的空窗極小）→ 沿用本次佔用，
    // 不因偶發一次讀不到牆況就把使用者擋在外面。
    if (!lastWallReadAuthoritative) {
      console.warn('[Editor] 佔字後複查牆況不可靠，沿用初次權威讀取的結果', { claimed, attempt })
      return claimed
    }
    if (!freshUsed.has(claimed)) {
      console.log('[Editor][diag] autoSelect 採用', { claimed, attempt })
      return claimed
    }

    // 佔到的字經複查發現已在牆上 → 釋放預約、記入排除集，並用這份最新牆況繼續挑下一個。
    provenOnWall.add(claimed)
    await fontReservation.releaseFont()
    used = freshUsed
    console.warn('[Editor] 佔到的字經最新牆況複查發現已在牆上，釋放並重挑', { claimed, attempt })
  }
  // 可選字全試過、每個複查都落在牆上（極端情況）→ 不冒險帶著牆上字進場，回報無字可選。
  return null
}

/** 按「開始」後打開字帖選擇：載入不可選清單並預設選第一個可選的字 */
const openFontPicker = async () => {
  showFontPicker.value = true
  fontPickerLoading.value = true
  pickerSelectedFont.value = null
  await refreshDisabledFonts()
  fontPickerLoading.value = false
}

/**
 * 按「確認」：原子佔用選取的字。
 * 成功 → 進入編輯器書寫；剛好被別人選走 → 重新整理可選清單並提示重選。
 */
const confirmFontSelection = async () => {
  const font = pickerSelectedFont.value
  if (!font || confirmingFont.value || disabledFonts.value.has(font)) return
  confirmingFont.value = true
  const claimed = await fontReservation.claimFont([font])
  if (!claimed) {
    await refreshDisabledFonts(true)
    confirmingFont.value = false
    showAlert('這個字剛剛被選走了，請選擇其他字', '請重新選擇', '✍️')
    return
  }
  selectedFontId.value = claimed
  fontReservation.startHeartbeat()
  confirmingFont.value = false
  showFontPicker.value = false
  enterEditor()
}

/**
 * 送出前確認字帖是否仍是自己的。牆位是語意性的（千字文 font-NN 對應固定格），
 * 所以「描的字 ↔ 落點」必須一致，不能靜默換字後直接送。回傳：
 *   'ok'         → 原字還保得住，可直接送出。
 *   'reselected' → 原字被別人搶走，已改挑一個新字帖並設給 selectedFontId；
 *                  呼叫端應中止此次送出、提示使用者依新描紅重描後再送。
 *   'unavailable'→ 連新字都搶不到（牆滿／reset 中），呼叫端中止並提示稍候。
 */
const ensureFontBeforeSubmit = async (): Promise<'ok' | 'reselected' | 'unavailable'> => {
  // 別人的預約：打開送出 modal 時已先發動讀取，這裡多半直接取現成結果，不必再等網路。
  // 注意：不取用一起預讀的「牆上已用字（used）」快照——它是 modal 打開當下的凍結值，
  // 送出前「原字是否已在牆上」一律改以 readFreshUsed() 的最新牆況判斷（見下方說明），
  // 避免用過時快照誤放行而把同字重複上牆。
  const [, reserved] = await consumeSubmitFontState()
  const current = selectedFontId.value

  // 重讀最新牆況（live_grid + pending）只在需要時做一次並快取，避免重複讀取
  let freshUsedCache: Set<string> | null = null
  const readFreshUsed = async (): Promise<Set<string>> => {
    if (!freshUsedCache) {
      invalidateUsedFontsCache()
      freshUsedCache = await getUsedFonts()
    }
    return freshUsedCache
  }

  // 先確認還握得住原字（atomic claim）。注意：握得住預約「不」等於原字不在牆上——
  // 若自己的預約曾因閒置過期被釋放、別人在這段空檔把同字送上牆後又讓預約過期，
  // 這裡仍可能重新 claim 成功。故不能據此就放行，必須再以最新牆況確認（見下）。
  if (current && (await fontReservation.claimFont([current]))) {
    // 握得住預約 → 以「最新牆況」確認原字沒在牆上才直接送。但「在不在牆上」只信任最準的來源：
    const freshUsed = await readFreshUsed()
    if (lastWallReadSource === 'reset-all') {
      // 大螢幕正在重置：不在這裡硬送，往下走（改字分支會因全部標記為 used 回 'unavailable'，請使用者稍候）。
    } else if (lastWallReadSource === 'live_grid' && freshUsed.has(current)) {
      // 由最準的 live_grid 確認原字確實已在牆上（多半是自己的預約曾閒置過期被別人搶送上牆又釋放）→ 往下改字。
    } else {
      // 其餘情況一律信任手上的預約鎖、直接送，不誤判換字：
      //  - live_grid 確認原字不在牆上 → 本來就該送。
      //  - 來源是 queue_history 後備或讀取不可靠 → 它看不到大螢幕本機的 clearedTokens，會把「畫面已清掉但
      //    cleared 旗標沒寫成功」的舊字誤當成還在牆上，據此換字就是「畫面明明沒這字卻說撞 canvas」的誤判
      //   （弱網／磁碟滿時特別明顯）。既然還握著預約鎖，直接送最安全。
      return 'ok'
    }
  }

  // 改字分支：原字保不住、或原字確實已在牆上。用最新牆況排除候選，
  // 避免挑到「已在牆上但預約剛過期」的字而覆蓋他人那一格。
  const freshUsed = await readFreshUsed()
  const handedOff = fontReservation.getRecentlyHandedOffFonts()
  const exclude = new Set<string>([...freshUsed, ...reserved, ...handedOff])
  const candidates = shuffle(ACTIVE_FONT_LIST.filter(id => !exclude.has(id)))
  let claimed = await fontReservation.claimFont(candidates)
  // 後備同樣排除「牆上的字（fresh）」＋剛交棒的字，絕不搶 canvas 上已有的字
  if (!claimed) {
    const retry = shuffle(ACTIVE_FONT_LIST.filter(id => !freshUsed.has(id) && !handedOff.has(id)))
    claimed = await fontReservation.claimFont(retry)
  }
  if (!claimed) return 'unavailable'
  // 換上新字帖，但不直接送：要求使用者依新描紅重描，確保牆上該格的筆跡就是該格的字
  selectedFontId.value = claimed
  return 'reselected'
}

// confirmSubmit 用：取用「打開 modal 時就先發動」的牆況讀取結果（多半已就緒），用完即失效
const consumeSubmitFontState = async (): Promise<[Set<string>, Set<string>]> => {
  const result = await prefetchSubmitFontState()
  submitFontStatePromise = null
  return result
}

// 每個物件（貼紙）各自疊放順序：點選時 bringToFront，完成後該物件維持最頂層
const objectZOrder = ref<Record<string, number>>({})
let zOrderCounter = 0
const getObjectZIndex = (id: string) => objectZOrder.value[id] ?? 1
const bringToFront = (id: string) => {
  zOrderCounter += 1
  objectZOrder.value = { ...objectZOrder.value, [id]: zOrderCounter }
}

/** 書法頁「下一步」：進入貼紙編輯（watch 會自動收起繪圖、保存筆畫） */
const goToStickerStep = () => {
  activeTab.value = 'sticker'
}

/** 貼紙頁「繼續書寫」：清掉選取並回到書法頁 */
const backToDrawing = () => {
  selectedStickerId.value = null
  activeTab.value = 'draw'
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
// 上傳冷卻：設為 0 即停用「每次上傳後需等待 N 秒」的限制（要恢復改回 0.5 * 60 * 1000＝30 秒）
const TOKEN_DISABLED_SUBMIT_COOLDOWN_MS = 0
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

// 僅在有實際筆畫時更新 drawingData（供預覽與上傳使用）
const syncDrawingDataFromFabric = () => {
  if (!fabricBrush.canUndo()) {
    return
  }
  const data = fabricBrush.exportToDataURL()
  if (data && data !== drawingData.value) {
    drawingData.value = data
  }
}

const fabricBrush = useFabricBrush(() => {
  syncDrawingDataFromFabric()
  // 下筆視為一次活動，避免長時間作畫期間字帖被閒置回收
  fontReservation.markActivity()
})
// 切換 tab 時同步繪圖模式
watch(activeTab, (tab) => {
  // 繪圖：進入/退出繪圖模式
  if (tab === 'draw') {
    drawMode.value = true
    // 恢復畫布尺寸（從 1×1 最小化還原為 600×600，重新分配 GPU backing store）
    fabricBrush.restoreCanvas()
    fabricBrush.setDrawingMode(true)
    // 不再把繪圖層提到最前：繪圖層固定 z-index 0，貼紙(z≥1)永遠在字的前面
  } else {
    if (drawMode.value) {
      // 離開繪圖模式：把最新筆畫同步到 drawingData
      syncDrawingDataFromFabric()
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
      `每隻字怪最多只能貼 ${MAX_STICKERS} 個貼紙喔！如果需要更多空間，可以先刪除一些。`,
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
  // 選取新貼紙並切到貼紙 tab，讓編輯框出現
  selectedStickerId.value = newSticker.id
  bringToFront(newSticker.id)
  activeTab.value = 'sticker'
}

const selectSticker = (id: string) => {
  selectedStickerId.value = id
  bringToFront(id)
}

const deselectAll = () => {
  if (lastCanvasDragEndAt.value && Date.now() - lastCanvasDragEndAt.value < 400) return
  selectedStickerId.value = null
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
  isTwoFingerGesture
})

const removeSticker = (id: string) => {
  stickers.value = stickers.value.filter(s => s.id !== id)
  selectedStickerId.value = null
}

// touchstart 上刪除貼紙：捲動中 touchstart 可能 cancelable=false，需先判斷再 preventDefault，
// 避免瀏覽器跳出 [Intervention] Ignored attempt to cancel a touchstart event 警告
const onDeleteStickerTouch = (e: TouchEvent, id: string) => {
  if (e.cancelable) e.preventDefault()
  removeSticker(id)
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
  showClearAllModal.value = false
  // 清空只清內容，保留目前的描紅字帖（不換字）；清完直接回到「書法」狀態可繼續書寫
  activeTab.value = 'draw'
}

const isSubmitting = ref(false)

const openSubmitModal = () => {
  if (!hasAnyContent.value) {
    showAlert('請至少加入一個貼紙或繪圖')
    return
  }

  // 測試模式停用上傳冷卻，方便連續送字驗證流程
  if (!tokenRequiredForSubmit.value && !TEST_MODE) {
    const remainingCooldownMs = getTokenDisabledRemainingCooldownMs()
    if (remainingCooldownMs > 0) {
      showAlert(
        `每次上傳後需等待 30秒。請於 ${formatCooldownRemaining(remainingCooldownMs)} 後再試。`,
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

  // 先發動「送出前的牆況讀取」：使用者看預覽、點確認的這段時間把 Firestore 讀完，送出時就不必再等。
  submitFontStatePromise = null
  void prefetchSubmitFontState()

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
    geoFenceSnap = await getDoc(doc(db, cn('system'), 'editor_geo_fence'))
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

  // 測試模式停用上傳冷卻，方便連續送字驗證流程
  if (!tokenRequiredForSubmit.value && !TEST_MODE) {
    const remainingCooldownMs = getTokenDisabledRemainingCooldownMs()
    if (remainingCooldownMs > 0) {
      showSubmitModal.value = false
      showAlert(
        `每次上傳後需等待 30 秒。請於 ${formatCooldownRemaining(remainingCooldownMs)} 後再試。`,
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

    // 2. 送出前重新搶佔字帖：閒置期間字可能已被釋放或被別人拿走。牆位是語意性的（千字文每格＝特定字），
    //    所以原字被搶走時不靜默換字硬送，而是換上新字帖、中止本次送出，請使用者依新描紅重描後再送。
    const fontResult = await ensureFontBeforeSubmit()
    if (fontResult === 'reselected') {
      showSubmitModal.value = false
      // 換了新字帖：原本的描紅/貼紙是描在「舊字」上的，已不適用 → 清空畫布，讓使用者依新字重描。
      resetEditorToInitial()
      activeTab.value = 'draw'
      showAlert(
        '你描的這個字剛好被其他人選走、即將出現在大螢幕上了，已幫你換上一張新的字帖。<br>畫面已清空，請依新的描紅重新描寫後，再按一次送出喔！',
        '字帖已更換',
        '✍️'
      )
      return
    }
    if (fontResult === 'unavailable') {
      showSubmitModal.value = false
      showAlert(
        '目前字帖都在使用中，稿紙可能正在更新。<br>請稍候幾秒再按一次送出。',
        '暫無可用字帖',
        '⏳'
      )
      return
    }

    // 3. 狀態正確(valid)或無法判別時，嘗試正式送出
    await createNote(
      { content: previewNoteData.value.content, style: previewNoteData.value.style },
      tokenForSubmit
    )

    // 送出成功：字已寫入 queue_pending，接著會經 moveToHistory→聚光→落格才出現在牆上。
    // 這段過渡期 note 已從 queue_pending 移除、但牆面廣播尚未含它，若此刻釋放預約會造成
    // 別的編輯器重複發到同一個字（見 reservationHandedToWall 說明）。故不主動釋放，
    // 只停掉續約並把預約改成短寬限期（handOffToWall）：牆面 broadcastState 一旦把字納入
    // live_grid（含聚光中／排隊中的字）就會持續覆蓋它，預約即多餘。沿用整整 1 分鐘 idle TTL 會
    // 讓字早已安全上牆卻仍被鎖最久 1 分鐘——測試模式只有 3 個字時會卡住整池，造成牆上還有空位
    // 卻顯示「暫無可用的字」。
    reservationHandedToWall = true
    fontReservation.stopHeartbeat()
    void fontReservation.handOffToWall()

    // 上傳成功：記錄冷卻起點（測試模式不記，反正也不檢查冷卻）
    if (!tokenRequiredForSubmit.value && !TEST_MODE) {
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
        title: '故宮南院 藝字遊戲',
        text: '這是我剛寫好的字怪！',
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

/** 字帖選好（已佔用）後進入編輯器：顯示教學、初始化手繪、停在「書法」 */
const enterEditor = async () => {
  await nextTick()
  // 第一次進來（沒看過教學）顯示教學
  const hasSeen = localStorage.getItem('hasSeenWillMusicTutorial')
  if (!hasSeen) {
    showTutorialModal.value = true
  }

  // 初始化 Fabric 手繪
  initFabricBrush()

  // 一開始就進入「書法」：用執行期切換（等同點分頁），確保介面/按鈕與一般進入書法一致
  activeTab.value = 'draw'
}

// 分頁關閉 / 切走時盡力即時釋放佔用的字帖（抓不到就靠 reservation 的 TTL 回收）
// 已送出者不釋放：保留預約撐過落格前的空窗，交給 TTL 回收，避免別的編輯器重複發字。
const releaseReservationBeacon = () => {
  if (reservationHandedToWall) return
  fontReservation.releaseFontBeacon()
}

onMounted(async () => {
  // 在背景預載 Fabric.js（不 await，讓它在使用者閱讀規範的期間下載完畢）
  if (import.meta.client) {
    import('fabric').catch(() => {})
    // 在背景先讀牆上已用字（不 await）：讓使用者閱讀活動介紹的期間就讀完，
    // 按「開始」打開字帖選擇時可立即標出哪些字已被用掉，不必等待。
    prefetchUsedFonts()
    window.addEventListener('beforeunload', releaseReservationBeacon)
    window.addEventListener('pagehide', releaseReservationBeacon)
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
  unsubTokenRequirement = onSnapshot(doc(db, cn('system'), 'editor_token_requirement'), (snap) => {
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
  unsubTokenRequirement?.()
  unsubTokenRequirement = null
  fabricBrush.dispose()
  // 離開編輯器：未送出就把字還回去給別人選；已送出則保留預約交給 TTL 回收，
  // 避免落格前的空窗（note 已離開 queue_pending、牆面廣播尚未含它）讓別的編輯器重複發到同一個字。
  fontReservation.stopHeartbeat()
  if (!reservationHandedToWall) void fontReservation.releaseFont()
  if (import.meta.client) {
    window.removeEventListener('beforeunload', releaseReservationBeacon)
    window.removeEventListener('pagehide', releaseReservationBeacon)
  }
})
</script>
