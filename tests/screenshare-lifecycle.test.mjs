import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(
    new URL("../src/shelter/screenshare/components/ScreensharePicker.tsx", import.meta.url),
    "utf8",
);
const patch = stripTypeScriptTypes(
    source
        .slice(source.indexOf("async function getVirtmic"), source.indexOf("export const ScreensharePicker"))
        .replace("export async", "async"),
);
function setup(requestAudio) {
    let enumerations = 0;
    const video = { applyConstraints: () => Promise.resolve(), getSettings: () => ({}), addEventListener() {} };
    const stream = { getVideoTracks: () => [video], getAudioTracks: () => [], addTrack() {}, removeTrack() {} };
    const mediaDevices = {
        getDisplayMedia: async () => stream,
        enumerateDevices: async () => {
            enumerations++;
            return [{ label: "vencord-screen-share", deviceId: "missing" }];
        },
        getUserMedia: async () => {
            throw new Error("virtual microphone failed");
        },
    };
    const context = {
        navigator: { mediaDevices },
        window: {
            legcord: {
                platform: "linux",
                screenshare: {
                    getAudioDeviceId: async () => {
                        await mediaDevices.enumerateDevices();
                        return "missing";
                    },
                },
            },
        },
        store: { fps: 30, resolution: 1080 },
        console: { log() {}, warn() {}, error() {} },
    };
    runInNewContext(`${patch}\npatchNavigator(${requestAudio});`, context);
    return { stream, capture: () => mediaDevices.getDisplayMedia(), enumerations: () => enumerations };
}
test("video-only capture does not access virtual microphone", async () => {
    const env = setup(false);
    assert.equal(await env.capture(), env.stream);
    assert.equal(env.enumerations(), 0);
});
test("virtual microphone failure preserves video capture", async () => {
    const env = setup(true);
    assert.equal(await env.capture(), env.stream);
    assert.equal(env.enumerations(), 1);
});
test("closing picker after selection does not cancel the selected stream", async () => {
    const calls = [];
    const code = source.slice(
        source.indexOf("    let submitted = false"),
        source.indexOf("    onCleanup(closeAndSave)"),
    );
    const context = {
        source: () => "screen:347:0",
        name: () => "Screen 1",
        audio: () => false,
        patchNavigator() {},
        props: { close() {} },
        window: {
            legcord: {
                platform: "linux",
                screenshare: { start: (...args) => calls.push(args), venmicStop: async () => {} },
            },
        },
    };
    await runInNewContext(`${code}\n(async()=>{await startScreenshare(); closeAndSave();})()`, context);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "screen:347:0");
});
test("dismissed picker submits cancellation only once", () => {
    const calls = [];
    const code = source.slice(
        source.indexOf("    let submitted = false"),
        source.indexOf("    onCleanup(closeAndSave)"),
    );
    runInNewContext(`${code}\ncloseAndSave(); closeAndSave();`, {
        props: { close() {} },
        window: {
            legcord: {
                platform: "linux",
                screenshare: { start: (...args) => calls.push(args), venmicStop: async () => {} },
            },
        },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "none");
});

const qualitySource = readFileSync(new URL("../src/shelter/screenshare/index.tsx", import.meta.url), "utf8");
const qualityHook = qualitySource.slice(
    qualitySource.indexOf("    removeQualityIntercept = intercept((dispatch) => {"),
    qualitySource.indexOf('    dispatcher.subscribe("MEDIA_ENGINE_VIDEO_SOURCE_QUALITY_CHANGED"'),
);
function interceptQuality(dispatch) {
    let hook;
    runInNewContext(qualityHook, {
        intercept: (callback) => {
            hook = callback;
        },
        store: { fps: 30, resolution: 1080 },
        console: { log() {} },
    });
    return hook(dispatch);
}
test("source cleanup with null settings passes through without throwing", () => {
    const dispatch = { type: "MEDIA_ENGINE_SET_GO_LIVE_SOURCE", settings: null };
    assert.equal(interceptQuality(dispatch), undefined);
    assert.equal(dispatch.settings, null);
});
test("source cleanup without settings passes through without throwing", () => {
    assert.equal(interceptQuality({ type: "MEDIA_ENGINE_SET_GO_LIVE_SOURCE" }), undefined);
});
test("active source still receives selected stream quality", () => {
    const dispatch = { type: "MEDIA_ENGINE_SET_GO_LIVE_SOURCE", settings: { sourceId: "screen:347:0" } };
    assert.equal(interceptQuality(dispatch), dispatch);
    assert.equal(dispatch.settings.qualityOptions.frameRate, 30);
    assert.equal(dispatch.settings.qualityOptions.resolution, 1080);
    assert.equal(dispatch.settings.sourceId, "screen:347:0");
});

test("confirmation footer closing during audio routing does not cancel capture", async () => {
    const calls = [];
    let finishRouting;
    const routed = new Promise((resolve) => {
        finishRouting = resolve;
    });
    const code = source.slice(
        source.indexOf("    let submitted = false"),
        source.indexOf("    onCleanup(closeAndSave)"),
    );
    const context = {
        source: () => "screen:347:0",
        name: () => "Screen 1",
        audio: () => true,
        audioSelection: () => ({ mode: "exclude", apps: [] }),
        routeAudioSelection: () => routed,
        patchNavigator() {},
        props: { audioSources: [], close() {} },
        window: {
            legcord: {
                platform: "linux",
                screenshare: { start: (...args) => calls.push(args), venmicStop: async () => {} },
            },
        },
    };
    const pending = runInNewContext(`${code}\nconst pending = startScreenshare(); closeAndSave(); pending;`, context);
    assert.equal(calls.length, 0);
    finishRouting(true);
    await pending;
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["screen:347:0", "Screen 1", false]);
});

test("capture waits for resolution and FPS limits before returning the stream", async () => {
    let finishConstraints;
    let constraintsStarted;
    const started = new Promise((resolve) => {
        constraintsStarted = resolve;
    });
    let applied;
    let returned = false;
    const video = {
        addEventListener() {},
        getSettings: () => ({}),
        applyConstraints: (constraints) => {
            applied = constraints;
            constraintsStarted();
            return new Promise((resolve) => {
                finishConstraints = resolve;
            });
        },
    };
    const stream = { getVideoTracks: () => [video] };
    const mediaDevices = { getDisplayMedia: async () => stream };
    runInNewContext(`${patch}\npatchNavigator(false);`, {
        navigator: { mediaDevices },
        window: { legcord: { platform: "linux" } },
        store: { resolution: 720, fps: 30, streamQuality: "detail" },
        console: { log() {}, warn() {}, error() {} },
    });
    const pending = mediaDevices.getDisplayMedia().then((value) => {
        returned = true;
        return value;
    });
    await started;
    assert.equal(returned, false);
    assert.equal(applied.frameRate.max, 30);
    assert.equal(applied.width.max, 1280);
    assert.equal(applied.height.max, 720);
    assert.equal(applied.advanced, undefined);
    finishConstraints();
    assert.equal(await pending, stream);
    assert.equal(video.contentHint, "detail");
});
