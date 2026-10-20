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
import { MotorCommands } from "@/data/zonecontrollers/zonecontrollers";
import { useStore } from "@/stores/useStore";
import { useShallow } from "zustand/react/shallow";

const MotorPage = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const leftMotorRef = useRef<HTMLImageElement>(null);
    const rightMotorRef = useRef<HTMLImageElement>(null);

    const [isDarkMode, setIsDarkMode] = useState(
        document.documentElement.classList.contains("dark")
    );

    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [motorPositions, setMotorPositions] = useState({
        left: { x: 0, y: 0 },
        right: { x: 0, y: 0 },
    });

    // Relay control states from Zustand store
    const {
        relay1On,
        relay2On,
        relay1Pending,
        relay2Pending,
        setRelay1On,
        setRelay2On,
        setRelay1Pending,
        setRelay2Pending,
    } = useStore(
        useShallow((state) => ({
            relay1On: state.relay1On,
            relay2On: state.relay2On,
            relay1Pending: state.relay1Pending,
            relay2Pending: state.relay2Pending,
            setRelay1On: state.setRelay1On,
            setRelay2On: state.setRelay2On,
            setRelay1Pending: state.setRelay1Pending,
            setRelay2Pending: state.setRelay2Pending,
        }))
    );

    // Listen for theme changes
    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDarkMode(document.documentElement.classList.contains("dark"));
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });

        return () => observer.disconnect();
    }, []);

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

    const handleRelay1Toggle = async (checked: boolean) => {
        setRelay1Pending(true);
        try {
            const success = await window.sero.sendMotorCommand(MotorCommands.TOGGLE_RELAY, 0);
            if (success) {
                setRelay1On(checked);
                toast.success(`Relay 1 turned ${checked ? "ON" : "OFF"}`);
            } else {
                toast.error("Failed to toggle Relay 1");
            }
        } catch {
            toast.error("Error communicating with motor controller");
        } finally {
            setRelay1Pending(false);
        }
    };

    const handleRelay2Toggle = async (checked: boolean) => {
        setRelay2Pending(true);
        try {
            const success = await window.sero.sendMotorCommand(MotorCommands.TOGGLE_RELAY, 1);
            if (success) {
                setRelay2On(checked);
                toast.success(`Relay 2 turned ${checked ? "ON" : "OFF"}`);
            } else {
                toast.error("Failed to toggle Relay 2");
            }
        } catch {
            toast.error("Error communicating with motor controller");
        } finally {
            setRelay2Pending(false);
        }
    };

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
                <div className="flex items-center gap-4">
                    <Label htmlFor="relay-1-switch" className="text-base font-medium select-none cursor-pointer">
                        Relay 1
                    </Label>
                    <Switch
                        id="relay-1-switch"
                        checked={relay1On}
                        disabled={relay1Pending}
                        onCheckedChange={handleRelay1Toggle}
                        className="data-[state=checked]:bg-blue-600"
                    />
                </div>
                <div className="flex items-center gap-4">
                    <Label htmlFor="relay-2-switch" className="text-base font-medium select-none cursor-pointer">
                        Relay 2
                    </Label>
                    <Switch
                        id="relay-2-switch"
                        checked={relay2On}
                        disabled={relay2Pending}
                        onCheckedChange={handleRelay2Toggle}
                        className="data-[state=checked]:bg-blue-600"
                    />
                </div>
            </div>

            {/* Settings toggle in top-right corner */}
            <div className="absolute top-4 right-4 z-20">
                <ParticleToggle />
            </div>
        </div>
    );
};

export default MotorPage;