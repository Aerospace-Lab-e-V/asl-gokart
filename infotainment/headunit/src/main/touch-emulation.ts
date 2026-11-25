import type { WebContents } from "electron";
import log from "electron-log/main";

/*
 * Makes a finger drag scroll on the kart's touchscreen (#206).
 *
 * The Pi hands the finger to Electron as a mouse: labwc's mouseEmulation on Wayland, or a panel
 * the X server only knows as a pointer. Chromium never scrolls on a mouse drag (and global.css
 * forbids text selection), so lists only moved via the scrollbar. Through the DevTools protocol,
 * Chromium turns mouse input into touch events, so every overflow container gets native swipe
 * scrolling with momentum. Real touch input is passed through unchanged.
 *
 * Packaged Linux builds only: on a dev machine the mouse keeps hover and normal clicks.
 */
export function enableTouchEmulation(webContents: WebContents) {
    const dbg = webContents.debugger;

    const send = () => {
        dbg.sendCommand("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" })
            .then(() => log.info("[touch-emulation] Mouse input is emitted as touch"))
            .catch((e) => log.error("[touch-emulation] Could not enable:", e));
    };

    try {
        dbg.attach("1.3");
    } catch (e) {
        log.error("[touch-emulation] Could not attach the debugger:", e);
        return;
    }
    dbg.on("detach", (_event, reason) => log.warn(`[touch-emulation] Debugger detached (${reason}), touch scrolling is off`));

    send();
    // The emulation belongs to the page's session; re-apply after a reload.
    webContents.on("did-finish-load", send);
}
