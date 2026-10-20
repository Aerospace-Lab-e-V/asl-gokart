// SERO service configuration
export const SERO_UNICAST_PORT = 30491;
export const SERO_CLIENT_ID = 0x0002;

// OTA trigger method ID — reserved on every zone controller's own Sero service.
export const ZC_OTA_METHOD_ID = 0x00FF;

// Firmware HTTP file server configuration
export const FIRMWARE_SERVER_PORT = process.env.FIRMWARE_SERVER_PORT ? parseInt(process.env.FIRMWARE_SERVER_PORT, 10) : 8080;
