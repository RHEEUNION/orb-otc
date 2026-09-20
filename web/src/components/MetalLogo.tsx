import { useEffect, useRef, useState } from "react";

/**
 * The Orbinum mark rendered as liquid chrome. The mark's shape (from the official SVG) is used as a mask; a blurred
 * copy of it becomes a height field, whose slope gives surface normals. A shader reflects a slowly moving noise
 * environment off that surface and adds warm highlights along the steep edges. Falls back to a CSS silver sheen
 * without WebGL, and renders a single still frame when the user prefers reduced motion.
 */

const N = 512; // mask texture size
const VERT = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform float uTime;
varying vec2 v;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return s;
}

void main(){
  vec2 uv = vec2(v.x, 1.0 - v.y);
  vec4 t = texture2D(uTex, uv);
  float mask = t.r;
  if (mask < 0.004) { gl_FragColor = vec4(0.0); return; }

  float px = 1.0 / ${N}.0;
  float hxa = texture2D(uTex, uv + vec2(px * 3.0, 0.0)).g - texture2D(uTex, uv - vec2(px * 3.0, 0.0)).g;
  float hya = texture2D(uTex, uv + vec2(0.0, px * 3.0)).g - texture2D(uTex, uv - vec2(0.0, px * 3.0)).g;
  float hxb = texture2D(uTex, uv + vec2(px * 9.0, 0.0)).b - texture2D(uTex, uv - vec2(px * 9.0, 0.0)).b;
  float hyb = texture2D(uTex, uv + vec2(0.0, px * 9.0)).b - texture2D(uTex, uv - vec2(0.0, px * 9.0)).b;
  vec2 grad = vec2(hxa, hya) * 9.0 + vec2(hxb, hyb) * 7.0;

  // slow liquid flow bends the normals
  float T = uTime * 0.16;
  vec2 flow = vec2(fbm(uv * 2.6 + vec2(T, 0.0)), fbm(uv * 2.6 + vec2(7.3, -T))) - 0.5;
  vec3 n = normalize(vec3(-grad + flow * 0.9, 1.0));

  // Region split, measured in hexagon units from the mark's centre (1.0 = outer edge of the frame).
  vec2 p = (uv - 0.5) * ${N}.0 / 220.0;
  float hn = max(abs(p.x) / 0.866, abs(p.x) * 0.5774 + abs(p.y));
  float frame = smoothstep(0.71, 0.77, hn);

  // Liquid chrome for the inner pieces: near-black steel with sharp, drifting white streaks.
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float warp = fbm(uv * 3.2 + T * 2.0) * 3.2;
  float bands = sin(r.x * 7.0 + r.y * 4.0 + warp + uTime * 0.25);
  float streak = smoothstep(-0.3, 0.8, bands);
  float spec = pow(max(dot(n, normalize(vec3(-0.5, 0.7, 0.55))), 0.0), 60.0);
  vec3 chrome = mix(vec3(0.03, 0.035, 0.05), vec3(0.84, 0.86, 0.9), streak * streak * 0.95 + streak * 0.1) + spec * 0.8;

  // Hot orange flares on the steep edges of the inner pieces.
  float steep = smoothstep(0.1, 0.3, length(grad));
  float hot = smoothstep(0.7, 0.95, noise(uv * 8.0 + vec2(uTime * 0.3, -uTime * 0.17)));
  chrome += vec3(1.0, 0.5, 0.12) * steep * hot * 0.95;

  // The outer frame is flat polished white with a faint drifting sheen.
  vec3 white = vec3(0.965, 0.972, 0.985) + 0.035 * sin(uv.x * 9.0 + uv.y * 6.0 + uTime * 0.4);

  vec3 col = mix(chrome, white, frame);
  gl_FragColor = vec4(col * mask, mask);
}`;

function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * n + Math.min(n - 1, Math.max(0, x))];
    for (let x = 0; x < n; x++) {
      tmp[y * n + x] = sum / w;
      sum += src[y * n + Math.min(n - 1, x + r + 1)] - src[y * n + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < n; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(n - 1, Math.max(0, y)) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = sum / w;
      sum += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x];
    }
  }
  return out;
}
const blur = (a: Float32Array, r: number) => boxBlur(boxBlur(boxBlur(a, N, r), N, r), N, r);

function loadMark(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Rasterises the mark into RGBA: R = crisp mask, G = fine height, B = broad height. */
async function buildTexture(src: string): Promise<Uint8Array> {
  const img = await loadMark(src);
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  const ratio = 577.35 / 500;
  const h = N * 0.86;
  const w = h / ratio;
  ctx.drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
  const px = ctx.getImageData(0, 0, N, N).data;
  const mask = new Float32Array(N * N);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] / 255;
  const fine = blur(mask, 4);
  const broad = blur(mask, 11);
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < mask.length; i++) {
    out[i * 4] = Math.round(mask[i] * 255);
    out[i * 4 + 1] = Math.round(fine[i] * 255);
    out[i * 4 + 2] = Math.round(broad[i] * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function MetalLogo({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) {
      setFallback(true);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    let alive = true;

    const shader = (type: number, code: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };

    buildTexture(src)
      .then((data) => {
        if (!alive) return;
        const prog = gl.createProgram()!;
        gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, "p");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const uTime = gl.getUniformLocation(prog, "uTime");
        gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);

        const resize = () => {
          const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
          const w = Math.round(canvas.clientWidth * dpr);
          const h = Math.round(canvas.clientHeight * dpr);
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          gl.viewport(0, 0, canvas.width, canvas.height);
        };
        const draw = (t: number) => {
          resize();
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.uniform1f(uTime, t);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        const frame = (ts: number) => {
          raf = requestAnimationFrame(frame);
          if (document.hidden || ts - last < 33) return;
          last = ts;
          draw(ts / 1000);
        };
        if (reduce) draw(6);
        else raf = requestAnimationFrame(frame);
      })
      .catch(() => alive && setFallback(true));

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [src]);

  if (fallback) return <div className="metal metal-fallback" style={{ ["--mark" as string]: `url(${src})` }} role="img" aria-label="Orbinum" />;
  return <canvas ref={ref} className="metal" role="img" aria-label="Orbinum" />;
}
