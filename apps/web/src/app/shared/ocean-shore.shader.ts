export const oceanShoreFragmentShader = `
  uniform sampler2D image;
  uniform float time;
  uniform vec2 coverScale;
  uniform vec2 coverOffset;
  uniform vec2 pointer;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x), f.y);
  }

  float waterMask(vec3 color) {
    return smoothstep(0.035, 0.16, color.g - color.r)
      * smoothstep(0.02, 0.12, color.b - color.r);
  }

  void main() {
    vec2 uv = vUv * coverScale + coverOffset;
    // Image-space cove coordinates keep the wash attached to the real beach,
    // independently of the responsive crop. The rocks lie outside this mask.
    float shore = 0.817 - 2.05 * pow(uv.y - 0.54, 2.0);
    float cove = smoothstep(0.35, 0.43, uv.y)
      * (1.0 - smoothstep(0.64, 0.70, uv.y));
    float distanceToShore = uv.x - shore;
    float phase = time * 0.82 + (uv.y - 0.54) * 3.0;
    float surge = 0.5 + 0.5 * sin(phase);
    float runup = -0.009 + 0.028 * pow(surge, 0.8);
    float washArea = smoothstep(-0.12, -0.025, distanceToShore)
      * (1.0 - smoothstep(0.035, 0.08, distanceToShore)) * cove;
    float edgeDetail = sin(uv.y * 150.0 + time * 0.7) * 0.001
      + (noise(vec2(uv.y * 90.0, time * 0.2)) - 0.5) * 0.002;

    vec2 shoreUv = uv;
    shoreUv.x -= (runup + edgeDetail) * washArea;
    vec3 base = texture2D(image, shoreUv).rgb;
    float water = waterMask(base);
    vec2 ripple = vec2(
      sin(uv.y * 85.0 + time * 0.8) + cos(uv.x * 54.0 - time * 0.6),
      cos(uv.x * 70.0 + time * 0.65) + sin(uv.y * 47.0 - time * 0.8)
    ) * 0.0013;
    float pointerDistance = length(vUv - pointer);
    ripple += normalize(vUv - pointer + 0.001)
      * sin(pointerDistance * 40.0 - time * 1.2) * 0.0006
      * exp(-pointerDistance * 4.0);
    vec3 color = texture2D(image, shoreUv + ripple * water).rgb;

    float shoreDistance = distanceToShore - runup * cove - edgeDetail;
    float wetSand = smoothstep(-0.001, 0.012, shoreDistance)
      * (1.0 - smoothstep(0.018, 0.042, distanceToShore))
      * cove * (1.0 - water);
    color *= 1.0 - wetSand * 0.10;

    // A thin broken leading edge and a transparent backwash, not an opaque band.
    float foamNoise = noise(uv * vec2(900.0, 380.0) + vec2(-time, time * 0.3));
    float leadingEdge = 1.0 - smoothstep(0.0012, 0.0045,
      abs(shoreDistance + (foamNoise - 0.5) * 0.003));
    float backwash = smoothstep(-0.032, -0.014, shoreDistance)
      * (1.0 - smoothstep(-0.012, 0.0, shoreDistance));
    float foam = cove * (leadingEdge * (0.30 + 0.26 * foamNoise)
      + backwash * smoothstep(0.54, 0.82, foamNoise) * 0.17);

    float swell = sin(distanceToShore * 155.0 - phase * 1.8
      + noise(uv * 22.0) * 0.6);
    float swellArea = smoothstep(-0.16, -0.10, distanceToShore)
      * (1.0 - smoothstep(-0.045, -0.012, distanceToShore)) * cove * water;
    color += swell * swellArea * 0.026;
    color = mix(color, vec3(0.94, 0.99, 0.97), clamp(foam, 0.0, 0.62));
    float light = sin(uv.x * 80.0 + uv.y * 40.0 + time * 0.5)
      * sin(uv.y * 94.0 - time * 0.6) * 0.009 * water;
    gl_FragColor = vec4(color + light, 1.0);
  }
`;
