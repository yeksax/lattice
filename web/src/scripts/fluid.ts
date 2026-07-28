/**
 * Ink-wash fluid — a port of the sim the hosted access-denied page runs
 * (cloud/src/denied.fluid.txt). Navier-Stokes on the GPU (WebGL1), pointer
 * driven, near-black soot on paper.
 *
 * The one difference from the hosted copy: the canvas is sized from its own
 * box instead of the viewport, so it can sit inside a section rather than
 * behind the whole page. Keep the two in step when the tuning changes.
 */

interface FloatSupport {
  type: number;
  linear: boolean;
}

interface CompiledProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  attach(id: number): number;
}

interface DoubleFBO {
  width: number;
  height: number;
  readonly read: FBO;
  readonly write: FBO;
  swap(): void;
}

interface Ink {
  r: number;
  g: number;
  b: number;
}

// Between the first "sick" pass and the heavy blot: lively, then gone.
const CONF = {
  sim: 128,
  dye: 700,
  densityFade: 0.978,
  velocityFade: 0.97,
  pressure: 0.75,
  pressureIters: 14,
  curl: 14,
  splatRadius: 0.18,
  splatForce: 7200,
};

const BASE_VS = `
  attribute vec2 a;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform vec2 texelSize;
  void main () {
    vUv = a * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(a, 0.0, 1.0);
  }`;

const CLEAR_FS = `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float value;
  void main () {
    gl_FragColor = value * texture2D(uTexture, vUv);
  }`;

const DISPLAY_FS = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  void main () {
    vec3 ink = texture2D(uTexture, vUv).rgb;
    float d = max(ink.r, max(ink.g, ink.b));
    d = clamp(d * 1.55, 0.0, 0.9);
    // Near-black soot — multiply against paper does the rest.
    vec3 tone = vec3(0.03, 0.028, 0.025);
    gl_FragColor = vec4(tone * d, d);
  }`;

const SPLAT_FS = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;
  void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }`;

const ADVECTION_FS = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform float dt;
  uniform float dissipation;
  void main () {
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    gl_FragColor = dissipation * texture2D(uSource, coord);
  }`;

const DIVERGENCE_FS = `
  precision mediump float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) L = -C.x;
    if (vR.x > 1.0) R = -C.x;
    if (vT.y > 1.0) T = -C.y;
    if (vB.y < 0.0) B = -C.y;
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }`;

const CURL_FS = `
  precision mediump float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }`;

const VORTICITY_FS = `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;
  void main () {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 vel = texture2D(uVelocity, vUv).xy;
    gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
  }`;

const PRESSURE_FS = `
  precision mediump float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }`;

const GRADIENT_SUBTRACT_FS = `
  precision mediump float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }`;

function inkColor(): Ink {
  const roll = Math.random();
  if (roll < 0.45) return { r: 0.72, g: 0.68, b: 0.62 };
  if (roll < 0.8) return { r: 0.58, g: 0.6, b: 0.68 };
  return { r: 0.8, g: 0.74, b: 0.68 };
}

export function initFluid(canvas: HTMLCanvasElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const gl = canvas.getContext('webgl', {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
    premultipliedAlpha: true,
  });
  if (!gl) return;

  const support = ((): FloatSupport | null => {
    const half = gl.getExtension('OES_texture_half_float');
    const float = half ?? gl.getExtension('OES_texture_float');
    const linear =
      gl.getExtension('OES_texture_half_float_linear') ?? gl.getExtension('OES_texture_float_linear');
    const type = half ? half.HALF_FLOAT_OES : float ? gl.FLOAT : null;
    if (type === null) return null;
    return { type, linear: !!linear };
  })();
  if (!support) return;

  try {
    run(canvas, gl, support);
  } catch (err) {
    console.error('[lattice fluid]', err);
  }
}

function run(canvas: HTMLCanvasElement, gl: WebGLRenderingContext, support: FloatSupport): void {
  function compile(type: number, src: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('shader');
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    }
    return shader;
  }

  function program(vs: string, fs: string): CompiledProgram {
    const p = gl.createProgram();
    if (!p) throw new Error('program');
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || 'program');
    }
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const count: number = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      if (!info) continue;
      uniforms[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { program: p, uniforms };
  }

  const blit = ((): ((target: FBO | null) => void) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    return (target) => {
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, target.width, target.height);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
  })();

  function createFBO(w: number, h: number, format: number): FBO {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    if (!texture) throw new Error('texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const filter = support.linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, support.type, null);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('framebuffer incomplete');
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture,
      fbo,
      width: w,
      height: h,
      attach(id: number): number {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  function createDouble(w: number, h: number, format: number): DoubleFBO {
    let a = createFBO(w, h, format);
    let b = createFBO(w, h, format);
    return {
      width: w,
      height: h,
      get read() {
        return a;
      },
      get write() {
        return b;
      },
      swap() {
        const t = a;
        a = b;
        b = t;
      },
    };
  }

  const clearProg = program(BASE_VS, CLEAR_FS);
  const displayProg = program(BASE_VS, DISPLAY_FS);
  const splatProg = program(BASE_VS, SPLAT_FS);
  const advectionProg = program(BASE_VS, ADVECTION_FS);
  const divergenceProg = program(BASE_VS, DIVERGENCE_FS);
  const curlProg = program(BASE_VS, CURL_FS);
  const vorticityProg = program(BASE_VS, VORTICITY_FS);
  const pressureProg = program(BASE_VS, PRESSURE_FS);
  const gradProg = program(BASE_VS, GRADIENT_SUBTRACT_FS);

  let dye: DoubleFBO;
  let velocity: DoubleFBO;
  let pressure: DoubleFBO;
  let divergence: FBO;
  let curl: FBO;

  function getRes(res: number): { w: number; h: number } {
    let aspect = canvas.width / canvas.height;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(res);
    const max = Math.round(res * aspect);
    return canvas.width > canvas.height ? { w: max, h: min } : { w: min, h: max };
  }

  function initFramebuffers(): void {
    const sim = getRes(CONF.sim);
    const dyeRes = getRes(CONF.dye);
    const fmt = gl.RGBA;
    dye = createDouble(dyeRes.w, dyeRes.h, fmt);
    velocity = createDouble(sim.w, sim.h, fmt);
    divergence = createFBO(sim.w, sim.h, fmt);
    curl = createFBO(sim.w, sim.h, fmt);
    pressure = createDouble(sim.w, sim.h, fmt);
  }

  // Sized from the element, not the viewport: the canvas is a section, not a
  // backdrop.
  function resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.floor((canvas.clientWidth || window.innerWidth) * dpr));
    const h = Math.max(1, Math.floor((canvas.clientHeight || window.innerHeight) * dpr));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    initFramebuffers();
    return true;
  }

  function bindAttrib(prog: CompiledProgram): void {
    gl.useProgram(prog.program);
    const loc = gl.getAttribLocation(prog.program, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  function step(dt: number): void {
    gl.disable(gl.BLEND);

    bindAttrib(curlProg);
    gl.uniform2f(curlProg.uniforms.texelSize, 1 / velocity.width, 1 / velocity.height);
    gl.uniform1i(curlProg.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    bindAttrib(vorticityProg);
    gl.uniform2f(vorticityProg.uniforms.texelSize, 1 / velocity.width, 1 / velocity.height);
    gl.uniform1i(vorticityProg.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProg.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProg.uniforms.curl, CONF.curl);
    gl.uniform1f(vorticityProg.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    bindAttrib(divergenceProg);
    gl.uniform2f(divergenceProg.uniforms.texelSize, 1 / velocity.width, 1 / velocity.height);
    gl.uniform1i(divergenceProg.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    bindAttrib(clearProg);
    gl.uniform1i(clearProg.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProg.uniforms.value, CONF.pressure);
    blit(pressure.write);
    pressure.swap();

    bindAttrib(pressureProg);
    gl.uniform2f(pressureProg.uniforms.texelSize, 1 / velocity.width, 1 / velocity.height);
    gl.uniform1i(pressureProg.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < CONF.pressureIters; i++) {
      gl.uniform1i(pressureProg.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    bindAttrib(gradProg);
    gl.uniform2f(gradProg.uniforms.texelSize, 1 / velocity.width, 1 / velocity.height);
    gl.uniform1i(gradProg.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradProg.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    bindAttrib(advectionProg);
    gl.uniform2f(advectionProg.uniforms.texelSize, 1 / velocity.width, 1 / velocity.height);
    const velId = velocity.read.attach(0);
    gl.uniform1i(advectionProg.uniforms.uVelocity, velId);
    gl.uniform1i(advectionProg.uniforms.uSource, velId);
    gl.uniform1f(advectionProg.uniforms.dt, dt);
    gl.uniform1f(advectionProg.uniforms.dissipation, CONF.velocityFade);
    blit(velocity.write);
    velocity.swap();

    gl.uniform2f(advectionProg.uniforms.texelSize, 1 / dye.width, 1 / dye.height);
    gl.uniform1i(advectionProg.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProg.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProg.uniforms.dissipation, CONF.densityFade);
    blit(dye.write);
    dye.swap();
  }

  function draw(): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    bindAttrib(displayProg);
    gl.uniform1i(displayProg.uniforms.uTexture, dye.read.attach(0));
    blit(null);
  }

  function splatRadius(): number {
    let r = CONF.splatRadius / 100;
    const aspect = canvas.width / canvas.height;
    if (aspect > 1) r *= aspect;
    return r;
  }

  function splat(x: number, y: number, dx: number, dy: number, color: Ink): void {
    bindAttrib(splatProg);
    gl.uniform1i(splatProg.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProg.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProg.uniforms.point, x, y);
    gl.uniform3f(splatProg.uniforms.color, dx, dy, 0);
    gl.uniform1f(splatProg.uniforms.radius, splatRadius());
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProg.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProg.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  }

  function multipleSplats(amount: number): void {
    for (let i = 0; i < amount; i++) {
      splat(
        Math.random(),
        Math.random(),
        1000 * (Math.random() - 0.5),
        1000 * (Math.random() - 0.5),
        inkColor(),
      );
    }
  }

  const pointer = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    down: false,
    moved: false,
    ready: false,
    color: inkColor(),
  };

  function updatePointer(x: number, y: number): void {
    if (!pointer.ready) {
      pointer.x = x;
      pointer.y = y;
      pointer.ready = true;
      pointer.moved = false;
      return;
    }
    pointer.dx = 8 * (x - pointer.x);
    pointer.dy = 8 * (y - pointer.y);
    pointer.x = x;
    pointer.y = y;
    pointer.moved = pointer.down && (Math.abs(pointer.dx) > 0.0015 || Math.abs(pointer.dy) > 0.0015);
  }

  function pointerXY(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: 1 - (e.clientY - rect.top) / rect.height,
    };
  }

  window.addEventListener('pointerdown', (e) => {
    pointer.down = true;
    pointer.color = inkColor();
    const { x, y } = pointerXY(e);
    updatePointer(x, y);
  });
  window.addEventListener('pointermove', (e) => {
    if (!pointer.down) {
      pointer.down = true;
      pointer.color = inkColor();
    }
    const { x, y } = pointerXY(e);
    updatePointer(x, y);
  });
  window.addEventListener('pointerup', () => {
    pointer.down = false;
  });
  window.addEventListener('pointerleave', () => {
    pointer.down = false;
    pointer.moved = false;
  });

  let last = Date.now();
  function frame(): void {
    // A resize rebuilds every buffer: seed the fresh dye so the page is never
    // blank after the layout settles.
    if (resize()) multipleSplats(3);

    const now = Date.now();
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;

    if (pointer.moved) {
      pointer.moved = false;
      splat(
        pointer.x,
        pointer.y,
        pointer.dx * CONF.splatForce,
        pointer.dy * CONF.splatForce,
        pointer.color,
      );
    }

    step(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resize();
  multipleSplats(3);
  requestAnimationFrame(frame);
}
