import type * as THREE from 'three';

/**
 * Splits a GLSL file into its `// @@name` sections (the convention WetSurfacePBR.frag uses), so one
 * file can hold every snippet a material splices into three's built-in shaders.
 */
export function glslSections(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const marker = /^\/\/ @@([\w-]+)[^\n]*$/gm;
  const found: { name: string; start: number; end: number }[] = [];
  for (let m = marker.exec(source); m; m = marker.exec(source)) found.push({ name: m[1], start: m.index, end: m.index + m[0].length });
  found.forEach((s, i) => {
    out[s.name] = source.slice(s.end + 1, i + 1 < found.length ? found[i + 1].start : undefined);
  });
  return out;
}

/** One splice: insert `code` after (or before) the first occurrence of `anchor`. */
export interface Splice {
  anchor: string;
  code: string;
  before?: boolean;
}

export function splice(source: string, edits: Splice[]): string {
  for (const e of edits) {
    if (!source.includes(e.anchor)) throw new Error(`shader has no ${e.anchor}`);
    source = source.replace(e.anchor, e.before ? `${e.code}\n${e.anchor}` : `${e.anchor}\n${e.code}`);
  }
  return source;
}

/**
 * Adds our own shader edits to a material on top of whatever onBeforeCompile it already has (the wet
 * surface patch, usually), and gives it its own program cache key: three caches programs by key, so a
 * patched material must never share one with an unpatched material of the same kind.
 */
export function extendMaterial(
  material: THREE.Material,
  key: string,
  uniforms: Record<string, { value: unknown }>,
  vertex: Splice[],
  fragment: Splice[] = [],
): void {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = splice(shader.vertexShader, vertex);
    shader.fragmentShader = splice(shader.fragmentShader, fragment);
  };
  material.customProgramCacheKey = () => key;
}
