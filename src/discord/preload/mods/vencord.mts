import { installVoiceMessagePreview } from "../voiceMessagePreview.js";

const { ipcRenderer, webFrame } = require("electron");

import type { ModBundle } from "../../../@types/ModBundle.js";

async function inject() {
    try {
        await ipcRenderer.invoke("getVencordBundle").then(async (bundle: ModBundle) => {
            if (bundle?.enabled) {
                await webFrame.executeJavaScript(`${bundle.js}
;(${installVoiceMessagePreview.toString()})();`);
                webFrame.insertCSS(bundle.css!); //NOTE - Vencord requires CSS.
            }
        });
    } catch (error) {
        console.error("Vencord Failed to load!");
        console.error(error);
    }
}
inject();
