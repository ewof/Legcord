import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { installVoiceMessagePreview } from "../src/discord/preload/voiceMessagePreview.js";

function setup(exports = {}) {
    let preview;
    const plugin = {
        patches: [{ find: '"pause-voice-message"' }],
        set VoiceMessage(value) {
            preview = value;
        },
    };
    const wreq = () => exports;
    wreq.m = { 7: "let voice$=React.memo(function(e){let{waveform:w,playbackCacheKey:k}=e;return null})" };
    const context = {
        Vencord: {
            Plugins: { plugins: { VoiceMessages: plugin } },
            Webpack: {
                findModuleId: () => 7,
                wreq,
                Common: { React: { createElement: (type, props) => ({ type, props }) } },
            },
        },
    };
    vm.runInNewContext(`(${installVoiceMessagePreview.toString()})()`, context);
    return { render: (props) => preview(props), plugin };
}
test("recovers the exported native voice player even when its patch was missed", () => {
    const player = vm.runInNewContext("(function(e){return(0,jsx)(voice$,{...e})})");
    const other = () => null;
    const env = setup({ other, renamedExport: player });
    const props = { src: "blob:preview", waveform: "AAAA" };
    const result = env.render(props);
    assert.equal(result.type, player);
    assert.equal(result.props, props);
});
test("an unrecognized Discord component still gives a playable audio preview", () => {
    const result = setup().render({ src: "blob:preview" });
    assert.equal(result.type, "audio");
    assert.equal(result.props.src, "blob:preview");
    assert.equal(result.props.controls, true);
});
test("Vencord's native patch can replace the compatibility preview later", () => {
    const env = setup();
    const native = () => "native";
    env.plugin.VoiceMessage = native;
    assert.equal(env.render({}), "native");
});
