"use client";
import Image from "next/image";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";

import { PlayerCard } from "@/components/player-card";
import { playersById } from "@/lib/data";
import { playerPhotoUrl } from "@/lib/format";
import { positionAccent } from "@/lib/position-style";
import { starPlayerIds } from "@/lib/star-players";

type OpeningPack = {
  id: string;
  kind: "daily" | "special";
  playerIds: string[];
  subtitle: string;
  title: string;
  image?: string;
  // Color del cacho que vuela al cortar (por defecto verde de marca).
  flap?: "green" | "white" | "black" | "navy";
};

type OpeningCard = {
  id: string;
  playerId: string;
};

type OverlayPhase = "carousel" | "focused" | "slashing" | "opening" | "reveal";

type SlashLineState = {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

type SlashPoint = {
  x: number;
  y: number;
};

type PackOpeningOverlayProps = {
  initialPackId: string;
  onAccept: (pack: OpeningPack) => Promise<void>;
  onClose: () => void;
  packs: OpeningPack[];
  pointsFor: (playerId: string) => number;
};

const carouselRadius = 4.5;
const packScale = 0.55;
const focusedPackY = -1.7;
const focusedPackZ = 2.5;
const focusedPackScale = packScale * 1.1;
// Seam del corte en el plano (local, centrado, alto packPlaneHeight=6.0). A
// ~9.4% del borde superior, sobre la línea lima del diseño (fila 113 de la
// imagen). Subir el número = línea más arriba.
const cutLocalY = 2.44;
const maxSlashAngle = 3 * (Math.PI / 180);
const envelopeHalfX = 2.034;
const envelopeMinY = -3.35;
const envelopeMaxY = 3.27;
// Carta plana del sobre: ancho = bordes del corte (envelopeHalfX*2) y alto al
// MISMO aspecto que sobre.png (818x1206) para no estirar la imagen.
const packPlaneWidth = envelopeHalfX * 2;
const packPlaneHeight = packPlaneWidth / (818 / 1206);

// Única fuente de verdad para el tamaño/posición del sobre según el ancho del
// viewport. El sobre visible, la detección del corte, la guía y la apertura
// consumen esto para que TODO se redimensione a la vez. En móvil (<520) el
// sobre se achica y baja un poco; escritorio (>=820) son los valores de
// siempre (sin regresión). Si en móvil el sobre se ve grande o pequeño, este
// 0.90 es el ÚNICO número a tocar: todo lo demás lo sigue. El sobre es vertical
// y la pantalla estrecha, así que SIEMPRE debe quedar margen lateral. Calibrado
// a ojo: 0.76 dejaba ~15% por lado, 0.90 deja ~8-9%; subir más come ese margen.
function packLayout(width: number) {
  const scale = focusedPackScale * (width < 520 ? 0.9 : width < 820 ? 0.98 : 1);
  const y = width < 520 ? focusedPackY - 0.12 : focusedPackY;
  return { scale, y };
}

// Geometría del corte derivada del layout. El seam está a cutLocalY (local)
// por encima del ancla, así que en mundo es y + cutLocalY*scale. Z y cutLocalY
// NO se escalan: el transform móvil solo mueve Y y escala.
function cutLayout(width: number) {
  const { scale, y } = packLayout(width);
  return {
    scale,
    y,
    cutY: y + cutLocalY * scale,
    cutZ: focusedPackZ + 0.2 * scale,
    halfX: envelopeHalfX * scale,
  };
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

// Textura del sobre: la imagen de marca, cargada UNA vez POR URL y compartida
// por todas las caras/mitades que usan ese sobre (cada sobre puede tener su
// imagen: /sobre.png, /sobre-madrid.png…). No se clona: al cargar (async) el
// TextureLoader marca needsUpdate y todos los materiales que la referencian se
// actualizan.
const packImageTextures = new Map<string, THREE.Texture>();
function getPackImageTexture(url = "/sobre.png") {
  let texture = packImageTextures.get(url);
  if (!texture) {
    texture = new THREE.TextureLoader().load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    packImageTextures.set(url, texture);
  }
  return texture;
}

function usePackTexture(url?: string) {
  return getPackImageTexture(url || "/sobre.png");
}

// Textura de la TAPA que se corta y vuela: un foil con borde dentado (crimp)
// arriba y una línea de "borde", como el sellado de un sobre. El trozo real de
// la imagen ahí salía oscuro/mal al volar; esto es claro y con forma de "cacho
// de sobre". Mismo aspecto que el plano (818x1206) para alinear. Variante por
// sobre: verde de marca (por defecto) o blanco (sobre Madrid). Cacheada por
// variante.
const packFlapTextures = new Map<string, THREE.CanvasTexture>();
function getFlapTexture(variant: "green" | "white" | "black" | "navy" = "green") {
  const cached = packFlapTextures.get(variant);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 818;
  canvas.height = 1206;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    packFlapTextures.set(variant, fallback);
    return fallback;
  }
  // Paleta del foil por variante. `black` = sobre21 (negro con filo dorado),
  // `navy` = sobre-estrellas (azul MUY oscuro con filo dorado): foil oscuro +
  // sheen/línea dorados, a juego con la imagen de cada sobre.
  const palettes = {
    white: {
      top: "#ffffff",
      mid: "#eaeef3",
      bottom: "#c8d0da",
      sheen: "rgba(255,255,255,0.5)",
      line: "#9aa6b4",
    },
    black: {
      top: "#1c1c1c",
      mid: "#101010",
      bottom: "#070707",
      sheen: "rgba(212,175,55,0.16)",
      line: "#caa23c",
    },
    navy: {
      top: "#16203a",
      mid: "#0c1124",
      bottom: "#070a14",
      sheen: "rgba(200,178,110,0.15)",
      line: "#b89a3e",
    },
    green: {
      top: "#327f27",
      mid: "#1f5418",
      bottom: "#13320e",
      sheen: "rgba(167,246,0,0.18)",
      line: "#a7f600",
    },
  } as const;
  const palette = palettes[variant] ?? palettes.green;
  // El corte está al ~10% de arriba; dibujamos el foil hasta el ~13%.
  const flapBottom = 150;
  const grad = ctx.createLinearGradient(0, 0, 0, flapBottom);
  grad.addColorStop(0, palette.top);
  grad.addColorStop(0.55, palette.mid);
  grad.addColorStop(1, palette.bottom);
  ctx.fillStyle = grad;
  // Borde "crimp" (dientes) en el borde superior.
  const teeth = 24;
  const toothW = 818 / teeth;
  const toothH = 18;
  ctx.beginPath();
  ctx.moveTo(0, toothH);
  for (let i = 0; i < teeth; i += 1) {
    ctx.lineTo(i * toothW + toothW / 2, 0);
    ctx.lineTo((i + 1) * toothW, toothH);
  }
  ctx.lineTo(818, flapBottom);
  ctx.lineTo(0, flapBottom);
  ctx.closePath();
  ctx.fill();
  // Sheen diagonal, solo sobre el foil.
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const sheen = ctx.createLinearGradient(0, 0, 818, 0);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, palette.sheen);
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 818, flapBottom);
  ctx.restore();
  // Línea del "borde" del cacho.
  ctx.fillStyle = palette.line;
  ctx.fillRect(0, 96, 818, 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  packFlapTextures.set(variant, texture);
  return texture;
}

// Fragment shader compartido del fondo "nebulosa" (domain warping, paleta de
// marca, viñeta). Lo usan el revelado HTML (`ShaderBackground`, raw WebGL) y la
// escena 3D del sobre (`SceneShaderBackground`, RawShaderMaterial). gl_FragCoord
// + u_resolution lo hacen independiente del tamaño/dpr.
const NEBULA_FRAGMENT = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_srgb;
  uniform vec3 u_tint;
  float hash(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.0; a *= 0.5; }
    return v;
  }
  void main(){
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 p = uv * vec2(u_resolution.x / u_resolution.y, 1.0) * 2.4;
    float t = u_time * 0.06;
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) + t * 0.5));
    vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.4),
                  fbm(p + 4.0 * q + vec2(8.3, 2.8) - t * 0.3));
    float f = fbm(p + 4.0 * r);
    // Paleta derivada del tinte del sobre (u_tint): nebulosa monocroma con
    // variación de luminancia (deep = base oscura, mid/bright = acentos, mist =
    // bruma clara). Así el fondo cambia de color según el sobre.
    vec3 deep   = u_tint * 0.16;
    vec3 mid    = u_tint * 0.55;
    vec3 bright = clamp(u_tint * 1.30, 0.0, 1.0);
    vec3 mist   = mix(u_tint, vec3(1.0), 0.55) * 0.78;
    vec3 color = deep;
    color = mix(color, bright, clamp(f * f * 2.4, 0.0, 1.0));
    color = mix(color, mid,    clamp(length(q) * 0.9, 0.0, 1.0));
    color = mix(color, bright, clamp(r.x * 0.5, 0.0, 1.0));
    color = mix(color, mist,   clamp((f - 0.55) * 1.7, 0.0, 1.0));
    float vignette = smoothstep(1.2, 0.30, length(uv - 0.5));
    color *= mix(0.28, 1.0, vignette);
    color *= 0.92;
    // u_srgb=1 (escena 3D): three convierte la salida lineal->sRGB y la aclara;
    // linealizamos para igualar al canvas HTML (sin gestión de color). u_srgb=0
    // (HTML, por defecto): salida directa.
    color = mix(color, pow(max(color, 0.0), vec3(2.2)), u_srgb);
    gl_FragColor = vec4(color, 1.0);
  }`;

// Tinte de la nebulosa según el TIPO de sobre (su `flap`): el fondo cambia de
// color con cada sobre. Valores en espacio de pantalla (sRGB-ish), un solo tono
// dominante por sobre (el shader le saca la variación de luminancia).
type NebulaTint = [number, number, number];
const NEBULA_TINTS: Record<NonNullable<OpeningPack["flap"]>, NebulaTint> = {
  green: [0.1, 0.34, 0.24], // diario / promesas: verde-teal de marca
  white: [0.3, 0.36, 0.46], // Madrid: plata frío
  black: [0.46, 0.33, 0.1], // sobre 21 (negro + oro): oro/ámbar
  navy: [0.12, 0.2, 0.52], // estrellas (azul + oro): azul real
};
function nebulaTint(flap?: OpeningPack["flap"]): NebulaTint {
  return NEBULA_TINTS[flap ?? "green"] ?? NEBULA_TINTS.green;
}

// Acento VIVO por tipo de sobre para luces y partículas de la escena 3D (las
// partículas no siempre verdes). Cohesivo con NEBULA_TINTS pero más saturado y
// brillante (las luces necesitan pegar). Mismo criterio: verde diario, plata
// Madrid, oro sobre21, azul Estrellas.
const PACK_ACCENTS: Record<NonNullable<OpeningPack["flap"]>, string> = {
  green: "#a7f600",
  white: "#d7e3ff",
  black: "#ffd24d",
  navy: "#6aa6ff",
};
function packAccent(flap?: OpeningPack["flap"]): string {
  return PACK_ACCENTS[flap ?? "green"] ?? PACK_ACCENTS.green;
}

// Fondo de la escena 3D del sobre: el MISMO shader nebulosa como quad a pantalla
// completa (RawShaderMaterial), detrás de todo (renderOrder -1, sin depth). El
// vertex shader saca el quad directo en clip-space, ignorando la cámara, así que
// llena la pantalla sea cual sea el encuadre.
function SceneShaderBackground({
  tint = NEBULA_TINTS.green,
}: {
  tint?: NebulaTint;
}) {
  const matRef = useRef<THREE.RawShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_srgb: { value: 1 },
      u_tint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useFrame(({ gl }) => {
    const mat = matRef.current;
    if (!mat) return;
    // Reloj compartido con el revelado HTML (performance.now): el patrón es
    // continuo al pasar de la escena 3D al revelado HTML, sin "recarga".
    mat.uniforms.u_time.value = performance.now() / 1000;
    // gl es el WebGLRenderer; getDrawingBufferSize da el tamaño real del buffer
    // (canvas * pixelRatio), que es el espacio de gl_FragCoord.
    gl.getDrawingBufferSize(mat.uniforms.u_resolution.value);
    // Tinte por sobre (por si cambia el sobre seleccionado sin remmontar).
    mat.uniforms.u_tint.value.set(tint[0], tint[1], tint[2]);
  });
  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <rawShaderMaterial
        ref={matRef}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
        vertexShader="attribute vec3 position; void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }"
        fragmentShader={NEBULA_FRAGMENT}
      />
    </mesh>
  );
}

function PackPrimitive({
  groupRef,
  image,
}: {
  groupRef?: RefObject<THREE.Group | null>;
  image?: string;
}) {
  const internalRef = useRef<THREE.Group>(null);
  const ref = groupRef || internalRef;
  const texture = usePackTexture(image);

  // El sobre es una CARTA PLANA con la imagen de marca (en escena solo se ve de
  // frente, así que no hace falta el modelo 3D). El plano va al aspecto exacto
  // de sobre.png para no estirar; ocupa el mismo espacio local que ocupaba el
  // modelo, así que el corte/apertura siguen valiendo. Material sin re-iluminar
  // (el foil ya viene horneado) y alphaTest recorta el fondo transparente.
  return (
    <group ref={ref}>
      <mesh>
        <planeGeometry args={[packPlaneWidth, packPlaneHeight]} />
        <meshBasicMaterial
          map={texture}
          toneMapped={false}
          transparent
          alphaTest={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function CarouselPacks({
  onPackPick,
  onSelectedIndexChange,
  packs,
  selectedIndex,
}: {
  onPackPick: (index: number) => void;
  onSelectedIndexChange: (index: number) => void;
  packs: OpeningPack[];
  selectedIndex: number;
}) {
  const packRefs = useRef<(THREE.Group | null)[]>([]);
  const { camera, gl, size } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const anglePerPack = (Math.PI * 2) / Math.max(packs.length, 1);
  const angleRef = useRef(-selectedIndex * anglePerPack);
  const targetAngleRef = useRef(-selectedIndex * anglePerPack);
  const pointer = useRef({
    down: false,
    moved: false,
    pointerId: null as number | null,
    startAngle: 0,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
  });

  const findHitPackIndex = useCallback(
    (clientX: number, clientY: number) => {
      const ndc = new THREE.Vector2(
        (clientX / window.innerWidth) * 2 - 1,
        -(clientY / window.innerHeight) * 2 + 1,
      );
      raycaster.current.setFromCamera(ndc, camera);
      const objects = packRefs.current.filter(Boolean) as THREE.Group[];
      const hits = raycaster.current.intersectObjects(objects, true);
      if (hits.length === 0) return -1;
      const hitObject = hits[0].object;
      return objects.findIndex((group) => {
        let found = false;
        group.traverse((child) => {
          if (child === hitObject) found = true;
        });
        return found;
      });
    },
    [camera],
  );

  useEffect(() => {
    targetAngleRef.current = -selectedIndex * anglePerPack;
  }, [anglePerPack, selectedIndex]);

  useEffect(() => {
    const dom = gl.domElement;

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      pointer.current = {
        down: true,
        moved: false,
        pointerId: event.pointerId,
        startAngle: targetAngleRef.current,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
      };
      try {
        dom.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail if the browser already released it.
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!event.isPrimary || !pointer.current.down) return;
      if (
        pointer.current.pointerId !== null &&
        event.pointerId !== pointer.current.pointerId
      ) {
        return;
      }
      const dx = event.clientX - pointer.current.startX;
      const dy = event.clientY - pointer.current.startY;
      pointer.current.x = event.clientX;
      pointer.current.y = event.clientY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) pointer.current.moved = true;
      targetAngleRef.current =
        pointer.current.startAngle + (dx / window.innerWidth) * Math.PI * 2;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary || !pointer.current.down) return;
      if (
        pointer.current.pointerId !== null &&
        event.pointerId !== pointer.current.pointerId
      ) {
        return;
      }
      pointer.current.down = false;
      const raw = Math.round(-targetAngleRef.current / anglePerPack);
      const snapped = ((raw % packs.length) + packs.length) % packs.length;
      const hitIndex = findHitPackIndex(pointer.current.x, pointer.current.y);
      const next = !pointer.current.moved && hitIndex >= 0 ? hitIndex : snapped;
      targetAngleRef.current = -next * anglePerPack;
      onSelectedIndexChange(next);
      if (!pointer.current.moved) onPackPick(next);
      pointer.current.pointerId = null;
      try {
        dom.releasePointerCapture(event.pointerId);
      } catch {
        // Some browsers auto-release pointer capture.
      }
    };

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointercancel", onPointerUp);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    anglePerPack,
    findHitPackIndex,
    gl,
    onPackPick,
    onSelectedIndexChange,
    packs.length,
  ]);

  useFrame((_, delta) => {
    const clamped = Math.min(delta, 0.05);
    angleRef.current = lerp(
      angleRef.current,
      targetAngleRef.current,
      6 * clamped,
    );
    const viewportScale = size.width < 520 ? 0.78 : size.width < 900 ? 0.9 : 1;

    packs.forEach((pack, index) => {
      const group = packRefs.current[index];
      if (!group) return;
      const angle = angleRef.current + index * anglePerPack;
      const targetPos = new THREE.Vector3(
        Math.sin(angle) * carouselRadius * viewportScale,
        size.width < 520 ? -0.3 : -0.12,
        Math.cos(angle) * carouselRadius - carouselRadius,
      );
      const frontness =
        (targetPos.z + carouselRadius * 2) / (carouselRadius * 2);
      const scale = packScale * viewportScale * (0.72 + frontness * 0.34);
      group.position.lerp(targetPos, 6 * clamped);
      group.rotation.x = lerp(group.rotation.x, 0, 5 * clamped);
      group.rotation.y = lerp(group.rotation.y, -angle, 5 * clamped);
      group.rotation.z = lerp(group.rotation.z, 0, 5 * clamped);
      group.scale.lerp(new THREE.Vector3(scale, scale, scale), 6 * clamped);
      group.visible = true;
    });
  });

  return (
    <group>
      {packs.map((pack, index) => (
        <group
          key={`${pack.id}-holder`}
          ref={(element) => {
            packRefs.current[index] = element;
          }}
        >
          <PackPrimitive image={pack.image} />
        </group>
      ))}
    </group>
  );
}

// Material de la guía de corte: línea de puntos BLANCA con glow, una sola vez
// (constante). La opacidad la anima CutGuide por frame.
let cutGuideMaterial: THREE.MeshBasicMaterial | null = null;
function getCutGuideMaterial() {
  if (cutGuideMaterial) return cutGuideMaterial;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) {
    cutGuideMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    return cutGuideMaterial;
  }
  context.clearRect(0, 0, 512, 32);
  // Halo oscuro + línea de puntos NEGRA, más gruesa. (NO AdditiveBlending: con
  // aditivo el negro no aporta nada y es invisible; con blending normal el negro
  // oscurece y se ve sobre el verde.)
  const glow = context.createLinearGradient(0, 0, 0, 32);
  glow.addColorStop(0, "rgba(0,0,0,0)");
  glow.addColorStop(0.42, "rgba(0,0,0,0.32)");
  glow.addColorStop(0.5, "rgba(0,0,0,0.62)");
  glow.addColorStop(0.58, "rgba(0,0,0,0.32)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 512, 32);
  context.strokeStyle = "#000000";
  context.lineWidth = 8;
  context.setLineDash([16, 10]);
  context.beginPath();
  context.moveTo(0, 16);
  context.lineTo(512, 16);
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cutGuideMaterial = new THREE.MeshBasicMaterial({
    depthWrite: false,
    map: texture,
    opacity: 0,
    side: THREE.DoubleSide,
    transparent: true,
  });
  return cutGuideMaterial;
}

function CutGuide({ visible }: { visible: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const drawProgress = useRef(0);
  const { size } = useThree();
  const { scale, cutY, cutZ } = cutLayout(size.width);
  // 3.4 (no 3.8): el foil del sobre ocupa ~86% del ancho del plano, así la línea
  // queda DENTRO de los bordes y no se sale.
  const lineWidth = 3.4 * scale;
  const leftEdge = -lineWidth / 2;

  const material = getCutGuideMaterial();

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const clamped = Math.min(delta, 0.05);
    drawProgress.current = visible
      ? Math.min(drawProgress.current + clamped / 0.5, 1)
      : 0;
    const progress = drawProgress.current;
    meshRef.current.scale.x = progress;
    meshRef.current.position.x = leftEdge + (lineWidth * progress) / 2;
    const meshMaterial = meshRef.current.material as THREE.MeshBasicMaterial;
    meshMaterial.opacity = progress;
  });

  return (
    <mesh
      ref={meshRef}
      material={material}
      position={[leftEdge, cutY, cutZ]}
      scale={[0, 1, 1]}
    >
      <planeGeometry args={[lineWidth, 0.14]} />
    </mesh>
  );
}

function SlashStroke({
  phase,
  slashPath,
}: {
  phase: OverlayPhase;
  slashPath: SlashPoint[];
}) {
  const glowMeshRef = useRef<THREE.Mesh>(null);
  const coreMeshRef = useRef<THREE.Mesh>(null);
  const { camera, size } = useThree();
  const showSlash = phase === "slashing" && slashPath.length >= 2;

  const clipPlanes = useMemo(() => {
    const { scale, y } = packLayout(size.width);
    return [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), envelopeHalfX * scale),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), envelopeHalfX * scale),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -(y + envelopeMinY * scale)),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y + envelopeMaxY * scale),
    ];
  }, [size.width]);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => {
      const ndc = new THREE.Vector3(
        (screenX / window.innerWidth) * 2 - 1,
        -(screenY / window.innerHeight) * 2 + 1,
        0.5,
      );
      ndc.unproject(camera);
      const direction = new THREE.Vector3()
        .subVectors(ndc, camera.position)
        .normalize();
      const distance = (focusedPackZ + 0.15 - camera.position.z) / direction.z;
      return new THREE.Vector3(
        camera.position.x + direction.x * distance,
        camera.position.y + direction.y * distance,
        focusedPackZ + 0.15,
      );
    },
    [camera],
  );

  const buildGeometry = useCallback(
    (points: SlashPoint[], width: number) => {
      if (points.length < 2) return null;
      const worldPoints = points.map((point) =>
        screenToWorld(point.x, point.y),
      );
      const positions = new Float32Array(worldPoints.length * 2 * 3);
      const colors = new Float32Array(worldPoints.length * 2 * 4);
      const indices: number[] = [];

      for (let index = 0; index < worldPoints.length; index += 1) {
        const point = worldPoints[index];
        const next = worldPoints[Math.min(index + 1, worldPoints.length - 1)];
        const previous = worldPoints[Math.max(index - 1, 0)];
        const dx = next.x - previous.x;
        const dy = next.y - previous.y;
        const length = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / length;
        const ny = dx / length;
        const topOffset = index * 6;
        const bottomOffset = topOffset + 3;
        positions[topOffset] = point.x + nx * width;
        positions[topOffset + 1] = point.y + ny * width;
        positions[topOffset + 2] = focusedPackZ + 0.151;
        positions[bottomOffset] = point.x - nx * width;
        positions[bottomOffset + 1] = point.y - ny * width;
        positions[bottomOffset + 2] = focusedPackZ + 0.151;

        const colorOffset = index * 8;
        colors[colorOffset] = 1;
        colors[colorOffset + 1] = 1;
        colors[colorOffset + 2] = 1;
        colors[colorOffset + 3] = width > 0.02 ? 0.36 : 1;
        colors[colorOffset + 4] = 1;
        colors[colorOffset + 5] = 1;
        colors[colorOffset + 6] = 1;
        colors[colorOffset + 7] = width > 0.02 ? 0.36 : 1;

        if (index < worldPoints.length - 1) {
          const vertex = index * 2;
          indices.push(vertex, vertex + 1, vertex + 2);
          indices.push(vertex + 1, vertex + 3, vertex + 2);
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
      geometry.setIndex(indices);
      return geometry;
    },
    [screenToWorld],
  );

  useEffect(() => {
    if (showSlash) return;
    if (glowMeshRef.current?.geometry) {
      glowMeshRef.current.geometry.dispose();
      glowMeshRef.current.geometry = new THREE.BufferGeometry();
    }
    if (coreMeshRef.current?.geometry) {
      coreMeshRef.current.geometry.dispose();
      coreMeshRef.current.geometry = new THREE.BufferGeometry();
    }
  }, [showSlash]);

  useFrame(() => {
    if (!showSlash) return;
    const glowGeometry = buildGeometry(slashPath, 0.045);
    const coreGeometry = buildGeometry(slashPath, 0.014);
    if (glowMeshRef.current && glowGeometry) {
      glowMeshRef.current.geometry.dispose();
      glowMeshRef.current.geometry = glowGeometry;
    }
    if (coreMeshRef.current && coreGeometry) {
      coreMeshRef.current.geometry.dispose();
      coreMeshRef.current.geometry = coreGeometry;
    }
  });

  if (!showSlash) return null;

  return (
    <group>
      <mesh ref={glowMeshRef}>
        <bufferGeometry />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          clippingPlanes={clipPlanes}
          depthWrite={false}
          side={THREE.DoubleSide}
          transparent
          vertexColors
        />
      </mesh>
      <mesh ref={coreMeshRef}>
        <bufferGeometry />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          clippingPlanes={clipPlanes}
          depthWrite={false}
          side={THREE.DoubleSide}
          transparent
          vertexColors
        />
      </mesh>
    </group>
  );
}

function findClipPlane(root: THREE.Object3D | null) {
  let plane: THREE.Plane | null = null;
  root?.traverse((child) => {
    if (plane || !(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      const clipped = material as THREE.Material & {
        clippingPlanes?: THREE.Plane[];
      };
      if (clipped.clippingPlanes?.[0]) {
        plane = clipped.clippingPlanes[0];
        break;
      }
    }
  });
  return plane;
}

function PackHalves({
  active,
  onComplete,
  pack,
  slashLine,
}: {
  active: boolean;
  onComplete: () => void;
  pack: OpeningPack;
  slashLine: SlashLineState | null;
}) {
  const topRef = useRef<THREE.Group>(null);
  const bottomRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const glowTwoRef = useRef<THREE.PointLight>(null);
  const doneRef = useRef(false);
  const progressRef = useRef(0);
  const clipPlanesRef = useRef<{
    body: THREE.Plane | null;
    flap: THREE.Plane | null;
  }>({ body: null, flap: null });
  const texture = usePackTexture(pack.image);
  const { size } = useThree();
  const { scale, y, cutY } = cutLayout(size.width);
  const slashNormal = useMemo(() => {
    if (!slashLine) return new THREE.Vector3(0, 1, 0);
    const dx = slashLine.x2 - slashLine.x1;
    const dy = slashLine.y2 - slashLine.y1;
    const angle = Math.atan2(-dy, dx);
    return new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0).normalize();
  }, [slashLine]);

  useEffect(() => {
    if (!active) return;
    doneRef.current = false;
    progressRef.current = 0;
  }, [active, pack.id]);

  const { bottomScene, topScene } = useMemo(() => {
    // Placeholder: PackHalves recalcula el plano de corte cada frame con
    // cutLocalY + matrixWorld (responsive), así que este valor inicial se
    // sobreescribe antes del primer paint y no necesita ser responsive.
    const seamY = focusedPackY + cutLocalY * focusedPackScale;
    const flapClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -seamY);
    const bodyClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), seamY);
    const makeHalf = (clipPlane: THREE.Plane, isFlap: boolean) => {
      // La TAPA que se corta y vuela (isFlap) usa un verde liso del estilo del
      // sobre: el trozo de imagen ahí arriba (el crimp) salía oscuro/mal mapeado
      // al volar. El CUERPO lleva la imagen (con alphaTest para recortar el
      // fondo transparente del PNG).
      const material = isFlap
        ? new THREE.MeshBasicMaterial({
            clippingPlanes: [clipPlane],
            map: getFlapTexture(pack.flap),
            toneMapped: false,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
          })
        : new THREE.MeshBasicMaterial({
            clippingPlanes: [clipPlane],
            map: texture,
            toneMapped: false,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
          });
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(packPlaneWidth, packPlaneHeight),
        material,
      );
      const group = new THREE.Group();
      group.add(mesh);
      return group;
    };

    return {
      bottomScene: makeHalf(flapClipPlane, true),
      topScene: makeHalf(bodyClipPlane, false),
    };
  }, [pack.flap, texture]);

  useEffect(() => {
    clipPlanesRef.current.body = findClipPlane(topScene);
    clipPlanesRef.current.flap = findClipPlane(bottomScene);
    // Sin esto, cada apertura deja 2 escenas clonadas + sus materiales y mapas
    // sin liberar (fuga de memoria de GPU que degrada la fluidez con el uso).
    return () => {
      [topScene, bottomScene].forEach((root) => {
        root.traverse((child) => {
          if (!(child as THREE.Mesh).isMesh) return;
          const mesh = child as THREE.Mesh;
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          // La textura del sobre es compartida (módulo, una sola carga); NO la
          // disponemos aquí, solo el material y la geometría del plano.
          materials.forEach((material) => material.dispose());
          mesh.geometry.dispose();
        });
      });
    };
  }, [bottomScene, topScene]);

  useFrame((_, delta) => {
    if (!active || !topRef.current || !bottomRef.current) return;
    const flapClipPlane = clipPlanesRef.current.flap;
    const bodyClipPlane = clipPlanesRef.current.body;
    if (!flapClipPlane || !bodyClipPlane) return;

    progressRef.current += Math.min(delta, 0.05) * 0.8;
    const progress = progressRef.current;
    const anticipation =
      Math.sin(clamp(progress / 0.18) * Math.PI) *
      Math.max(0, 1 - progress / 0.5);
    const flapProgress = clamp(progress / 0.6);
    const flapEase = easeOutCubic(flapProgress);
    const flapOpacity = 1 - easeOutCubic(clamp((flapProgress - 0.15) / 0.85));
    const slideProgress = clamp((progress - 0.6) / 1.6);
    const slideEase = easeOutCubic(slideProgress);

    bottomRef.current.position.set(
      flapEase * 0.3,
      y + flapEase * 2.5 - anticipation * 0.12,
      focusedPackZ + flapEase * 0.5 + anticipation * 0.14,
    );
    bottomRef.current.rotation.x = flapEase * -0.3 - anticipation * 0.08;
    bottomRef.current.rotation.z = flapEase * 0.15;
    bottomRef.current.scale.setScalar(scale * (1 - flapEase * 0.1));

    topRef.current.position.set(
      0,
      y - slideEase * 6 + anticipation * 0.06,
      focusedPackZ - anticipation * 0.05,
    );
    topRef.current.scale.setScalar(scale * (1 + anticipation * 0.025));

    bottomRef.current.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      materials.forEach((material) => {
        material.transparent = true;
        material.opacity = flapOpacity;
      });
    });

    flapClipPlane.normal.copy(slashNormal);
    flapClipPlane.constant = -slashNormal.y * cutLocalY;
    bottomRef.current.updateMatrixWorld();
    flapClipPlane.applyMatrix4(bottomRef.current.matrixWorld);

    bodyClipPlane.normal.copy(slashNormal).negate();
    bodyClipPlane.constant = slashNormal.y * cutLocalY;
    topRef.current.updateMatrixWorld();
    bodyClipPlane.applyMatrix4(topRef.current.matrixWorld);

    if (glowRef.current && glowTwoRef.current) {
      const glowTime = progress - 0.1;
      const glow =
        glowTime < 0
          ? 0
          : glowTime < 0.35
            ? easeOutCubic(glowTime / 0.35)
            : glowTime < 0.75
              ? 1
              : Math.max(0, 1 - easeOutCubic((glowTime - 0.75) / 0.6));
      glowRef.current.intensity = glow * 10 + anticipation * 2;
      glowTwoRef.current.intensity = glow * 5 + anticipation;
    }

    if (progress > 1.5 && !doneRef.current) {
      doneRef.current = true;
      onComplete();
    }
  });

  if (!active) return null;

  return (
    <>
      <group ref={topRef} position={[0, y, focusedPackZ]} scale={scale}>
        <primitive object={topScene} />
      </group>
      <group ref={bottomRef} position={[0, y, focusedPackZ]} scale={scale}>
        <primitive object={bottomScene} />
      </group>
      <pointLight
        ref={glowRef}
        color={packAccent(pack.flap)}
        distance={15}
        intensity={0}
        position={[0, cutY + 0.3, focusedPackZ + 0.8]}
      />
      <pointLight
        ref={glowTwoRef}
        color="#ffffff"
        distance={20}
        intensity={0}
        position={[0, cutY + 1, focusedPackZ + 0.3]}
      />
    </>
  );
}

function FocusedPack({
  image,
  onPackSettled,
  onSlashCancel,
  onSlashComplete,
  onSlashStart,
  onSlashUpdate,
  phase,
  slashLine,
}: {
  image?: string;
  onPackSettled: (settled: boolean) => void;
  onSlashCancel: () => void;
  onSlashComplete: () => void;
  onSlashStart: (line: SlashLineState, path: SlashPoint[]) => void;
  onSlashUpdate: (line: SlashLineState, point: SlashPoint) => void;
  phase: OverlayPhase;
  slashLine: SlashLineState | null;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, gl, size } = useThree();
  const phaseRef = useRef<OverlayPhase>(phase);
  const slashLineRef = useRef<SlashLineState | null>(slashLine);
  const pointer = useRef({
    completed: false,
    down: false,
    moved: false,
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
  });

  useEffect(() => {
    phaseRef.current = phase;
    slashLineRef.current = slashLine;
  }, [phase, slashLine]);

  const getCutScreenY = useCallback(() => {
    const { cutY, cutZ } = cutLayout(size.width);
    const cutScreenPos = new THREE.Vector3(0, cutY, cutZ);
    cutScreenPos.project(camera);
    return ((-cutScreenPos.y + 1) / 2) * window.innerHeight;
  }, [camera, size.width]);

  const getPackScreenEdges = useCallback(() => {
    // Solo halfX es responsive; Z se mantiene en focusedPackZ para que en
    // escritorio los bordes proyecten EXACTAMENTE igual que antes (sin
    // regresión en el hit-test). La X proyectada no depende de Y con la cámara
    // on-axis, así que dejar focusedPackY es indiferente.
    const { halfX } = cutLayout(size.width);
    const left = new THREE.Vector3(-halfX, focusedPackY, focusedPackZ);
    const right = new THREE.Vector3(halfX, focusedPackY, focusedPackZ);
    left.project(camera);
    right.project(camera);
    return {
      left: ((left.x + 1) / 2) * window.innerWidth,
      right: ((right.x + 1) / 2) * window.innerWidth,
    };
  }, [camera, size.width]);

  useEffect(() => {
    if (phase !== "focused" && phase !== "slashing") return;
    const dom = gl.domElement;

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      pointer.current = {
        completed: false,
        down: true,
        moved: false,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      try {
        dom.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can be unavailable during browser gesture transitions.
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = pointer.current;
      if (!event.isPrimary || !current.down) return;
      if (current.pointerId !== null && event.pointerId !== current.pointerId) {
        return;
      }

      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) current.moved = true;

      if (phaseRef.current === "focused") {
        if (Math.abs(dx) <= 15) return;
        const cutScreenY = getCutScreenY();
        const tolerance = window.innerHeight * 0.12;
        if (Math.abs(event.clientY - cutScreenY) > tolerance) return;
        const edges = getPackScreenEdges();
        const goingRight = dx > 0;
        const startX = goingRight ? edges.left : edges.right;
        const line = {
          x1: startX,
          x2: event.clientX,
          y1: cutScreenY,
          y2: cutScreenY,
        };
        onSlashStart(line, [
          { x: startX, y: cutScreenY },
          { x: event.clientX, y: cutScreenY },
        ]);
        phaseRef.current = "slashing";
        slashLineRef.current = line;
        return;
      }

      const activeLine = slashLineRef.current;
      if (!activeLine) return;
      const slashDx = event.clientX - activeLine.x1;
      const maxDy = Math.abs(slashDx) * Math.tan(maxSlashAngle);
      const clampedY = Math.max(
        activeLine.y1 - maxDy,
        Math.min(activeLine.y1 + maxDy, event.clientY),
      );
      const nextLine = {
        ...activeLine,
        x2: event.clientX,
        y2: clampedY,
      };
      slashLineRef.current = nextLine;
      onSlashUpdate(nextLine, { x: event.clientX, y: clampedY });

      const edges = getPackScreenEdges();
      const goingRight = event.clientX > activeLine.x1;
      const reached = goingRight
        ? event.clientX >= edges.right
        : event.clientX <= edges.left;
      if (reached) {
        current.completed = true;
        phaseRef.current = "opening";
        onSlashComplete();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const current = pointer.current;
      if (!event.isPrimary || !current.down) return;
      if (current.pointerId !== null && event.pointerId !== current.pointerId) {
        return;
      }
      if (dom.hasPointerCapture?.(event.pointerId)) {
        try {
          dom.releasePointerCapture(event.pointerId);
        } catch {
          // Some browsers auto-release capture.
        }
      }
      if (phaseRef.current === "focused" && current.moved) {
        const dx = event.clientX - current.startX;
        const cutScreenY = getCutScreenY();
        const tolerance = window.innerHeight * 0.12;
        if (
          Math.abs(dx) > 90 &&
          Math.abs(current.startY - cutScreenY) < tolerance
        ) {
          const edges = getPackScreenEdges();
          const goingRight = dx > 0;
          const startX = goingRight ? edges.left : edges.right;
          const endX = goingRight ? edges.right : edges.left;
          const line = {
            x1: startX,
            x2: endX,
            y1: cutScreenY,
            y2: cutScreenY,
          };
          onSlashStart(line, [
            { x: startX, y: cutScreenY },
            { x: endX, y: cutScreenY },
          ]);
          current.completed = true;
          phaseRef.current = "opening";
          onSlashComplete();
        }
      }

      if (phaseRef.current === "slashing" && !current.completed) {
        phaseRef.current = "focused";
        onSlashCancel();
      }
      current.down = false;
      current.pointerId = null;
    };

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    getCutScreenY,
    getPackScreenEdges,
    gl,
    onSlashCancel,
    onSlashComplete,
    onSlashStart,
    onSlashUpdate,
    phase,
  ]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const clamped = Math.min(delta, 0.05);
    const { scale, y } = packLayout(size.width);
    const target = new THREE.Vector3(0, y, focusedPackZ);
    groupRef.current.position.lerp(target, 5 * clamped);
    groupRef.current.rotation.x = lerp(
      groupRef.current.rotation.x,
      0,
      5 * clamped,
    );
    groupRef.current.rotation.y = lerp(
      groupRef.current.rotation.y,
      0,
      5 * clamped,
    );
    groupRef.current.rotation.z = lerp(
      groupRef.current.rotation.z,
      0,
      5 * clamped,
    );
    groupRef.current.scale.lerp(
      new THREE.Vector3(scale, scale, scale),
      5 * clamped,
    );

    const settled =
      groupRef.current.position.distanceTo(target) < 0.02 &&
      Math.abs(groupRef.current.scale.x - scale) < 0.02;
    if (settled) onPackSettled(true);
  });

  return <PackPrimitive groupRef={groupRef} image={image} />;
}

function OpeningFallback({
  image,
  tint = NEBULA_TINTS.green,
  accent = PACK_ACCENTS.green,
}: {
  image?: string;
  tint?: NebulaTint;
  accent?: string;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { size } = useThree();
  const texture = usePackTexture(image);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const viewportFit = size.width < 520 ? 0.86 : size.width < 820 ? 0.94 : 1;
    const pulse = 1 + Math.sin(clock.elapsedTime * 5) * 0.025;
    meshRef.current.scale.set(
      1.08 * viewportFit * pulse,
      1.62 * viewportFit * pulse,
      1,
    );
    meshRef.current.rotation.z = Math.sin(clock.elapsedTime * 7) * 0.025;
  });

  return (
    <>
      <SceneShaderBackground tint={tint} />
      <ambientLight color="#ffffff" intensity={1.7} />
      <pointLight color={accent} intensity={4} position={[0, 0, 2.4]} />
      <Sparkles
        color={accent}
        count={42}
        opacity={0.55}
        scale={[4, 3, 2]}
        size={1.8}
        speed={0.36}
      />
      <mesh ref={meshRef} position={[0, size.width < 520 ? -0.05 : -0.16, 0.4]}>
        <planeGeometry args={[1, 1.4]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </>
  );
}

let softGlowTexture: THREE.CanvasTexture | null = null;
function getSoftGlowTexture() {
  if (softGlowTexture) return softGlowTexture;
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.48)");
  gradient.addColorStop(0.72, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  softGlowTexture = new THREE.CanvasTexture(canvas);
  return softGlowTexture;
}

function OpeningDimmer({
  phase,
  slashLine,
}: {
  phase: OverlayPhase;
  slashLine: SlashLineState | null;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  useFrame(() => {
    if (!meshRef.current || !materialRef.current) return;
    let target = 0;
    if (phase === "slashing" && slashLine) {
      target =
        Math.min(
          Math.abs(slashLine.x2 - slashLine.x1) / (window.innerWidth * 0.16),
          1,
        ) * 0.82;
    } else if (phase === "opening") {
      target = 0.78;
    } else if (phase === "reveal") {
      target = 0.66;
    }
    const material = materialRef.current;
    material.opacity +=
      (target - material.opacity) * (target > material.opacity ? 0.15 : 0.04);
    meshRef.current.visible = material.opacity > 0.01;
  });

  return (
    <mesh
      ref={meshRef}
      position={[0, 0, phase === "slashing" ? 2.58 : -2]}
      visible={false}
    >
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial
        ref={materialRef}
        color="#000000"
        depthWrite={false}
        opacity={0}
        transparent
      />
    </mesh>
  );
}

function FlashEffects({
  accent,
  phase,
}: {
  accent: string;
  phase: OverlayPhase;
}) {
  const mainRef = useRef<THREE.PointLight>(null);
  const fillRef = useRef<THREE.PointLight>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const flash = useRef(0);
  const fill = useRef(0);
  const ringScale = useRef(0);
  const lastPhase = useRef<OverlayPhase>(phase);

  useFrame((_, delta) => {
    const clamped = Math.min(delta, 0.05);
    if (lastPhase.current !== phase) {
      if (phase === "opening") {
        flash.current = 34;
        fill.current = 16;
        ringScale.current = 0.12;
        mainRef.current?.color.set(accent);
        fillRef.current?.color.set("#ffffff");
        const canvas = document.querySelector(
          "[data-cofres-opening-overlay] canvas",
        ) as HTMLCanvasElement | null;
        if (canvas) {
          canvas.style.animation = "cofres-epic-shake 420ms ease-out";
          window.setTimeout(() => {
            canvas.style.animation = "";
          }, 430);
        }
      }
      lastPhase.current = phase;
    }

    flash.current = lerp(flash.current, 0, 3 * clamped);
    fill.current = lerp(fill.current, 0, 4 * clamped);
    if (mainRef.current) mainRef.current.intensity = flash.current;
    if (fillRef.current) fillRef.current.intensity = fill.current;
    if (ringRef.current) {
      if (ringScale.current > 0.01) {
        ringScale.current += clamped * 8;
        const progress = Math.min(ringScale.current / 5, 1);
        ringRef.current.scale.setScalar(ringScale.current);
        const material = ringRef.current.material as THREE.MeshBasicMaterial;
        material.opacity = (1 - progress) * 0.85;
        material.color.set(accent);
        ringRef.current.visible = material.opacity > 0.01;
        if (progress >= 1) ringScale.current = 0;
      } else {
        ringRef.current.visible = false;
      }
    }
  });

  return (
    <>
      <pointLight
        ref={mainRef}
        color={accent}
        distance={36}
        intensity={0}
        position={[0, 0, 3]}
      />
      <pointLight
        ref={fillRef}
        color="#ffffff"
        distance={28}
        intensity={0}
        position={[0, 2, 5]}
      />
      <mesh ref={ringRef} position={[0, 0, 0.65]} visible={false}>
        <ringGeometry args={[0.95, 1, 64]} />
        <meshBasicMaterial
          color={accent}
          opacity={0}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>
    </>
  );
}

function OpeningParticles({
  accent,
  phase,
}: {
  accent: string;
  phase: OverlayPhase;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const sprites = useRef<
    {
      baseSize: number;
      life: number;
      sprite: THREE.Sprite;
      velocity: THREE.Vector3;
    }[]
  >([]);
  const lastPhase = useRef<OverlayPhase>(phase);
  const { size } = useThree();

  const spawn = useCallback(() => {
    if (!groupRef.current) return;
    const texture = getSoftGlowTexture();
    // Tercer tono = acento aclarado (antes era verde fijo): así las partículas
    // van con el color del sobre, no siempre verdes.
    const accentLight = new THREE.Color(accent)
      .lerp(new THREE.Color("#ffffff"), 0.55)
      .getStyle();
    const colors = [accent, "#ffffff", accentLight];
    const origin = new THREE.Vector3(
      0,
      cutLayout(size.width).cutY,
      focusedPackZ + 0.1,
    );
    for (let index = 0; index < 64; index += 1) {
      const material = new THREE.SpriteMaterial({
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(colors[index % colors.length]),
        depthWrite: false,
        map: texture,
        opacity: 1,
        transparent: true,
      });
      const sprite = new THREE.Sprite(material);
      const baseSize = 0.06 + Math.random() * 0.18;
      sprite.position.copy(origin);
      sprite.scale.setScalar(baseSize);
      const angle = Math.random() * Math.PI * 2;
      const rise = 1.4 + Math.random() * 3.2;
      const speed = 1.4 + Math.random() * 4.2;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        rise,
        Math.sin(angle) * speed * 0.35,
      );
      sprites.current.push({ baseSize, life: 1, sprite, velocity });
      groupRef.current.add(sprite);
    }
  }, [accent, size.width]);

  useFrame((_, delta) => {
    const clamped = Math.min(delta, 0.05);
    if (lastPhase.current !== phase) {
      if (phase === "opening") spawn();
      lastPhase.current = phase;
    }

    for (let index = sprites.current.length - 1; index >= 0; index -= 1) {
      const particle = sprites.current[index];
      particle.life -= clamped * 0.85;
      if (particle.life <= 0) {
        groupRef.current?.remove(particle.sprite);
        particle.sprite.material.dispose();
        sprites.current.splice(index, 1);
        continue;
      }
      particle.sprite.position.add(
        particle.velocity.clone().multiplyScalar(clamped),
      );
      particle.velocity.y -= 3.4 * clamped;
      particle.sprite.material.opacity = particle.life;
      particle.sprite.scale.setScalar(
        particle.baseSize * (0.5 + particle.life),
      );
    }
  });

  return <group ref={groupRef} />;
}

function OverlayWorld({
  onOpeningComplete,
  onPackPick,
  onPackSettled,
  onSelectedIndexChange,
  onSlashCancel,
  onSlashComplete,
  onSlashStart,
  onSlashUpdate,
  packSettled,
  packs,
  phase,
  selectedIndex,
  slashLine,
  slashPath,
}: {
  onOpeningComplete: () => void;
  onPackPick: (index: number) => void;
  onPackSettled: (settled: boolean) => void;
  onSelectedIndexChange: (index: number) => void;
  onSlashCancel: () => void;
  onSlashComplete: () => void;
  onSlashStart: (line: SlashLineState, path: SlashPoint[]) => void;
  onSlashUpdate: (line: SlashLineState, point: SlashPoint) => void;
  packSettled: boolean;
  packs: OpeningPack[];
  phase: OverlayPhase;
  selectedIndex: number;
  slashLine: SlashLineState | null;
  slashPath: SlashPoint[];
}) {
  const selectedPack = packs[selectedIndex] || packs[0];
  const accent = packAccent(selectedPack?.flap);

  return (
    <>
      <SceneShaderBackground tint={nebulaTint(selectedPack?.flap)} />
      <OpeningDimmer phase={phase} slashLine={slashLine} />
      <ambientLight color="#ffffff" intensity={1.55} />
      <directionalLight
        color="#ffffff"
        intensity={2.8}
        position={[2.8, 3.8, 5]}
      />
      <directionalLight
        color={accent}
        intensity={1.1}
        position={[-3, -1.5, 4]}
      />
      <FlashEffects accent={accent} phase={phase} />
      <OpeningParticles accent={accent} phase={phase} />
      <Sparkles
        color={accent}
        count={phase === "carousel" ? 42 : 96}
        opacity={0.68}
        scale={[5.2, 3.4, 2.7]}
        size={2.0}
        speed={0.52}
      />
      {phase === "carousel" ? (
        <CarouselPacks
          onPackPick={onPackPick}
          packs={packs}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      ) : null}
      {phase === "focused" || phase === "slashing" ? (
        <>
          <FocusedPack
            image={selectedPack?.image}
            onPackSettled={onPackSettled}
            onSlashCancel={onSlashCancel}
            onSlashComplete={onSlashComplete}
            onSlashStart={onSlashStart}
            onSlashUpdate={onSlashUpdate}
            phase={phase}
            slashLine={slashLine}
          />
          <CutGuide visible={phase === "focused" && packSettled} />
          <SlashStroke phase={phase} slashPath={slashPath} />
        </>
      ) : null}
      {phase === "opening" && selectedPack ? (
        <PackHalves
          active={phase === "opening"}
          pack={selectedPack}
          slashLine={slashLine}
          onComplete={onOpeningComplete}
        />
      ) : null}
    </>
  );
}

// Fondo del revelado: shader WebGL con domain warping (Inigo Quilez) que pinta
// una nebulosa OPACA en la paleta de marca (slate oscuro -> teal -> cian ->
// lima -> bruma) con viñeta para concentrar el brillo al centro y que las
// cartas "floten" encima. Se mueve despacio (u_time), se monta solo en el
// revelado y limpia su contexto al desmontar. Si no hay WebGL no pinta nada
// (alpha 1 solo en lo dibujado) y queda el degradado CSS de reserva.
function ShaderBackground({
  tint = NEBULA_TINTS.green,
}: {
  tint?: NebulaTint;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // El loop de WebGL se monta una vez ([]); para que el tinte pueda cambiar sin
  // reinicializar el contexto, lo leemos de un ref que actualizamos por efecto.
  const tintRef = useRef(tint);
  useEffect(() => {
    tintRef.current = tint;
  }, [tint]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) return;

    const vsSource =
      "attribute vec2 a_position; void main(){ gl_Position = vec4(a_position, 0.0, 1.0); }";
    const fsSource = NEBULA_FRAGMENT;

    const compile = (type: number, src: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    // Quad a pantalla completa: 2 triángulos (6 vértices) de -1 a 1.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uTint = gl.getUniformLocation(program, "u_tint");

    let raf = 0;
    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, performance.now() / 1000);
      gl.uniform3f(uTint, tintRef.current[0], tintRef.current[1], tintRef.current[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      // NO usar WEBGL_lose_context aquí: en React Strict Mode (dev) el efecto
      // hace mount->cleanup->mount sobre el MISMO canvas, y perder el contexto
      // en el cleanup deja el segundo mount con un contexto perdido (pantalla
      // negra). Basta con borrar recursos; el contexto lo libera el GC cuando
      // el canvas se desmonta de verdad.
      cancelAnimationFrame(raf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

// Efecto "poke-holo" de hover en la carta protagonista del revelado: tilt 3D
// que sigue al ratón + glare/holo por rareza. DESACTIVADO por ahora — en móvil
// (sin hover real) se veía raro y queremos simplificar. El código se conserva
// entero; basta poner esto en `true` para reactivarlo en el futuro.
const CARD_HOVER_FX: boolean = false;

// Shader holográfico de las cartas de TIER ALTO del revelado, movido por el
// GIROSCOPIO (DeviceOrientation) en móvil y por el ratón en escritorio. Escribe
// CSS vars (--holo-rx/ry para el giro, --holo-mx/my para el brillo) en el nodo
// de la carta vía rAF, SIN re-render por frame. En iOS 13+ la orientación pide
// permiso desde un gesto del usuario: el hook devuelve un ref con la función
// para pedirlo (se llama en el primer toque del revelado). Respeta
// prefers-reduced-motion (si está, no engancha nada y la carta queda estática).
function useHoloMotion(
  enabled: boolean,
  ref: RefObject<HTMLDivElement | null>,
  measureRef: RefObject<HTMLDivElement | null>,
) {
  // En iOS la orientación necesita permiso desde un gesto: exponemos esta
  // función (ref) para pedirlo al TOCAR la carta, además de al abrir el sobre.
  const requestRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const target = { rx: 0, ry: 0, mx: 50, my: 50 };
    const cur = { rx: 0, ry: 0, mx: 50, my: 50 };
    let base: { beta: number; gamma: number } | null = null;
    let raf = 0;
    let alive = true;
    const MAX = 15; // giro máximo (grados)
    const RANGE = 60; // rango de inclinación del móvil (grados) que llega al tope
    // (RANGE más bajo = más reactivo a inclinaciones pequeñas; MAX más alto =
    // giro más marcado. Junto con la perspectiva más cercana (650px) el giro se
    // nota claramente.)

    const onOrient = (event: DeviceOrientationEvent) => {
      if (event.beta == null || event.gamma == null) return;
      // La PRIMERA lectura calibra el "neutro": funciona sostengas el móvil
      // como lo sostengas.
      if (!base) base = { beta: event.beta, gamma: event.gamma };
      const db = Math.max(-RANGE, Math.min(RANGE, event.beta - base.beta));
      const dg = Math.max(-RANGE, Math.min(RANGE, event.gamma - base.gamma));
      target.rx = -(db / RANGE) * MAX;
      target.ry = (dg / RANGE) * MAX;
      target.mx = 50 + (dg / RANGE) * 50;
      target.my = 50 + (db / RANGE) * 50;
    };
    const onMouse = (event: PointerEvent) => {
      // Ratón (PC) y DEDO (móvil): arrastrar el dedo inclina la carta. En táctil
      // no hay "hover", solo dispara mientras el dedo está apoyado y moviéndose
      // (el tap <14px sigue pasando de carta; arrastrar inclina).
      // Medimos sobre la caja ESTABLE (no la capa que se inclina), si no su
      // rect cambiaría con el giro y derivaría.
      const el = measureRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = (event.clientX - r.left) / r.width;
      const py = (event.clientY - r.top) / r.height;
      // PRUEBA: todo el viewport como área -> la carta gira según el ratón esté
      // donde esté en la pantalla (el giro se mantiene al máximo más allá del
      // borde de la carta, por el clamp de cx/cy a ±0.5).
      const inside = true;
      const cx = Math.max(-0.5, Math.min(0.5, px - 0.5));
      const cy = Math.max(-0.5, Math.min(0.5, py - 0.5));
      target.rx = inside ? -cy * 2 * MAX : 0;
      target.ry = inside ? cx * 2 * MAX : 0;
      target.mx = inside ? px * 100 : 50;
      target.my = inside ? py * 100 : 50;
    };
    const loop = () => {
      if (!alive) return;
      cur.rx += (target.rx - cur.rx) * 0.18;
      cur.ry += (target.ry - cur.ry) * 0.18;
      cur.mx += (target.mx - cur.mx) * 0.18;
      cur.my += (target.my - cur.my) * 0.18;
      const el = ref.current;
      if (el) {
        el.style.setProperty("--holo-rx", `${cur.rx.toFixed(2)}deg`);
        el.style.setProperty("--holo-ry", `${cur.ry.toFixed(2)}deg`);
        // Centro del brillo (rango completo 0-100%): para máscaras/glare.
        el.style.setProperty("--holo-mx", `${cur.mx.toFixed(1)}%`);
        el.style.setProperty("--holo-my", `${cur.my.toFixed(1)}%`);
        // Paneo del FOIL: rango comprimido y centrado (34-66%) para que las
        // bandas se muevan pero sin llegar nunca al borde/hueco del patrón
        // (si no, al inclinar a un lado se veía "el final del shader").
        el.style.setProperty("--holo-bx", `${(30 + cur.mx * 0.4).toFixed(1)}%`);
        el.style.setProperty("--holo-by", `${(30 + cur.my * 0.4).toFixed(1)}%`);
      }
      raf = requestAnimationFrame(loop);
    };

    const startGyro = () =>
      window.addEventListener("deviceorientation", onOrient);
    const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if ("DeviceOrientationEvent" in window) {
      // Escucha ya: cubre Android y iOS con el permiso YA concedido antes.
      startGyro();
      // iOS sin permiso aún: lo pedimos al tocar la carta (gesto). Al concederlo
      // re-enganchamos (addEventListener deduplica, no añade dos veces).
      if (typeof DOE.requestPermission === "function") {
        requestRef.current = () => {
          DOE.requestPermission?.()
            .then((res) => {
              if (res === "granted") startGyro();
            })
            .catch(() => {});
        };
      }
    }
    window.addEventListener("pointermove", onMouse);
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("pointermove", onMouse);
      requestRef.current = null;
    };
  }, [enabled, ref, measureRef]);

  return requestRef;
}

// Revelado en HTML (reusa la carta del inventario). three.js solo se encarga
// del sobre; al abrirlo, el Canvas se desmonta y entra esta capa: cartas una a
// una con tap/swipe, abanico final, tilt 3D en CSS y barrido de brillo.
function RevealCards({
  cards,
  stackIndex,
  onAdvance,
  pointsFor,
  title,
  tint = NEBULA_TINTS.green,
  accent = PACK_ACCENTS.green,
}: {
  cards: OpeningCard[];
  stackIndex: number;
  onAdvance: () => void;
  pointsFor: (playerId: string) => number;
  title?: string;
  tint?: NebulaTint;
  accent?: string;
}) {
  const done = stackIndex >= cards.length;
  // Acento de la carta visible (protagonista) para teñir el brillo del fondo.
  const heroIndex = Math.min(stackIndex, cards.length - 1);
  const heroAccent =
    positionAccent[
      playersById.get(cards[heroIndex]?.playerId)?.position ?? "DEL"
    ];
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const start = useRef<{ x: number; y: number; id: number | null }>({
    x: 0,
    y: 0,
    id: null,
  });
  // Caja estable de la carta (no se inclina) para medir la posición del ratón.
  const stageRef = useRef<HTMLDivElement>(null);
  // Hover de ratón sobre la carta protagonista: tilt 3D + brillo que siguen al
  // puntero (estilo poke-holo). En táctil no aplica (ahí solo se arrastra).
  const [hover, setHover] = useState({
    rx: 0,
    ry: 0,
    mx: 50,
    my: 50,
    active: false,
  });

  // Shader holográfico por giroscopio en la carta de tier alto (legendaria).
  // Solo se engancha si el sobre tiene alguna legendaria. holoRef apunta a la
  // carta protagonista cuando es legendaria; el hook le escribe las CSS vars.
  const hasLegendary = cards.some((card) => starPlayerIds.has(card.playerId));
  const holoRef = useRef<HTMLDivElement>(null);
  const gyroRequest = useHoloMotion(hasLegendary, holoRef, stageRef);
  const askedGyro = useRef(false);

  const onDown = (event: ReactPointerEvent) => {
    if (done || !event.isPrimary) return;
    // iOS: pide el permiso de orientación en el primer toque (gesto de usuario),
    // por si no se concedió al abrir el sobre.
    if (gyroRequest.current && !askedGyro.current) {
      askedGyro.current = true;
      gyroRequest.current();
    }
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    setDrag({ x: 0, y: 0, active: true });
  };
  const onMove = (event: ReactPointerEvent) => {
    // 1) Arrastre en curso: mueve la carta (tap/swipe para pasar de carta).
    if (start.current.id !== null && event.pointerId === start.current.id) {
      setDrag({
        x: event.clientX - start.current.x,
        y: event.clientY - start.current.y,
        active: true,
      });
      return;
    }
    // 2) Si no, hover de ratón: la carta se inclina y brilla siguiendo al
    // puntero. Solo ratón y solo mientras quede carta protagonista.
    // (Desactivado por CARD_HOVER_FX mientras simplificamos.)
    if (!CARD_HOVER_FX || done || event.pointerType !== "mouse") return;
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = (event.clientX - r.left) / r.width;
    const py = (event.clientY - r.top) / r.height;
    // Fuera de la carta (con un pequeño margen): vuelve a plano.
    if (px < -0.08 || px > 1.08 || py < -0.08 || py > 1.08) {
      setHover((h) => (h.active ? { ...h, active: false } : h));
      return;
    }
    const max = 15;
    // Mismo sentido que el arrastre: rotateY sigue al eje X del puntero y
    // rotateX al inverso del eje Y (la carta gira "empujada" por el cursor).
    setHover({
      rx: clamp(-(py - 0.5) * 2 * max, -max, max),
      ry: clamp((px - 0.5) * 2 * max, -max, max),
      mx: px * 100,
      my: py * 100,
      active: true,
    });
  };
  const onUp = (event: ReactPointerEvent) => {
    if (start.current.id === null) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    const travel = Math.hypot(dx, dy);
    start.current.id = null;
    setDrag({ x: 0, y: 0, active: false });
    // Tap (incl. temblor <14px) o swipe fuerte (>70px) -> siguiente carta.
    if (!done && (travel < 14 || travel > 70)) onAdvance();
  };

  // card 0 -> izquierda, card 1 -> derecha, card 2 -> centro (igual que el 3D).
  // Con UNA sola carta (p.ej. sobre Madrid) no hay abanico: queda centrada.
  const fan =
    cards.length === 1
      ? [{ x: 0, rot: 0, scale: 0.9 }]
      : [
          { x: -56, rot: -8, scale: 0.82 },
          { x: 56, rot: 8, scale: 0.82 },
          { x: 0, rot: 0, scale: 0.9 },
        ];

  return (
    <div
      className="absolute inset-0 flex select-none items-center justify-center"
      style={{
        background:
          // foco cenital (lima) + focos laterales + viñeta + base
          "radial-gradient(85% 55% at 50% -10%, rgba(167,246,0,0.10), transparent 55%)," +
          "radial-gradient(55% 45% at 16% 10%, rgba(150,190,120,0.07), transparent 60%)," +
          "radial-gradient(55% 45% at 84% 10%, rgba(150,190,120,0.07), transparent 60%)," +
          "radial-gradient(130% 100% at 50% 42%, transparent 50%, rgba(0,0,0,0.62) 100%)," +
          "linear-gradient(180deg, #0b1211, #0a0f0d 45%, #050807)",
        perspective: "650px",
        touchAction: "none",
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() =>
        setHover((h) => (h.active ? { ...h, active: false } : h))
      }
    >
      <ShaderBackground tint={tint} />

      {/* Brillo central que late y se tiñe del color de la carta visible. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{
          width: "62vmin",
          height: "62vmin",
          background: `radial-gradient(circle, rgba(${heroAccent.rgb},0.16), rgba(${heroAccent.rgb},0.05) 45%, transparent 70%)`,
          animation: "cofreGlow 4.5s ease-in-out infinite",
        }}
      />

      {/* Cabecera: logo + título del sobre. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-3 pt-[5vh] sm:pt-[6vh]">
        <div className="relative h-14 w-72 sm:h-20 sm:w-[26rem] xl:h-24 xl:w-[32rem]">
          {/* Glow del logo: radial ESTÁTICO detrás (no filter), tematizado por
              sobre. Antes era filter:drop-shadow verde y en iOS salía como un
              rectángulo raro. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-x-10 -inset-y-7"
            style={{
              background: `radial-gradient(60% 72% at 50% 50%, ${accent}40, transparent 75%)`,
            }}
          />
          <Image
            src="/logo.png"
            alt="Triliporra"
            fill
            sizes="(max-width: 640px) 288px, 512px"
            className="object-contain"
            unoptimized
          />
        </div>
        {title ? (
          <span className="text-xs font-bold uppercase tracking-[0.32em] text-white/55 sm:text-sm xl:text-base">
            {title}
          </span>
        ) : null}
      </div>

      <div
        ref={stageRef}
        className="relative w-[64vw] max-w-[280px]"
        style={{ aspectRatio: "5 / 7", transformStyle: "preserve-3d" }}
      >
        {cards.map((card, index) => {
          const isHero = index === stackIndex;
          const revealed = index < stackIndex;
          let x = 0;
          let y = -2;
          let rot = 0;
          let scale = 1;
          let z = 40;
          if (revealed) {
            const slot = fan[Math.min(index, fan.length - 1)];
            x = slot.x;
            y = 0;
            rot = slot.rot;
            scale = slot.scale;
            z = 20;
          } else if (!isHero) {
            const depth = index - stackIndex;
            y = -2 - depth * 2;
            scale = 1 - depth * 0.05;
            z = 40 - depth;
          }
          // Con el efecto desactivado (CARD_HOVER_FX) la carta NO se mueve al
          // pulsarla/arrastrarla. El tap/swipe para pasar de carta SIGUE
          // funcionando: lo decide onUp con start.current (el ref), no este
          // estado visual de arrastre.
          const dragActive = CARD_HOVER_FX && isHero && drag.active;
          const hoverActive =
            CARD_HOVER_FX && isHero && hover.active && !drag.active;
          const dragX = CARD_HOVER_FX && isHero ? drag.x : 0;
          const dragY = CARD_HOVER_FX && isHero ? drag.y : 0;
          const tiltY = dragActive
            ? clamp(drag.x / 16, -12, 12)
            : hoverActive
              ? hover.ry
              : 0;
          const tiltX = dragActive
            ? clamp(-drag.y / 16, -12, 12)
            : hoverActive
              ? hover.rx
              : 0;
          // Pop hacia el espectador al pasar el ratón (efecto 3D más marcado).
          const lift = hoverActive ? 34 : 0;
          // Rareza ALTA (legendaria) = shader holográfico (foil + glare) que
          // sigue al giroscopio/ratón. El resto, sin shader.
          const legendary = starPlayerIds.has(card.playerId);
          // Carta "protagonista" del shader: la que estás revelando (isHero) Y la
          // que queda mostrada al terminar (done + revelada), justo antes de
          // entrar al inventario.
          const showcase = isHero || (done && revealed);
          const holoHero = showcase && legendary;
          return (
            <div
              key={card.id}
              className="absolute inset-0"
              style={{
                zIndex: z,
                transform: `translate(calc(${x}% + ${dragX}px), calc(${y}% + ${
                  dragY * 0.35
                }px)) rotateZ(${rot}deg) rotateY(${tiltY}deg) rotateX(${tiltX}deg) translateZ(${lift}px) scale(${scale})`,
                transformStyle: "preserve-3d",
                transition: dragActive
                  ? "none"
                  : hoverActive
                    ? "transform 90ms ease-out"
                    : "transform 460ms cubic-bezier(0.2, 0.7, 0.25, 1)",
                willChange: "transform",
              }}
            >
              <div
                ref={holoHero ? holoRef : undefined}
                className="relative h-full w-full"
                style={
                  holoHero
                    ? {
                        // Giro 3D que sigue al giroscopio/ratón (CSS vars que
                        // pone useHoloMotion). Va aquí, NO en la capa que coloca
                        // el abanico, para no pisar su transición de posición.
                        transform:
                          "rotateY(var(--holo-ry, 0deg)) rotateX(var(--holo-rx, 0deg)) translateZ(18px)",
                        transformStyle: "preserve-3d",
                        transition: "transform 70ms linear",
                      }
                    : undefined
                }
              >
                <PlayerCard
                  playerId={card.playerId}
                  points={pointsFor(card.playerId)}
                  featured={isHero}
                  holoShader={showcase && legendary}
                />
                {showcase ? (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                    {/* El holo (foil dorado + destello) va DENTRO de la carta,
                        DETRÁS de la foto (PlayerCard holoShader), para que la
                        cara del jugador quede por encima/limpia. El tilt 3D por
                        giroscopio sigue en la capa interior (--holo-rx/ry). Aquí
                        solo queda el barrido del momento de revelar. */}
                    {isHero ? (
                      <div
                        className="absolute inset-y-[-30%] left-0 w-1/2"
                        style={{
                          background:
                            "linear-gradient(100deg, transparent, rgba(255,255,255,0.33), transparent)",
                          // forwards: al terminar se queda en el último fotograma
                          // (fuera de la carta, a la derecha) y no deja la mitad
                          // iluminada con la banda en su posición base.
                          animation: "cofreShine 780ms ease-out forwards",
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes cofreRevealIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cofreShine {
          from { transform: translateX(-180%) skewX(-12deg); }
          to { transform: translateX(360%) skewX(-12deg); }
        }
        @keyframes cofreGlow {
          0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(0.92); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.06); }
        }
      `}</style>
    </div>
  );
}

export function PackOpeningOverlay({
  initialPackId,
  onAccept,
  onClose,
  packs,
  pointsFor,
}: PackOpeningOverlayProps) {
  const initialIndex = Math.max(
    0,
    packs.findIndex((pack) => pack.id === initialPackId),
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [phase, setPhase] = useState<OverlayPhase>("focused");
  const [packSettled, setPackSettled] = useState(false);
  const [slashLine, setSlashLine] = useState<SlashLineState | null>(null);
  const [slashPath, setSlashPath] = useState<SlashPoint[]>([]);
  const [stackIndex, setStackIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedPack = packs[selectedIndex] || packs[0];
  const cards = useMemo(
    () =>
      selectedPack.playerIds.map((playerId, index) => ({
        id: `${selectedPack.id}-preview-${index}-${playerId}`,
        playerId,
      })),
    [selectedPack],
  );

  // Las fotos de los jugadores son REMOTAS (api-sports), así que al revelar a
  // veces aparecían tarde (el "efecto raro" de la carta sin foto que luego
  // pega un pop). Las precargamos en cuanto se conoce el mazo —mientras dura el
  // sobre 3D y el slash hay margen de sobra— para que en el revelado ya estén
  // en caché.
  useEffect(() => {
    if (typeof window === "undefined") return;
    for (const card of cards) {
      const player = playersById.get(card.playerId);
      const url = player ? playerPhotoUrl(player) : "";
      if (url) {
        const img = new window.Image();
        img.decoding = "async";
        img.src = url;
      }
    }
  }, [cards]);

  // "Desliza para cortar el sobre" se muestra ENCIMA del sobre; abajo solo queda
  // el estado de apertura. El revelado usa pips + CTA (más abajo).
  const bottomHint = phase === "opening" ? "Abriendo el sobre..." : "";
  const revealDone = phase === "reveal" && stackIndex >= cards.length;

  const selectPackForOpening = useCallback((index: number) => {
    setError("");
    setSelectedIndex(index);
    setPackSettled(false);
    setSlashLine(null);
    setSlashPath([]);
    setStackIndex(0);
    setPhase("focused");
  }, []);

  const onCardSwiped = useCallback(() => {
    // Avanza el paso del revelado; al pasar la última, queda en "todo revelado"
    // (stackIndex === cards.length) y aparece el CTA. Sin cambio de fase.
    setStackIndex((current) => Math.min(current + 1, cards.length));
  }, [cards.length]);

  const onSlashStart = useCallback(
    (line: SlashLineState, path: SlashPoint[]) => {
      setSlashLine(line);
      setSlashPath(path);
      setPhase("slashing");
    },
    [],
  );

  const onSlashUpdate = useCallback(
    (line: SlashLineState, point: SlashPoint) => {
      setSlashLine(line);
      setSlashPath((current) => {
        const previous = current[current.length - 1];
        if (
          previous &&
          Math.abs(previous.x - point.x) < 2 &&
          Math.abs(previous.y - point.y) < 2
        ) {
          return current;
        }
        return [...current, point];
      });
    },
    [],
  );

  const onSlashCancel = useCallback(() => {
    setSlashLine(null);
    setSlashPath([]);
    setPhase("focused");
  }, []);

  const onSlashComplete = useCallback(() => {
    setPhase("opening");
  }, []);

  const acceptCards = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onAccept(selectedPack);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se han podido anadir las cartas.",
      );
      setBusy(false);
    }
  };

  const onSelectedIndexChange = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] overflow-hidden bg-black text-white"
      data-cofres-opening-overlay
      data-opening-phase={phase}
    >
      {phase !== "reveal" ? (
        <div className="absolute inset-0">
          <Canvas
            camera={{ fov: 50, near: 0.1, far: 100, position: [0, 0, 8] }}
            dpr={[1, 1.6]}
            gl={{
              alpha: false,
              antialias: true,
              localClippingEnabled: true,
              toneMapping: THREE.NoToneMapping,
            }}
            shadows
            style={{ height: "100%", touchAction: "none", width: "100%" }}
          >
            <Suspense
              fallback={
                <OpeningFallback
                  image={selectedPack?.image}
                  tint={nebulaTint(selectedPack?.flap)}
                  accent={packAccent(selectedPack?.flap)}
                />
              }
            >
              <OverlayWorld
                onOpeningComplete={() => {
                  setStackIndex(0);
                  setPhase("reveal");
                }}
                onPackPick={selectPackForOpening}
                onPackSettled={setPackSettled}
                onSelectedIndexChange={onSelectedIndexChange}
                onSlashCancel={onSlashCancel}
                onSlashComplete={onSlashComplete}
                onSlashStart={onSlashStart}
                onSlashUpdate={onSlashUpdate}
                packSettled={packSettled}
                packs={packs}
                phase={phase}
                selectedIndex={selectedIndex}
                slashLine={slashLine}
                slashPath={slashPath}
              />
              <EffectComposer multisampling={0}>
                <Bloom
                  height={270}
                  intensity={1.1}
                  luminanceSmoothing={0.35}
                  luminanceThreshold={0.72}
                  mipmapBlur
                  width={480}
                />
              </EffectComposer>
            </Suspense>
          </Canvas>
        </div>
      ) : (
        <RevealCards
          cards={cards}
          stackIndex={stackIndex}
          onAdvance={onCardSwiped}
          pointsFor={pointsFor}
          title={selectedPack.title}
          tint={nebulaTint(selectedPack.flap)}
          accent={packAccent(selectedPack.flap)}
        />
      )}

      {error ? (
        <div className="absolute inset-x-4 top-28 mx-auto max-w-lg rounded-lg border border-rose-400/30 bg-rose-950/80 px-4 py-3 text-sm font-bold text-rose-100 shadow-2xl shadow-black/40 backdrop-blur">
          {error}
        </div>
      ) : null}

      {phase === "carousel" ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute left-4 top-5 rounded-lg border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white shadow-2xl shadow-black/30 backdrop-blur transition hover:bg-white/10 sm:left-6 sm:top-8"
        >
          Cerrar
        </button>
      ) : null}

      {phase === "focused" || phase === "slashing" ? (
        <button
          type="button"
          onClick={() => {
            setSlashLine(null);
            setSlashPath([]);
            setPackSettled(false);
            onClose();
          }}
          className="absolute left-4 top-5 rounded-lg border border-white/10 bg-black/45 px-4 py-3 text-sm font-bold text-white shadow-2xl shadow-black/40 backdrop-blur transition hover:bg-white/10 sm:left-6 sm:top-8"
        >
          Volver
        </button>
      ) : null}

      {phase === "focused" || phase === "slashing" ? (
        <div className="pointer-events-none absolute inset-x-0 top-[14%] flex justify-center px-4">
          <span className="animate-pulse rounded-full border border-white/15 bg-black/45 px-5 py-2.5 text-center text-sm font-bold text-white shadow-2xl shadow-black/40 backdrop-blur">
            Desliza para cortar el sobre
          </span>
        </div>
      ) : null}

      {bottomHint ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4 sm:bottom-8">
          <span className="rounded-full bg-black/20 px-4 py-2 text-center text-sm font-bold text-zinc-300 shadow-2xl shadow-black/30 backdrop-blur">
            {bottomHint}
          </span>
        </div>
      ) : null}

      {phase === "reveal" && !revealDone ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-7 flex flex-col items-center gap-3 px-4 sm:bottom-10">
          <div className="flex gap-2.5">
            {cards.map((card, index) => {
              const pip =
                positionAccent[
                  playersById.get(card.playerId)?.position ?? "DEL"
                ];
              // done = carta ya pasada (encendida del todo); active = la que se
              // ve ahora (encendida suave); el resto, apagada. Asi el ultimo pip
              // no finge "completado" mientras sigues en la ultima carta.
              const done = index < stackIndex;
              const active = index === stackIndex;
              return (
                <span
                  key={card.id}
                  className="h-2.5 w-2.5 rounded-full transition-all duration-300"
                  style={{
                    background: done
                      ? pip.text
                      : active
                        ? `rgba(${pip.rgb},0.55)`
                        : "rgba(255,255,255,0.16)",
                    boxShadow: done
                      ? `0 0 10px rgba(${pip.rgb},0.7)`
                      : active
                        ? `0 0 8px rgba(${pip.rgb},0.35)`
                        : "none",
                  }}
                />
              );
            })}
          </div>
          <span className="text-xs font-semibold text-zinc-400">
            Toca para continuar
          </span>
        </div>
      ) : null}

      {revealDone ? (
        <div className="absolute inset-x-0 bottom-7 flex flex-col items-center gap-3 px-4 sm:bottom-10">
          <button
            type="button"
            onClick={() => void acceptCards()}
            disabled={busy}
            className="w-full max-w-xs rounded-full bg-[#a7f600] px-6 py-3.5 text-base font-bold text-black shadow-2xl shadow-black/40 transition hover:bg-[#c7ff43] disabled:opacity-60"
          >
            {busy ? "Anadiendo..." : "A mi inventario"}
          </button>
          <button
            type="button"
            onClick={() => setStackIndex(0)}
            disabled={busy}
            className="text-xs font-semibold text-zinc-400 transition hover:text-white"
          >
            Ver otra vez
          </button>
        </div>
      ) : null}
    </div>
  );
}

