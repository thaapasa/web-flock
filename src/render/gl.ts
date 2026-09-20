/**
 * A thin WebGL2 helper. Not an engine: it removes the boilerplate around
 * compiling, linking, describing vertex layout and issuing instanced draws,
 * and gets out of the way. Everything else is raw `gl.*` at the call site.
 */

export class GLError extends Error {}

export function getContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    // The grid and the boids both draw every frame, so there is nothing worth
    // preserving between them.
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new GLError('WebGL2 is not available in this browser');
  return gl;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new GLError(`Could not create shader (${label})`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    gl.deleteShader(shader);
    throw new GLError(`${label} failed to compile:\n${log}\n${withLineNumbers(source)}`);
  }
  return shader;
}

/** Shader logs report line numbers, so print the source with them attached. */
function withLineNumbers(source: string): string {
  return source
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
    .join('\n');
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label = 'program',
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex shader`);
  const fragment = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentSource,
    `${label} fragment shader`,
  );

  const program = gl.createProgram();
  if (!program) throw new GLError(`Could not create ${label}`);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  // The shaders are reference-counted by the program, so they can go now.
  gl.detachShader(program, vertex);
  gl.detachShader(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)';
    gl.deleteProgram(program);
    throw new GLError(`${label} failed to link:\n${log}`);
  }
  return program;
}

/**
 * Looks up every named uniform at once. A missing name yields `null` rather
 * than throwing: a uniform the compiler optimised away is normal, and the
 * `gl.uniform*` calls against `null` are silently ignored.
 */
export function getUniformLocations<const N extends readonly string[]>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: N,
): Record<N[number], WebGLUniformLocation | null> {
  const locations = {} as Record<N[number], WebGLUniformLocation | null>;
  for (const name of names) {
    locations[name as N[number]] = gl.getUniformLocation(program, name);
  }
  return locations;
}

export function createBuffer(
  gl: WebGL2RenderingContext,
  target: number,
  data: ArrayBufferView | number,
  usage: number = gl.STATIC_DRAW,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new GLError('Could not create buffer');
  gl.bindBuffer(target, buffer);
  // The two branches look identical but resolve to different `bufferData`
  // overloads: allocate-by-size versus upload-from-view. The union type matches
  // neither on its own.
  if (typeof data === 'number') {
    gl.bufferData(target, data, usage);
  } else {
    gl.bufferData(target, data, usage);
  }
  gl.bindBuffer(target, null);
  return buffer;
}

/** One vertex attribute's slot in a VAO. */
export interface AttributeSpec {
  /** `layout(location = N)` in the vertex shader. */
  location: number;
  buffer: WebGLBuffer;
  /** Components per element: 1..4. */
  size: 1 | 2 | 3 | 4;
  /** Defaults to `gl.FLOAT`. */
  type?: number;
  normalized?: boolean;
  /** Bytes between consecutive elements. 0 means tightly packed. */
  stride?: number;
  /** Byte offset of the first element. */
  offset?: number;
  /**
   * 0 advances per vertex, 1 advances per instance. Anything above 1 advances
   * once every N instances.
   */
  divisor?: number;
  /** Use `vertexAttribIPointer`, for integer attributes read as integers. */
  integer?: boolean;
}

export function createVertexArray(
  gl: WebGL2RenderingContext,
  attributes: readonly AttributeSpec[],
  indexBuffer?: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new GLError('Could not create vertex array object');
  gl.bindVertexArray(vao);

  for (const attribute of attributes) {
    const {
      location,
      buffer,
      size,
      type = gl.FLOAT,
      normalized = false,
      stride = 0,
      offset = 0,
      divisor = 0,
      integer = false,
    } = attribute;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    if (integer) {
      gl.vertexAttribIPointer(location, size, type, stride, offset);
    } else {
      gl.vertexAttribPointer(location, size, type, normalized, stride, offset);
    }
    gl.vertexAttribDivisor(location, divisor);
  }

  if (indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return vao;
}

export function draw(
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject,
  mode: number,
  vertexCount: number,
  first = 0,
): void {
  gl.bindVertexArray(vao);
  gl.drawArrays(mode, first, vertexCount);
  gl.bindVertexArray(null);
}

export function drawInstanced(
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject,
  mode: number,
  vertexCount: number,
  instanceCount: number,
  first = 0,
): void {
  gl.bindVertexArray(vao);
  gl.drawArraysInstanced(mode, first, vertexCount, instanceCount);
  gl.bindVertexArray(null);
}

/**
 * Prepends `#define`s to a shader.
 *
 * Shaders live in their own `.vert` and `.frag` files, which an editor can
 * highlight and a GLSL tool can parse — but a file cannot read a TypeScript
 * constant, and a constant repeated in both places is one that will drift. So
 * the values that must agree with the CPU side are injected here instead of
 * being written twice.
 *
 * `#version` has to be the first thing in a GLSL source, so the defines go
 * after it rather than at the top. That shifts the line numbers the compiler
 * reports relative to the file on disk; {@link createProgram} prints the
 * assembled source on failure, so the numbers in an error message still match
 * the listing printed beside it.
 */
export function withDefines(source: string, defines: Record<string, number>): string {
  const lines = Object.entries(defines).map(([name, value]) => `#define ${name} ${value}`);
  if (lines.length === 0) return source;

  const block = `${lines.join('\n')}\n`;
  const firstBreak = source.indexOf('\n');
  if (source.startsWith('#version') && firstBreak !== -1) {
    return source.slice(0, firstBreak + 1) + block + source.slice(firstBreak + 1);
  }
  return block + source;
}
