<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="c-modal-overlay">
        <div 
          class="c-modal c-modal--tutorial" 
          @click.stop
          @touchstart="handleTouchStart"
          @touchend="handleTouchEnd"
        >
          <template v-if="currentStepData">
            <h2 class="c-modal__title">{{ currentStepData.title }}</h2>
            <p class="c-modal__message">{{ currentStepData.message }}</p>
          </template>

          <!-- 示意區：與 editor 一致的被選取物件 + 雙指動畫 -->
          <div
            class="tutorial-demo"
            :class="`tutorial-demo--step-${currentStep}`"
          >
            <div class="tutorial-demo__stage">
              <!-- 稿紙描紅範字（墊在底下、半透明） -->
              <img src="/font/font-01.svg" class="tutorial-demo__font" alt="" />

              <!-- 寫字步驟：手指沿曲線由左到右移動，墨色筆畫同步一筆寫出 -->
              <template v-if="currentStepData.type === 'write'">
                <svg
                  class="tutorial-demo__write-svg"
                  viewBox="0 0 200 120"
                  fill="none"
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  <path
                    class="tutorial-demo__write-path"
                    pathLength="100"
                    d="M26,80 C66,58 96,52 124,60 C146,66 166,72 178,62"
                    stroke="#241F20"
                    stroke-width="13"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <!-- 手指：沿同一條曲線移動，與筆畫同步 -->
                  <image
                    class="tutorial-demo__write-hand"
                    href="/tutorial-drag.svg"
                    width="50"
                    height="50"
                    x="-12"
                    y="-4"
                  >
                    <animateMotion
                      dur="3.2s"
                      repeatCount="indefinite"
                      calcMode="spline"
                      keyTimes="0;0.12;0.68;1"
                      keyPoints="0;0;1;1"
                      keySplines="0 0 1 1; .42 0 .58 1; 0 0 1 1"
                      path="M26,80 C66,58 96,52 124,60 C146,66 166,72 178,62"
                    />
                    <animate
                      attributeName="opacity"
                      dur="3.2s"
                      repeatCount="indefinite"
                      keyTimes="0;0.12;0.68;0.92;1"
                      values="0;0.9;0.9;0.9;0"
                    />
                  </image>
                </svg>
              </template>

              <!-- 物件步驟（拖移/旋轉/縮放）：編輯框 + 手勢圖一起動畫 -->
              <div v-else class="tutorial-demo__object-wrap">
                <img :src="currentStepData.image" class="tutorial-demo__guesture" alt="" />
                <div class="tutorial-demo__object">
                  <img src="/decoration/decoration-01.svg" class="tutorial-demo__object-img" alt="" />
                </div>
              </div>
            </div>
          </div>

          <div class="tutorial-steps">
            <span
              v-for="(_, index) in steps"
              :key="index"
              class="tutorial-step-dot"
              :class="{ 'is-active': currentStep === index }"
            />
          </div>

          <div class="c-modal__actions">
            <button
              v-if="currentStep > 0"
              class="c-button c-button--secondary"
              @click="prevStep"
            >
              上一步
            </button>
            <button
              v-else
              class="c-button c-button--secondary"
              @click="finish"
            >
              略過
            </button>
            <button
              class="c-button c-button--primary"
              @click="nextStep"
            >
              {{ currentStep === steps.length - 1 ? '開始體驗' : '下一步' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  }
})

const emit = defineEmits(['update:modelValue', 'finish'])

const currentStep = ref(0)

const steps = [
  {
    type: 'write',
    title: '書寫',
    message: '用手指在稿紙上寫下你的字。',
    image: '/tutorial-drag.svg'
  },
  {
    type: 'object',
    title: '單指拖移',
    message: '選取貼紙，即可隨心移動位置。',
    image: '/tutorial-drag.svg'
  },
  {
    type: 'object',
    title: '雙指旋轉',
    message: '雙指旋轉物件，輕鬆調整呈現角度。',
    image: '/tutorial-rotate.svg'
  },
  {
    type: 'object',
    title: '雙指縮放',
    message: '雙指捏合或張開，自由放大縮小物件。',
    image: '/tutorial-scale.svg'
  }
]

const currentStepData = computed(() => steps[currentStep.value] ?? steps[0])

const touchStartX = ref(0)
const touchEndX = ref(0)
const SWIPE_THRESHOLD = 50

const handleTouchStart = (e: TouchEvent) => {
  if (e.touches && e.touches.length > 0) {
    touchStartX.value = e.touches[0]?.clientX ?? 0
  }
}

const handleTouchEnd = (e: TouchEvent) => {
  if (!e.changedTouches || e.changedTouches.length === 0) return
  
  touchEndX.value = e.changedTouches[0]?.clientX ?? 0
  const deltaX = touchStartX.value - touchEndX.value
  
  if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
    if (deltaX > 0) {
      // 向左滑動 (Swiped left) -> 下一步
      nextStep()
    } else {
      // 向右滑動 (Swiped right) -> 上一步
      prevStep()
    }
  }
}

function nextStep() {
  if (currentStep.value < steps.length - 1) {
    currentStep.value++
  } else {
    finish()
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

function finish() {
  emit('update:modelValue', false)
  emit('finish')
  if (typeof window !== 'undefined') {
    localStorage.setItem('hasSeenWillMusicTutorial', 'true')
  }
}

// 每次打開 modal 都從第一步開始
watch(() => props.modelValue, (open) => {
  if (open) currentStep.value = 0
})
</script>

<style lang="scss" scoped>
/* 樣式已移至 assets/scss/components/_editor-tutorial-modal.scss，由 component-index 載入 */
</style>
