"use client";

import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { DashboardRiskNode, DashboardTriadCode, RiskBand } from "@/types";

const colors: Record<RiskBand, string> = { high: "#ff6b5e", medium: "#f4b740", low: "#4d8aa8", unavailable: "#6c7881" };
const tempObject = new THREE.Object3D();
const tempColor = new THREE.Color();

interface NodeLayout {
  positions: Map<string, THREE.Vector3>;
  mapY: (value: number | null) => number;
}

function expandedBounds(values: number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const center = (minimum + maximum) / 2;
  const range = Math.max(.08, maximum - minimum);
  const padding = range * .12;
  return { minimum: center - range / 2 - padding, maximum: center + range / 2 + padding };
}

function mapToRange(value: number, bounds: { minimum: number; maximum: number }, size: number) {
  return ((value - bounds.minimum) / (bounds.maximum - bounds.minimum) - .5) * size;
}

function buildNodeLayout(nodes: DashboardRiskNode[]): NodeLayout {
  const xBounds = expandedBounds(nodes.map((node) => node.eass ?? .5));
  const yBounds = expandedBounds(nodes.map((node) => node.finalIndex ?? .5));
  const industries = [...new Set(nodes.map((node) => node.industry))].sort();
  const industryCenter = (industries.length - 1) / 2;
  const positions = new Map<string, THREE.Vector3>();

  nodes.forEach((node) => {
    const industryDepth = (industries.indexOf(node.industry) - industryCenter) * .18;
    const persistenceDepth = Math.max(0, node.persistentHighRiskYears - 1) * .16;
    const evidenceDepth = (1 - node.evidenceCoverage / 100) * .62;
    positions.set(node.companyId, new THREE.Vector3(
      mapToRange(node.eass ?? .5, xBounds, 8.1),
      mapToRange(node.finalIndex ?? .5, yBounds, 4.7),
      industryDepth + persistenceDepth + evidenceDepth,
    ));
  });

  return {
    positions,
    mapY: (value) => mapToRange(value ?? .5, yBounds, 4.7),
  };
}

function AdaptiveCamera() {
  const { size } = useThree();
  const zoom = Math.max(42, Math.min(82, Math.min(size.width / 10.2, size.height / 6.1)));
  return <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={zoom} near={.1} far={100}/>;
}

function focusRisk(node: DashboardRiskNode, factor: DashboardTriadCode | null) {
  if (factor === "RHETORIC_CONTENT") return node.metricRiskValues.ESGSI;
  if (factor === "ACTION_SUBSTANCE") return node.metricRiskValues.EASS;
  if (factor === "AMBIGUITY_VERIFICATION") {
    const ir = node.metricRiskValues.IR;
    const upr = node.metricRiskValues.UPR;
    return ir == null || upr == null ? null : (ir + upr) / 2;
  }
  return node.finalIndex;
}

function RiskBandNodes({ band, nodes, positions, selectedFactor, selectedCompanyId, onHover, onSelect, onOpen }: {
  band: RiskBand;
  nodes: DashboardRiskNode[];
  positions: Map<string, THREE.Vector3>;
  selectedFactor: DashboardTriadCode | null;
  selectedCompanyId: string | null;
  onHover: (node: DashboardRiskNode | null) => void;
  onSelect: (companyId: string, addToCompare: boolean) => void;
  onOpen: (companyId: string) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const bandNodes = useMemo(() => nodes.filter((node) => node.riskBand === band), [band, nodes]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    bandNodes.forEach((node, index) => {
      const selected = selectedCompanyId === node.companyId;
      const dimmed = selectedCompanyId != null && !selected;
      const risk = focusRisk(node, selectedFactor);
      const focusScale = dimmed || (selectedFactor && risk != null && risk < .5) ? .62 : 1;
      const scale = Math.max(.09, Math.min(.22, .08 + Math.log2(node.environmentalSentenceCount + 1) * .021)) * (selected ? 1.38 : focusScale);
      tempObject.position.copy(positions.get(node.companyId) ?? new THREE.Vector3());
      tempObject.scale.setScalar(scale);
      tempObject.updateMatrix();
      mesh.setMatrixAt(index, tempObject.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [bandNodes, positions, selectedCompanyId, selectedFactor]);

  function findNode(event: ThreeEvent<PointerEvent | MouseEvent>) {
    return event.instanceId == null ? null : bandNodes[event.instanceId] ?? null;
  }

  if (!bandNodes.length) return null;
  return <instancedMesh
    ref={meshRef}
    args={[undefined, undefined, bandNodes.length]}
    onPointerMove={(event) => { event.stopPropagation(); onHover(findNode(event)); }}
    onPointerOut={() => onHover(null)}
    onClick={(event) => { const node = findNode(event); if (node) onSelect(node.companyId, Boolean(event.nativeEvent.shiftKey)); }}
    onDoubleClick={(event) => { const node = findNode(event); if (node) onOpen(node.companyId); }}
  >
    <icosahedronGeometry args={[1, 2]}/><meshStandardMaterial color={colors[band]} emissive={colors[band]} emissiveIntensity={.24} roughness={.32} metalness={.18} toneMapped={false}/>
  </instancedMesh>;
}

function ConstellationScene({ nodes, selectedFactor, selectedCompanyId, onHover, onSelect, onOpen }: {
  nodes: DashboardRiskNode[];
  selectedFactor: DashboardTriadCode | null;
  selectedCompanyId: string | null;
  onHover: (node: DashboardRiskNode | null) => void;
  onSelect: (companyId: string, addToCompare: boolean) => void;
  onOpen: (companyId: string) => void;
}) {
  const ringsRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const layout = useMemo(() => buildNodeLayout(nodes), [nodes]);
  const positions = useMemo(() => nodes.map((node) => layout.positions.get(node.companyId) ?? new THREE.Vector3()), [layout, nodes]);
  const linePositions = useMemo(() => {
    const vertices: number[] = [];
    nodes.forEach((node, nodeIndex) => {
      const base = positions[nodeIndex];
      const available = (node.history ?? []).filter((point) => point.finalIndex != null);
      for (let index = 1; index < available.length; index += 1) {
        const previous = available[index - 1];
        const current = available[index];
        const previousY = layout.mapY(previous.finalIndex);
        const currentY = layout.mapY(current.finalIndex);
        vertices.push(base.x, previousY, base.z - (available.length - index) * .22, base.x, currentY, base.z - (available.length - index - 1) * .22);
      }
    });
    return new Float32Array(vertices);
  }, [layout, nodes, positions]);

  const glowAttributes = useMemo(() => {
    const position = new Float32Array(nodes.length * 3);
    const color = new Float32Array(nodes.length * 3);
    const size = new Float32Array(nodes.length);
    const opacity = new Float32Array(nodes.length);
    nodes.forEach((node, index) => {
      const point = positions[index];
      position.set([point.x, point.y, point.z], index * 3);
      const colorValue = new THREE.Color(colors[node.riskBand]);
      color.set([colorValue.r, colorValue.g, colorValue.b], index * 3);
      size[index] = node.riskBand === "high" ? 46 : node.riskBand === "medium" ? 38 : 31;
      opacity[index] = selectedCompanyId && selectedCompanyId !== node.companyId ? .1 : node.riskBand === "high" ? .9 : .58;
    });
    return { position, color, size, opacity };
  }, [nodes, positions, selectedCompanyId]);

  useLayoutEffect(() => {
    const rings = ringsRef.current;
    if (!rings) return;
    nodes.forEach((node, index) => {
      const point = positions[index];
      const ringScale = .13 + node.redFlags.length * .045;
      tempObject.position.copy(point);
      tempObject.scale.setScalar(ringScale);
      tempObject.updateMatrix();
      rings.setMatrixAt(index, tempObject.matrix);
      tempColor.set(colors[node.riskBand]);
      if (selectedCompanyId && selectedCompanyId !== node.companyId) tempColor.multiplyScalar(.2);
      rings.setColorAt(index, tempColor);
    });
    rings.instanceMatrix.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    const ringMaterials = Array.isArray(rings.material) ? rings.material : [rings.material];
    ringMaterials.forEach((material) => { material.needsUpdate = true; });
  }, [nodes, positions, selectedCompanyId, selectedFactor]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.position.y = Math.sin(clock.elapsedTime * .22) * .025;
  });

  return <>
    <AdaptiveCamera/>
    <color attach="background" args={["#030a07"]}/>
    <ambientLight intensity={.8}/><directionalLight position={[3, 4, 7]} intensity={1.45} color="#c8f8d7"/><directionalLight position={[-4, -2, 4]} intensity={.42} color="#789783"/>
    <group ref={groupRef} rotation={[-.035, -.065, 0]}>
      <lineSegments>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[linePositions, 3]}/></bufferGeometry>
        <lineBasicMaterial color="#45d483" transparent opacity={.38} depthWrite={false}/>
      </lineSegments>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[glowAttributes.position, 3]}/>
          <bufferAttribute attach="attributes-aColor" args={[glowAttributes.color, 3]}/>
          <bufferAttribute attach="attributes-aSize" args={[glowAttributes.size, 1]}/>
          <bufferAttribute attach="attributes-aOpacity" args={[glowAttributes.opacity, 1]}/>
        </bufferGeometry>
        <shaderMaterial
          transparent depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending}
          vertexShader={`attribute vec3 aColor; attribute float aSize; attribute float aOpacity; varying vec3 vColor; varying float vOpacity; void main(){vColor=aColor;vOpacity=aOpacity;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_PointSize=aSize;gl_Position=projectionMatrix*mvPosition;}`}
          fragmentShader={`varying vec3 vColor; varying float vOpacity; void main(){float d=distance(gl_PointCoord,vec2(.5));float halo=1.0-smoothstep(.08,.5,d);float core=1.0-smoothstep(0.0,.18,d);float alpha=(halo*.5+core*.7)*vOpacity;gl_FragColor=vec4(vColor,alpha);}`}
        />
      </points>
      {nodes.length <= 3000 ? <instancedMesh ref={ringsRef} args={[undefined, undefined, nodes.length]}>
        <torusGeometry args={[1, .05, 6, 24]}/><meshBasicMaterial transparent opacity={.64} depthWrite={false} vertexColors/>
      </instancedMesh> : null}
      {(["high", "medium", "low", "unavailable"] as RiskBand[]).map((band) => <RiskBandNodes key={band} band={band} nodes={nodes} positions={layout.positions} selectedFactor={selectedFactor} selectedCompanyId={selectedCompanyId} onHover={onHover} onSelect={onSelect} onOpen={onOpen}/>)}
    </group>
    <gridHelper args={[12, 12, "#19452d", "#0d281a"]} position={[0, 0, -1.5]} rotation={[Math.PI / 2, 0, 0]}/>
    <OrbitControls enablePan={false} enableDamping dampingFactor={.08} minAzimuthAngle={-.18} maxAzimuthAngle={.18} minPolarAngle={1.43} maxPolarAngle={1.71} minZoom={42} maxZoom={88}/>
  </>;
}

export default function RiskConstellation3D({ nodes, selectedFactor, selectedCompanyId, onSelect, onOpen }: {
  nodes: DashboardRiskNode[];
  selectedFactor: DashboardTriadCode | null;
  selectedCompanyId: string | null;
  onSelect: (companyId: string, addToCompare: boolean) => void;
  onOpen: (companyId: string) => void;
}) {
  const [hovered, setHovered] = useState<DashboardRiskNode | null>(null);
  return <div className="cc-risk-3d" role="img" aria-label="三维漂绿风险星图">
    <Canvas dpr={[1, 1.6]} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}>
      <ConstellationScene nodes={nodes} selectedFactor={selectedFactor} selectedCompanyId={selectedCompanyId} onHover={setHovered} onSelect={onSelect} onOpen={onOpen}/>
    </Canvas>
    {hovered ? <div className="cc-3d-tooltip"><strong>{hovered.companyName}</strong><span>{hovered.stockCode} · {hovered.industry}</span><div><i>行动实质 {hovered.eass == null ? "—" : `${Math.round(hovered.eass * 100)}%`}</i><i>E-AA {hovered.finalIndex == null ? "—" : `${Math.round(hovered.finalIndex * 100)}%`}</i></div><small>证据完整度 {Math.round(hovered.evidenceCoverage)}% · Shift 点击加入对比</small></div> : null}
  </div>;
}
