import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/discord/preload/patches.mts", import.meta.url), "utf8");
const fragment = source.slice(
    source.indexOf('    var CAP = "80000";'),
    source.indexOf("    function wrapDescription(desc)"),
);
function munge(sdp, hardware = false) {
    const context = { preferHwH264: hardware };
    const script = vm.runInNewContext(`\`${fragment}\``, context);
    vm.runInNewContext(script, context);
    return context.mungeSdp(sdp);
}
const audio =
    "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n";
const video =
    "m=video 9 UDP/TLS/RTP/SAVPF 108 109\r\na=rtpmap:108 H264/90000\r\na=fmtp:108 profile-level-id=42e01f;x-google-max-bitrate=2500\r\na=rtpmap:109 rtx/90000\r\na=fmtp:109 apt=108\r\n";
test("screenshare SDP patch preserves bundled Opus and RTX parameters", () => {
    const result = munge(`v=0\r\n${audio}${video}${audio}`);
    assert.ok(result.startsWith(`v=0\r\n${audio}`));
    assert.ok(result.endsWith(audio));
    assert.ok(result.includes("a=fmtp:109 apt=108\r\n"));
    assert.ok(result.includes("x-google-max-bitrate=80000"));
    assert.equal((result.match(/x-google-max-bitrate/g) || []).length, 1);
});
test("reapplying the patch does not duplicate bitrate parameters", () => {
    const once = munge(video);
    assert.equal(munge(once), once);
});
test("H264 baseline preference respects platform setting", () => {
    assert.ok(munge(video).includes("profile-level-id=42e01f"));
    assert.ok(munge(video, true).includes("profile-level-id=42001f"));
});
