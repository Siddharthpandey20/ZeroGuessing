import { useEffect, useRef } from 'react'

/**
 * The atmosphere: slow fog, a hex lattice that surfaces in patches, and drifting dust.
 * One fragment shader on a full-screen triangle (no 3D library). Colours come from the design tokens,
 * resolution is capped, it pauses off-screen or in a hidden tab, and reduced motion gets one still frame.
 * If WebGL is unavailable the container's CSS gradient shows instead.
 */

const FRAG = `
precision mediump float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse;
uniform vec3 uHaze; uniform vec3 uHaze2; uniform vec3 uLight; uniform vec3 uInk;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*noise(p); p = p*2.03 + 7.1; a *= 0.5; } return v; }
float hexDist(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
vec4 hexCoords(vec2 uv){ vec2 r = vec2(1.0, 1.7320508); vec2 h = r*0.5;
  vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h; vec2 gv = dot(a,a) < dot(b,b) ? a : b; return vec4(gv, uv - gv); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;
  float t = uTime * 0.035;
  vec3 col = mix(uHaze2, uHaze, smoothstep(-0.25, 1.15, uv.x*0.55 + uv.y*0.75));
  float f = fbm(p*1.35 + vec2(t, -t*0.55) + uMouse*0.04);
  col = mix(col, uLight, smoothstep(0.38, 0.98, f) * 0.42);
  vec4 hc = hexCoords(p*6.2 + uMouse*0.12);
  float edge = smoothstep(0.455, 0.5, hexDist(hc.xy));
  float patchy = smoothstep(0.52, 0.78, fbm(hc.zw*0.21 + vec2(t*1.7, t)));
  col = mix(col, uLight, edge * patchy * 0.26);
  col = mix(col, uInk, edge * patchy * 0.035);
  for (int k = 0; k < 3; k++){
    float fk = float(k);
    vec2 g = p * (9.0 + fk*5.0) + vec2(t*(2.0+fk), t*(5.0+fk*2.0)) + uMouse*(0.08 + fk*0.05);
    vec2 id = floor(g); vec2 fp = fract(g) - 0.5;
    vec2 off = (vec2(hash(id + fk), hash(id + 3.7 + fk)) - 0.5) * 0.7;
    float d = length(fp - off);
    float on = step(0.88, hash(id + 11.3 + fk));
    float tw = 0.55 + 0.45*sin(uTime*(0.6 + hash(id)*1.4) + hash(id+5.0)*6.28);
    col = mix(col, uLight, on * smoothstep(0.055 - fk*0.012, 0.0, d) * tw * (0.75 - fk*0.18));
  }
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}`

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`

/** Resolve a CSS colour token (any syntax the browser knows, OKLCH included) to linear-ish RGB 0..1. */
function tokenRGB(el: Element, name: string): [number, number, number] {
  const value = getComputedStyle(el).getPropertyValue(name).trim() || '#a8b6bd'
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return [r / 255, g / 255, b / 255]
}

export function Haze({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', premultipliedAlpha: false })
    if (!gl) return

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const u = (n: string) => gl.getUniformLocation(prog, n)
    const uRes = u('uRes'), uTime = u('uTime'), uMouse = u('uMouse')
    const root = document.documentElement
    gl.uniform3fv(u('uHaze'), tokenRGB(root, '--color-haze'))
    gl.uniform3fv(u('uHaze2'), tokenRGB(root, '--color-haze-2'))
    gl.uniform3fv(u('uLight'), tokenRGB(root, '--color-paper-2'))
    gl.uniform3fv(u('uInk'), tokenRGB(root, '--color-ink'))

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.7
    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * scale))
      const h = Math.max(1, Math.round(canvas.clientHeight * scale))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
      gl.uniform2f(uRes, w, h)
    }

    let mx = 0, my = 0, tx = 0, ty = 0
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2
      ty = (e.clientY / window.innerHeight - 0.5) * -2
    }

    let raf = 0, visible = true, start = performance.now()
    const frame = (now: number) => {
      mx += (tx - mx) * 0.04
      my += (ty - my) * 0.04
      gl.uniform1f(uTime, (now - start) / 1000 + 40)
      gl.uniform2f(uMouse, mx, my)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(frame)
    }
    const play = () => {
      cancelAnimationFrame(raf)
      if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(frame)
    }

    resize()
    frame(start)
    canvas.dataset.ready = 'true'

    const ro = new ResizeObserver(() => {
      resize()
      if (reduce) frame(performance.now())
    })
    ro.observe(canvas)
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      play()
    })
    io.observe(canvas)
    const onVis = () => play()
    document.addEventListener('visibilitychange', onVis)
    if (!reduce) window.addEventListener('pointermove', onMove, { passive: true })
    start = performance.now()
    play()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointermove', onMove)
      // Free GL objects but keep the context alive: getContext() on the same canvas returns this same
      // context on a remount (React StrictMode mounts twice in dev), and a lost one would render nothing.
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
    }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
