/**
 * 抑制「[Intervention] Ignored attempt to cancel a touchstart event with cancelable=false」警告。
 *
 * 來源：第三方函式庫（如 Fabric.js 的 _onTouchStart）在 touchstart/touchmove 上呼叫
 * e.preventDefault() 時並未先檢查 e.cancelable。當手勢正在慣性捲動（fling）中，事件的
 * cancelable=false，瀏覽器會忽略該 preventDefault 並在 console 印出 intervention 警告。
 *
 * 對「不可取消」的事件而言，preventDefault() 本來就不會有任何效果；這裡在呼叫原生方法前
 * 先擋掉 cancelable=false 的情況，只是少印一行警告，不改變任何實際行為。
 */
export default defineNuxtPlugin(() => {
  if (typeof Event === 'undefined') return
  const proto = Event.prototype
  const original = proto.preventDefault
  proto.preventDefault = function (this: Event) {
    if (this.cancelable === false) return
    return original.call(this)
  }
})
