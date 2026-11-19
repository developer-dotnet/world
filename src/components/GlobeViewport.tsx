import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  AggregationMode,
  CountryWeatherAggregate,
  LocationWeatherReading,
} from '../types/weather';
import {
  renderCountryAverageTexture,
  renderLandRoughnessTexture,
  renderLocalThermalTexture,
  TEXTURE_HEIGHT,
  TEXTURE_WIDTH,
} from '../utils/globeTextures';
import { sampleThermalHex } from '../utils/temperatureScale';
import {
  type CountryPolygonFeature,
  findCountryAtLatLon,
  getWorldBorderLines,
  getWorldCountryFeatures,
  latLonToVector3,
  type LonLat,
  vector3ToLatLon,
} from '../utils/worldGeo';

export const GLOBE_RADIUS = 2.0;
export const MIN_CAMERA_DISTANCE = 2.24;
export const MAX_CAMERA_DISTANCE = 7.6;
export const DEFAULT_CAMERA_DISTANCE = 5.45;

export function distanceToZoomLevel(distance: number): number {
  const clamped = Math.max(
    MIN_CAMERA_DISTANCE,
    Math.min(MAX_CAMERA_DISTANCE, distance),
  );
  return Math.round(
    ((MAX_CAMERA_DISTANCE - clamped) /
      (MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE)) *
      200,
  );
}

export function zoomLevelToDistance(zoomLevel: number): number {
  const clamped = Math.max(0, Math.min(200, zoomLevel));
  return (
    MAX_CAMERA_DISTANCE -
    (clamped / 200) * (MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE)
  );
}

export function computeIsLocalMode(
  distance: number,
  zoomAggregate: number,
  modeOverride: AggregationMode,
): boolean {
  if (modeOverride === 'country') return false;
  if (modeOverride === 'local') return true;
  if (zoomAggregate <= 15) {
    return distance < zoomAggregate;
  }
  return distanceToZoomLevel(distance) >= zoomAggregate;
}

export interface GlobeViewportHandle {
  flyToLatLon: (lat: number, lon: number, targetDistance?: number) => void;
  setZoomDelta: (deltaZoom: number) => void;
  resetView: () => void;
}

interface GlobeViewportProps {
  aggregates: CountryWeatherAggregate[];
  zoomAggregate: number;
  modeOverride: AggregationMode;
  selectedCountryISO: string | null;
  hoveredCountryISO: string | null;
  selectedLocationKey: string | null;
  onZoomChange: (zoomLevel: number, distance: number, isLocal: boolean) => void;
  onHoverCountry: (iso: string | null, feature: CountryPolygonFeature | null) => void;
  onSelectCountry: (iso: string | null, feature: CountryPolygonFeature | null) => void;
  onHoverLocation: (loc: LocationWeatherReading | null) => void;
  onSelectLocation: (loc: LocationWeatherReading | null) => void;
}

// Reusable scratch math objects (zero GC in render loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _scaleVec = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

function buildCountryBorderGeometry(
  feature: CountryPolygonFeature,
  radius: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  for (const poly of feature.polygons) {
    for (const ring of poly) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        if (Math.abs(lon1 - lon2) > 180) continue;
        latLonToVector3(lat1, lon1, radius, a);
        latLonToVector3(lat2, lon2, radius, b);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function buildWorldBorderGeometry(
  lines: LonLat[][],
  radius: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  for (const line of lines) {
    if (line.length < 2) continue;
    for (let i = 0; i < line.length - 1; i++) {
      const [lon1, lat1] = line[i];
      const [lon2, lat2] = line[i + 1];
      if (Math.abs(lon1 - lon2) > 180) continue;
      latLonToVector3(lat1, lon1, radius, a);
      latLonToVector3(lat2, lon2, radius, b);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

export const GlobeViewport = React.forwardRef<
  GlobeViewportHandle,
  GlobeViewportProps
>(function GlobeViewport(
  {
    aggregates,
    zoomAggregate,
    modeOverride,
    selectedCountryISO,
    hoveredCountryISO,
    selectedLocationKey,
    onZoomChange,
    onHoverCountry,
    onSelectCountry,
    onHoverLocation,
    onSelectLocation,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglLost, setWebglLost] = useState(false);

  // Latest props stored in refs so WebGL effect mounts once cleanly
  const propsRef = useRef({
    aggregates,
    zoomAggregate,
    modeOverride,
    selectedCountryISO,
    hoveredCountryISO,
    selectedLocationKey,
    onZoomChange,
    onHoverCountry,
    onSelectCountry,
    onHoverLocation,
    onSelectLocation,
  });
  propsRef.current = {
    aggregates,
    zoomAggregate,
    modeOverride,
    selectedCountryISO,
    hoveredCountryISO,
    selectedLocationKey,
    onZoomChange,
    onHoverCountry,
    onSelectCountry,
    onHoverLocation,
    onSelectLocation,
  };

  const sceneApiRef = useRef<{
    requestRender: () => void;
    updateWeatherLayers: () => void;
    updateHighlightBorder: () => void;
    flyToLatLon: (lat: number, lon: number, targetDistance?: number) => void;
    setZoomDelta: (deltaZoom: number) => void;
    resetView: () => void;
  } | null>(null);

  useImperativeHandle(ref, () => ({
    flyToLatLon: (lat, lon, targetDistance) => {
      sceneApiRef.current?.flyToLatLon(lat, lon, targetDistance);
    },
    setZoomDelta: (deltaZoom) => {
      sceneApiRef.current?.setZoomDelta(deltaZoom);
    },
    resetView: () => {
      sceneApiRef.current?.resetView();
    },
  }));

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const features = getWorldCountryFeatures();

    // Detect software WebGL (SwiftShader / llvmpipe / WARP)
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const onContextRestored = () => {
      setWebglLost(false);
      sceneApiRef.current?.requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener(
      'webglcontextrestored',
      onContextRestored,
    );

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090e);
    scene.fog = new THREE.FogExp2(0x07090e, 0.022);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    // Start facing Europe / Atlantic / Africa
    latLonToVector3(24, 14, DEFAULT_CAMERA_DISTANCE, camera.position);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.85;
    controls.minDistance = MIN_CAMERA_DISTANCE;
    controls.maxDistance = MAX_CAMERA_DISTANCE;
    controls.minPolarAngle = 0.18;
    controls.maxPolarAngle = Math.PI - 0.18;

    // 3-point calibrated studio + orbital lighting
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.85);
    keyLight.position.set(6, 4.5, 6);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
    rimLight.position.set(-6, -2, -5);
    scene.add(rimLight);

    // Subtle deep-space starfield
    const starCount = 750;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 24 + (i % 17) * 1.1;
      const theta = ((i * 137.508) % 360) * (Math.PI / 180);
      const u = ((i * 0.6180339887) % 1) * 2 - 1;
      const sinPhi = Math.sqrt(Math.max(0, 1 - u * u));
      starPositions[i * 3] = r * sinPhi * Math.cos(theta);
      starPositions[i * 3 + 1] = r * u;
      starPositions[i * 3 + 2] = r * sinPhi * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xcbd5e1,
      size: 0.085,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Procedural offscreen canvases for globe textures
    const countryAvgCanvas = document.createElement('canvas');
    countryAvgCanvas.width = TEXTURE_WIDTH;
    countryAvgCanvas.height = TEXTURE_HEIGHT;

    const localThermalCanvas = document.createElement('canvas');
    localThermalCanvas.width = TEXTURE_WIDTH;
    localThermalCanvas.height = TEXTURE_HEIGHT;

    const roughnessCanvas = document.createElement('canvas');
    roughnessCanvas.width = TEXTURE_WIDTH;
    roughnessCanvas.height = TEXTURE_HEIGHT;

    renderLandRoughnessTexture(roughnessCanvas, features);
    renderCountryAverageTexture(
      countryAvgCanvas,
      features,
      propsRef.current.aggregates,
    );
    renderLocalThermalTexture(
      localThermalCanvas,
      features,
      propsRef.current.aggregates,
    );

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const countryAvgTexture = new THREE.CanvasTexture(countryAvgCanvas);
    countryAvgTexture.colorSpace = THREE.SRGBColorSpace;
    countryAvgTexture.anisotropy = maxAniso;
    countryAvgTexture.wrapS = THREE.RepeatWrapping;
    countryAvgTexture.wrapT = THREE.ClampToEdgeWrapping;

    const localThermalTexture = new THREE.CanvasTexture(localThermalCanvas);
    localThermalTexture.colorSpace = THREE.SRGBColorSpace;
    localThermalTexture.anisotropy = maxAniso;
    localThermalTexture.wrapS = THREE.RepeatWrapping;
    localThermalTexture.wrapT = THREE.ClampToEdgeWrapping;

    const roughnessTexture = new THREE.CanvasTexture(roughnessCanvas);
    roughnessTexture.colorSpace = THREE.NoColorSpace;
    roughnessTexture.anisotropy = maxAniso;

    // Crossfade uniform between Country Average map & Local Thermal Circle map
    const blendUniforms = {
      uLocalMap: { value: localThermalTexture },
      uLocalMix: { value: 0.0 },
    };

    const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64);
    const globeMat = new THREE.MeshStandardMaterial({
      map: countryAvgTexture,
      roughnessMap: roughnessTexture,
      roughness: 0.9,
      metalness: 0.06,
      envMapIntensity: 0.55,
    });

    globeMat.onBeforeCompile = (shader) => {
      shader.uniforms.uLocalMap = blendUniforms.uLocalMap;
      shader.uniforms.uLocalMix = blendUniforms.uLocalMix;
      shader.fragmentShader =
        'uniform sampler2D uLocalMap;\nuniform float uLocalMix;\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec4 localThermalTexel = texture2D( uLocalMap, vMapUv );
        diffuseColor.rgb = mix( diffuseColor.rgb, localThermalTexel.rgb, uLocalMix );`,
      );
    };

    const globeMesh = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globeMesh);

    // Subtle atmospheric Fresnel rim shell
    const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.045, 64, 48);
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vec3 viewDir = normalize(vViewPos);
          float rim = pow(clamp(0.68 - dot(vNormal, -viewDir), 0.0, 1.0), 3.0);
          gl_FragColor = vec4(0.18, 0.56, 0.92, rim * 0.42);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    scene.add(atmosMesh);

    // Crisp 3D vector borders across entire globe (stays razor-sharp at close zoom)
    const worldBorderLines = getWorldBorderLines();
    const worldBorderGeo = buildWorldBorderGeometry(
      worldBorderLines,
      GLOBE_RADIUS + 0.0028,
    );
    const worldBorderMat = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.62,
    });
    const worldBordersMesh = new THREE.LineSegments(
      worldBorderGeo,
      worldBorderMat,
    );
    scene.add(worldBordersMesh);

    // Country highlight vector border mesh
    const highlightBorderMat = new THREE.LineBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.96,
    });
    let highlightLines: THREE.LineSegments | null = null;

    // Instanced weather station pins on globe surface
    const maxStations = 1024;
    const markerGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.006, 18);
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      metalness: 0.15,
      emissive: new THREE.Color(0x0b1220),
      emissiveIntensity: 0.35,
    });
    const stationMarkers = new THREE.InstancedMesh(
      markerGeo,
      markerMat,
      maxStations,
    );
    stationMarkers.count = 0;
    stationMarkers.frustumCulled = false;
    scene.add(stationMarkers);

    let activeStations: LocationWeatherReading[] = [];

    function syncStationMarkers(localMix: number) {
      const aggs = propsRef.current.aggregates;
      const selectedKey = propsRef.current.selectedLocationKey;
      const stations: LocationWeatherReading[] = [];
      for (const c of aggs) {
        for (const loc of c.locations) {
          stations.push(loc);
          if (stations.length >= maxStations) break;
        }
        if (stations.length >= maxStations) break;
      }
      activeStations = stations;
      stationMarkers.count = stations.length;

      const baseScale = 0.42 + localMix * 0.68;

      for (let i = 0; i < stations.length; i++) {
        const loc = stations[i];
        latLonToVector3(loc.latitude, loc.longitude, GLOBE_RADIUS + 0.008, _vec3A);
        _vec3B.copy(_vec3A).normalize();
        _quat.setFromUnitVectors(_upAxis, _vec3B);

        const isSel = selectedKey === loc.key;
        const s = isSel ? baseScale * 1.55 : baseScale;
        _scaleVec.set(s, 1, s);
        _mat4.compose(_vec3A, _quat, _scaleVec);
        stationMarkers.setMatrixAt(i, _mat4);

        if (loc.temperature !== null) {
          _color.setHex(sampleThermalHex(loc.temperature));
        } else {
          _color.setHex(0x64748b);
        }
        stationMarkers.setColorAt(i, _color);
      }

      stationMarkers.instanceMatrix.needsUpdate = true;
      if (stationMarkers.instanceColor) {
        stationMarkers.instanceColor.needsUpdate = true;
      }
      stationMarkers.computeBoundingSphere();
    }

    syncStationMarkers(0);

    // Pre-warm shaders on hardware GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Coalesced on-demand rendering + animation state
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTickMs = performance.now();

    let targetFlyDir: THREE.Vector3 | null = null;
    let targetFlyDist: number | null = null;
    let lastReportedDist = -1;
    let lastReportedLocal: boolean | null = null;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function updateAdaptiveControlSpeed(dist: number) {
      const altRatio = THREE.MathUtils.clamp(
        (dist - GLOBE_RADIUS) / (DEFAULT_CAMERA_DISTANCE - GLOBE_RADIUS),
        0.09,
        1.25,
      );
      controls.rotateSpeed = 0.65 * altRatio;
      controls.zoomSpeed = 0.85 * Math.max(0.32, altRatio);
    }

    function reportCameraMetrics(dist: number) {
      updateAdaptiveControlSpeed(dist);
      const { zoomAggregate, modeOverride, onZoomChange } = propsRef.current;
      const isLocal = computeIsLocalMode(dist, zoomAggregate, modeOverride);
      if (
        Math.abs(dist - lastReportedDist) > 0.015 ||
        isLocal !== lastReportedLocal
      ) {
        lastReportedDist = dist;
        lastReportedLocal = isLocal;
        onZoomChange(distanceToZoomLevel(dist), dist, isLocal);
      }
      return isLocal;
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        const delta = Math.min(0.1, Math.max(0.001, (now - lastTickMs) / 1000));
        lastTickMs = now;

        let needsMoreFrames = false;

        // Smooth scripted camera fly-to transition
        if (targetFlyDir !== null) {
          const curDist = camera.position.length();
          const curDir = _vec3A.copy(camera.position).normalize();
          const nextDist =
            targetFlyDist !== null
              ? THREE.MathUtils.damp(curDist, targetFlyDist, 6.5, delta)
              : curDist;

          const angleDiff = curDir.angleTo(targetFlyDir);
          const distDiff =
            targetFlyDist !== null ? Math.abs(nextDist - targetFlyDist) : 0;

          if (angleDiff < 0.004 && distDiff < 0.01) {
            camera.position
              .copy(targetFlyDir)
              .multiplyScalar(targetFlyDist ?? curDist);
            targetFlyDir = null;
            targetFlyDist = null;
          } else {
            const slerpAlpha = 1 - Math.exp(-6.5 * delta);
            curDir.lerp(targetFlyDir, slerpAlpha).normalize();
            camera.position.copy(curDir).multiplyScalar(nextDist);
            needsMoreFrames = true;
          }
        }

        const controlsChanged = controls.update();
        if (controlsChanged && controls.enableDamping) {
          needsMoreFrames = true;
        }

        const dist = camera.position.length();
        const isLocal = reportCameraMetrics(dist);
        const targetMix = isLocal ? 1.0 : 0.0;
        const curMix = blendUniforms.uLocalMix.value;

        if (Math.abs(curMix - targetMix) > 0.005) {
          blendUniforms.uLocalMix.value = THREE.MathUtils.damp(
            curMix,
            targetMix,
            8.0,
            delta,
          );
          syncStationMarkers(blendUniforms.uLocalMix.value);
          needsMoreFrames = true;
        } else if (curMix !== targetMix) {
          blendUniforms.uLocalMix.value = targetMix;
          syncStationMarkers(targetMix);
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsMoreFrames) {
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    // Cancel scripted fly-to as soon as user interacts
    const onControlsStart = () => {
      targetFlyDir = null;
      targetFlyDist = null;
      updateAdaptiveControlSpeed(camera.position.length());
    };
    const onControlsChange = () => {
      updateAdaptiveControlSpeed(camera.position.length());
      requestRender();
    };
    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('change', onControlsChange);

    // Raycasting for country & weather station hover / click
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };
    let lastHoverCheck = 0;

    function updatePointerNdc(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    }

    function pickAtPointer(): {
      station: LocationWeatherReading | null;
      countryFeat: CountryPolygonFeature | null;
    } {
      raycaster.setFromCamera(pointerNdc, camera);

      const stationHits = raycaster.intersectObject(stationMarkers, false);
      if (
        stationHits.length > 0 &&
        stationHits[0].instanceId !== undefined &&
        stationHits[0].instanceId < activeStations.length
      ) {
        const station = activeStations[stationHits[0].instanceId];
        const agg = propsRef.current.aggregates.find(
          (c) => c.ISO === station.countryISO,
        );
        const feat =
          (agg?.numericId && features.find((f) => f.id === agg.numericId)) ||
          null;
        return { station, countryFeat: feat };
      }

      const globeHits = raycaster.intersectObject(globeMesh, false);
      if (globeHits.length > 0) {
        const { lat, lon } = vector3ToLatLon(globeHits[0].point);
        const feat = findCountryAtLatLon(lat, lon, features);
        return { station: null, countryFeat: feat };
      }

      return { station: null, countryFeat: null };
    }

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverCheck < 45) return;
      lastHoverCheck = now;

      updatePointerNdc(e.clientX, e.clientY);
      const { station, countryFeat } = pickAtPointer();

      renderer.domElement.style.cursor =
        station || countryFeat ? 'pointer' : 'grab';

      propsRef.current.onHoverLocation(station);
      if (countryFeat) {
        const matchedAgg = propsRef.current.aggregates.find(
          (a) => a.numericId === countryFeat.id,
        );
        propsRef.current.onHoverCountry(
          matchedAgg?.ISO ?? countryFeat.iso3 ?? countryFeat.id,
          countryFeat,
        );
      } else {
        propsRef.current.onHoverCountry(null, null);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 5) return; // Ignore orbit drag

      updatePointerNdc(e.clientX, e.clientY);
      const { station, countryFeat } = pickAtPointer();

      if (station) {
        propsRef.current.onSelectLocation(station);
        const matchedAgg = propsRef.current.aggregates.find(
          (a) => a.ISO === station.countryISO,
        );
        if (matchedAgg?.numericId) {
          const feat = features.find((f) => f.id === matchedAgg.numericId) ?? null;
          propsRef.current.onSelectCountry(station.countryISO, feat);
        } else {
          propsRef.current.onSelectCountry(station.countryISO, countryFeat);
        }
        return;
      }

      if (countryFeat) {
        const matchedAgg = propsRef.current.aggregates.find(
          (a) => a.numericId === countryFeat.id,
        );
        propsRef.current.onSelectLocation(null);
        propsRef.current.onSelectCountry(
          matchedAgg?.ISO ?? countryFeat.iso3 ?? countryFeat.id,
          countryFeat,
        );
      } else {
        propsRef.current.onSelectLocation(null);
        propsRef.current.onSelectCountry(null, null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', onResize);

    sceneApiRef.current = {
      requestRender,
      updateWeatherLayers: () => {
        renderCountryAverageTexture(
          countryAvgCanvas,
          features,
          propsRef.current.aggregates,
        );
        countryAvgTexture.needsUpdate = true;

        renderLocalThermalTexture(
          localThermalCanvas,
          features,
          propsRef.current.aggregates,
        );
        localThermalTexture.needsUpdate = true;

        syncStationMarkers(blendUniforms.uLocalMix.value);
        requestRender();
      },
      updateHighlightBorder: () => {
        if (highlightLines) {
          scene.remove(highlightLines);
          highlightLines.geometry.dispose();
          highlightLines = null;
        }
        const targetISO =
          propsRef.current.hoveredCountryISO ||
          propsRef.current.selectedCountryISO;
        if (targetISO) {
          const agg = propsRef.current.aggregates.find(
            (a) => a.ISO === targetISO,
          );
          const feat =
            (agg?.numericId && features.find((f) => f.id === agg.numericId)) ||
            features.find(
              (f) => f.iso3 === targetISO || f.id === targetISO,
            ) ||
            null;
          if (feat) {
            const borderGeo = buildCountryBorderGeometry(
              feat,
              GLOBE_RADIUS + 0.005,
            );
            highlightLines = new THREE.LineSegments(
              borderGeo,
              highlightBorderMat,
            );
            scene.add(highlightLines);
          }
        }
        requestRender();
      },
      flyToLatLon: (lat, lon, targetDist) => {
        const dir = latLonToVector3(lat, lon, 1, new THREE.Vector3()).normalize();
        targetFlyDir = dir;
        targetFlyDist = targetDist ?? camera.position.length();
        requestRender();
      },
      setZoomDelta: (deltaZoom) => {
        const curZoom = distanceToZoomLevel(camera.position.length());
        const nextDist = zoomLevelToDistance(curZoom + deltaZoom);
        const dir = camera.position.clone().normalize();
        targetFlyDir = dir;
        targetFlyDist = nextDist;
        requestRender();
      },
      resetView: () => {
        const dir = latLonToVector3(24, 14, 1, new THREE.Vector3()).normalize();
        targetFlyDir = dir;
        targetFlyDist = DEFAULT_CAMERA_DISTANCE;
        requestRender();
      },
    };

    // Initial metrics & draw
    reportCameraMetrics(camera.position.length());
    requestRender();

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener(
        'webglcontextrestored',
        onContextRestored,
      );

      if (highlightLines) {
        highlightLines.geometry.dispose();
      }
      worldBorderGeo.dispose();
      worldBorderMat.dispose();
      highlightBorderMat.dispose();
      globeGeo.dispose();
      globeMat.dispose();
      atmosGeo.dispose();
      atmosMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      markerGeo.dispose();
      markerMat.dispose();
      countryAvgTexture.dispose();
      localThermalTexture.dispose();
      roughnessTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneApiRef.current = null;
    };
  }, []);

  // Re-render globe textures when live weather aggregates update
  useEffect(() => {
    sceneApiRef.current?.updateWeatherLayers();
  }, [aggregates]);

  // Update highlighted border & selected station pin scale
  useEffect(() => {
    sceneApiRef.current?.updateHighlightBorder();
    sceneApiRef.current?.requestRender();
  }, [selectedCountryISO, hoveredCountryISO, selectedLocationKey]);

  // Re-evaluate aggregation mode when zoomAggregate or modeOverride changes
  useEffect(() => {
    sceneApiRef.current?.requestRender();
  }, [zoomAggregate, modeOverride]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#07090E]">
      <div ref={mountRef} className="h-full w-full" />
      {webglLost && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#07090E]/95 p-6 text-center">
          <div className="max-w-md border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-base font-semibold text-slate-100">
              WebGL Context Interrupted
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              The 3D graphics context was temporarily suspended. Reloading or
              restoring hardware acceleration will resume the thermal globe.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
