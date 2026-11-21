let ready;
async function load() {
  if (!ready)
    ready = (async () => {
      const { pipeline, env } = await import(
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1"
      );
      env.allowLocalModels = false;
      env.backends.onnx.wasm.numThreads = 1;
      const progress_callback = (p) =>
        self.postMessage({
          type: "progress",
          message:
            p.status === "progress"
              ? `Loading visual matcher: ${Math.round(p.progress)}%`
              : "Preparing visual matcher…",
        });
      // Use the same q8 weights on both backends to keep saved embeddings compatible.
      let extractor,
        backend = "wasm";
      try {
        if (!self.navigator?.gpu) throw Error("WebGPU unavailable");
        extractor = await pipeline(
          "image-feature-extraction",
          "Xenova/dinov2-small",
          { device: "webgpu", dtype: "q8", progress_callback },
        );
        backend = "webgpu";
      } catch (e) {
        extractor = await pipeline(
          "image-feature-extraction",
          "Xenova/dinov2-small",
          { device: "wasm", dtype: "q8", progress_callback },
        );
      }
      return { extractor, backend };
    })().catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
self.onmessage = async ({ data }) => {
  try {
    const { extractor, backend } = await load(),
      start = performance.now(),
      vectors = [];
    // DINOv2 exports token features rather than a pooler output. The first token is CLS.
    for (const image of data.images) {
      const features = await extractor(image, { pool: false });
      if (
        features.dims.length !== 3 ||
        features.dims[0] !== 1 ||
        features.dims[2] !== 384
      )
        throw Error("Unexpected visual feature shape");
      const v = Array.from(features.data.slice(0, 384));
      if (v.length !== 384)
        throw Error("Unexpected visual embedding dimensions");
      const norm = Math.hypot(...v);
      if (!norm || !v.every(Number.isFinite))
        throw Error("Invalid visual embedding");
      vectors.push(v.map((x) => x / norm));
    }
    self.postMessage({
      id: data.id,
      vectors,
      backend,
      ms: Math.round(performance.now() - start),
    });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message || String(e) });
  }
};
