/**
 * LocalStorage 和 SessionStorage 工具函式
 */
const TOKEN_KEY = 'willmusic_token'

export const useStorage = () => {
  /**
   * 儲存 Token 到 SessionStorage
   */
  const saveToken = (token: string) => {
    if (!import.meta.client) return

    try {
      sessionStorage.setItem(TOKEN_KEY, token)
    } catch (error) {
      console.error('Error saving token:', error)
    }
  }

  /**
   * 從 SessionStorage 讀取 Token
   */
  const loadToken = (): string | null => {
    if (!import.meta.client) return null

    try {
      return sessionStorage.getItem(TOKEN_KEY)
    } catch (error) {
      console.error('Error loading token:', error)
      return null
    }
  }

  /**
   * 清除 Token
   */
  const clearToken = () => {
    if (!import.meta.client) return
    sessionStorage.removeItem(TOKEN_KEY)
  }

  /**
   * 檢查是否有 Token
   */
  const hasToken = computed(() => {
    if (!import.meta.client) return false
    return !!sessionStorage.getItem(TOKEN_KEY)
  })

  return {
    saveToken,
    loadToken,
    clearToken,
    hasToken
  }
}
