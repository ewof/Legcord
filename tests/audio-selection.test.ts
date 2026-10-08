import assert from "node:assert/strict";
import test from "node:test";
import {
    audioAppIncluded,
    listAudioApps,
    normalizeAudioSelection,
    routeAudioSelection,
    toggleAudioApp,
} from "../src/shelter/screenshare/audioSelection.js";

test("audio apps group playback streams and omit microphones and MIDI", () => {
    assert.deepEqual(
        listAudioApps([
            { "media.class": "Stream/Output/Audio", "application.name": "LibreWolf", "node.name": "one" },
            { "media.class": "Stream/Output/Audio", "application.name": "LibreWolf", "node.name": "two" },
            { "media.class": "Stream/Input/Audio", "application.name": "Discord" },
            { "media.class": "Audio/Source", "node.name": "Microphone" },
            { "media.class": "Midi/Bridge", "node.name": "MIDI" },
        ]),
        [{ id: "application.name:LibreWolf", label: "LibreWolf" }],
    );
});
test("system selection excludes unchecked apps; app selection includes checked apps", () => {
    const excluded = toggleAudioApp({ mode: "exclude", apps: [] }, "application.name:Discord", false);
    assert.equal(audioAppIncluded(excluded, "application.name:Discord"), false);
    assert.equal(audioAppIncluded(excluded, "application.name:LibreWolf"), true);
    const included = toggleAudioApp({ mode: "include", apps: [] }, "application.name:LibreWolf", true);
    assert.equal(audioAppIncluded(included, "application.name:LibreWolf"), true);
    assert.equal(audioAppIncluded(included, "application.name:Discord"), false);
});
function api() {
    const calls: unknown[] = [];
    return {
        calls,
        venmicStart: async (nodes: unknown[]) => {
            calls.push(["include", nodes]);
            return true;
        },
        venmicSystemStart: async (nodes: unknown[]) => {
            calls.push(["exclude", nodes]);
            return true;
        },
        venmicStop: async () => {
            calls.push(["stop"]);
        },
    };
}
test("multiple app routing uses stable names rather than transient PipeWire IDs", async () => {
    const a = api();
    await routeAudioSelection(
        { mode: "include", apps: ["application.name:LibreWolf", "application.name:Music:Player"] },
        a,
    );
    assert.deepEqual(a.calls, [
        [
            "include",
            [
                { "media.class": "Stream/Output/Audio", "application.name": "LibreWolf" },
                { "media.class": "Stream/Output/Audio", "application.name": "Music:Player" },
            ],
        ],
    ]);
});
test("entire system routing preserves exclusions", async () => {
    const a = api();
    await routeAudioSelection({ mode: "exclude", apps: ["application.name:Discord"] }, a);
    assert.deepEqual(a.calls, [["exclude", [{ "media.class": "Stream/Output/Audio", "application.name": "Discord" }]]]);
});
test("no apps selected never passes an empty include list that would capture everything", async () => {
    const a = api();
    assert.equal(await routeAudioSelection({ mode: "include", apps: [] }, a), false);
    assert.deepEqual(a.calls, [["stop"]]);
});
test("audio routing failure reaches caller", async () => {
    const a = api();
    a.venmicSystemStart = async () => false;
    await assert.rejects(routeAudioSelection({ mode: "exclude", apps: [] }, a), /Could not start/);
});
test("saved selection rejects malformed filters and removes duplicates", () => {
    assert.deepEqual(
        normalizeAudioSelection({
            mode: "include",
            apps: ["bogus", "application.name:Music", "application.name:Music"],
        }),
        { mode: "include", apps: ["application.name:Music"] },
    );
});
