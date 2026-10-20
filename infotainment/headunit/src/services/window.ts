export async function minimizeWindow() {
    await window.api.window.minimize();
}
export async function maximizeWindow() {
    await window.api.window.maximize();
}
export async function closeWindow() {
    await window.api.window.close();
}
