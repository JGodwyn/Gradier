import { arcSamples, samplePath, type Vec } from './geometry';
import { encodeSrgb, oklabToLinear, pointLab } from './color';
import { ARM_LENGTH, look, MAX_POINTS, type BlendMode, type Gradient } from './types';

/** Samples per curve in the path texture. */
const PATH_N = 32;

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform int u_count;
uniform vec2 u_pos[${MAX_POINTS}];
// each point's colour (already filtered) in OKLab, linear RGB and sRGB
uniform vec3 u_col[${MAX_POINTS}];
uniform vec3 u_colLin[${MAX_POINTS}];
uniform vec3 u_colSrgb[${MAX_POINTS}];
// x: kind (0 point, 1 curve), y: radius multiplier, z: number of curve samples
uniform vec3 u_meta[${MAX_POINTS}];
// curve width multipliers at the start (x) and end (y)
uniform vec2 u_ends[${MAX_POINTS}];
// arm angles (sorted ascending, [0, 2pi)) and lengths
uniform vec4 u_armAng[${MAX_POINTS}];
uniform vec4 u_armLen[${MAX_POINTS}];
// curve samples: one row per point, 16-bit x/y packed into RGBA
uniform sampler2D u_paths;
// per-point falloff exponent (lower = softer)
uniform float u_power[${MAX_POINTS}];
// Per-point opacity.
uniform float u_alpha[${MAX_POINTS}];
// Per-point blend mode: x = mixing space (0 OKLab, 1 linear RGB, 2 sRGB),
// y = contrast curve (0 none, 1 screen, 2 multiply, 3 overlay, 4 soft light)
uniform vec2 u_mode[${MAX_POINTS}];
uniform float u_warp;
uniform float u_warpScale;
uniform float u_grain;
// x: type (0 mono, 1 duo, 2 multi), y: cell size in device pixels, z: density
uniform vec3 u_grainOpts;

const int PATH_N = ${PATH_N};

// Simplex noise (Ashima Arts / Stefan Gustavson, MIT)
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

const float TAU = 6.28318530718;
const float ARM0 = ${ARM_LENGTH.toFixed(4)};

// Reach scale for direction d inside the cone between two neighbouring arms (angles a0 < a1, lengths l0, l1).
// Expresses d in the basis of the two arm vectors, so perpendicular arms give an exact ellipse.
float coneScale(vec2 d, float a0, float a1, float l0, float l1) {
  vec2 A = l0 * vec2(cos(a0), sin(a0));
  vec2 B = l1 * vec2(cos(a1), sin(a1));
  float det = A.x * B.y - A.y * B.x;
  if (abs(det) < 1e-6 * l0 * l1 || a1 - a0 > 3.05) {
    // Arms (nearly) opposite: blend the lengths by angle instead.
    float th = atan(d.y, d.x);
    if (th < a0) th += TAU;
    float t = clamp((th - a0) / max(a1 - a0, 1e-4), 0.0, 1.0);
    return ARM0 / max(mix(l0, l1, t * t * (3.0 - 2.0 * t)), 1e-3);
  }
  float s = (d.x * B.y - d.y * B.x) / det;
  float t = (A.x * d.y - A.y * d.x) / det;
  return length(vec2(s, t)) * ARM0 / length(d);
}

// How much the distance in direction d is scaled by the point's four arms (1.0 for the default cross).
float armScale(vec2 d, vec4 a, vec4 l) {
  if (dot(d, d) < 1e-12) return 1.0;
  float th = atan(d.y, d.x);
  if (th < 0.0) th += TAU;
  if (th < a.x) th += TAU;
  if (th < a.y) return coneScale(d, a.x, a.y, l.x, l.y);
  if (th < a.z) return coneScale(d, a.y, a.z, l.y, l.z);
  if (th < a.w) return coneScale(d, a.z, a.w, l.z, l.w);
  return coneScale(d, a.w, a.x + TAU, l.w, l.x);
}

vec2 pathPoint(int i, int k) {
  vec4 t = texture2D(u_paths, vec2((float(k) + 0.5) / float(PATH_N), (float(i) + 0.5) / float(${MAX_POINTS})));
  vec2 v = vec2(t.r * 65280.0 + t.g * 255.0, t.b * 65280.0 + t.a * 255.0) / 65535.0;
  return v * 2.0 - 0.5;
}

// Sine-free hashes (after Dave Hoskins, MIT). The classic fract(sin(dot(...)) * 43758.5453) loses precision on
// many GPUs once pixel coordinates get large, which shows up as diagonal stripes in the grain.
vec4 hash42(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
// Two independent rounds so neighbouring cells don't share structure.
vec4 grainNoise(vec2 cell, float seed) {
  vec4 a = hash42(cell + seed * vec2(37.17, 91.73));
  return hash42(a.xy * 4096.0 + a.zw * 512.0 + cell.yx);
}

vec3 oklabToLinear(vec3 c) {
  float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  float l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 scale = vec2(sqrt(aspect), 1.0 / sqrt(aspect));
  vec2 uv = v_uv;
  float freq = mix(0.8, 6.0, u_warpScale);
  vec2 n = vec2(snoise(uv * scale * freq + u_time * 0.15), snoise(uv * scale * freq + 17.3 - u_time * 0.15));
  uv += n * u_warp * 0.22;
  vec2 q = uv * scale;

  vec3 sum = vec3(0.0), sumLin = vec3(0.0), sumSrgb = vec3(0.0);
  // Colours mix by influence × opacity, so a see-through point fades out instead of tinting its neighbours.
  float total = 0.0, totalC = 0.0;
  float ws[${MAX_POINTS}];
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (i >= u_count) break;
    vec3 meta = u_meta[i];
    float dist;
    if (meta.x < 0.5) {
      vec2 d = q - u_pos[i] * scale;
      dist = length(d) * armScale(d, u_armAng[i], u_armLen[i]);
    } else {
      // Distance to the curve, divided by the curve's width at the nearest spot.
      dist = 1e9;
      vec2 prev = pathPoint(i, 0) * scale;
      for (int k = 1; k < PATH_N; k++) {
        if (float(k) >= meta.z) break;
        vec2 cur = pathPoint(i, k) * scale;
        vec2 ab = cur - prev;
        float t = clamp(dot(q - prev, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
        float along = (float(k - 1) + t) / max(meta.z - 1.0, 1.0);
        float width = mix(u_ends[i].x, u_ends[i].y, along);
        dist = min(dist, length(q - prev - ab * t) / width);
        prev = cur;
      }
    }
    dist /= meta.y;
    float w = pow(dist * dist + 1e-5, -u_power[i] * 0.5);
    float wc = w * u_alpha[i];
    ws[i] = wc;
    sum += u_col[i] * wc;
    sumLin += u_colLin[i] * wc;
    sumSrgb += u_colSrgb[i] * wc;
    total += w;
    totalC += wc;
  }
  float alpha = totalC / total;
  totalC = max(totalC, 1e-6);

  // Colours arrive already filtered; mix them in the chosen space.
  // The blend in each mixing space, as display sRGB.
  vec3 inOklab = linearToSrgb(oklabToLinear(sum / totalC));
  vec3 inLinear = linearToSrgb(sumLin / totalC);
  vec3 inSrgb = clamp(sumSrgb / totalC, 0.0, 1.0);
  // Each point applies its own blend mode, weighted by its influence here, so a mode set on one node shows around
  // that node and fades into its neighbours. With one mode everywhere this is exactly that mode.
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (i >= u_count) break;
    vec2 m = u_mode[i];
    vec3 c = m.x < 0.5 ? inOklab : m.x < 1.5 ? inLinear : inSrgb;
    if (m.y > 3.5) c = c * c * (3.0 - 2.0 * c);
    else if (m.y > 2.5) c = mix(2.0 * c * c, 1.0 - 2.0 * (1.0 - c) * (1.0 - c), step(0.5, c));
    else if (m.y > 1.5) c = c * c;
    else if (m.y > 0.5) c = 1.0 - (1.0 - c) * (1.0 - c);
    col += c * (ws[i] / totalC);
  }

  // Film grain: every value comes from its own channel of an independent hash, so there is no shared pattern.
  float seed = floor(fract(u_time) * 64.0);
  vec2 cell = floor(gl_FragCoord.xy / max(u_grainOpts.y, 1.0));
  vec4 h1 = grainNoise(cell, seed);
  vec4 h2 = grainNoise(cell + vec2(1913.0, 2971.0), seed);
  float amount = u_grain * 0.3 * max(u_grainOpts.z, 1.0);
  float coverage = step(h2.w, min(u_grainOpts.z, 1.0));
  // Sum of two uniforms: a soft, film-like distribution in [-1, 1] instead of a flat one.
  float r = (h1.x + h2.x - 1.0);
  vec3 grain = vec3(r);
  if (u_grainOpts.x > 1.5) {
    grain = vec3(h1.x + h2.x, h1.y + h2.y, h1.z + h2.z) - 1.0;
  } else if (u_grainOpts.x > 0.5) {
    grain = vec3(r) + (h1.y + h2.y - 1.0) * vec3(0.6, 0.1, -0.6);
  }
  col += grain * amount * coverage;
  // Tiny per-pixel dither against banding.
  col += (hash42(gl_FragCoord.xy + 0.5 + seed * 7.0).w - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(col, alpha);
}`;

const DEFAULT_ARMS: Array<[number, number]> = [
  [ARM_LENGTH, 0],
  [0, ARM_LENGTH],
  [-ARM_LENGTH, 0],
  [0, -ARM_LENGTH],
];

const GRAIN_TYPES = { mono: 0, duo: 1, multi: 2 } as const;

/** Blend mode → [mixing space, contrast curve] (see u_mode in the shader). */
const BLEND: Record<BlendMode, [number, number]> = {
  oklab: [0, 0],
  linear: [1, 0],
  normal: [2, 0],
  screen: [0, 1],
  multiply: [0, 2],
  overlay: [0, 3],
  softlight: [0, 4],
};

/** Renders a mesh gradient into a canvas with WebGL. */
export class MeshRenderer {
  readonly gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private gradient: Gradient | null = null;
  private time = 0;
  private pixelScale = 1;
  private pathTex: WebGLTexture;
  private pathData = new Uint8Array(PATH_N * MAX_POINTS * 4);

  static create(canvas: HTMLCanvasElement): MeshRenderer | null {
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    try {
      return new MeshRenderer(gl);
    } catch (err) {
      console.warn('[gradier] WebGL init failed, using CSS fallback.', err);
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    this.program = p;
    gl.useProgram(p);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.pathTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.pathTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    for (const name of [
      'u_res', 'u_time', 'u_count', 'u_pos', 'u_col', 'u_meta', 'u_ends', 'u_armAng', 'u_armLen', 'u_paths',
      'u_power', 'u_alpha', 'u_colLin', 'u_colSrgb', 'u_mode', 'u_warp', 'u_warpScale', 'u_grain', 'u_grainOpts',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(p, name);
    }
  }

  setGradient(g: Gradient) {
    this.gradient = g;
  }

  setTime(t: number) {
    this.time = t;
  }

  /** Device pixels per CSS pixel, used to size the grain. Read from the canvas when it is in the page. */
  setPixelScale(s: number) {
    this.pixelScale = s;
  }

  render() {
    const { gl, gradient: g } = this;
    if (!g || gl.isContextLost()) return;
    const canvas = gl.canvas as HTMLCanvasElement;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.program);
    const u = this.uniforms;
    const count = Math.min(g.points.length, MAX_POINTS);
    const pos = new Float32Array(MAX_POINTS * 2);
    const col = new Float32Array(MAX_POINTS * 3);
    const meta = new Float32Array(MAX_POINTS * 3);
    const ends = new Float32Array(MAX_POINTS * 2).fill(1);
    const armAng = new Float32Array(MAX_POINTS * 4);
    const armLen = new Float32Array(MAX_POINTS * 4).fill(ARM_LENGTH);
    const t = this.time;
    const drift = g.speed > 0 ? 0.06 : 0;
    const aspect = (canvas.width || 1) / (canvas.height || 1);
    const sx = Math.sqrt(aspect);
    const sy = 1 / sx;
    const toScaled = (p: Vec, dx: number, dy: number) => ({ x: (p.x + dx) * sx, y: (p.y + dy) * sy });
    const data = this.pathData;
    const colLin = new Float32Array(MAX_POINTS * 3);
    const colSrgb = new Float32Array(MAX_POINTS * 3);
    const mode = new Float32Array(MAX_POINTS * 2);
    const power = new Float32Array(MAX_POINTS).fill(3.75);
    const alpha = new Float32Array(MAX_POINTS).fill(1);
    g.points.slice(0, count).forEach((pt, i) => {
      const dx = drift * Math.sin(t * 0.6 + i * 1.7);
      const dy = drift * Math.cos(t * 0.5 + i * 2.3);
      pos[i * 2] = pt.x + dx;
      pos[i * 2 + 1] = pt.y + dy;
      const lab = pointLab(pt, g);
      const lin = oklabToLinear(lab);
      col.set(lab, i * 3);
      colLin.set(lin, i * 3);
      colSrgb.set(lin.map(encodeSrgb), i * 3);
      mode.set(BLEND[pt.blendMode ?? look(g, 'blendMode')], i * 2);
      // Higher softness = lower exponent = wider, gentler falloff.
      power[i] = 6 - (pt.softness ?? g.softness) * 4.5;
      alpha[i] = pt.opacity ?? 1;
      meta[i * 3 + 1] = pt.radius ?? 1;
      const sh = pt.shape;
      if (sh) {
        // Sample the curve in aspect-corrected space so samples are evenly spaced on screen.
        const samples =
          sh.type === 'path'
            ? samplePath(sh.points.map((p) => toScaled(p, dx, dy)), PATH_N)
            : sh.type === 'arc'
              ? arcSamples(toScaled(sh.a, dx, dy), toScaled(pt, 0, 0), toScaled(sh.b, dx, dy), PATH_N - 1)
              : [toScaled(sh.a, dx, dy), toScaled(sh.b, dx, dy)];
        meta[i * 3] = 1;
        meta[i * 3 + 2] = samples.length;
        ends[i * 2] = sh.ra ?? 1;
        ends[i * 2 + 1] = sh.rb ?? 1;
        samples.forEach((s, k) => {
          const enc = (v: number) => Math.round(Math.min(1, Math.max(0, (v + 0.5) / 2)) * 65535);
          const ex = enc(s.x / sx);
          const ey = enc(s.y / sy);
          const o = (i * PATH_N + k) * 4;
          data[o] = ex >> 8;
          data[o + 1] = ex & 255;
          data[o + 2] = ey >> 8;
          data[o + 3] = ey & 255;
        });
      }
      // Arms sorted by angle so the shader can interpolate between neighbours.
      const arms = (pt.arms ?? DEFAULT_ARMS)
        .map(([ax, ay]) => ({ ang: (Math.atan2(ay, ax) + Math.PI * 2) % (Math.PI * 2), len: Math.max(Math.hypot(ax, ay), 0.005) }))
        .sort((p, q) => p.ang - q.ang);
      arms.forEach((arm, k) => {
        armAng[i * 4 + k] = arm.ang;
        armLen[i * 4 + k] = arm.len;
      });
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pathTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PATH_N, MAX_POINTS, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.uniform1i(u.u_paths!, 0);

    const px = canvas.clientWidth ? canvas.width / canvas.clientWidth : this.pixelScale;
    gl.uniform2f(u.u_res!, canvas.width || 1, canvas.height || 1);
    gl.uniform1f(u.u_time!, t);
    gl.uniform1i(u.u_count!, count);
    gl.uniform2fv(u.u_pos!, pos);
    gl.uniform3fv(u.u_col!, col);
    gl.uniform3fv(u.u_meta!, meta);
    gl.uniform2fv(u.u_ends!, ends);
    gl.uniform4fv(u.u_armAng!, armAng);
    gl.uniform4fv(u.u_armLen!, armLen);
    gl.uniform1fv(u.u_power!, power);
    gl.uniform1fv(u.u_alpha!, alpha);
    gl.uniform3fv(u.u_colLin!, colLin);
    gl.uniform3fv(u.u_colSrgb!, colSrgb);
    gl.uniform2fv(u.u_mode!, mode);
    gl.uniform1f(u.u_warp!, g.warp);
    gl.uniform1f(u.u_warpScale!, g.warpScale);
    gl.uniform1f(u.u_grain!, g.grain);
    gl.uniform3f(u.u_grainOpts!, GRAIN_TYPES[look(g, 'grainType')], look(g, 'grainSize') * px, look(g, 'grainDensity'));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
