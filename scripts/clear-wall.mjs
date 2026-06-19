/**
 * 一次性清除大螢幕資料：刪除 queue_history、queue_pending 全部文件，
 * 並把 system/current_state 重設為 idle（清空 live_grid）。
 *
 * 用法：node scripts/clear-wall.mjs
 * 讀取專案根目錄 .env 的 NUXT_PUBLIC_FIREBASE_* 設定，使用 Firebase Web SDK 刪除。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, collection, getDocs, doc, setDoc, writeBatch
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 解析 .env（簡單版：KEY="value" / KEY=value）
const env = {}
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (!m) continue
  env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const firebaseConfig = {
  apiKey: env.NUXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NUXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NUXT_PUBLIC_FIREBASE_APP_ID
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

// 刪除 queue_history 需要 admin 身分（Firestore 規則限制）。
// 透過環境變數帶入 admin 帳密登入後再刪，避免把帳密寫進檔案：
//   ADMIN_EMAIL=xxx ADMIN_PASSWORD=yyy node scripts/clear-wall.mjs
const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
if (adminEmail && adminPassword) {
  await signInWithEmailAndPassword(getAuth(app), adminEmail, adminPassword)
  console.log(`已以 admin 登入：${adminEmail}`)
} else {
  console.warn('未提供 ADMIN_EMAIL / ADMIN_PASSWORD，將以匿名身分嘗試（刪除多半會被規則拒絕）')
}

async function clearCollection(name) {
  const snap = await getDocs(collection(db, name))
  if (snap.empty) {
    console.log(`[${name}] 已是空的`)
    return 0
  }
  // 分批刪除（writeBatch 上限 500）
  let deleted = 0
  let batch = writeBatch(db)
  let n = 0
  for (const d of snap.docs) {
    batch.delete(doc(db, name, d.id))
    n++
    deleted++
    if (n === 450) { await batch.commit(); batch = writeBatch(db); n = 0 }
  }
  if (n > 0) await batch.commit()
  console.log(`[${name}] 已刪除 ${deleted} 筆`)
  return deleted
}

try {
  console.log(`連線專案：${firebaseConfig.projectId}`)
  await clearCollection('queue_pending')
  await clearCollection('queue_history')
  await setDoc(doc(db, 'system', 'current_state'), {
    mode: 'idle', now_playing: null, live_grid: [], updated_at: Date.now()
  })
  console.log('[system/current_state] 已重設為 idle')
  console.log('完成。')
  process.exit(0)
} catch (e) {
  console.error('清除失敗：', e?.code || '', e?.message || e)
  process.exit(1)
}
