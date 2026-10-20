import React, { useRef, useState, useEffect } from "react";

// Import image file from /images folder
import motorDark from "../../images/motor_dark.png";
import motorLight from "../../images/motor_light.png";

// Import particle effect components
import { EnergyFlowCanvas } from "@/components/shared/energy-flow-canvas";
import { ParticleToggle } from "@/components/shared/particle-toggle";
import { ErrorBoundary } from "@/components/shared/error-boundary";

// UI imports for relays control
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useSignal } from "@/stores/signals";
import { useCommand } from "@/services/commands";
import { useIsDark } from "@/hooks/use-is-dark";

/** Shows the relay state the ECU reports; a flip asks the ECU to toggle it. */
const RelaySwitch = ({ relay }: { relay: 0 | 1 }) => {
    const n = relay + 1;
    const on = useSignal(n === 1 ? "drive.relay_1" : "drive.relay_2");
    const { run, pending } = useCommand();

    const toggleRelay = async () => {
        const result = await run({ type: "motor.toggleRelay", relay });
        if (!result.ok) toast.error(`Failed to toggle Relay ${n}: ${result.error}`);
    };

    return (
        <div className="flex items-center gap-4">
            <Label htmlFor={`relay-${n}-switch`} className="text-base font-medium select-none cursor-pointer">
                Relay {n}{on === null && " (--)"}
            </Label>
            <Switch
                id={`relay-${n}-switch`}
                checked={on === 1}
                disabled={pending || on === null}
                onCheckedChange={toggleRelay}
                className="data-[state=checked]:bg-blue-600"
            />
        </div>
    );
};

const MotorPage = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const leftMotorRef = useRef<HTMLImageElement>(null);
    const rightMotorRef = useRef<HTMLImageElement>(null);

    const isDarkMode = useIsDark();

    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [motorPositions, setMotorPositions] = useState({
        left: { x: 0, y: 0 },
        right: { x: 0, y: 0 },
    });

    // Update positions on resize
    useEffect(() => {
        const updatePositions = () => {
            if (!containerRef.current) return;

            const containerRect = containerRef.current.getBoundingClientRect();
            setContainerSize({
                width: containerRect.width,
                height: containerRect.height,
            });

            if (leftMotorRef.current && rightMotorRef.current) {
                const leftRect = leftMotorRef.current.getBoundingClientRect();
                const rightRect = rightMotorRef.current.getBoundingClientRect();

                // Only update if images have loaded (have non-zero dimensions)
                if (leftRect.width > 0 && rightRect.width > 0) {
                    // Get center positions relative to container
                    setMotorPositions({
                        left: {
                            x: leftRect.left - containerRect.left + leftRect.width / 2,
                            y: leftRect.top - containerRect.top + leftRect.height / 2,
                        },
                        right: {
                            x: rightRect.left - containerRect.left + rightRect.width / 2,
                            y: rightRect.top - containerRect.top + rightRect.height / 2,
                        },
                    });
                }
            }
        };

        updatePositions();

        // Listen for image load events to recalculate positions
        const leftImg = leftMotorRef.current;
        const rightImg = rightMotorRef.current;
        
        const handleImageLoad = () => {
            // Use requestAnimationFrame to ensure layout is complete
            requestAnimationFrame(updatePositions);
        };

        leftImg?.addEventListener("load", handleImageLoad);
        rightImg?.addEventListener("load", handleImageLoad);

        // Use ResizeObserver for responsive updates
        const resizeObserver = new ResizeObserver(updatePositions);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        window.addEventListener("resize", updatePositions);
        return () => {
            leftImg?.removeEventListener("load", handleImageLoad);
            rightImg?.removeEventListener("load", handleImageLoad);
            resizeObserver.disconnect();
            window.removeEventListener("resize", updatePositions);
        };
    }, []);

    const motor = isDarkMode ? motorDark : motorLight;

    return (
        <div ref={containerRef} className="relative h-full w-full">
            {/* Particle effect canvas layer */}
            {containerSize.width > 0 && motorPositions.left.x > 0 && motorPositions.right.x > 0 && (
                <ErrorBoundary fallback={null}>
                    <EnergyFlowCanvas
                        leftMotorPosition={motorPositions.left}
                        rightMotorPosition={motorPositions.right}
                        containerWidth={containerSize.width}
                        containerHeight={containerSize.height}
                    />
                </ErrorBoundary>
            )}

            {/* Motor images layer */}
            <div className="flex items-center justify-center h-full w-full gap-36 relative">
                <img
                    ref={leftMotorRef}
                    src={motor}
                    alt="Left Motor"
                    className="max-h-[50%] w-auto object-contain"
                />
                <img
                    ref={rightMotorRef}
                    src={motor}
                    alt="Right Motor"
                    className="max-h-[50%] w-auto object-contain"
                />
            </div>

            {/* Relay Switches Control Panel */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex flex-row gap-12 bg-background/60 dark:bg-background/40 backdrop-blur-md px-8 py-5 rounded-2xl border border-border shadow-xl">
                <RelaySwitch relay={0} />
                <RelaySwitch relay={1} />
            </div>

            {/* Settings toggle in top-right corner */}
            <div className="absolute top-4 right-4 z-20">
                <ParticleToggle />
            </div>
        </div>
    );
};

export default MotorPage;