import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { useSession } from "@/stores/session";
import { ParticleFlow } from "./particle-flow";

interface EnergyFlowCanvasProps {
    leftMotorPosition: { x: number; y: number };
    rightMotorPosition: { x: number; y: number };
    containerWidth: number;
    containerHeight: number;
}

const EnergyFlowCanvas: React.FC<EnergyFlowCanvasProps> = ({
    leftMotorPosition,
    rightMotorPosition,
    containerWidth,
    containerHeight,
}) => {
    const showParticleEffects = useSession((state) => state.showParticleEffects);

    if (!showParticleEffects) {
        return null;
    }

    // Convert screen coordinates to centered coordinates (0,0 at center)
    const toCanvasX = (x: number) => x - containerWidth / 2;
    const toCanvasY = (y: number) => -(y - containerHeight / 2); // Flip Y axis (screen Y goes down, canvas Y goes up)

    // Source position: outside viewport, below bottom center
    // Particles will already be flowing into view
    const sourcePos = {
        x: toCanvasX(containerWidth / 2),
        y: toCanvasY(containerHeight + 100), // 100px below the viewport
    };

    // Branching point: visible inside viewport, bottom third of screen
    const branchingPos = {
        x: toCanvasX(containerWidth / 2),
        y: toCanvasY(containerHeight * 0.75), // 75% down from top
    };

    const leftMotorNorm = {
        x: toCanvasX(leftMotorPosition.x),
        y: toCanvasY(leftMotorPosition.y),
    };

    const rightMotorNorm = {
        x: toCanvasX(rightMotorPosition.x),
        y: toCanvasY(rightMotorPosition.y),
    };

    // Motor target area radius (circular area where particles end)
    const motorTargetRadius = Math.min(containerWidth, containerHeight) * 0.08;

    // Branching area radius (circular area where particles diverge)
    const branchingRadius = Math.min(containerWidth, containerHeight) * 0.04;

    return (
        <div 
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 20 }}
        >
            <Canvas
                dpr={1} // Low pixel ratio for Pi4 performance
                gl={{
                    alpha: true,
                    antialias: false, // Disable for performance
                    powerPreference: "low-power",
                }}
                orthographic
                camera={{
                    zoom: 1,
                    position: [0, 0, 10],
                    near: 0.1,
                    far: 1000,
                    left: -containerWidth / 2,
                    right: containerWidth / 2,
                    top: containerHeight / 2,
                    bottom: -containerHeight / 2,
                }}
                style={{ background: 'transparent' }}
            >
                <Suspense fallback={null}>
                    <ParticleFlow
                        sourcePosition={sourcePos}
                        branchingPosition={branchingPos}
                        branchingRadius={branchingRadius}
                        leftMotorPosition={leftMotorNorm}
                        rightMotorPosition={rightMotorNorm}
                        motorTargetRadius={motorTargetRadius}
                        containerWidth={containerWidth}
                        containerHeight={containerHeight}
                    />
                </Suspense>
            </Canvas>
        </div>
    );
};

export { EnergyFlowCanvas };
