<template>
  <div class="p-queue-status">
    <AppHeader />
    <div class="p-queue-status__container">

      <!-- 卡片：送出成功訊息 -->
      <div class="p-queue-status__card">
        <h1 class="p-queue-status__title">送出成功</h1>
        <p class="p-queue-status__hint">您的字怪已送出，請稍後於大螢幕與它相見！</p>

        <NuxtLink to="/editor" class="p-queue-status__btn">返回編輯器</NuxtLink>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

definePageMeta({
  layout: false
})

const router = useRouter()

// 未點擊「返回編輯器」時，30 秒後自動返回編輯器
const AUTO_RETURN_MS = 30_000
let autoReturnTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  autoReturnTimer = setTimeout(() => {
    router.push('/editor')
  }, AUTO_RETURN_MS)
})

onUnmounted(() => {
  if (autoReturnTimer) {
    clearTimeout(autoReturnTimer)
    autoReturnTimer = null
  }
})
</script>
