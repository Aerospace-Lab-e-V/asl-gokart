import { exposeAppContext } from "./application/app-context";
import { exposeThemeContext } from "./theme/theme-context";
import { exposeWebSocketContext } from "./websocket/ws-context";
import { exposeWindowContext } from "./window/window-context";
import { exposeSeroContext } from "./sero/sero-context";
import { exposeHardwareContext } from "./hardware/hardware-context";
import { exposeFirmwareContext } from "./firmware/firmware-context";
import { exposeUpdaterContext } from "./updater/updater-context";
import { exposeTinybufContext } from "./tinybuf/tinybuf-context";

export default function exposeContexts() {
    exposeWindowContext();
    exposeThemeContext();
    exposeWebSocketContext();
    exposeAppContext();
    exposeSeroContext();
    exposeHardwareContext();
    exposeFirmwareContext();
    exposeUpdaterContext();
    exposeTinybufContext();
}
