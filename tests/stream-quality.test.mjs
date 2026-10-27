import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/shelter/screenshare/index.tsx", import.meta.url), "utf8");
const bitrate = source.slice(source.indexOf("function targetBitrateFor("), source.indexOf("type StreamConnection"));
const patch = source.slice(
    source.indexOf("function patchStreamQuality("),
    source.indexOf("function scheduleStreamQualityReapplies"),
);
test("1080p30 does not retain a low startup target as the operating quality", () => {
    const connection = {
        videoQualityManager: { goliveMaxQuality: { bitrateTarget: 600000 } },
        videoStreamParameters: [{ maxFrameRate: 15, maxResolution: { width: 640, height: 360 } }],
    };
    const context = {
        store: { resolution: 1080, fps: 30 },
        BITRATE_CEILING: 25000000,
        getLocalStreamConnection: () => connection,
        applySenderEncodeLimits() {},
        preferPlatformHwH264() {},
        log() {},
        formatMbps: String,
    };
    vm.runInNewContext(stripTypeScriptTypes(`${bitrate}\n${patch}\npatchStreamQuality("test")`), context);
    assert.equal(connection.videoQualityManager.goliveMaxQuality.bitrateTarget, 8000000);
    // A higher desired quality must not become a mandatory minimum bandwidth.
    assert.equal(connection.videoQualityManager.goliveMaxQuality.bitrateMin, 150000);
    assert.equal(connection.videoStreamParameters[0].maxResolution.width, 1920);
    assert.equal(connection.videoStreamParameters[0].maxResolution.height, 1080);
    assert.equal(connection.videoStreamParameters[0].maxFrameRate, 30);
});

test("changing quality updates an existing 15-fps capture track as well as RTP", async () => {
    let applied;
    let sent;
    const sender = {
        track: {
            kind: "video",
            contentHint: "detail",
            getSettings: () => ({ frameRate: 15 }),
            getConstraints: () => ({ width: { ideal: 1920 }, frameRate: { ideal: 15 } }),
            applyConstraints: async (constraints) => {
                applied = constraints;
            },
        },
        getParameters: () => ({ encodings: [{ maxBitrate: 3500000 }] }),
        setParameters: async (params) => {
            sent = params;
        },
    };
    const limits = source.slice(
        source.indexOf("async function applySenderEncodeLimits("),
        source.indexOf("async function logEncoderImplementation("),
    );
    const context = {
        store: { streamQuality: "motion" },
        getOutboundVideoSender: () => sender,
        log() {},
        formatMbps: String,
        console,
    };
    await vm.runInNewContext(stripTypeScriptTypes(`${limits}\napplySenderEncodeLimits({},1080,30,9600000)`), context);
    assert.equal(applied.frameRate.ideal, 30);
    assert.equal(applied.frameRate.max, 30);
    assert.equal(applied.width.ideal, 1920);
    assert.equal(sender.track.contentHint, "motion");
    assert.equal(sent.encodings[0].maxFramerate, 30);
    assert.equal(sent.degradationPreference, "maintain-framerate");
});

const limits = source.slice(
    source.indexOf("async function applySenderEncodeLimits("),
    source.indexOf("async function logEncoderImplementation("),
);
for (const [quality, hint, preference] of [
    ["balanced", "", "balanced"],
    ["detail", "detail", "maintain-resolution"],
    ["motion", "motion", "maintain-framerate"],
]) {
    test(`${quality} updates capture resolution even when FPS is unchanged`, async () => {
        let applied;
        let sent;
        const sender = {
            track: {
                kind: "video",
                getSettings: () => ({ frameRate: 30, width: 3840, height: 2160 }),
                applyConstraints: async (constraints) => {
                    applied = constraints;
                },
            },
            getParameters: () => ({ encodings: [{ maxBitrate: 25000000, scaleResolutionDownBy: 2 }] }),
            setParameters: async (params) => {
                sent = params;
            },
        };
        const context = {
            store: { streamQuality: quality },
            getOutboundVideoSender: () => sender,
            log() {},
            formatMbps: String,
            console,
        };
        await vm.runInNewContext(
            stripTypeScriptTypes(`${limits}\napplySenderEncodeLimits({},720,30,4800000)`),
            context,
        );
        assert.equal(applied.width.max, 1280);
        assert.equal(applied.height.max, 720);
        assert.equal(applied.frameRate.max, 30);
        assert.equal(sender.track.contentHint, hint);
        assert.equal(sent.degradationPreference, preference);
        assert.equal(sent.encodings[0].maxBitrate, 4800000);
        assert.equal(sent.encodings[0].scaleResolutionDownBy, 2);
    });
}
test("capture constraint failure still applies RTP limits", async () => {
    let sent;
    const sender = {
        track: {
            kind: "video",
            applyConstraints: async () => {
                throw new Error("unsupported");
            },
        },
        getParameters: () => ({ encodings: [{}] }),
        setParameters: async (params) => {
            sent = params;
        },
    };
    await vm.runInNewContext(stripTypeScriptTypes(`${limits}\napplySenderEncodeLimits({},1080,30,9600000)`), {
        store: {},
        getOutboundVideoSender: () => sender,
        log() {},
        formatMbps: String,
        console: { warn() {} },
    });
    assert.equal(sent.encodings[0].maxBitrate, 9600000);
});
test("hardware codec preference uses the sender's transceiver", () => {
    let preferred;
    const sender = {};
    const codecs = [{ mimeType: "video/VP8" }, { mimeType: "video/H264", sdpFmtpLine: "profile-level-id=42001f" }];
    const connection = {
        pc: {
            getTransceivers: () => [
                {
                    sender,
                    setCodecPreferences: (value) => {
                        preferred = value;
                    },
                },
            ],
        },
    };
    const code = source.slice(source.indexOf("function preferPlatformHwH264("), source.indexOf("function formatMbps("));
    vm.runInNewContext(stripTypeScriptTypes(`${code}\npreferPlatformHwH264(connection)`), {
        connection,
        window: { legcord: { platform: "win32" } },
        getOutboundVideoSender: () => sender,
        RTCRtpSender: { getCapabilities: () => ({ codecs }) },
        log() {},
        console,
    });
    assert.equal(preferred[0].mimeType, "video/H264");
    assert.equal(preferred.length, codecs.length);
});
