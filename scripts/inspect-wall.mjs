/**
 * 唯讀診斷：印出 queue_history / queue_pending / font_reservations / current_state 的現況，
 * 用來確認「畫面只有2字卻沒字可選」的原因。
 * 用法：node scripts/inspect-wall.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = {}
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = getFirestore(initializeApp({
  apiKey: env.NUXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NUXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NUXT_PUBLIC_FIREBASE_APP_ID
}))

const fontOf = (d) => d?.style?.font ?? '(無)'

async function dump(name) {
  const snap = await getDocs(collection(db, name))
  console.log(`\n=== ${name} (${snap.size} 筆) ===`)
  snap.forEach(d => console.log(`  ${d.id}  font=${fontOf(d.data())}  token=${d.data()?.token ?? ''}`))
}

try {
  await dump('queue_history')
  await dump('queue_pending')

  const res = await getDocs(collection(db, 'font_reservations'))
  console.log(`\n=== font_reservations (${res.size} 筆) ===`)
  const now = Date.now()
  res.forEach(d => {
    const x = d.data()
    const active = typeof x.expiresAt === 'number' && x.expiresAt > now
    const leftSec = typeof x.expiresAt === 'number' ? Math.round((x.expiresAt - now) / 1000) : '?'
    console.log(`  font=${d.id}  owner=${String(x.owner).slice(0,8)}  ${active ? '有效' : '已過期'}  剩 ${leftSec}s`)
  })

  const cs = await getDoc(doc(db, 'system', 'current_state'))
  const lg = cs.exists() ? (cs.data()?.live_grid ?? []) : null
  console.log(`\n=== system/current_state.live_grid ===`)
  console.log('  mode:', cs.data()?.mode, ' live_grid 字:', Array.isArray(lg) ? lg.map(g => g?.style?.font).join(', ') : lg)
  process.exit(0)
} catch (e) {
  console.error('讀取失敗：', e?.code || '', e?.message || e)
  process.exit(1)
}
