namespace SourceUtils {
    /**
     * Downloads, parses and decompresses resource pages on a Web Worker so
     * that the main thread (and every map viewer on the page) keeps drawing
     * frames while a map streams in.
     *
     * The worker replaces LZ-compressed mesh vertex/index strings with
     * transferred Float32Array/Uint32Array buffers and vertex lighting strings
     * with arrays; the page loaders' decompress calls then pass these through
     * unchanged. Falls back to Facepunch.Http.getJson when workers are
     * unavailable (e.g. blocked by a content security policy).
     */
    export class PageWorker {
        private static worker: Worker = null;
        private static failed = false;
        private static nextId = 1;
        private static readonly callbacks: {
            [id: number]: { success: (payload: any) => void, failure: (error: any) => void }
        } = {};

        static getJson<TPayload>(url: string, success: (payload: TPayload) => void,
            failure?: (error: any) => void, progress?: (loaded: number, total: number) => void): void {
            const worker = PageWorker.getWorker();
            if (worker == null) {
                Facepunch.Http.getJson<TPayload>(url, success, failure, progress);
                return;
            }

            const id = PageWorker.nextId++;
            PageWorker.callbacks[id] = { success: success, failure: failure };
            worker.postMessage({ id: id, url: new URL(url, document.baseURI).href });
        }

        private static getWorker(): Worker {
            if (PageWorker.worker != null || PageWorker.failed) return PageWorker.worker;
            try {
                const source = `(${pageWorkerMain.toString()})();`;
                const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
                PageWorker.worker = new Worker(blobUrl);
                URL.revokeObjectURL(blobUrl);
            } catch (e) {
                console.warn("Page worker unavailable, decoding pages on the main thread:", e);
                PageWorker.failed = true;
                return null;
            }

            PageWorker.worker.onmessage = ev => {
                const msg = ev.data as { id: number, page?: any, error?: string };
                const callback = PageWorker.callbacks[msg.id];
                delete PageWorker.callbacks[msg.id];
                if (callback == null) return;
                if (msg.error != null) {
                    if (callback.failure != null) callback.failure(msg.error);
                } else {
                    callback.success(msg.page);
                }
            };

            return PageWorker.worker;
        }
    }

    /**
     * Worker entry point. Serialized with toString(), so it must be
     * self-contained: no references to anything outside its own body.
     */
    function pageWorkerMain(): void {
        const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        const base64Values = new Int8Array(128);
        for (let i = 0; i < base64.length; ++i) base64Values[base64.charCodeAt(i)] = i;

        // lz-string 1.4.4 decompressFromBase64 (WTFPL, Pieroxy), as in Facepunch.LZString.
        function lzDecompressFromBase64(input: string): string {
            if (input == null) return "";
            if (input === "") return null;

            const length = input.length;
            const resetValue = 32;
            const dictionary: string[] = [];
            let enlargeIn = 4;
            let dictSize = 4;
            let numBits = 3;
            let entry = "";
            const result: string[] = [];
            let w: string;
            let c: string;
            let val = base64Values[input.charCodeAt(0)];
            let position = resetValue;
            let index = 1;

            function readBits(count: number): number {
                let bits = 0;
                const maxpower = 1 << count;
                let power = 1;
                while (power !== maxpower) {
                    const resb = val & position;
                    position >>= 1;
                    if (position === 0) {
                        position = resetValue;
                        val = base64Values[input.charCodeAt(index++)];
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }
                return bits;
            }

            for (let i = 0; i < 3; ++i) dictionary[i] = String.fromCharCode(i);

            switch (readBits(2)) {
                case 0: c = String.fromCharCode(readBits(8)); break;
                case 1: c = String.fromCharCode(readBits(16)); break;
                case 2: return "";
            }
            dictionary[3] = c;
            w = c;
            result.push(c);

            while (true) {
                if (index > length) return "";

                let code = readBits(numBits);
                switch (code) {
                    case 0:
                        dictionary[dictSize++] = String.fromCharCode(readBits(8));
                        code = dictSize - 1;
                        enlargeIn--;
                        break;
                    case 1:
                        dictionary[dictSize++] = String.fromCharCode(readBits(16));
                        code = dictSize - 1;
                        enlargeIn--;
                        break;
                    case 2:
                        return result.join("");
                }

                if (enlargeIn === 0) {
                    enlargeIn = 1 << numBits;
                    numBits++;
                }

                if (dictionary[code]) {
                    entry = dictionary[code];
                } else if (code === dictSize) {
                    entry = w + w.charAt(0);
                } else {
                    return null;
                }
                result.push(entry);

                dictionary[dictSize++] = w + entry.charAt(0);
                enlargeIn--;
                w = entry;

                if (enlargeIn === 0) {
                    enlargeIn = 1 << numBits;
                    numBits++;
                }
            }
        }

        function decompress(value: any): any {
            return typeof value === "string" ? JSON.parse(lzDecompressFromBase64(value)) : value;
        }

        function prepareMesh(meshData: any, transfer: ArrayBuffer[]): void {
            if (meshData == null) return;
            const vertices = new Float32Array(decompress(meshData.vertices));
            const indices = new Uint32Array(decompress(meshData.indices));
            meshData.vertices = vertices;
            meshData.indices = indices;
            transfer.push(vertices.buffer, indices.buffer);
        }

        /** Leaf, displacement and studio model pages carry materials[].meshData; vertex lighting pages carry props. */
        function preparePage(page: any, transfer: ArrayBuffer[]): void {
            if (page == null || typeof page !== "object") return;
            if (Array.isArray(page.materials)) {
                for (const material of page.materials) {
                    if (material != null) prepareMesh(material.meshData, transfer);
                }
            }
            if (Array.isArray(page.props)) {
                for (const prop of page.props) {
                    if (prop == null) continue;
                    for (let j = 0; j < prop.length; ++j) prop[j] = decompress(prop[j]);
                }
            }
        }

        self.onmessage = (ev: MessageEvent) => {
            const msg = ev.data as { id: number, url: string };
            fetch(msg.url)
                .then(response => {
                    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${msg.url}`);
                    return response.text();
                })
                .then(text => {
                    const page = JSON.parse(text);
                    const transfer: ArrayBuffer[] = [];
                    preparePage(page, transfer);
                    (self as any).postMessage({ id: msg.id, page: page }, transfer);
                })
                .catch(error => {
                    (self as any).postMessage({ id: msg.id, error: String(error) });
                });
        };
    }
}
