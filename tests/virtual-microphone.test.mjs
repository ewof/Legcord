import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { hideStreamMicrophone } from "../src/discord/preload/virtualMicrophone.js";

test("Discord sees physical microphones but not Venmic or its default-device alias", async () => {
    const physical = { kind: "audioinput", label: "Headset", deviceId: "headset" };
    const devices = [
        physical,
        { kind: "audioinput", label: "vencord-screen-share", deviceId: "stream" },
        { kind: "audioinput", label: "Default - vencord-screen-share", deviceId: "default" },
    ];
    const nativeEnumerate = async () => devices;
    const getUserMedia = async () => "capture";
    const mediaDevices = { enumerateDevices: nativeEnumerate, getUserMedia };
    vm.runInNewContext(`(${hideStreamMicrophone.toString()})()`, { navigator: { mediaDevices } });
    assert.deepEqual(await mediaDevices.enumerateDevices(), [physical]);
    // Stream capture in the isolated preload retains the native enumerator.
    assert.equal((await nativeEnumerate())[1].deviceId, "stream");
    assert.equal(mediaDevices.getUserMedia, getUserMedia);
});

test("hiding Venmic does not filter speakers or install duplicate wrappers", async () => {
    const speaker = { kind: "audiooutput", label: "vencord-screen-share", deviceId: "speaker" };
    const mediaDevices = { enumerateDevices: async () => [speaker] };
    const context = { navigator: { mediaDevices } };
    vm.runInNewContext(`(${hideStreamMicrophone.toString()})()`, context);
    const wrapped = mediaDevices.enumerateDevices;
    vm.runInNewContext(`(${hideStreamMicrophone.toString()})()`, context);
    assert.equal(mediaDevices.enumerateDevices, wrapped);
    assert.deepEqual(await wrapped(), [speaker]);
});
