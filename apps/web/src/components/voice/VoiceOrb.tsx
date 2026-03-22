"use client";

import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle, Color } from "ogl";

export type VoiceOrbState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface VoiceOrbProps {
  state: VoiceOrbState;
  audioLevelRef?: React.MutableRefObject<number>;
  size?: number;
  className?: string;
  ariaLabel?: string;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const stateToIndex: Record<VoiceOrbState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
  error: 4,
};

export const stateColors: Record<VoiceOrbState, [number, number, number]> = {
  idle: [0.30, 0.52, 1.0],
  listening: [0.18, 0.74, 0.95],
  thinking: [0.58, 0.32, 1.0],
  speaking: [1.0, 0.40, 0.72],
  error: [1.0, 0.65, 0.10],
};

const stateSpeeds: Record<VoiceOrbState, number> = {
  idle: 0.70,
  listening: 1.00,
  thinking: 1.35,
  speaking: 1.20,
  error: 0.20,
};

export const toRgba = (color: [number, number, number], alpha: number) =>
  `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${alpha})`;

const glowColors: Record<VoiceOrbState, string> = {
  idle: toRgba(stateColors.idle, 0.25),
  listening: toRgba(stateColors.listening, 0.35),
  thinking: toRgba(stateColors.thinking, 0.35),
  speaking: toRgba(stateColors.speaking, 0.45),
  error: toRgba(stateColors.error, 0.35),
};

const vertexShader = /* glsl */ `
attribute vec2 uv;
attribute vec2 position;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3 uColor;
uniform vec2 uResolution;
uniform float uAudioLevel;
uniform float uState;
uniform float uSpeed;
uniform float uReducedMotion;

varying vec2 vUv;

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  float mr = min(uResolution.x, uResolution.y);
  vec2 uv = (vUv * 2.0 - 1.0) * uResolution.xy / mr;

  float dist = length(uv);
  float angle = atan(uv.y, uv.x);

  float audio = uAudioLevel * mix(1.0, 0.4, uReducedMotion);
  float time = uTime;
  float speed = uSpeed * mix(1.0, 0.5, uReducedMotion);

  float isIdle = 1.0 - step(0.5, abs(uState - 0.0));
  float isListening = 1.0 - step(0.5, abs(uState - 1.0));
  float isThinking = 1.0 - step(0.5, abs(uState - 2.0));
  float isSpeaking = 1.0 - step(0.5, abs(uState - 3.0));
  float isError = 1.0 - step(0.5, abs(uState - 4.0));

  float baseRadius = 0.68;

  float breathe = 0.0;
  breathe += sin(time * 0.8) * 0.02 * isIdle;
  breathe += (sin(time * 2.0) * 0.02 + audio * 0.08) * isListening;
  breathe += sin(time * 2.5) * 0.01 * isThinking;
  breathe += (sin(time * 3.0) * 0.01 + audio * 0.15) * isSpeaking;
  breathe += (sin(time * 0.4) * 0.02) * isError;

  float edgeDistort = 0.0;
  // edgeDistort += (sin(angle * 3.0 + time * 0.8) * 0.01 + sin(angle * 5.0 - time * 0.5) * 0.005) * isIdle;
  // edgeDistort += (sin(dist * 20.0 + time * 5.0) * 0.015 + audio * sin(angle * 6.0 + time * 4.0) * 0.04) * isListening;
  // edgeDistort += (noise((uv * rot(time * 0.3)) * 4.0) * 0.04 - 0.02) * isThinking;
  // edgeDistort += (sin(dist * 15.0 - time * 8.0) * 0.02 + sin(angle * 12.0 + time * 6.0) * audio * 0.08) * isSpeaking;
  // edgeDistort += (sin(angle * 2.0 + time * 0.4) * 0.01) * isError;

  float radius = baseRadius + breathe; // purely constant circle shape (with slight size pulsing)

  float edgeSoftness = 0.08;
  float coreMask = 1.0 - smoothstep(radius - edgeSoftness, radius + edgeSoftness, dist);

  float outerGlow = pow(1.0 - smoothstep(radius, radius + 0.16, dist), 3.0);

  vec2 uvIdle = uv * 1.25;
  vec2 uvListen = uv * (1.1 - audio * 0.15);
  vec2 uvThink = uv * (1.2 + noise(uv * 2.0 + time) * 0.2);
  vec2 uvSpeak = uv * (1.3 + audio * 0.2);
  vec2 uvError = uv * 1.05;
  vec2 orbUv = uvIdle * isIdle + uvListen * isListening + uvThink * isThinking + uvSpeak * isSpeaking + uvError * isError;

  float swirlAngle = time * 0.05 * isIdle + time * 0.12 * isListening + time * 0.4 * isThinking + time * 0.2 * isSpeaking + time * 0.02 * isError;
  orbUv *= rot(swirlAngle);

  float d = -time * 0.5 * speed;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * orbUv.x);
    d += sin(orbUv.y * i + a);
  }
  d += time * 0.5 * speed;
  vec3 col = vec3(cos(orbUv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;

  float thinkingNoise = noise((uv * rot(-time * 0.2)) * 8.5) * 1.5;
  float speakRipple = sin(dist * 20.0 - time * 6.0);
  float listenRipple = sin(dist * 25.0 + time * 6.0);
  float errorFlicker = 1.0;

  col *= 0.9;
  col += uColor * thinkingNoise * 0.15 * isThinking;
  col += uColor * speakRipple * audio * 0.18 * isSpeaking;
  col += uColor * listenRipple * audio * 0.12 * isListening;

  float rim = smoothstep(radius - 0.14, radius, dist) * coreMask;
  // col += uColor * rim * (0.4 + 0.15 * isListening + 0.15 * isThinking + 0.2 * isSpeaking + 0.3 * isError);

  float fresnel = pow(smoothstep(radius * 0.5, radius, dist), 2.0) * coreMask;
  // col += vec3(1.0) * fresnel * (0.1 + 0.1 * isSpeaking + 0.1 * isError);

  float brightness = 1.0;
  brightness += 0.04 * isListening + 0.06 * isThinking + audio * 0.2 * isSpeaking;
  brightness *= mix(1.0, errorFlicker, isError);
  col *= brightness;

  vec3 glowColor = uColor * (0.6 + 0.1 * isListening + 0.1 * isThinking + 0.15 * isSpeaking + 0.15 * isError);

  vec3 finalColor = col * coreMask + glowColor * outerGlow * (1.0 - coreMask * 0.5);
  
  float alpha = max(coreMask, outerGlow * 0.52);
  gl_FragColor = vec4(finalColor, alpha);
}
`;;

export default function VoiceOrb({
  state,
  audioLevelRef,
  size = 400,
  className,
  ariaLabel,
}: VoiceOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glow1Ref = useRef<HTMLDivElement>(null);
  const glow2Ref = useRef<HTMLDivElement>(null);

  const rendererRef = useRef<Renderer | null>(null);
  const programRef = useRef<Program | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  const stateRef = useRef(stateToIndex[state]);
  const smoothedAudioLevelRef = useRef(0);

  const targetColorRef = useRef<[number, number, number]>([...stateColors[state]]);
  const currentColorRef = useRef<[number, number, number]>([...stateColors[state]]);

  const targetSpeedRef = useRef(stateSpeeds[state]);
  const currentSpeedRef = useRef(stateSpeeds[state]);
  const currentExtraSpeedRef = useRef(0);

  const reducedMotionRef = useRef(0);

  useEffect(() => {
    stateRef.current = stateToIndex[state];
    targetColorRef.current = [...stateColors[state]];
    targetSpeedRef.current = stateSpeeds[state];
  }, [state]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const updateReducedMotion = () => {
      reducedMotionRef.current = mediaQuery.matches ? 1 : 0;
    };

    updateReducedMotion();
    mediaQuery.addEventListener?.("change", updateReducedMotion);

    return () => {
      mediaQuery.removeEventListener?.("change", updateReducedMotion);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    container.innerHTML = "";

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
      });
    } catch (e) {
      console.error("Failed to initialize OGL renderer", e);
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    renderer.setSize(size * dpr, size * dpr);
    gl.canvas.style.width = `${size}px`;
    gl.canvas.style.height = `${size}px`;
    gl.canvas.style.display = "block";

    const geometry = new Triangle(gl);
    const colorUniform = new Color(...stateColors[state]);

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: colorUniform },
        uResolution: { value: [size * dpr, size * dpr] },
        uAudioLevel: { value: 0 },
        uState: { value: stateToIndex[state] },
        uSpeed: { value: stateSpeeds[state] },
        uReducedMotion: { value: reducedMotionRef.current },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });

    rendererRef.current = renderer;
    programRef.current = program;
    meshRef.current = mesh;

    container.appendChild(gl.canvas);
    startTimeRef.current = performance.now();

    const animate = () => {
      const renderer = rendererRef.current;
      const program = programRef.current;
      const mesh = meshRef.current;

      if (!renderer || !program || !mesh) return;

      const elapsed = (performance.now() - startTimeRef.current) / 1000;

      const targetColor = targetColorRef.current;
      const currentColor = currentColorRef.current;

      const colorLerp = reducedMotionRef.current > 0.5 ? 0.06 : 0.08;
      currentColor[0] += (targetColor[0] - currentColor[0]) * colorLerp;
      currentColor[1] += (targetColor[1] - currentColor[1]) * colorLerp;
      currentColor[2] += (targetColor[2] - currentColor[2]) * colorLerp;

      const targetAudio = audioLevelRef?.current ? clamp01(audioLevelRef.current) : 0;
      const currentAudio = smoothedAudioLevelRef.current;
      // Magical smooth decay for audio
      const audioLerp = targetAudio > currentAudio ? 0.15 : 0.03;
      smoothedAudioLevelRef.current += (targetAudio - currentAudio) * audioLerp;

      const currentState = stateRef.current;
      const audio = smoothedAudioLevelRef.current;

      let targetExtraSpeed = 0;
      const isAudioState = currentState === 1 || currentState === 3;
      if (isAudioState) {
        // Extra speed relative to audio input, strictly capped
        const maxThreshold = currentState === 3 ? 0.7 : 0.4;
        const speedBoost = audio * 1.5;
        targetExtraSpeed = Math.min(speedBoost, maxThreshold);
      }

      // Magical speed transitions for audio: smooth spin up, and very serene spin down
      const isSpeedingUp = targetExtraSpeed > currentExtraSpeedRef.current;
      let extraSpeedLerp = 0.1; // Fast drop off for state changes like error/idle
      if (isAudioState) {
        extraSpeedLerp = reducedMotionRef.current > 0.5
          ? (isSpeedingUp ? 0.02 : 0.005)
          : (isSpeedingUp ? 0.04 : 0.008);
      }

      currentExtraSpeedRef.current += (targetExtraSpeed - currentExtraSpeedRef.current) * extraSpeedLerp;

      // Base state speed transitions should be very incredibly responsive so state changes (like error) apply immediately
      const baseSpeedLerp = reducedMotionRef.current > 0.5 ? 0.05 : 0.15;
      currentSpeedRef.current += (targetSpeedRef.current - currentSpeedRef.current) * baseSpeedLerp;

      const color = program.uniforms.uColor.value as Color;
      if (color.set) {
        color.set(currentColor);
      } else {
        color[0] = currentColor[0];
        color[1] = currentColor[1];
        color[2] = currentColor[2];
      }

      program.uniforms.uTime.value = elapsed;
      program.uniforms.uAudioLevel.value = smoothedAudioLevelRef.current;
      program.uniforms.uState.value = stateRef.current;
      program.uniforms.uSpeed.value = currentSpeedRef.current + currentExtraSpeedRef.current;
      program.uniforms.uReducedMotion.value = reducedMotionRef.current;
      program.uniforms.uResolution.value = [size * dpr, size * dpr];

      renderer.render({ scene: mesh });

      if (glow1Ref.current) {
        let scale = 1.0;
        let opacity = 0.58;
        if (currentState === 3) {
          scale = 1.0 + audio * 0.18;
          opacity = 0.7 + audio * 0.25;
        } else if (currentState === 1) {
          scale = 1.0 + audio * 0.1;
          opacity = 0.6 + audio * 0.2;
        } else if (currentState === 4) {
          opacity = 0.4;
        }
        glow1Ref.current.style.transform = `scale(${scale})`;
        glow1Ref.current.style.opacity = opacity.toString();
      }

      if (glow2Ref.current) {
        let scale = 1.0;
        let opacity = 0.26;
        if (currentState === 3) {
          scale = 1.0 + audio * 0.12;
          opacity = 0.35 + audio * 0.45;
        } else if (currentState === 1) {
          opacity = 0.28 + audio * 0.3;
        } else if (currentState === 4) {
          opacity = 0.2;
        }
        glow2Ref.current.style.transform = `scale(${scale})`;
        glow2Ref.current.style.opacity = opacity.toString();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);

      try {
        if (renderer && renderer.gl) {
          const extension = renderer.gl.getExtension("WEBGL_lose_context");
          if (extension) extension.loseContext();
        }
      } catch {
        // ignore
      }

      if (container && renderer && renderer.gl && container.contains(renderer.gl.canvas)) {
        container.removeChild(renderer.gl.canvas);
      }

      rendererRef.current = null;
      programRef.current = null;
      meshRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]); // audioLevelRef and state are intentionally omitted to avoid WebGL tear down

  return (
    <div
      className={["relative flex items-center justify-center", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel ?? `Voice assistant status: ${state}`}
    >
      <div
        ref={glow1Ref}
        aria-hidden="true"
        className="absolute rounded-full blur-2xl transition-all duration-500 ease-out"
        style={{
          width: size * 0.9,
          height: size * 0.9,
          background: `radial-gradient(circle, ${glowColors[state]} 0%, transparent 60%)`
        }}
      />

      <div
        ref={glow2Ref}
        aria-hidden="true"
        className="absolute rounded-full blur-lg transition-all duration-300"
        style={{
          width: size * 0.85,
          height: size * 0.85,
          background:
            state === "thinking"
              ? `radial-gradient(circle, transparent 35%, ${glowColors[state]} 58%, transparent 78%)`
              : state === "error"
                ? `radial-gradient(circle, transparent 42%, ${glowColors[state]} 60%, transparent 80%)`
                : `radial-gradient(circle, transparent 40%, ${glowColors[state]} 60%, transparent 80%)`
        }}
      />

      <div
        ref={containerRef}
        className="relative z-10"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    </div>
  );
}

export { VoiceOrb };