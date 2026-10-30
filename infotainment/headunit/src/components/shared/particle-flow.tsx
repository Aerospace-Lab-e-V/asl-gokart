import React, { useRef, useMemo } from "react";
import { useFrame, extend } from "@react-three/fiber";
import * as THREE from "three";
import { shaderMaterial } from "@react-three/drei";
import { FlowState } from "@/domain/signals";
import { readSignal } from "@/stores/signals";
import { useSession } from "@/stores/session";
import { useIsDark } from "@/hooks/use-is-dark";

// Custom spark shader material
const SparkMaterial = shaderMaterial(
    {
        // No uniforms needed - we use vertex colors
    },
    // Vertex shader
    `
        attribute float size;
        varying vec3 vColor;
        
        void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size;
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    // Fragment shader - creates glowing spark effect
    `
        varying vec3 vColor;
        
        void main() {
            // Calculate distance from center of point
            vec2 center = gl_PointCoord - vec2(0.5);
            float dist = length(center);
            
            // Discard pixels outside the circle
            if (dist > 0.5) discard;
            
            // Create glowing spark effect with soft falloff
            float strength = 1.0 - (dist * 2.0);
            strength = pow(strength, 1.5); // Sharper center, softer edges
            
            // Add a bright core
            float core = 1.0 - smoothstep(0.0, 0.15, dist);
            strength = strength + core * 0.5;
            
            // Apply color with glow
            vec3 glow = vColor * strength;
            
            // Add slight white core for spark effect
            glow = mix(glow, vec3(1.0), core * 0.3);
            
            gl_FragColor = vec4(glow, strength * 0.9);
        }
    `
);

// Extend Three.js with our custom material
extend({ SparkMaterial });

// Add type declaration for the custom material
declare module "@react-three/fiber" {
    interface ThreeElements {
        sparkMaterial: object;
    }
}

// Theme-aware color palettes
const COLORS = {
    dark: {
        power: { primary: "#FF6B35", secondary: "#FFD700" },
        regen: { primary: "#00D9FF", secondary: "#7B68EE" },
        idle: { primary: "#4A5568", secondary: "#718096" },
    },
    light: {
        power: { primary: "#E85A24", secondary: "#F59E0B" },
        regen: { primary: "#0284C7", secondary: "#6366F1" },
        idle: { primary: "#9CA3AF", secondary: "#D1D5DB" },
    },
};

const PALETTE_KEY = {
    [FlowState.POWER]: "power",
    [FlowState.REGEN]: "regen",
    [FlowState.IDLE]: "idle",
} as const;

/** Read per frame, not per render: battery current updates far faster than React should re-render. */
function currentFlowState(): FlowState {
    return useSession.getState().flowStateOverride ?? (readSignal("drive.flow_state") as FlowState | null) ?? FlowState.IDLE;
}

// Particle counts optimized for Raspberry Pi 4
const PARTICLES_PER_MOTOR = 80;
const IDLE_PARTICLES_PER_MOTOR = 30;
// Always allocate max particles to avoid buffer resize issues
const MAX_PARTICLES_PER_MOTOR = PARTICLES_PER_MOTOR;

interface Position2D {
    x: number;
    y: number;
}

interface ParticleFlowProps {
    sourcePosition: Position2D; // Outside viewport, below bottom
    branchingPosition: Position2D; // Visible branching point inside viewport
    branchingRadius: number; // Radius of circular area where particles diverge
    leftMotorPosition: Position2D;
    rightMotorPosition: Position2D;
    motorTargetRadius: number; // Radius of circular target area around motors
    containerWidth: number;
    containerHeight: number;
}

// Quadratic bezier interpolation
function quadraticBezier(
    t: number,
    p0: Position2D,
    p1: Position2D,
    p2: Position2D
): Position2D {
    const oneMinusT = 1 - t;
    return {
        x: oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x,
        y: oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y,
    };
}

// Generate random control point for organic curve
function generateControlPoint(
    start: Position2D,
    end: Position2D,
    variance: number
): Position2D {
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    return {
        x: midX + (Math.random() - 0.5) * variance,
        y: midY + (Math.random() - 0.5) * variance * 0.5,
    };
}

// Lissajous curve for idle animation
function lissajousPoint(
    t: number,
    center: Position2D,
    radiusX: number,
    radiusY: number,
    freqX: number,
    freqY: number,
    phase: number
): Position2D {
    return {
        x: center.x + Math.sin(freqX * t + phase) * radiusX,
        y: center.y + Math.sin(freqY * t) * radiusY,
    };
}

interface Particle {
    t: number; // Progress along path (0-1)
    speed: number; // Individual speed multiplier
    controlPoint1: Position2D; // Bezier control point for source->branch segment
    controlPoint2: Position2D; // Bezier control point for branch->motor segment
    branchOffset: Position2D; // Random offset within branching area circle
    targetOffset: Position2D; // Random offset within motor target circle
    size: number;
    opacity: number;
    // For idle animation
    phase: number;
    freqX: number;
    freqY: number;
}

// Generate target offset within circular area
function generateTargetOffset(radius: number): Position2D {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    return {
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
    };
}

const ParticleFlow: React.FC<ParticleFlowProps> = ({
    sourcePosition,
    branchingPosition,
    branchingRadius,
    leftMotorPosition,
    rightMotorPosition,
    motorTargetRadius,
    containerWidth,
    containerHeight,
}) => {
    const pointsRef = useRef<THREE.Points>(null);
    // Reused every frame, allocating them per particle churns the GC on the Pi.
    const scratch = useMemo(() => ({ primary: new THREE.Color(), secondary: new THREE.Color(), color: new THREE.Color() }), []);

    // Scale factor for control point variance (based on screen size)
    const pathVariance = Math.min(containerWidth, containerHeight) * 0.1;

    const isDarkMode = useIsDark();
    const palette = isDarkMode ? COLORS.dark : COLORS.light;

    // Initialize particles - always create max count to avoid buffer resize
    const particles = useMemo(() => {
        const leftParticles: Particle[] = [];
        const rightParticles: Particle[] = [];
        
        // Idle orbit radius based on container size
        const idleRadius = Math.min(containerWidth, containerHeight) * 0.08;

        // Always create max particles to avoid buffer resize issues
        for (let i = 0; i < MAX_PARTICLES_PER_MOTOR; i++) {
            // Left motor particles
            leftParticles.push({
                t: Math.random(),
                speed: 0.3 + Math.random() * 0.4,
                controlPoint1: generateControlPoint(
                    sourcePosition,
                    branchingPosition,
                    pathVariance * 0.3 // Less variance for the trunk
                ),
                controlPoint2: generateControlPoint(
                    branchingPosition,
                    leftMotorPosition,
                    pathVariance
                ),
                branchOffset: generateTargetOffset(branchingRadius),
                targetOffset: generateTargetOffset(motorTargetRadius),
                size: 6 + Math.random() * 4,
                opacity: 0.6 + Math.random() * 0.3,
                phase: Math.random() * Math.PI * 2,
                freqX: 2 + Math.random(),
                freqY: 3 + Math.random(),
            });

            // Right motor particles
            rightParticles.push({
                t: Math.random(),
                speed: 0.3 + Math.random() * 0.4,
                controlPoint1: generateControlPoint(
                    sourcePosition,
                    branchingPosition,
                    pathVariance * 0.3 // Less variance for the trunk
                ),
                controlPoint2: generateControlPoint(
                    branchingPosition,
                    rightMotorPosition,
                    pathVariance
                ),
                branchOffset: generateTargetOffset(branchingRadius),
                targetOffset: generateTargetOffset(motorTargetRadius),
                size: 6 + Math.random() * 4,
                opacity: 0.6 + Math.random() * 0.3,
                phase: Math.random() * Math.PI * 2,
                freqX: 2 + Math.random(),
                freqY: 3 + Math.random(),
            });
        }

        return { left: leftParticles, right: rightParticles, idleRadius };
    }, [sourcePosition, branchingPosition, branchingRadius, leftMotorPosition, rightMotorPosition, motorTargetRadius, pathVariance, containerWidth, containerHeight]);

    // Create geometry buffers - fixed size to avoid resize issues
    const { positions, colorsBuffer, sizes, totalParticles } = useMemo(() => {
        const total = MAX_PARTICLES_PER_MOTOR * 2; // left + right
        return {
            positions: new Float32Array(total * 3),
            colorsBuffer: new Float32Array(total * 3),
            sizes: new Float32Array(total),
            totalParticles: total,
        };
    }, []);

    // Animation loop
    useFrame((state, delta) => {
        if (!pointsRef.current) return;

        const geometry = pointsRef.current.geometry;
        const positionAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
        const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
        const sizeAttr = geometry.getAttribute("size") as THREE.BufferAttribute;

        const flowState = currentFlowState();
        const colors = palette[PALETTE_KEY[flowState] ?? "idle"];

        // Speed multiplier based on current magnitude
        const currentMagnitude = Math.min(Math.abs(readSignal("battery.current") ?? 0) / 100, 1);
        const baseSpeed = 0.2 + currentMagnitude * 0.6;

        // Parse colors
        const primaryColor = scratch.primary.set(colors.primary);
        const secondaryColor = scratch.secondary.set(colors.secondary);

        // Determine active particle count per motor based on flow state
        const activePerMotor = flowState === FlowState.IDLE ? IDLE_PARTICLES_PER_MOTOR : PARTICLES_PER_MOTOR;

        const allParticles = [...particles.left, ...particles.right];
        const isLeftMotor = (index: number) => index < particles.left.length;
        
        // Get the index within the motor's particle array
        const getMotorIndex = (index: number) => isLeftMotor(index) ? index : index - particles.left.length;

        allParticles.forEach((particle, i) => {
            const motorIndex = getMotorIndex(i);
            
            // Hide inactive particles (set size to 0 and position offscreen)
            if (motorIndex >= activePerMotor) {
                positionAttr.setXYZ(i, 0, -10000, 0);
                sizeAttr.setX(i, 0);
                return;
            }
            
            // Update particle progress
            particle.t += delta * particle.speed * baseSpeed;
            if (particle.t > 1) {
                particle.t = 0;
                // Regenerate control points, branch offset, and target offset for variety
                const target = isLeftMotor(i) ? leftMotorPosition : rightMotorPosition;
                particle.controlPoint1 = generateControlPoint(
                    sourcePosition,
                    branchingPosition,
                    pathVariance * 0.3
                );
                particle.controlPoint2 = generateControlPoint(
                    branchingPosition,
                    target,
                    pathVariance
                );
                particle.branchOffset = generateTargetOffset(branchingRadius);
                particle.targetOffset = generateTargetOffset(motorTargetRadius);
            }

            let pos: Position2D;
            const motorPos = isLeftMotor(i) ? leftMotorPosition : rightMotorPosition;
            
            // Calculate branching position with offset (circular area)
            const branchPos = {
                x: branchingPosition.x + particle.branchOffset.x,
                y: branchingPosition.y + particle.branchOffset.y,
            };
            
            // Calculate target position with offset (circular area)
            const targetPos = {
                x: motorPos.x + particle.targetOffset.x,
                y: motorPos.y + particle.targetOffset.y,
            };

            if (flowState === FlowState.IDLE) {
                // Lissajous orbit around motor
                pos = lissajousPoint(
                    state.clock.elapsedTime * 0.5 + particle.phase,
                    motorPos,
                    particles.idleRadius,
                    particles.idleRadius * 0.7,
                    particle.freqX,
                    particle.freqY,
                    particle.phase
                );
            } else {
                // Two-segment bezier path
                // POWER mode: source -> branching -> motor (energy flows TO motors)
                // REGEN mode: motor -> branching -> source (energy flows FROM motors)
                
                const t = particle.t;
                const isRegen = flowState === FlowState.REGEN;
                
                // Define path endpoints based on flow direction
                const pathStart = isRegen ? targetPos : sourcePosition;
                const pathEnd = isRegen ? sourcePosition : targetPos;
                
                // Control points need to be swapped for regen mode
                // controlPoint1 was generated for source->branch segment
                // controlPoint2 was generated for branch->motor segment
                const ctrl1 = isRegen ? particle.controlPoint2 : particle.controlPoint1;
                const ctrl2 = isRegen ? particle.controlPoint1 : particle.controlPoint2;
                
                if (t < 0.5) {
                    // First segment: start to branching area (t: 0->0.5 maps to 0->1)
                    const segmentT = t * 2;
                    pos = quadraticBezier(segmentT, pathStart, ctrl1, branchPos);
                } else {
                    // Second segment: branching area to end (t: 0.5->1 maps to 0->1)
                    const segmentT = (t - 0.5) * 2;
                    pos = quadraticBezier(segmentT, branchPos, ctrl2, pathEnd);
                }
            }

            // Update position buffer
            positionAttr.setXYZ(i, pos.x, pos.y, 0);

            // Color gradient based on progress
            const color = scratch.color.lerpColors(
                primaryColor,
                secondaryColor,
                particle.t
            );
            colorAttr.setXYZ(i, color.r, color.g, color.b);

            // Size with slight pulsing - smaller for idle mode
            const pulse = 1 + Math.sin(state.clock.elapsedTime * 3 + particle.phase) * 0.2;
            const sizeMultiplier = flowState === FlowState.IDLE ? 0.6 : 1.0;
            sizeAttr.setX(i, particle.size * pulse * sizeMultiplier);
        });

        positionAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
    });

    return (
        <points ref={pointsRef}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    args={[positions, 3]}
                    count={totalParticles}
                    array={positions}
                    itemSize={3}
                />
                <bufferAttribute
                    attach="attributes-color"
                    args={[colorsBuffer, 3]}
                    count={totalParticles}
                    array={colorsBuffer}
                    itemSize={3}
                />
                <bufferAttribute
                    attach="attributes-size"
                    args={[sizes, 1]}
                    count={totalParticles}
                    array={sizes}
                    itemSize={1}
                />
            </bufferGeometry>
            <sparkMaterial
                vertexColors
                transparent
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                depthTest={false}
            />
        </points>
    );
};

export { ParticleFlow };
