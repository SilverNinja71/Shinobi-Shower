// Master's cape, injected into a standard material before lighting: crimson wool velvet outside, a
// darker silk lining inside, a narrow gold-thread border along the hem and the edges. Velvet keeps
// its colour at grazing angles, so the folds glow at their edges instead of going grey.
// The simulated cloth is a coarse grid, so the long vertical folds are added here as shading: they
// start fine at the shoulders and fan out deeper toward the hem (v runs 1 at the collar to 0).
{
  float drop = 1.0 - vUv.y;
  float foldPhase = vUv.x * 28.0 + drop * 1.6;
  float foldSlope = (cos(foldPhase) * 0.7 + cos(foldPhase * 2.03 + 1.1) * 0.6) * (0.25 + 0.75 * drop);
  // Tangent across the cape from screen-space derivatives (no tangent attribute on the cloth).
  vec3 qx = dFdx(-vViewPosition);
  vec3 qy = dFdy(-vViewPosition);
  vec2 sx = dFdx(vUv);
  vec2 sy = dFdy(vUv);
  vec3 across = cross(qy, normal) * sx.x + cross(normal, qx) * sy.x;
  across *= inversesqrt(max(dot(across, across), 1e-12));
  normal = normalize(normal - across * foldSlope * 0.55);
  // The fold valleys hold shadow.
  float valley = 0.72 + 0.28 * smoothstep(-1.0, 0.6, sin(foldPhase) * 0.7 + sin(foldPhase * 2.03 + 1.1) * 0.3);

  float border = max(step(vUv.x, 0.03) + step(0.97, vUv.x), step(vUv.y, 0.035));
  float braid = 0.6 + 0.4 * sin(vUv.y * 160.0 + vUv.x * 160.0);
  vec3 gold = vec3(0.62, 0.45, 0.16) * braid;
  float grazing = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
  if (gl_FrontFacing) {
    diffuseColor.rgb *= (0.75 + 0.9 * grazing * grazing) * valley;
  } else {
    diffuseColor.rgb = vec3(0.09, 0.012, 0.018) * valley;
    roughnessFactor = 0.32;
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, gold, clamp(border, 0.0, 1.0));
  metalnessFactor = mix(metalnessFactor, 0.9, clamp(border, 0.0, 1.0));
  roughnessFactor = mix(roughnessFactor, 0.35, clamp(border, 0.0, 1.0));
}
