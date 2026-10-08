export function installClipboard() {
    const KEY = "__legcordNativeClipboard";
    function install() {
        const nav = navigator.clipboard;
        const lc = window.legcord?.clipboard;
        if (!nav || !lc || nav[KEY]) return;
        const origWriteText = nav.writeText?.bind(nav);
        const origWrite = nav.write?.bind(nav);
        const origReadText = nav.readText?.bind(nav);
        const origRead = nav.read?.bind(nav);
        function blobToDataUrl(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    resolve(String(reader.result));
                };
                reader.onerror = () => {
                    reject(reader.error || new Error("clipboard image read failed"));
                };
                reader.readAsDataURL(blob);
            });
        }
        function dataUrlToBlob(url) {
            return fetch(url).then((res) => res.blob());
        }
        nav.writeText = (text) => {
            try {
                return lc.writeText(text == null ? "" : String(text));
            } catch (err) {
                if (origWriteText) return origWriteText(text);
                return Promise.reject(err);
            }
        };
        nav.write = (items) => {
            const list = items && typeof items.length === "number" ? Array.prototype.slice.call(items) : [];
            const jobs = [];
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                const types = item?.types ? Array.prototype.slice.call(item.types) : [];
                let imageType = null;
                for (let t = 0; t < types.length; t++) {
                    if (String(types[t]).indexOf("image/") === 0) {
                        imageType = types[t];
                        break;
                    }
                }
                if (imageType && typeof item.getType === "function") {
                    jobs.push(
                        item
                            .getType(imageType)
                            .then(blobToDataUrl)
                            .then((url) => lc.writeImage(url)),
                    );
                } else if (types.indexOf("text/plain") !== -1 && typeof item.getType === "function") {
                    jobs.push(
                        item
                            .getType("text/plain")
                            .then((blob) => blob.text())
                            .then((text) => lc.writeText(text)),
                    );
                }
            }
            if (!jobs.length) {
                if (origWrite) return origWrite(items);
                return Promise.resolve();
            }
            return Promise.all(jobs).then(() => {});
        };
        nav.readText = () => {
            try {
                return Promise.resolve(lc.readText()).then((text) => (text == null ? "" : String(text)));
            } catch (err) {
                if (origReadText) return origReadText();
                return Promise.reject(err);
            }
        };
        nav.read = () => {
            try {
                return Promise.resolve(lc.read()).then((data) => {
                    data = data || {};
                    if (data.image) {
                        return dataUrlToBlob(data.image).then((blob) => {
                            const map = {};
                            map[blob.type || "image/png"] = blob;
                            if (data.text) map["text/plain"] = new Blob([data.text], { type: "text/plain" });
                            return [new ClipboardItem(map)];
                        });
                    }
                    if (data.text) {
                        return [new ClipboardItem({ "text/plain": new Blob([data.text], { type: "text/plain" }) })];
                    }
                    if (origRead) return origRead();
                    return [];
                });
            } catch (err) {
                if (origRead) return origRead();
                return Promise.reject(err);
            }
        };
        try {
            Object.defineProperty(nav, KEY, { value: true });
        } catch (_err) {
            nav[KEY] = true;
        }
        if (!window.__legcordCopyHook) {
            window.__legcordCopyHook = true;
            document.addEventListener("copy", (event) => {
                const ae = document.activeElement;
                const tag = ae?.tagName;
                let text = "";
                try {
                    const sel = document.getSelection();
                    text = sel ? String(sel.toString() || "") : "";
                    if (tag === "INPUT" || tag === "TEXTAREA") {
                        text = ae.value.slice(ae.selectionStart, ae.selectionEnd);
                    }
                } catch (_err) {}
                if (!text) return;
                try {
                    if (event.defaultPrevented) return;
                    event.preventDefault();
                    lc.writeText(text).catch(console.error);
                } catch (_err) {}
            });
        }
    }
    install();
    document.addEventListener("DOMContentLoaded", install, { once: true });
}
