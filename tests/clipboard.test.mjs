import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/discord/preload/clipboard.js", import.meta.url), "utf8").replace(
    "export function",
    "function",
);
function setup(bridge, activeElement = null) {
    const listeners = {};
    const navigator = { clipboard: {} };
    const document = {
        activeElement,
        addEventListener: (name, callback) => {
            listeners[name] = callback;
        },
        getSelection: () => ({ toString: () => "selected text" }),
    };
    runInNewContext(`${source}\ninstallClipboard();`, {
        navigator,
        document,
        window: { legcord: { clipboard: bridge } },
        console,
        Blob,
        fetch,
    });
    return { clipboard: navigator.clipboard, listeners };
}
test("text write waits for native completion even after focus changes", async () => {
    let complete;
    const pending = new Promise((resolve) => {
        complete = resolve;
    });
    let value;
    const { clipboard } = setup({
        writeText: (text) => {
            value = text;
            return pending;
        },
    });
    let settled = false;
    const write = clipboard.writeText("hello").then(() => {
        settled = true;
    });
    await Promise.resolve();
    assert.equal(value, "hello");
    assert.equal(settled, false);
    complete();
    await write;
    assert.equal(settled, true);
});
test("native write failure reaches caller", async () => {
    const { clipboard } = setup({ writeText: () => Promise.reject(new Error("native failure")) });
    await assert.rejects(clipboard.writeText("hello"), /native failure/);
});
test("Ctrl+C copies the selected input range", async () => {
    let copied;
    const { listeners } = setup(
        {
            writeText: (text) => {
                copied = text;
                return Promise.resolve();
            },
        },
        { tagName: "TEXTAREA", value: "abc def ghi", selectionStart: 4, selectionEnd: 7 },
    );
    let prevented = false;
    listeners.copy({
        defaultPrevented: false,
        preventDefault: () => {
            prevented = true;
        },
    });
    assert.equal(copied, "def");
    assert.equal(prevented, true);
});
test("copy handler preserves custom editor clipboard data", () => {
    let copied = false;
    const { listeners } = setup({
        writeText: () => {
            copied = true;
        },
    });
    listeners.copy({ defaultPrevented: true });
    assert.equal(copied, false);
});
