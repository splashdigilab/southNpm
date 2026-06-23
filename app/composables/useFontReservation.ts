import {
  collection,
  doc,
  getDocs,
  deleteDoc,
  setDoc,
  runTransaction
} from 'firebase/firestore'

/**
 * 字帖預約（reservation）機制
 * ──────────────────────────────────────────────────────────────
 * 目的：使用者一進編輯器選好字帖時就「佔用」該字，讓其他人的編輯器選不到同一個字，
 * 避免兩人同時挑到同一個還沒人用的字而撞字。
 *
 * 釋放時機：
 *   1. 送出成功後（字已變成正式便利貼，預約功成身退）
 *   2. 關閉分頁 / 離開頁面（beforeunload、pagehide、卸載）——盡力即時釋放
 *   3. 上述抓不到時，靠 TTL：超過 RESERVATION_TTL_MS 沒續約即視為離開、自動釋放
 *
 * 資料結構：collection `font_reservations`，doc id = 字帖 id（天然一字一鎖），
 *   欄位 { owner, font, expiresAt(ms epoch) }。
 */

/**
 * 字帖最後一次「使用者互動」後，超過此時間沒有再互動即自動釋放（毫秒）。
 * 預約的有效期 expiresAt 一律設為 lastActivityAt + 此值，所以即使分頁一直開著，
 * 只要使用者停止操作超過這段時間，該字就會釋放回可選池（解決「開著不關永遠佔字」）。
 */
const RESERVATION_TTL_MS = 1 * 60_000
/** 續約間隔：須明顯小於 TTL，確保正在書寫的人不會被誤回收（毫秒） */
const HEARTBEAT_MS = 0.5 * 60_000
/**
 * 送出後「交棒給牆面」的寬限期（毫秒）。
 * 送出成功時不立即刪預約，要撐過「字已從 queue_pending 移除、但牆面 live_grid 廣播尚未含它」的空窗；
 * 但這個空窗極短——牆面的 broadcastState 一旦把字納入 live_grid（含聚光中／排隊中的字）就會持續覆蓋它，
 * 之後預約即多餘。故交棒後只保留這段短寬限期，而非沿用整整 1 分鐘的 idle TTL，
 * 否則字早已安全上牆卻仍被預約鎖住，最久達 1 分鐘無法再被選到。
 * 測試模式只有 3 個字時尤其明顯：剛送出的字會卡住整池，導致牆上還有空位卻顯示「暫無可用的字」。
 */
const HANDOFF_GRACE_MS = 15_000

const RESERVATION_COL = 'font_reservations'

export const useFontReservation = () => {
  const { $firestore } = useNuxtApp()
  const db = $firestore as any

  // 本編輯器分頁的擁有者識別（重新整理就換一個，舊的交給 TTL 回收）
  const owner =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`

  let currentFont: string | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  // 最後一次使用者互動時間：續約以此為基準（expiresAt = lastActivityAt + TTL）
  let lastActivityAt = Date.now()

  /**
   * 本分頁「剛送出、已交棒給牆面但可能還沒在 live_grid 現身」的字（font → 寬限到期 ms）。
   * getReservedFonts 會略過自己分頁的預約，因此同一分頁在 HANDOFF_GRACE_MS 過渡窗內連續送字時，
   * autoSelect 讀不到剛交棒的字（它還沒進牆面 live_grid）就可能又挑回同一個 → 跟牆上撞字。
   * 用這份本地清單把這些字暫時排除，撐到它安全上牆（被 live_grid 涵蓋）為止。
   */
  const recentlyHandedOff = new Map<string, number>()
  /** 取出本分頁仍在過渡窗內、尚未確認上牆的字（過期即清掉） */
  const getRecentlyHandedOffFonts = (): Set<string> => {
    const now = Date.now()
    const out = new Set<string>()
    for (const [font, exp] of recentlyHandedOff) {
      if (exp > now) out.add(font)
      else recentlyHandedOff.delete(font)
    }
    return out
  }

  /** 記錄一次使用者互動（觸控/點擊/下筆…），讓正在操作的人持續保住字 */
  const markActivity = (): void => { lastActivityAt = Date.now() }

  const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const
  const onVisibilityChange = (): void => {
    // 回到前景：先記一次活動，並重新確保預約（被搶走就不覆蓋，留給送出前重搶處理）
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      markActivity()
      void renew()
    }
  }
  const bindActivityListeners = (): void => {
    if (typeof window === 'undefined') return
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, markActivity, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  const unbindActivityListeners = (): void => {
    if (typeof window === 'undefined') return
    for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, markActivity)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  /** 讀取目前「別人」仍有效（未過期）的預約字帖集合；自己的預約不算佔用 */
  const getReservedFonts = async (): Promise<Set<string>> => {
    const out = new Set<string>()
    try {
      const snap = await getDocs(collection(db, RESERVATION_COL))
      const now = Date.now()
      snap.forEach((d) => {
        const data = d.data() as { owner?: string; font?: string; expiresAt?: number }
        if (!data?.font || data.owner === owner) return
        if (typeof data.expiresAt !== 'number' || data.expiresAt <= now) return // 過期＝已釋放
        out.add(data.font)
      })
    } catch (e) {
      console.debug('[reservation] 讀取預約失敗，視為無預約', e)
    }
    return out
  }

  /**
   * 依序原子佔用候選字帖（transaction 防同時搶同一個字），成功回傳該字帖；
   * 候選全被別人佔走則回傳 null。佔到新字會自動釋放先前持有的字。
   */
  const claimFont = async (candidates: string[]): Promise<string | null> => {
    for (const font of candidates) {
      try {
        const ok = await runTransaction(db, async (tx) => {
          const ref = doc(db, RESERVATION_COL, font)
          const snap = await tx.get(ref)
          const now = Date.now()
          if (snap.exists()) {
            const d = snap.data() as { owner?: string; expiresAt?: number }
            const active = typeof d.expiresAt === 'number' && d.expiresAt > now
            if (active && d.owner !== owner) return false // 別人正持有且未過期
          }
          tx.set(ref, { owner, font, expiresAt: now + RESERVATION_TTL_MS })
          return true
        })
        if (ok) {
          if (currentFont && currentFont !== font) await releaseFont()
          currentFont = font
          markActivity() // 佔到字＝一次活動，重置閒置計時
          return font
        }
      } catch (e) {
        console.debug('[reservation] 佔用失敗，試下一個', font, e)
      }
    }
    return null
  }

  /** 釋放目前持有的預約（送出成功 / 卸載時呼叫） */
  const releaseFont = async (): Promise<void> => {
    const font = currentFont
    if (!font) return
    currentFont = null
    try {
      await deleteDoc(doc(db, RESERVATION_COL, font))
    } catch (e) {
      console.debug('[reservation] 釋放失敗，交給 TTL 回收', font, e)
    }
  }

  /**
   * 在分頁關閉當下盡力釋放（beforeunload / pagehide 內呼叫）。
   * deleteDoc 在卸載瞬間不保證送達，真正的保險仍是 TTL。
   */
  const releaseFontBeacon = (): void => {
    const font = currentFont
    if (!font) return
    currentFont = null
    deleteDoc(doc(db, RESERVATION_COL, font)).catch(() => {})
  }

  /**
   * 送出成功後把字交棒給牆面：不立即刪預約（要撐過 pending→history→廣播的短暫空窗），
   * 但把到期時間改成 now + HANDOFF_GRACE_MS 的短寬限期即可，讓字一旦上牆（被 live_grid 覆蓋）
   * 就能很快釋放回可選池，而非沿用整整 1 分鐘的 idle TTL 把字長時間鎖死。
   * 呼叫前應先 stopHeartbeat()，避免續約把寬限期又拉長回 1 分鐘。
   */
  const handOffToWall = async (): Promise<void> => {
    const font = currentFont
    if (!font) return
    currentFont = null // 交棒後不再持有：避免卸載時又被 releaseFont/renew 動到
    // 記錄為「本分頁剛交棒」：同分頁在過渡窗內若再選字，autoSelect 會排除它，避免又挑回而撞字
    recentlyHandedOff.set(font, Date.now() + HANDOFF_GRACE_MS)
    try {
      await setDoc(doc(db, RESERVATION_COL, font), {
        owner,
        font,
        expiresAt: Date.now() + HANDOFF_GRACE_MS
      })
    } catch (e) {
      console.debug('[reservation] 交棒縮短 TTL 失敗，沿用原 TTL 回收', font, e)
    }
  }

  /**
   * 續約：把 expiresAt 設為 lastActivityAt + TTL（依「最後互動時間」而非當下時間）。
   * - 使用者持續操作 → lastActivityAt 一直更新 → 字一直保住。
   * - 使用者停止操作 → 閒置超過 TTL 就不再續約（且不覆蓋別人），讓字自然過期釋放，
   *   避免「分頁開著不關就永遠佔字」。
   * - 用 transaction 確認：若已被別人搶走且仍有效，就不覆蓋（不偷回別人的字）。
   */
  const renew = async (): Promise<void> => {
    const font = currentFont
    if (!font) return
    // 閒置已超過 TTL：放棄續約，讓它過期釋放
    if (Date.now() - lastActivityAt >= RESERVATION_TTL_MS) return
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, RESERVATION_COL, font)
        const snap = await tx.get(ref)
        if (snap.exists()) {
          const d = snap.data() as { owner?: string; expiresAt?: number }
          const heldByOther =
            d.owner !== owner && typeof d.expiresAt === 'number' && d.expiresAt > Date.now()
          if (heldByOther) return // 已被別人佔走且有效 → 不覆蓋
        }
        tx.set(ref, { owner, font, expiresAt: lastActivityAt + RESERVATION_TTL_MS })
      })
    } catch (e) {
      console.debug('[reservation] 續約失敗', font, e)
    }
  }

  const startHeartbeat = (): void => {
    if (heartbeatTimer) return
    markActivity() // 開始時視為一次活動
    bindActivityListeners()
    heartbeatTimer = setInterval(() => { void renew() }, HEARTBEAT_MS)
  }
  const stopHeartbeat = (): void => {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    unbindActivityListeners()
  }

  return {
    owner,
    getReservedFonts,
    getRecentlyHandedOffFonts,
    claimFont,
    releaseFont,
    releaseFontBeacon,
    handOffToWall,
    markActivity,
    startHeartbeat,
    stopHeartbeat
  }
}
