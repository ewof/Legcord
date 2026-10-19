import type { Node } from "@vencord/venmic";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { SegmentedControl } from "../../settings/components/SegmentedControl.jsx";
import { type AudioSelection, normalizeAudioSelection, routeAudioSelection } from "../audioSelection.js";
import { AudioPicker } from "./AudioPicker.jsx";
import classes from "./ScreensharePicker.module.css";
import { type IPCSources, SourceCard } from "./SourceCard.jsx";

const {
    ui: { ModalRoot, ModalBody, ModalConfirmFooter, ModalSizes, ModalHeader, Header, HeaderTags, Checkbox, showToast },
    plugin: { store },
} = shelter;

async function getVirtmic() {
    try {
        return await window.legcord.screenshare.getAudioDeviceId();
    } catch (_error) {
        return null;
    }
}

const original = navigator.mediaDevices.getDisplayMedia;
let captureAudioRequested = false;
export async function patchNavigator(requestAudio = false) {
    // The picker updates this while the original capture request is pending.
    captureAudioRequested = requestAudio;
    navigator.mediaDevices.getDisplayMedia = async function (opts = {}) {
        if (requestAudio) opts.audio = true;
        const stream = await original.call(this, opts);
        const video = stream.getVideoTracks()[0];

        const width = Math.round(store.resolution * (16 / 9));
        const height = store.resolution;

        // Keep continuous frame delivery for real-time screen sharing.
        const contentHint = store.fps >= 30 ? "motion" : "detail";

        const stream_constraints: MediaTrackConstraints = {
            frameRate: { ideal: store.fps, min: Math.min(15, store.fps) },
            width: { min: 640, ideal: width, max: width },
            height: { min: 480, ideal: height, max: height },
            advanced: [{ width, height }],
            // crop-and-scale so capture matches the picker resolution. "none" kept native
            // panel size (e.g. 2304x1440) and forced software/HW encode of full desktop.
            // @ts-expect-error Chromium supports resizeMode on display tracks
            resizeMode: "crop-and-scale",
        };

        if (video) {
            video.addEventListener(
                "ended",
                () => {
                    console.warn("[Screenshare] Display video track ended");
                },
                { once: true },
            );
            try {
                video.contentHint = contentHint;
            } catch {
                // contentHint is best-effort
            }

            video
                .applyConstraints(stream_constraints)
                .then(() => {
                    const settings = video.getSettings();
                    console.log(
                        `Stream modified -> requested (${width}x${height}) ${store.fps}FPS hint=${contentHint}; actual (${settings.width ?? "?"}x${settings.height ?? "?"}) ${settings.frameRate ?? "?"}FPS`,
                    );
                    if (
                        typeof settings.width === "number" &&
                        typeof settings.height === "number" &&
                        (settings.width > width * 1.25 || settings.height > height * 1.25)
                    ) {
                        console.warn(
                            `[Screenshare] Capture is larger than requested (${settings.width}x${settings.height} vs ${width}x${height}); encode may still downscale in software.`,
                        );
                    }
                })
                .catch((error) => {
                    console.error("Failed to apply video constraints:", error);
                });
        }

        const virtmic_id = captureAudioRequested && window.legcord.platform === "linux" ? await getVirtmic() : null;
        if (virtmic_id) {
            try {
                const audio = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: { exact: virtmic_id },
                        autoGainControl: false,
                        echoCancellation: false,
                        noiseSuppression: false,
                        channelCount: 2,
                    },
                });
                stream.getAudioTracks().forEach((track) => {
                    stream.removeTrack(track);
                    track.stop();
                });
                audio.getAudioTracks().forEach((track) => {
                    stream.addTrack(track);
                });
                video?.addEventListener(
                    "ended",
                    () =>
                        audio.getTracks().forEach((track) => {
                            track.stop();
                        }),
                    {
                        once: true,
                    },
                );
            } catch (error) {
                console.warn("[Screenshare] Virtual microphone unavailable; continuing video capture:", error);
            }
        }

        return stream;
    };
}

export const ScreensharePicker = (props: {
    close: () => void;
    sources: IPCSources[];
    audioSources: Node[] | undefined;
}) => {
    const [source, setSource] = createSignal("none");
    const [audioSelection, setAudioSelection] = createSignal(normalizeAudioSelection(store.audioSelection));
    function saveAudioSelection(selection: AudioSelection) {
        setAudioSelection(selection);
        store.audioSelection = selection;
    }
    const [name, setName] = createSignal("nothing...");
    const [audio, setAudio] = createSignal(false);
    if (props.sources.length === 1) {
        setSource(props.sources[0].id);
        setName(props.sources[0].name);
    }

    const t = store.i18n;
    let submitted = false;
    let starting = false;
    async function startScreenshare() {
        if (submitted || starting) return;
        if (source() === "" || source() === "none") {
            showToast(t["screenshare-selectSource"], "error");
            return;
        }
        starting = true;
        // Shelter's confirmation footer closes synchronously. Commit the selection
        // before awaiting audio routing so modal cleanup cannot cancel the request.
        submitted = true;
        try {
            let captureAudio = audio();
            if (window.legcord.platform === "linux") {
                if (captureAudio) {
                    if (props.audioSources === undefined)
                        throw new Error(
                            "Audio capture requires PipeWire. You can turn off Share Audio to stream video.",
                        );
                    captureAudio = await routeAudioSelection(audioSelection(), window.legcord.screenshare);
                } else {
                    await window.legcord.screenshare.venmicStop();
                }
            }
            patchNavigator(captureAudio);
            // Linux uses the selected Venmic mix, rather than a second system loopback.
            window.legcord.screenshare.start(source(), name(), captureAudio && window.legcord.platform !== "linux");
            props.close();
        } catch (error) {
            window.legcord.screenshare.start("none", "", false);
            if (window.legcord.platform === "linux") void window.legcord.screenshare.venmicStop();
            showToast(error instanceof Error ? error.message : String(error), "error");
        } finally {
            starting = false;
        }
    }

    function closeAndSave() {
        if (!submitted) {
            submitted = true;
            window.legcord.screenshare.start("none", "", false);
        }
        props.close();
    }

    onCleanup(closeAndSave);

    return (
        <ModalRoot size={ModalSizes.MEDIUM} style="max-height: 90vh;">
            <ModalHeader close={closeAndSave}>{t["screenshare-title"]}</ModalHeader>
            <ModalBody>
                <div class={classes.sources}>
                    <For each={props.sources}>
                        {(source: IPCSources) => (
                            <SourceCard
                                selected_name={name}
                                source={source}
                                onSelect={(srcId, name) => {
                                    setSource(srcId);
                                    setName(name);
                                }}
                            />
                        )}
                    </For>
                </div>
                <div class={classes.settingsSection}>
                    <div class={classes.selectedBanner}>
                        <svg class={classes.selectedIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <title>Monitor</title>
                            <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2" />
                            <path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                        </svg>
                        <span class={classes.selectedLabel}>Sharing:</span>
                        <span class={classes.selectedName}>{name()}</span>
                    </div>
                    <div class={classes.qualityBox}>
                        <div class={classes.controlGroup}>
                            <Header class={classes.header} tag={HeaderTags.H4}>
                                Resolution
                            </Header>
                            <SegmentedControl
                                value={store.resolution}
                                onChange={(v) => {
                                    store.resolution = Number(v);
                                }}
                                options={[
                                    { label: "480p", value: "480" },
                                    { label: "720p", value: "720" },
                                    { label: "1080p", value: "1080" },
                                    { label: "1440p", value: "1440" },
                                    { label: "2160p", value: "2160" },
                                ]}
                            />
                        </div>
                        <div class={classes.controlGroup}>
                            <Header class={classes.header} tag={HeaderTags.H4}>
                                FPS
                            </Header>
                            <SegmentedControl
                                value={store.fps}
                                onChange={(v) => {
                                    store.fps = Number(v);
                                }}
                                options={[
                                    { label: "5", value: "5" },
                                    { label: "15", value: "15" },
                                    { label: "30", value: "30" },
                                    { label: "60", value: "60" },
                                ]}
                            />
                        </div>
                    </div>
                    <div class={classes.audioRow} style="margin-top: 12px;">
                        <div class={classes.audioLabel}>
                            <svg class={classes.audioIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <title>Audio</title>
                                <path
                                    d="M11 5L6 9H2v6h4l5 4V5z"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                                <path
                                    d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                            Share Audio
                        </div>
                        <Checkbox checked={audio()} onChange={setAudio} />
                    </div>

                    <Show when={window.legcord.platform === "linux" && props.audioSources !== undefined && audio()}>
                        <AudioPicker
                            sources={props.audioSources!}
                            selection={audioSelection()}
                            onChange={saveAudioSelection}
                        />
                    </Show>
                </div>
            </ModalBody>
            <ModalConfirmFooter
                confirmText={t["screenshare-share"]}
                onConfirm={startScreenshare}
                close={closeAndSave}
            />
        </ModalRoot>
    );
};
