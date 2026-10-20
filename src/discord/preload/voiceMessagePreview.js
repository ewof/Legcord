/** Recover Vencord's preview when Discord loaded the voice player before its patch. */
export function installVoiceMessagePreview() {
    const vencord = globalThis.Vencord;
    const plugin = vencord?.Plugins?.plugins?.VoiceMessages;
    if (!plugin) return;
    let nativePlayer;
    plugin.VoiceMessage = function VoiceMessagePreview(props) {
        const { Webpack } = vencord;
        if (!nativePlayer) {
            try {
                const id = Webpack.findModuleId(plugin.patches[0].find);
                if (id != null) {
                    const source = String(Webpack.wreq.m[id]);
                    const memo = source.match(
                        /([\w$]+)=[\w$]+\.memo\((?=[\s\S]{0,300}?waveform:)(?=[\s\S]{0,500}?playbackCacheKey:)/,
                    );
                    if (memo) {
                        const name = memo[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const rendersPlayer = new RegExp(`\\)\\(${name},\\{`);
                        nativePlayer = Object.values(Webpack.wreq(id)).find(
                            (value) => typeof value === "function" && rendersPlayer.test(String(value)),
                        );
                    }
                }
            } catch {
                // A Discord update can change the internal component shape.
            }
        }
        const React = Webpack.Common.React;
        return nativePlayer
            ? React.createElement(nativePlayer, props)
            : React.createElement("audio", {
                  src: props.src,
                  controls: true,
                  preload: "metadata",
                  "aria-label": "Voice message preview",
                  style: { width: "100%" },
              });
    };
}
