/** Which network interface the services bind to. */
export const hardware = {
    getAvailableNetworkInterfaces: () => window.api.hardware.getAvailableNetworkInterfaces(),
    getNetworkInterface: () => window.api.hardware.getNetworkInterface(),
    setNetworkInterface: (mac: string) => window.api.hardware.setNetworkInterface(mac),
};
