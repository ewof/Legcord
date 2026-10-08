import type { Node } from "@vencord/venmic";
import { createMemo, createSignal, For, Show } from "solid-js";
import { type AudioSelection, audioAppIncluded, listAudioApps, toggleAudioApp } from "../audioSelection.js";
import classes from "./ScreensharePicker.module.css";

export const AudioPicker = (props: {
    sources: Node[];
    selection: AudioSelection;
    onChange: (selection: AudioSelection) => void;
}) => {
    const [sources, setSources] = createSignal(props.sources);
    const [query, setQuery] = createSignal("");
    const [error, setError] = createSignal("");
    const [refreshing, setRefreshing] = createSignal(false);
    const runningApps = createMemo(() => listAudioApps(sources()));
    const apps = createMemo(() => {
        const running = runningApps();
        return [
            ...running,
            ...props.selection.apps
                .filter((id) => !running.some((app) => app.id === id))
                .map((id) => ({ id, label: `${id.slice(id.indexOf(":") + 1)} (not running)` })),
        ];
    });
    const filtered = createMemo(() =>
        apps().filter((app) => app.label.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase())),
    );
    const summary = createMemo(() => {
        if (props.selection.mode === "exclude")
            return props.selection.apps.length
                ? `Entire system except ${props.selection.apps.length} ${props.selection.apps.length === 1 ? "app" : "apps"}`
                : "Entire system";
        return props.selection.apps.length
            ? apps()
                  .filter((app) => props.selection.apps.includes(app.id))
                  .map((app) => app.label)
                  .join(", ")
            : "No audio";
    });
    async function refresh() {
        if (refreshing()) return;
        setRefreshing(true);
        setError("");
        try {
            const result = await window.legcord.screenshare.venmicList();
            if (!result.ok) throw new Error("Audio apps are unavailable. Check that PipeWire is running.");
            setSources(result.targets);
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
        } finally {
            setRefreshing(false);
        }
    }
    return (
        <details
            class={classes.audioPicker}
            onToggle={(event) => {
                if (event.currentTarget.open) void refresh();
            }}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.stopPropagation();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                }
            }}
        >
            <summary>{summary()}</summary>
            <div class={classes.audioToolbar}>
                <input
                    type="search"
                    placeholder="Search audio apps…"
                    aria-label="Search audio apps"
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                />
                <button type="button" disabled={refreshing()} onClick={() => void refresh()}>
                    Refresh
                </button>
            </div>
            <label class={classes.audioOption}>
                <span>
                    Entire system<small>Uncheck apps below to exclude them</small>
                </span>
                <input
                    type="checkbox"
                    checked={props.selection.mode === "exclude"}
                    onChange={(event) =>
                        props.onChange({ mode: event.currentTarget.checked ? "exclude" : "include", apps: [] })
                    }
                />
            </label>
            <div class={classes.audioApps}>
                <For each={filtered()}>
                    {(app) => (
                        <label class={classes.audioOption}>
                            <span>{app.label}</span>
                            <input
                                type="checkbox"
                                checked={audioAppIncluded(props.selection, app.id)}
                                onChange={(event) =>
                                    props.onChange(toggleAudioApp(props.selection, app.id, event.currentTarget.checked))
                                }
                            />
                        </label>
                    )}
                </For>
                <Show when={filtered().length === 0}>
                    <p class={classes.audioHint}>
                        {query() ? "No matching apps" : "No apps are playing audio. Start playback, then refresh."}
                    </p>
                </Show>
            </div>
            <Show when={error()}>
                <p class={classes.audioError} role="alert">
                    {error()}
                </p>
            </Show>
        </details>
    );
};
