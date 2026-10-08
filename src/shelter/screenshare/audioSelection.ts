import type { Node } from "@vencord/venmic";

export interface AudioSelection {
    mode: "include" | "exclude";
    apps: string[];
}
export interface AudioApp {
    id: string;
    label: string;
}

export function normalizeAudioSelection(value: Partial<AudioSelection> | undefined): AudioSelection {
    return {
        mode: value?.mode === "include" ? "include" : "exclude",
        apps: [
            ...new Set(
                (Array.isArray(value?.apps) ? value.apps : []).filter(
                    (id) => typeof id === "string" && /^(application\.name|node\.name):.+/.test(id),
                ),
            ),
        ].slice(0, 128),
    };
}

export function listAudioApps(nodes: Node[]): AudioApp[] {
    const apps = new Map<string, AudioApp>();
    for (const node of nodes) {
        if (node["media.class"] !== "Stream/Output/Audio") continue;
        const property = node["application.name"] ? "application.name" : "node.name";
        const label = node[property];
        if (label) apps.set(`${property}:${label}`, { id: `${property}:${label}`, label });
    }
    return [...apps.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function audioAppIncluded(selection: AudioSelection, id: string): boolean {
    return selection.mode === "include" ? selection.apps.includes(id) : !selection.apps.includes(id);
}

export function toggleAudioApp(selection: AudioSelection, id: string, checked: boolean): AudioSelection {
    const apps = selection.apps.filter((app) => app !== id);
    if (selection.mode === "include" ? checked : !checked) apps.push(id);
    return { mode: selection.mode, apps };
}

export async function routeAudioSelection(
    selection: AudioSelection,
    api: Pick<Window["legcord"]["screenshare"], "venmicStart" | "venmicSystemStart" | "venmicStop">,
): Promise<boolean> {
    if (selection.mode === "include" && selection.apps.length === 0) {
        await api.venmicStop();
        return false;
    }
    const filters = selection.apps.map((id) => {
        const separator = id.indexOf(":");
        return { "media.class": "Stream/Output/Audio", [id.slice(0, separator)]: id.slice(separator + 1) };
    });
    const ok = selection.mode === "include" ? await api.venmicStart(filters) : await api.venmicSystemStart(filters);
    if (!ok) throw new Error("Could not start the selected audio capture. Refresh the audio apps and try again.");
    return true;
}
