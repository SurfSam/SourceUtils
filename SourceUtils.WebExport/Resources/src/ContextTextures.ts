namespace SourceUtils {
    import WebGame = Facepunch.WebGame;

    /**
     * WebGame.TextureUtils keeps its white, black, translucent and error
     * textures in static fields, created for whichever GL context asks first.
     * Every later MapViewer then binds a texture from another context, which
     * WebGL rejects, so the sampler reads whatever texture its unit last held.
     * This makes the getters keep one texture per context.
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
                const created: { context: WebGLRenderingContext, texture: WebGame.Texture }[] = [];

                utils[getter] = (context: WebGLRenderingContext): WebGame.Texture => {
                    for (let i = 0; i < created.length; ++i) {
                        if (created[i].context === context) return created[i].texture;
                    }

                    // The original returns its cached texture if the field is set.
                    utils[field] = null;
                    const texture = create.call(utils, context);
                    created.push({ context: context, texture: texture });
                    return texture;
                };
            }
        }
    }
}
