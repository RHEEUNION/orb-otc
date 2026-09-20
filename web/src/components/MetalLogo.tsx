import { useEffect, useRef, useState } from "react";

/**
 * Liquid-metal rendering of a logo mark, following the "MetallicPaint" technique (React Bits, MIT + Commons Clause,
 * https://reactbits.dev). Two stages:
 *  1. CPU: rasterise the mark, mark its boundary, then relax a Poisson equation inside it (successive
 *     over-relaxation, 200 passes) to get a smooth "inflated" depth field. This is what gives the flowing,
 *     puffy chrome look instead of a flat bevel.
 *  2. GPU (WebGL2): a fragment shader turns that depth into drifting bands and separates the red, green and blue
 *     channels slightly (chromatic spread), which produces the warm and cool fringes on the edges.
 * Falls back to a CSS silver sheen without WebGL2, and renders one still frame for reduced motion.
 */

// Parameters used for the Orbinum mark.
const P = {
  seed: 42, scale: 4, refraction: 0.01, blur: 0.015, liquid: 0.75, speed: 0.3, brightness: 2, contrast: 0.5,
  angle: 0, fresnel: 1, sharp: 1, wave: 1, noise: 0.5, chroma: 2, distort: 1, contour: 0.2,
  light: [1, 1, 1], dark: [0, 0, 0], tint: [1, 1, 1],
};

const VERT = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 vP;
void main(){ vP = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 oC;
uniform sampler2D u_tex;
uniform float u_time, u_ratio, u_imgRatio, u_seed, u_scale, u_refract, u_blur, u_liquid;
uniform float u_bright, u_contrast, u_angle, u_fresnel, u_sharp, u_wave, u_noise, u_chroma;
uniform float u_distort, u_contour;
uniform vec3 u_lightColor, u_darkColor, u_tint;

vec3 sC, sM;

vec3 pW(vec3 v){
  vec3 i = floor(v), f = fract(v), s = sign(fract(v * 0.5) - 0.5), h = fract(sM * i + i.yzx), c = f * (f - 1.0);
  return s * c * ((h * 16.0 - 4.0) * c - 1.0);
}
vec3 aF(vec3 b, vec3 c){ return pW(b + c.zxy - pW(b.zxy + c.yzx) + pW(b.yzx + c.xyz)); }
vec3 lM(vec3 s, vec3 p){ return (p + aF(s, p)) * 0.5; }

vec2 fitImage(){
  vec2 c = vP - 0.5;
  c.x *= u_ratio > u_imgRatio ? u_ratio / u_imgRatio : 1.0;
  c.y *= u_ratio > u_imgRatio ? 1.0 : u_imgRatio / u_ratio;
  return vec2(c.x + 0.5, 0.5 - c.y);
}
vec2 rot(vec2 p, float r){ float c = cos(r), s = sin(r); return vec2(p.x * c + p.y * s, p.y * c - p.x * s); }
float borderMask(vec2 c, float t){
  vec2 l = smoothstep(vec2(0.0), vec2(t), c), u = smoothstep(vec2(0.0), vec2(t), 1.0 - c);
  return l.x * l.y * u.x * u.y;
}

// Banded mix between the light and dark colour: a few sharp stripes and a soft tail.
float bands(float hi, float lo, float t, float sh, float cv){
  sh *= (2.0 - u_sharp);
  float ci = smoothstep(0.15, 0.85, cv), r = lo;
  float e1 = 0.08 / u_scale;
  r = mix(r, hi, smoothstep(0.0, sh * 1.5, t));
  r = mix(r, lo, smoothstep(e1 - sh, e1 + sh, t));
  float e2 = e1 + 0.05 / u_scale * (1.0 - ci * 0.35);
  r = mix(r, hi, smoothstep(e2 - sh, e2 + sh, t));
  float e3 = e2 + 0.025 / u_scale * (1.0 - ci * 0.45);
  r = mix(r, lo, smoothstep(e3 - sh, e3 + sh, t));
  float e4 = e1 + 0.1 / u_scale;
  r = mix(r, hi, smoothstep(e4 - sh, e4 + sh, t));
  float rm = 1.0 - e4, gT = clamp((t - e4) / rm, 0.0, 1.0);
  r = mix(r, mix(hi, lo, smoothstep(0.0, 1.0, gT)), smoothstep(e4 - sh * 0.5, e4 + sh * 0.5, t));
  return r;
}

void main(){
  sC = fract(vec3(0.7548, 0.5698, 0.4154) * (u_seed + 17.31)) + 0.5;
  sM = fract(sC.zxy - sC.yzx * 1.618);
  vec2 sc = vec2(vP.x * u_ratio, 1.0 - vP.y);
  float angleRad = u_angle * 3.14159 / 180.0;
  sc = rot(sc - 0.5, angleRad) + 0.5;
  sc = clamp(sc, 0.0, 1.0);
  float sl = sc.x - sc.y, an = u_time * 0.001;
  vec2 iC = fitImage();
  vec4 texSample = texture(u_tex, iC);
  float dp = texSample.r;          // depth: 1 at the edge, falling towards the thick middle of each stroke
  float shapeMask = texSample.a;
  vec3 hi = u_lightColor * u_bright;
  vec3 lo = u_darkColor * (2.0 - u_bright);
  lo.b += smoothstep(0.6, 1.4, sc.x + sc.y) * 0.08;
  vec2 fC = sc - 0.5;
  float rd = length(fC + vec2(0.0, sl * 0.15));
  vec2 ag = rot(fC, (0.22 - sl * 0.18) * 3.14159);
  float cv = 1.0 - pow(rd * 1.65, 1.15);
  cv *= pow(sc.y, 0.35);
  float vs = shapeMask;
  vs *= borderMask(iC, 0.01);
  float fr = pow(1.0 - cv, u_fresnel) * 0.3;
  vs = min(vs + fr * vs, 1.0);
  float mT = an * 0.0625;
  vec3 wO = vec3(-1.05, 1.35, 1.55);
  vec3 wA = aF(vec3(31.0, 73.0, 56.0), mT + wO) * 0.22 * u_wave;
  vec3 wB = aF(vec3(24.0, 64.0, 42.0), mT - wO.yzx) * 0.22 * u_wave;
  vec2 nC = sc * 45.0 * u_noise;
  nC += aF(sC.zxy, an * 0.17 * sC.yzx - sc.yxy * 0.35).xy * 18.0 * u_wave;
  vec3 tC = vec3(0.00041, 0.00053, 0.00076) * mT + wB * nC.x + wA * nC.y;
  tC = lM(sC, tC);
  tC = lM(sC + 1.618, tC);
  float tb = sin(tC.x * 3.14159) * 0.5 + 0.5;
  tb = tb * 2.0 - 1.0;
  float noiseVal = pW(vec3(sc * 8.0 + an, an * 0.5)).x;
  float edgeFactor = smoothstep(0.0, 0.5, dp) * smoothstep(1.0, 0.5, dp);
  float lD = dp + (1.0 - dp) * u_liquid * tb;
  lD += noiseVal * u_distort * 0.15 * edgeFactor;
  float rB = clamp(1.0 - cv, 0.0, 1.0);
  float fl = ag.x + sl;
  fl += noiseVal * sl * u_distort * edgeFactor;
  fl *= mix(1.0, 1.0 - dp * 0.5, u_contour);
  fl -= dp * u_contour * 0.8;
  float eI = smoothstep(0.0, 1.0, lD) * smoothstep(1.0, 0.0, lD);
  fl -= tb * sl * 1.8 * eI;
  float cA = cv * clamp(pow(sc.y, 0.12), 0.25, 1.0);
  fl *= 0.12 + (1.05 - lD) * cA;
  fl *= smoothstep(1.0, 0.65, lD);
  float vA1 = smoothstep(0.08, 0.18, sc.y) * smoothstep(0.38, 0.18, sc.y);
  float vA2 = smoothstep(0.08, 0.18, 1.0 - sc.y) * smoothstep(0.38, 0.18, 1.0 - sc.y);
  fl += vA1 * 0.16 + vA2 * 0.025;
  fl *= 0.45 + pow(sc.y, 2.0) * 0.55;
  fl *= u_scale;
  fl -= an;
  float rO = rB + cv * tb * 0.025;
  float vM1 = smoothstep(-0.12, 0.18, sc.y) * smoothstep(0.48, 0.08, sc.y);
  float cM1 = smoothstep(0.35, 0.55, cv) * smoothstep(0.95, 0.35, cv);
  rO += vM1 * cM1 * 4.5;
  rO -= sl;
  float bO = rB * 1.25;
  float vM2 = smoothstep(-0.02, 0.35, sc.y) * smoothstep(0.75, 0.08, sc.y);
  float cM2 = smoothstep(0.35, 0.55, cv) * smoothstep(0.75, 0.35, cv);
  bO += vM2 * cM2 * 0.9;
  bO -= lD * 0.18;
  rO *= u_refract * u_chroma;
  bO *= u_refract * u_chroma;
  float sf = u_blur;
  float rP = fract(fl + rO);
  float rC = bands(hi.r, lo.r, rP, sf + 0.018 + u_refract * cv * 0.025, cv);
  float gP = fract(fl);
  float gC = bands(hi.g, lo.g, gP, sf + 0.008 / max(0.01, 1.0 - sl), cv);
  float bP = fract(fl - bO);
  float bC = bands(hi.b, lo.b, bP, sf + 0.008, cv);
  vec3 col = vec3(rC, gC, bC);
  col = (col - 0.5) * u_contrast + 0.5;
  col = clamp(col, 0.0, 1.0);
  col = mix(col, 1.0 - min(vec3(1.0), (1.0 - col) / max(u_tint, vec3(0.001))), length(u_tint - 1.0) * 0.5);
  col = clamp(col, 0.0, 1.0);
  oC = vec4(col * vs, vs);
}`;

const W = 640;
const H = 740;

/** Stage 1: rasterise the mark and solve for its depth field. Returns RGBA pixels for the shader texture. */
async function buildDepthTexture(src: string): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const ratio = 577.35 / 500;
  const ch = H * 0.8;
  const cw = ch / ratio;
  ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch);
  const px = ctx.getImageData(0, 0, W, H).data;

  const n = W * H;
  const alpha = new Float32Array(n);
  const inside = new Uint8Array(n);
  const boundary = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3];
    alpha[i] = a < 5 ? 0 : a / 255;
    inside[i] = alpha[i] > 0.1 ? 1 : 0;
  }
  const interior: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!inside[i]) continue;
      if (x === 0 || x === W - 1 || y === 0 || y === H - 1 || !inside[i - 1] || !inside[i + 1] || !inside[i - W] || !inside[i + W]) boundary[i] = 1;
      else interior.push(i);
    }
  }
  const idx = Int32Array.from(interior);

  // Successive over-relaxation of  laplacian(u) = -0.01  with u = 0 on the boundary.
  const u = new Float32Array(n);
  const w = 1.85;
  for (let pass = 0; pass < 200; pass++) {
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const sum = (inside[i + 1] ? u[i + 1] : 0) + (inside[i - 1] ? u[i - 1] : 0) + (inside[i + W] ? u[i + W] : 0) + (inside[i - W] ? u[i - W] : 0);
      u[i] = w * ((0.01 + sum) / 4) + (1 - w) * u[i];
    }
  }
  let max = 0;
  for (let i = 0; i < n; i++) if (u[i] > max) max = u[i];
  if (max === 0) max = 1;

  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const d = u[i] / max;
    const v = Math.round(255 * (1 - d * d));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = Math.round(alpha[i] * 255);
  }
  return out;
}

export function MetalLogo({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) {
      setFallback(true);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let alive = true;

    const compile = (type: number, code: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };

    buildDepthTexture(src)
      .then((pixels) => {
        if (!alive) return;
        const prog = gl.createProgram()!;
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, "a_position");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        const U = (name: string) => gl.getUniformLocation(prog, name);
        gl.uniform1i(U("u_tex"), 0);
        gl.uniform1f(U("u_imgRatio"), W / H);
        gl.uniform1f(U("u_ratio"), 1);
        gl.uniform1f(U("u_seed"), P.seed);
        gl.uniform1f(U("u_scale"), P.scale);
        gl.uniform1f(U("u_refract"), P.refraction);
        gl.uniform1f(U("u_blur"), P.blur);
        gl.uniform1f(U("u_liquid"), P.liquid);
        gl.uniform1f(U("u_bright"), P.brightness);
        gl.uniform1f(U("u_contrast"), P.contrast);
        gl.uniform1f(U("u_angle"), P.angle);
        gl.uniform1f(U("u_fresnel"), P.fresnel);
        gl.uniform1f(U("u_sharp"), P.sharp);
        gl.uniform1f(U("u_wave"), P.wave);
        gl.uniform1f(U("u_noise"), P.noise);
        gl.uniform1f(U("u_chroma"), P.chroma);
        gl.uniform1f(U("u_distort"), P.distort);
        gl.uniform1f(U("u_contour"), P.contour);
        gl.uniform3f(U("u_lightColor"), P.light[0], P.light[1], P.light[2]);
        gl.uniform3f(U("u_darkColor"), P.dark[0], P.dark[1], P.dark[2]);
        gl.uniform3f(U("u_tint"), P.tint[0], P.tint[1], P.tint[2]);
        const uTime = U("u_time");

        const size = Math.round(Math.min(1000, canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2)) || 800);
        canvas.width = size;
        canvas.height = size;
        gl.viewport(0, 0, size, size);
        gl.clearColor(0, 0, 0, 0);

        const draw = (t: number) => {
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.uniform1f(uTime, t);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        if (reduce) {
          draw(9000);
          return;
        }
        let t = 0;
        let last = performance.now();
        const frame = (now: number) => {
          raf = requestAnimationFrame(frame);
          if (document.hidden) {
            last = now;
            return;
          }
          t += (now - last) * P.speed;
          last = now;
          draw(t);
        };
        raf = requestAnimationFrame(frame);
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
