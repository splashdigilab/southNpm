/**
 * 測試環境資料隔離。
 *
 * 在獨立路由（/canvas-test、/editor-test，路徑以 `-test` 結尾）或任何網址加上
 * `?test=1` 時，所有 Firestore collection 名稱都會自動加上 `test_` 前綴
 * （queue_pending → test_queue_pending …），與正式站資料完全分開，
 * 但共用同一個 Firebase 專案、同一份程式碼。
 *
 * 正式路由（/canvas、/editor）前綴為空字串，行為與原本完全一致；
 * bug 修在共用的 component / composable 裡，修完正式站自動生效，不需手動 port。
 *
 * 用法：在 setup（或任何 client 端函式）取得 `cn`，把寫死的 collection 名稱換成
 *   collection(db, 'queue_pending')      → collection(db, cn('queue_pending'))
 *   doc(db, 'system', 'current_state')   → doc(db, cn('system'), 'current_state')
 */
export const useDbEnv = () => {
  // 直接讀 window，不依賴 Vue setup context，可在任何 client 端函式內呼叫。
  // canvas / editor 皆為 client-only 頁；SSR 階段一律回正式前綴（空字串）。
  let isTest = false
  if (import.meta.client) {
    const { pathname, search } = window.location
    isTest = pathname.endsWith('-test') || new URLSearchParams(search).has('test')
  }
  const prefix = isTest ? 'test_' : ''
  return {
    isTest,
    prefix,
    /** 把 collection 名稱套上目前環境前綴 */
    cn: (name: string) => prefix + name
  }
}
