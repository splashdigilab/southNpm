<template>
  <div ref="noteRef" class="c-sticky-note">
    <div class="c-sticky-note__scaler" :style="scalerStyle">
      <div class="c-sticky-note__inner">
        <!-- 貼紙 -->
        <div
          v-for="sticker in stickers"
          :key="sticker.id"
          class="c-sticky-note__sticker"
          :style="getStickerWrapStyle(sticker)"
        >
          <img
            v-if="getStickerData(sticker.type)?.svgFile"
            :src="getStickerData(sticker.type)?.svgFile"
            :alt="getStickerData(sticker.type)?.id"
            class="c-sticky-note__sticker-img"
            loading="lazy"
            decoding="async"
            fetchpriority="low"
          />
        </div>
        <!-- 手繪圖層 -->
        <img
          v-if="props.note.style?.drawing"
          :src="props.note.style.drawing"
          alt=""
          class="c-sticky-note__drawing"
          loading="lazy"
          decoding="async"
          fetchpriority="low"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { QueuePendingItem, QueueHistoryItem, StickerInstance } from '~/types'
import { STICKER_LIBRARY } from '~/data/stickers'
import { getStickerStyle } from '~/utils/sticky-note-style'

interface Props {
  note: QueuePendingItem | QueueHistoryItem
  animate?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  animate: false
})

const noteRef = ref<HTMLElement | null>(null)

const stickers = computed(() => {
  return props.note.style?.stickers || []
})

/** 預覽/上傳/display 與編輯器疊放順序一致；無則沿用預設（貼紙 3） */
const objectLayerOrder = computed(() => props.note.style?.objectLayerOrder ?? {})

// 貼紙永遠疊在手繪文字（drawing 層 z-index 2）之上：
// 預覽/上傳/LED 牆一律以 STICKER_Z_BASE 偏移，避免貼紙的 layer order 值偏低時跑到文字下方；
// 仍以 objectLayerOrder 保留貼紙彼此之間的相對堆疊順序。
const STICKER_Z_BASE = 10
const getStickerWrapStyle = (sticker: StickerInstance) => {
  const base = getStickerStyle(sticker)
  const z = objectLayerOrder.value[sticker.id] ?? 3
  return { ...base, zIndex: STICKER_Z_BASE + z }
}

const getStickerData = (type: string) => STICKER_LIBRARY.find(s => s.id === type)

// GSAP 動畫（如果需要）與縮放
const scalerStyle = ref({ transform: 'scale(1)' })
const VIRTUAL_SIZE = 600

function updateScale() {
  if (noteRef.value) {
    const width = noteRef.value.clientWidth
    if (width > 0) {
      scalerStyle.value = { transform: `scale(${width / VIRTUAL_SIZE})` }
    }
  }
}

let ro: ResizeObserver | null = null

onMounted(async () => {
  updateScale()

  // 使用 ResizeObserver 監聽大小變化，保證 GSAP Flip 重排後 scale 始終正確
  if (noteRef.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { updateScale() })
    ro.observe(noteRef.value)
  }

  if (props.animate && import.meta.client && noteRef.value) {
    // 只在實際需要動畫時才載入 GSAP，減少不需要動畫時的記憶體與解析成本
    const { gsap } = await import('gsap')
    gsap.from(noteRef.value, {
      scale: 0,
      rotation: -180,
      opacity: 0,
      duration: 0.6,
      ease: 'back.out(1.7)'
    })
  }
})

onUnmounted(() => {
  ro?.disconnect()
})
</script>

<style scoped>
/* 所有樣式已移至 app/assets/scss/components/_sticky-note.scss */
</style>
