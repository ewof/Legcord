import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { installH264Compatibility } from "../src/discord/preload/h264Compatibility.js";

const nal = (type, ...bytes) => [0, 0, 0, 1, type, ...bytes];
const frame = (...units) => ({ type: "key", data: Uint8Array.from(units.flat()).buffer });
async function processFrames(frames) {
    const written = [];
    class Sender {
        createEncodedStreams() {
            return {
                readable: new ReadableStream({
                    start(c) {
                        for (const f of frames) c.enqueue(f);
                        c.close();
                    },
                }),
                writable: new WritableStream({
                    write(f) {
                        written.push(f);
                    },
                }),
            };
        }
    }
    Object.defineProperty(Sender.prototype, "transform", { configurable: true, get() {} });
    vm.runInNewContext(`(${installH264Compatibility.toString()})()`, {
        RTCRtpSender: Sender,
        TransformStream,
        Uint8Array,
    });
    const streams = new Sender().createEncodedStreams();
    await streams.readable.pipeTo(streams.writable);
    assert.equal("transform" in Sender.prototype, false);
    return written;
}
test("hardware IDR gets its SPS/PPS before the picture, without changing picture bytes", async () => {
    const input = frame(nal(0x65, 1, 2), nal(0x67, 66, 192, 40), nal(0x68, 3));
    const [output] = await processFrames([input]);
    assert.deepEqual(
        [...new Uint8Array(output.data)],
        [...nal(0x67, 66, 192, 40), ...nal(0x68, 3), ...nal(0x65, 1, 2)],
    );
});
test("late-join keyframes receive the cached headers", async () => {
    const first = frame(nal(0x67, 66, 192, 40), nal(0x68, 3), nal(0x65, 1));
    const second = frame(nal(0x65, 2));
    const [, output] = await processFrames([first, second]);
    assert.deepEqual([...new Uint8Array(output.data)], [...nal(0x67, 66, 192, 40), ...nal(0x68, 3), ...nal(0x65, 2)]);
});
test("audio, delta frames, other codecs and already ordered H264 are unchanged", async () => {
    const audio = { data: Uint8Array.from([1, 2, 3]).buffer };
    const delta = { type: "delta", data: Uint8Array.from(nal(0x61, 5)).buffer };
    const vp8 = { type: "key", data: Uint8Array.from([0x90, 1, 0, 0x9d, 1, 0x2a]).buffer };
    const h264 = frame(nal(0x67, 66, 192, 40), nal(0x68, 3), nal(0x65, 1));
    const originals = [audio, delta, vp8, h264].map((f) => f.data);
    const output = await processFrames([audio, delta, vp8, h264]);
    output.forEach((f, i) => {
        assert.equal(f.data, originals[i]);
    });
});
