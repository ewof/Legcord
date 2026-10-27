/** Normalize hardware H.264 headers before Discord's DAVE encryption.
 * Some VA-API frames put the IDR slice before SPS/PPS. Chrome tolerates this,
 * while other hardware decoders can repeatedly reject the initial keyframe.
 */
export function installH264Compatibility() {
    const proto = globalThis.RTCRtpSender?.prototype;
    if (!proto?.createEncodedStreams || proto.__legcordH264Compatibility) return;
    // Preserve the native DAVE transform path on modern Chromium. Selecting the
    // legacy API by deleting `transform` changes Discord's encryption pipeline.
    // Only normalize frames when the browser itself requires the legacy API.
    if ("transform" in proto) return;
    const original = proto.createEncodedStreams;
    proto.createEncodedStreams = function (...args) {
        const streams = original.apply(this, args);
        let headers = [];
        const readable = streams.readable.pipeThrough(
            new TransformStream({
                transform(frame, controller) {
                    if (frame.type === "key") {
                        const data = new Uint8Array(frame.data);
                        const units = [];
                        for (let i = 0; i + 3 < data.length; i++) {
                            if (data[i] !== 0 || data[i + 1] !== 0) continue;
                            const prefix = data[i + 2] === 1 ? 3 : data[i + 2] === 0 && data[i + 3] === 1 ? 4 : 0;
                            if (!prefix || i + prefix >= data.length) continue;
                            units.push({ start: i, type: data[i + prefix] & 31 });
                            i += prefix;
                        }
                        // Require an Annex-B H.264 IDR, SPS and PPS (or previously
                        // observed headers). Other codecs and audio pass untouched.
                        if (units[0]?.start === 0 && units.some((unit) => unit.type === 5)) {
                            const chunks = units.map((unit, i) => ({
                                type: unit.type,
                                data: data.slice(unit.start, units[i + 1]?.start ?? data.length),
                            }));
                            const sps = chunks.filter((unit) => unit.type === 7);
                            const pps = chunks.filter((unit) => unit.type === 8);
                            if (sps.length && pps.length) headers = [...sps, ...pps];
                            const firstSlice = chunks.findIndex((unit) => unit.type === 5);
                            const ordered =
                                chunks.findIndex((unit) => unit.type === 7) >= 0 &&
                                chunks.findIndex((unit) => unit.type === 7) <
                                    chunks.findIndex((unit) => unit.type === 8) &&
                                chunks.findIndex((unit) => unit.type === 8) < firstSlice;
                            if (headers.length && !ordered) {
                                const aud = chunks.filter((unit) => unit.type === 9);
                                const body = chunks.filter((unit) => ![7, 8, 9].includes(unit.type));
                                const corrected = [...aud, ...headers, ...body];
                                const output = new Uint8Array(
                                    corrected.reduce((size, unit) => size + unit.data.length, 0),
                                );
                                let offset = 0;
                                for (const unit of corrected) {
                                    output.set(unit.data, offset);
                                    offset += unit.data.length;
                                }
                                frame.data = output.buffer;
                            }
                        }
                    }
                    controller.enqueue(frame);
                },
            }),
        );
        // The writable side is still Discord's encrypted output. Only normalize
        // the readable, unencrypted video before DAVE receives it.
        return { readable, writable: streams.writable };
    };
    Object.defineProperty(proto, "__legcordH264Compatibility", { value: true });
}
