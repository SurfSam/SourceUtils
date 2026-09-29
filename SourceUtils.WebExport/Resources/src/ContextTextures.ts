namespace SourceUtils {
    import WebGame = Facepunch.WebGame;

    /**
     * WebGame.TextureUtils keeps its white, black, translucent and error
     * textures in static fields, created for whichever GL context asks first.
     * Every later MapViewer then binds a texture from another context, which
     * WebGL rejects, so the sampler reads whatever texture its unit last held.
     * This makes the getters keep one texture per context.
     *
     * The textures are held in WeakMaps keyed by context: a strong list would
     * keep every context ever created alive, and with it its canvas, viewer
     * and whole map (the replay splicer creates a viewer per map).
     */
    export class ContextTextures {
        private static installed = false;

        static install(): void {
            if (ContextTextures.installed) return;
            ContextTextures.installed = true;

            const utils = WebGame.TextureUtils as any;
            const getters: { [getter: string]: string } = {
                getWhiteTexture: "whiteTexture",
                getBlackTexture: "blackTexture",
                getTranslucentTexture: "translucentTexture",
                getErrorTexture: "errorTexture"
            };

            for (let getter in getters) {
                const field = getters[getter];
                const create = utils[getter] as (context: WebGLRenderingContext) => WebGame.Texture;
                const created = new WeakMap<WebGLRenderingContext, WebGame.Texture>();

                utils[getter] = (context: WebGLRenderingContext): WebGame.Texture => {
                    const existing = created.get(context);
                    if (existing != null) return existing;

                    // The original returns its cached texture if the field is set.
                    utils[field] = null;
                    const texture = create.call(utils, context);
                    // Nor may the static field keep the last context alive.
                    utils[field] = null;
                    created.set(context, texture);
                    return texture;
                };
            }
        }
    }
}
