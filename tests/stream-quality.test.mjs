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
