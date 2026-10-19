// Keep the stream-audio bridge out of Discord's voice-device picker and
// new-microphone detection. Screenshare resolves it in the isolated preload.
export function hideStreamMicrophone() {
    const devices = navigator.mediaDevices;
    if (!devices?.enumerateDevices || devices.__legcordStreamMicHidden) return;
    const enumerate = devices.enumerateDevices.bind(devices);
    devices.enumerateDevices = async () =>
        (await enumerate()).filter(
            (device) => device.kind !== "audioinput" || !device.label.includes("vencord-screen-share"),
        );
    Object.defineProperty(devices, "__legcordStreamMicHidden", { value: true });
}
