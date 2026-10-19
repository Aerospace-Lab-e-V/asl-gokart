import { useEffect } from "react";
import { useStore } from "@/stores/useStore";

export function useConnectionData() {
    const setGokartLanConnected = useStore((state) => state.setGokartLanConnected);

    useEffect(() => {
        const checkConnections = async () => {
            try {
                const networkInterface = await window.hardware.getNetworkInterface();
                setGokartLanConnected(networkInterface !== null);
            } catch (e) {
                setGokartLanConnected(false);
            }
        };

        // Initial check
        checkConnections();

        // Polling interval
        const interval = setInterval(checkConnections, 5000);

        return () => clearInterval(interval);
    }, [setGokartLanConnected]);
}
