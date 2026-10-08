import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/discord/preload/mods/shelter.mts", import.meta.url), "utf8");
const cleanup = source.slice(
    source.indexOf("let cleanupAttempts = 0;"),
    source.indexOf("}, 100);") + "}, 100);".length,
);
function setup(installed) {
    const loaded = {};
    const removed = [];
    let tick;
    let cancelled = false;
    vm.runInNewContext(cleanup, {
        SHELTER_INJECTOR_PLUGINS: { "legcord-screenshare": [], "legcord-settings": [] },
        window: {
            shelter: {
                plugins: {
                    loadedPlugins: () => loaded,
                    installedPlugins: () => installed,
                    removePlugin: (id) => {
                        assert.ok(id in installed);
                        removed.push(id);
                        delete installed[id];
                    },
                },
            },
        },
        setInterval: (callback) => {
            tick = callback;
            return 1;
        },
        clearInterval: () => {
            cancelled = true;
        },
    });
    return { loaded, removed, tick: () => tick(), cancelled: () => cancelled };
}
test("legacy plugin cleanup waits until required plugins finish starting", () => {
    const env = setup({ "armcord-settings": {}, "armcord-screenshare": {} });
    env.tick();
    assert.deepEqual(env.removed, []);
    env.loaded["legcord-screenshare"] = {};
    env.tick();
    assert.deepEqual(env.removed, []);
    env.loaded["legcord-settings"] = {};
    env.tick();
    assert.deepEqual(env.removed, ["armcord-settings", "armcord-screenshare"]);
    assert.ok(env.cancelled());
});
test("startup cleanup safely skips legacy plugins already removed", () => {
    const env = setup({});
    env.loaded["legcord-screenshare"] = {};
    env.loaded["legcord-settings"] = {};
    assert.doesNotThrow(env.tick);
    assert.deepEqual(env.removed, []);
    assert.ok(env.cancelled());
});
