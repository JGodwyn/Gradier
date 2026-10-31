import { hexToRgb, MAX_POINTS, type Gradient } from './types';

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
uniform vec3 u_col[${MAX_POINTS}];
uniform float u_power;
uniform float u_warp;
uniform float u_warpScale;
uniform float u_grain;

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

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

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

  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    if (i >= u_count) break;
    vec2 d = (uv - u_pos[i]) * scale;
    float w = pow(dot(d, d) + 1e-5, -u_power * 0.5);
    sum += u_col[i] * w;
    total += w;
  }
  vec3 col = linearToSrgb(oklabToLinear(sum / total));
  float r = hash(gl_FragCoord.xy + fract(u_time) * 100.0) - 0.5;
  col += r * (u_grain * 0.35 + 1.5 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}`;

function srgbToOklab(hex: string): [number, number, number] {
  const lin = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Renders a mesh gradient into a canvas with WebGL. */
export class MeshRenderer {
  readonly gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private gradient: Gradient | null = null;
  private time = 0;

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

    for (const name of ['u_res', 'u_time', 'u_count', 'u_pos', 'u_col', 'u_power', 'u_warp', 'u_warpScale', 'u_grain']) {
      this.uniforms[name] = gl.getUniformLocation(p, name);
    }
  }

  setGradient(g: Gradient) {
    this.gradient = g;
  }

  setTime(t: number) {
    this.time = t;
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
    const t = this.time;
    const drift = g.speed > 0 ? 0.06 : 0;
    g.points.slice(0, count).forEach((pt, i) => {
      pos[i * 2] = pt.x + drift * Math.sin(t * 0.6 + i * 1.7);
      pos[i * 2 + 1] = pt.y + drift * Math.cos(t * 0.5 + i * 2.3);
      col.set(srgbToOklab(pt.color), i * 3);
    });
    gl.uniform2f(u.u_res!, canvas.width || 1, canvas.height || 1);
    gl.uniform1f(u.u_time!, t);
    gl.uniform1i(u.u_count!, count);
    gl.uniform2fv(u.u_pos!, pos);
    gl.uniform3fv(u.u_col!, col);
    gl.uniform1f(u.u_power!, 1.5 + g.softness * 4.5);
    gl.uniform1f(u.u_warp!, g.warp);
    gl.uniform1f(u.u_warpScale!, g.warpScale);
    gl.uniform1f(u.u_grain!, g.grain);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
