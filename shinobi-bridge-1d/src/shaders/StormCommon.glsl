// Shared by every storm particle shader: StormMaterial.ts prepends it to both stages.

#ifdef USE_FOG
uniform float fogDensity;
uniform float fogNear;
uniform float fogFar;
#endif

// How much of a light at this view depth survives the scene's fog (exp2 or linear, whichever the
// environment set). Particles fade out with distance rather than turning fog-coloured, so far rain
// never glows grey against the night.
float stormFogFade(float depth) {
#ifdef USE_FOG
#ifdef FOG_EXP2
  return exp(-fogDensity * fogDensity * depth * depth);
#else
  return 1.0 - smoothstep(fogNear, fogFar, depth);
#endif
#else
  return 1.0;
#endif
}
