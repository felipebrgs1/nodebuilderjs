// WebGL side of the web renderer: the shader of native/core/render_gles2.c (GLSL ES 1.0 runs
// unchanged in WebGL), image textures, and an atlas of text runs rasterized by Canvas2D.

import type { ColorSpace } from "../render/color.js";
import { type ClipState, type RenderDevice, type TextPainter, type TextQuad, Renderer, VERTEX_FLOATS } from "./renderer.js";
import { context2d, cssFont, setFont } from "./text.js";

const VERTEX = `
attribute vec2 a_pos; attribute vec2 a_local; attribute vec2 a_half;
attribute vec4 a_color; attribute vec4 a_bcolor; attribute vec3 a_params; attribute vec3 a_uv;
uniform vec2 u_viewport;
varying vec2 v_local; varying vec2 v_half; varying vec4 v_color; varying vec4 v_bcolor;
varying vec3 v_params; varying vec3 v_uv;
void main() {
  vec2 ndc = a_pos / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  v_local = a_local; v_half = a_half; v_color = vec4(a_color.rgb * a_color.a, a_color.a); v_bcolor = a_bcolor;
  v_params = a_params; v_uv = a_uv;
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_local; varying vec2 v_half; varying vec4 v_color; varying vec4 v_bcolor;
varying vec3 v_params; varying vec3 v_uv;
uniform sampler2D u_atlas; uniform sampler2D u_image; uniform sampler2D u_color_atlas;
uniform vec4 u_clip; uniform vec4 u_clip_radii; uniform float u_fb_height;
vec4 texel(vec4 t, float convert) {
  if (convert < 0.5 || t.a <= 0.0) return t;
  vec3 c = t.rgb / t.a;
  c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  c = clamp((convert < 1.5 ? mat3(0.8224620, 0.0331942, 0.0170826, 0.1775380, 0.9668058, 0.0723974, 0.0, 0.0, 0.9105199)
                           : mat3(1.2249402, -0.0420570, -0.0196376, -0.2249402, 1.0420570, -0.0786360, 0.0, 0.0, 1.0982736)) * c, 0.0, 1.0);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  return vec4(c * t.a, t.a);
}
float sd_round_box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float corner(vec2 p, vec4 r) {
  return p.x > 0.0 ? (p.y > 0.0 ? r.z : r.y) : (p.y > 0.0 ? r.w : r.x);
}
void main() {
  vec4 c;
  vec4 pm = v_color;
  if (v_params.z > 6.5) {
    c = texel(texture2D(u_color_atlas, v_uv.xy), v_params.y) * v_color.a;
  } else if (v_params.z > 5.5) {
    vec2 q = vec2(abs(v_local.x), v_local.y);
    float d = length(q) - v_params.x;
    if (v_half.y > -0.9999) {
      float m = length(q - v_half * clamp(dot(q, v_half), 0.0, v_params.x));
      d = max(d, m * sign(v_half.y * q.x - v_half.x * q.y));
    }
    d = max(d, v_params.y - length(v_local));
    c = pm * clamp(0.5 - d, 0.0, 1.0);
  } else if (v_params.z > 4.5) {
    c = pm;
  } else if (v_params.z > 3.5) {
    float hw = v_params.x, len = v_params.y, d;
    if (v_local.x < 0.0) d = v_half.x > 0.5 ? length(v_local) - hw : max(-v_local.x, abs(v_local.y) - hw);
    else if (v_local.x > len) d = v_half.y > 0.5 ? length(v_local - vec2(len, 0.0)) - hw : max(v_local.x - len, abs(v_local.y) - hw);
    else d = abs(v_local.y) - hw;
    c = pm * clamp(0.5 - d, 0.0, 1.0);
  } else if (v_params.z > 2.5) {
    float d = sd_round_box(v_local, v_half, v_params.x);
    c = texel(texture2D(u_image, v_uv.xy), v_params.y) * pm * clamp(0.5 - d, 0.0, 1.0);
  } else if (v_params.z > 1.5) {
    vec4 radii = vec4(v_params.x, v_uv);
    float d = sd_round_box(v_local, v_half, corner(v_local, radii));
    vec2 b = v_local + vec2(0.0, v_bcolor.x);
    c = pm * (1.0 - smoothstep(-v_params.y, v_params.y, d)) * clamp(0.5 + sd_round_box(b, v_half, corner(b, radii)), 0.0, 1.0);
  } else if (v_params.z > 0.5) {
    c = pm * texture2D(u_atlas, v_uv.xy).a;
  } else {
    float d = sd_round_box(v_local, v_half, corner(v_local, vec4(v_params.x, v_uv)));
    c = pm;
    if (v_params.y > 0.0) {
      float ring = 1.0 - clamp(0.5 - (d + v_params.y), 0.0, 1.0);
      vec4 b = vec4(v_bcolor.rgb * v_bcolor.a, v_bcolor.a) * ring;
      c = b + c * (1.0 - b.a);
    }
    c *= clamp(0.5 - d, 0.0, 1.0);
  }
  if (dot(u_clip_radii, vec4(1.0)) > 0.0) {
    vec2 half_size = (u_clip.zw - u_clip.xy) * 0.5;
    vec2 p = vec2(gl_FragCoord.x, u_fb_height - gl_FragCoord.y) - u_clip.xy - half_size;
    c *= clamp(0.5 - sd_round_box(p, half_size, corner(p, u_clip_radii)), 0.0, 1.0);
  }
  gl_FragColor = c;
}`;

const ATTRIBUTES: [name: string, size: number][] = [["a_pos", 2], ["a_local", 2], ["a_half", 2], ["a_color", 4], ["a_bcolor", 4], ["a_params", 3], ["a_uv", 3]];

interface Image {
  width: number;
  height: number;
  pixels: Uint8Array | null; // straight alpha until uploaded
  space: ColorSpace;
  texture: WebGLTexture | null;
}

export interface WebGLRenderer {
  renderer: Renderer;
  createImage(width: number, height: number, rgba: Uint8Array, space: ColorSpace): number;
  destroyImage(id: number): void;
}

export function createWebGLRenderer(gl: WebGLRenderingContext): WebGLRenderer {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`nodebuilder: shader error: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  ATTRIBUTES.forEach(([name], i) => gl.bindAttribLocation(program, i, name));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`nodebuilder: shader link error: ${gl.getProgramInfoLog(program)}`);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const uViewport = u("u_viewport"), uClip = u("u_clip"), uClipRadii = u("u_clip_radii"), uFbHeight = u("u_fb_height");
  const vbo = gl.createBuffer();
  let fbHeight = 0;

  const newTexture = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  // ---- images -----------------------------------------------------------------
  const images = new Map<number, Image>();
  const dead: WebGLTexture[] = [];
  let nextImage = 1;

  // ---- text atlas: runs packed on shelves; when full, the renderer resets it ------
  const atlasSize = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  const atlas = newTexture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlasSize, atlasSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const runs = new Map<string, TextQuad | null>();
  let shelves: { y: number; height: number; x: number }[] = [];
  let nextShelf = 0;
  const ctx = context2d();
  const scratch = ctx.canvas;

  const allocate = (w: number, h: number): [number, number] | null => {
    for (const s of shelves) {
      if (s.height >= h && s.height <= h * 1.4 + 2 && s.x + w <= atlasSize) {
        s.x += w;
        return [s.x - w, s.y];
      }
    }
    if (nextShelf + h > atlasSize || w > atlasSize) return null;
    shelves.push({ y: nextShelf, height: h, x: w });
    nextShelf += h;
    return [0, nextShelf - h];
  };

  const text: TextPainter = {
    place(str, font, spec, px, spacing, color) {
      const r = Math.round(color[0]! * 255), g = Math.round(color[1]! * 255), b = Math.round(color[2]! * 255);
      const key = `${font}|${px}|${spacing}|${r},${g},${b}|${spec}|${str}`;
      const cached = runs.get(key);
      if (cached !== undefined) return cached;
      const css = cssFont(font, spec, px);
      setFont(ctx, css, spacing);
      const m = ctx.measureText(str);
      const ascent = m.fontBoundingBoxAscent ?? px * 0.9;
      const left = Math.ceil(Math.max(m.actualBoundingBoxLeft, 0)) + 1;
      const right = Math.ceil(Math.max(m.actualBoundingBoxRight, m.width)) + 1;
      const top = Math.ceil(Math.max(m.actualBoundingBoxAscent, ascent)) + 1;
      const bottom = Math.ceil(Math.max(m.actualBoundingBoxDescent, m.fontBoundingBoxDescent ?? 0)) + 1;
      const w = Math.min(left + right, atlasSize), h = Math.min(top + bottom, atlasSize);
      if (right - 1 <= 0 || !str.trim()) {
        runs.set(key, null);
        return null;
      }
      const at = allocate(w, h);
      if (!at) return "full";
      if (scratch.width < w || scratch.height < h) {
        scratch.width = Math.max(scratch.width, w);
        scratch.height = Math.max(scratch.height, h);
      }
      ctx.clearRect(0, 0, w, h);
      setFont(ctx, css, spacing); // resizing the canvas resets its state
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(str, left, top);
      const pixels = ctx.getImageData(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, at[0], at[1], gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.activeTexture(gl.TEXTURE0);
      // The native core puts the baseline at round(top + ascent).
      const y0 = Math.round(ascent) - top;
      const q: TextQuad = {
        x0: -left, y0, x1: w - left, y1: y0 + h,
        u0: at[0] / atlasSize, v0: at[1] / atlasSize, u1: (at[0] + w) / atlasSize, v1: (at[1] + h) / atlasSize,
      };
      runs.set(key, q);
      return q;
    },
    reset() {
      runs.clear();
      shelves = [];
      nextShelf = 0;
    },
  };

  const device: RenderDevice = {
    begin(width, height) {
      fbHeight = height;
      for (const t of dead.splice(0)) gl.deleteTexture(t);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.uniform2f(uViewport, width, height);
      gl.uniform1i(u("u_atlas"), 0);
      gl.uniform1i(u("u_image"), 1);
      gl.uniform1i(u("u_color_atlas"), 2);
      gl.uniform1f(uFbHeight, height);
      gl.uniform4f(uClipRadii, 0, 0, 0, 0);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      let offset = 0;
      ATTRIBUTES.forEach(([, size], i) => {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, size, gl.FLOAT, false, VERTEX_FLOATS * 4, offset * 4);
        offset += size;
      });
    },
    draw(vertices, count) {
      gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, count * VERTEX_FLOATS), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    },
    clip(state: ClipState | null) {
      if (!state) {
        gl.disable(gl.SCISSOR_TEST);
        gl.uniform4f(uClipRadii, 0, 0, 0, 0);
        return;
      }
      const [x0, y0, x1, y1] = state.scissor;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x0, fbHeight - y1, Math.max(x1 - x0, 0), Math.max(y1 - y0, 0));
      gl.uniform4f(uClip, ...state.mask);
      gl.uniform4f(uClipRadii, ...state.radii);
    },
    bindImage(id) {
      const im = images.get(id);
      if (!im) return null;
      gl.activeTexture(gl.TEXTURE1);
      if (!im.texture) {
        im.texture = newTexture();
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // linear filtering must not bleed transparent texels
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, im.width, im.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, im.pixels);
        im.pixels = null;
      } else gl.bindTexture(gl.TEXTURE_2D, im.texture);
      gl.activeTexture(gl.TEXTURE0);
      return im.space;
    },
  };

  return {
    renderer: new Renderer(device, text),
    createImage(width, height, rgba, space) {
      if (width <= 0 || height <= 0) return 0;
      const id = nextImage++;
      images.set(id, { width, height, pixels: rgba.slice(), space, texture: null });
      return id;
    },
    destroyImage(id) {
      const im = images.get(id);
      if (!im) return;
      images.delete(id);
      if (im.texture) dead.push(im.texture);
    },
  };
}
