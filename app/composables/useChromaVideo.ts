/**
 * useChromaVideo — 用 WebGL 即時對綠幕影片去背，輸出到透明 <canvas>。
 *
 * 採用 OBS 風格的 chroma key（在 UV 色度平面上量距離），支援：
 *   - playForward()：原生順向播放，邊播邊去背繪製，影片 ended 時 resolve。
 *   - playReverse()：瀏覽器 <video> 不支援負速率，故以手動 seek 倒退逐格繪製。
 *
 * 注意：canvas 的繪圖緩衝大小 = 影片原生尺寸，外觀靠 CSS object-fit 縮放。
 */

export interface ChromaVideoOptions {
  /** 要去背的鍵色（0~1 RGB），預設純綠 */
  keyColor?: [number, number, number]
  /** 色度距離小於此值 → 全透明 */
  similarity?: number
  /** similarity 之後的羽化過渡寬度 */
  smoothness?: number
  /** 溢色（spill）作用範圍：色度距離小於此值的像素會被拉向灰階去色 */
  spill?: number
}

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

// Production-ready chroma key（Jim Fisher / OBS）：在 YUV 色度平面量距離，
// 半透明邊緣的溢色處理採「拉向亮度灰階」而非壓綠通道——拉到中性灰永遠不會
// 殘留綠、也不會翻成洋紅/粉紅，這是半透明物件去色的正解。
const FRAG_SRC = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec3 u_key;
uniform float u_similarity;
uniform float u_smoothness;
uniform float u_spill;
varying vec2 v_uv;

vec2 RGBtoUV(vec3 c) {
  return vec2(
    c.r * -0.169 + c.g * -0.331 + c.b * 0.5 + 0.5,
    c.r *  0.5   + c.g * -0.419 + c.b * -0.081 + 0.5
  );
}

void main() {
  vec4 rgba = texture2D(u_tex, v_uv);

  // 色度距離 → 透明度：越接近鍵色越透明，並以 1.5 次方做柔邊
  float chromaDist = distance(RGBtoUV(rgba.rgb), RGBtoUV(u_key));
  float baseMask = chromaDist - u_similarity;
  rgba.a = pow(clamp(baseMask / u_smoothness, 0.0, 1.0), 1.5);

  // 溢色抑制：靠近鍵色的像素（含半透明邊緣）依距離拉向亮度灰階，
  // 去掉殘留色偏；遠離鍵色的前景則保留原色。
  float spillVal = pow(clamp(baseMask / u_spill, 0.0, 1.0), 1.5);
  float desat = clamp(dot(rgba.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  rgba.rgb = mix(vec3(desat), rgba.rgb, spillVal);

  gl_FragColor = rgba;
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader compile failed: ' + gl.getShaderInfoLog(sh))
  }
  return sh
}

export function useChromaVideo(opts: ChromaVideoOptions = {}) {
  const keyColor = opts.keyColor ?? [0.0, 1.0, 0.0]
  const similarity = opts.similarity ?? 0.4
  const smoothness = opts.smoothness ?? 0.08
  const spill = opts.spill ?? 0.12

  let gl: WebGLRenderingContext | null = null
  let tex: WebGLTexture | null = null
  let uTex: WebGLUniformLocation | null = null
  let video: HTMLVideoElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let raf = 0
  let ready = false

  function sizeCanvas() {
    if (!canvas || !video) return
    const w = video.videoWidth || 1280
    const h = video.videoHeight || 720
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    gl?.viewport(0, 0, w, h)
  }

  async function init(canvasEl: HTMLCanvasElement, videoEl: HTMLVideoElement): Promise<boolean> {
    canvas = canvasEl
    video = videoEl
    const ctx = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false
    })
    if (!ctx) return false
    gl = ctx

    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT_SRC))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('program link failed: ' + gl.getProgramInfoLog(prog))
    }
    gl.useProgram(prog)

    // 全螢幕兩個三角形
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    uTex = gl.getUniformLocation(prog, 'u_tex')
    gl.uniform1i(uTex, 0)
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_key'), keyColor)
    gl.uniform1f(gl.getUniformLocation(prog, 'u_similarity'), similarity)
    gl.uniform1f(gl.getUniformLocation(prog, 'u_smoothness'), smoothness)
    gl.uniform1f(gl.getUniformLocation(prog, 'u_spill'), spill)

    gl.clearColor(0, 0, 0, 0)

    if (video.readyState < 1) {
      await new Promise<void>(resolve => {
        const f = () => { video!.removeEventListener('loadedmetadata', f); resolve() }
        video!.addEventListener('loadedmetadata', f)
      })
    }
    sizeCanvas()
    ready = true
    return true
  }

  function drawFrame() {
    if (!gl || !video || !tex) return
    sizeCanvas()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    } catch {
      return
    }
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  function loop() {
    drawFrame()
    raf = requestAnimationFrame(loop)
  }

  /** 順向播放，邊播邊去背；影片 ended 時 resolve */
  function playForward(): Promise<void> {
    return new Promise(resolve => {
      if (!ready || !video) { resolve(); return }
      const v = video
      const done = () => {
        v.removeEventListener('ended', done)
        cancelAnimationFrame(raf)
        drawFrame()
        resolve()
      }
      v.addEventListener('ended', done)
      v.currentTime = 0
      v.playbackRate = 1
      v.muted = true
      cancelAnimationFrame(raf)
      loop()
      void v.play().catch(() => { /* 靜音仍失敗就讓 timeupdate/ended 善後 */ })
    })
  }

  /**
   * 倒退播放：總時長 ≈ 影片長度，且確實逐格顯示。
   * <video> 不支援負播放速率，故每一步用 wall-clock 算出要倒退到的目標時間
   * （讓總長貼近影片長度），但仍等該格 seeked（加逾時保險）才繪製——
   * 確保上傳的是已解碼好的影格、看得到反向。seek 快就多畫幾格、慢就略過幾格。
   */
  function playReverse(): Promise<void> {
    return new Promise(resolve => {
      if (!ready || !video) { resolve(); return }
      const v = video
      v.pause()
      cancelAnimationFrame(raf)
      const dur = v.duration || 0
      if (!isFinite(dur) || dur <= 0) { resolve(); return }
      const start = performance.now()

      // seek 到 t，等 seeked（或 120ms 逾時）後繪製，再呼叫 after
      const seekAndDraw = (t: number, after: () => void) => {
        let settled = false
        let timer = 0
        const onSeeked = () => {
          if (settled) return
          settled = true
          v.removeEventListener('seeked', onSeeked)
          clearTimeout(timer)
          drawFrame()
          after()
        }
        v.addEventListener('seeked', onSeeked)
        timer = window.setTimeout(onSeeked, 120)
        v.currentTime = t
      }

      const stepBack = () => {
        const remain = dur - (performance.now() - start) / 1000
        if (remain <= 0) {
          v.currentTime = 0
          drawFrame()
          resolve()
          return
        }
        seekAndDraw(remain, stepBack)
      }
      stepBack()
    })
  }

  function destroy() {
    cancelAnimationFrame(raf)
    ready = false
    gl = null
    tex = null
    video = null
    canvas = null
  }

  return { init, playForward, playReverse, drawFrame, destroy }
}
