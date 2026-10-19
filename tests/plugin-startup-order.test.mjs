import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/discord/preload/plugins.mts", import.meta.url), "utf8");
const code = stripTypeScriptTypes(
    source.slice(source.indexOf("async function loadRendererPlugins()"), source.indexOf("void (async () =>")),
);
test("renderer plugin installers wait for Shelter to finish its startup iteration", async () => {
    const executions = [];
    let finishShelter;
    const shelterReady = new Promise((resolve) => {
        finishShelter = resolve;
    });
    const context = {
        shelterReady,
        ipcRenderer: {
            invoke: async (channel) =>
                channel === "plugins:get-runtime-entries" ? [{ id: "ogas", name: "OGAS" }] : "install()",
        },
        getRendererBootstrap: (_id, _name, body) => body,
        webFrame: {
            executeJavaScript: async (body) => {
                executions.push(body);
            },
        },
        console,
    };
    const pending = vm.runInNewContext(`${code}\nloadRendererPlugins()`, context);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(executions, []);
    finishShelter();
    await pending;
    assert.deepEqual(executions, ["install()"]);
});
