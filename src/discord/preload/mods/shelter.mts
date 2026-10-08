const { ipcRenderer, webFrame } = require("electron");

import type { ModBundle } from "../../../@types/ModBundle.js";

const requiredPlugins: Record<string, [string, { isVisible: boolean; allowedActions: Record<string, true> }]> = {
    "legcord-arrpc": ["legcord://plugins/rpc/", { isVisible: false, allowedActions: {} }],
    "legcord-settings": ["legcord://plugins/settings/", { isVisible: false, allowedActions: {} }],
    "legcord-power": ["legcord://plugins/power/", { isVisible: false, allowedActions: {} }],
    "legcord-screenshare": ["legcord://plugins/screenshare/", { isVisible: false, allowedActions: {} }],
    "legcord-titlebar": ["legcord://plugins/titlebar/", { isVisible: false, allowedActions: {} }],
};
if (process.platform === "darwin") {
    requiredPlugins["legcord-touchbar"] = [
        "legcord://plugins/touchbar/",
        { isVisible: true, allowedActions: { toggle: true } },
    ];
}
async function inject() {
    try {
        await ipcRenderer.invoke("getShelterBundle").then(async (bundle: ModBundle) => {
            if (bundle?.enabled) {
                await webFrame.executeJavaScript(`(()=>{
                const SHELTER_INJECTOR_PLUGINS = ${JSON.stringify(requiredPlugins)};
                ${bundle.js}
                // Shelter snapshots plugin IDs before awaiting updates. Removing
                // legacy entries during startup invalidates that snapshot and
                // prevents the remaining plugins (including the picker) loading.
                let cleanupAttempts = 0;
                const cleanupLegacyPlugins = setInterval(() => {
                    const plugins = window.shelter?.plugins;
                    if (++cleanupAttempts > 300) {
                        clearInterval(cleanupLegacyPlugins);
                        return;
                    }
                    if (!plugins || !Object.keys(SHELTER_INJECTOR_PLUGINS)
                        .every(id => id in plugins.loadedPlugins())) return;
                    clearInterval(cleanupLegacyPlugins);
                    for (const id of ["armcord-settings", "armcord-screenshare"]) {
                        if (id in plugins.installedPlugins()) plugins.removePlugin(id);
                    }
                }, 100);
            })()`);
            }
        });
    } catch (e) {
        console.error(e);
    }
}
inject();
