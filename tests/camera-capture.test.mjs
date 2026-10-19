import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/discord/preload/patches.mts", import.meta.url), "utf8");
const block = source.slice(
    source.indexOf("// Fix: Chromium on macOS"),
    source.indexOf("\nasync function waitForPageGlobal"),
);
function injectedScript(platform) {
    let script = null;
    runInNewContext(block, {
        process: { platform },
        document: {
            createElement: () => ({ textContent: "" }),
            documentElement: {
                prepend: (element) => {
                    script = element.textContent;
                },
            },
        },
    });
    return script;
}
test("macOS camera workaround does not patch Linux or Windows media capture", () => {
    assert.equal(injectedScript("linux"), null);
    assert.equal(injectedScript("win32"), null);
});
test("opening another capture preserves a desktop stream on macOS", async () => {
    const tracks = [];
    const navigator = {
        mediaDevices: {
            getUserMedia: async () => {
                const track = {
                    readyState: "live",
                    stop() {
                        this.readyState = "ended";
                    },
                };
                tracks.push(track);
                return { getVideoTracks: () => [track], getAudioTracks: () => [] };
            },
        },
    };
    runInNewContext(injectedScript("darwin"), { navigator, WeakRef, console, setTimeout });
    await navigator.mediaDevices.getUserMedia({
        video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: "screen:347:0" } },
    });
    await navigator.mediaDevices.getUserMedia({ video: { deviceId: "camera" } });
    assert.equal(tracks[0].readyState, "live");
});
