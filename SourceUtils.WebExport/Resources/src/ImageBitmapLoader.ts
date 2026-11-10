namespace SourceUtils {
    /**
     * Replaces Facepunch.Http.getImage with fetch + createImageBitmap, so
     * texture images are decoded off the main thread instead of synchronously
     * inside texImage2D. Bitmaps match WebGame's upload defaults (no flip, no
     * premultiplied alpha). Browsers without createImageBitmap keep <img>.
     */
    export class ImageBitmapLoader {
        private static installed = false;

        static install(): void {
            if (ImageBitmapLoader.installed) return;
            ImageBitmapLoader.installed = true;
            if (typeof createImageBitmap !== "function" || typeof fetch !== "function") return;

            const fallback = Facepunch.Http.getImage;
            (Facepunch.Http as any).getImage = (url: string, success: (image: any) => void,
                failure?: (error: any) => void, progress?: (loaded: number, total: number) => void) => {
                fetch(url)
                    .then(response => {
                        if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
                        return response.blob();
                    })
                    .then(blob => createImageBitmap(blob, {
                        premultiplyAlpha: "none",
                        colorSpaceConversion: "default",
                        imageOrientation: "none"
                    } as ImageBitmapOptions))
                    .then(bitmap => {
                        if (progress != null) progress(1, 1);
                        success(bitmap);
                    }, error => {
                        // e.g. a format createImageBitmap rejects: let <img> try.
                        console.warn(`createImageBitmap failed for ${url}, falling back to <img>:`, error);
                        fallback(url, success, failure, progress);
                    });
            };
        }
    }
}
