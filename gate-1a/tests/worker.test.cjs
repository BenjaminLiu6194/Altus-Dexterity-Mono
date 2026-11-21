const path = require("node:path"),
  web = path.resolve(__dirname, "../web");
const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
let loads = 0,
  calls = 0,
  bad = false;
const messages = [];
const pipeline = async (task, model, opts) => {
  loads++;
  assert.equal(task, "image-feature-extraction");
  assert.equal(model, "Xenova/dinov2-small");
  assert.equal(opts.device, "wasm");
  return async (image, options) => {
    calls++;
    assert.equal(options.pool, false);
    return {
      dims: bad ? [1, 384] : [1, 257, 384],
      data: Float32Array.from({ length: 257 * 384 }, (_, i) =>
        i < 384 ? 1 : 100,
      ),
    };
  };
};
const source = fs
  .readFileSync(path.join(web, "worker.js"), "utf8")
  .replace(
    /import\(\s*["'][^"']+@huggingface\/transformers@3\.8\.1["']\s*\)/,
    "Promise.resolve(runtime)",
  );
const context = {
  runtime: { pipeline, env: { backends: { onnx: { wasm: {} } } } },
  self: { navigator: {}, postMessage: (m) => messages.push(m) },
  performance,
};
vm.runInNewContext(source, context);
(async () => {
  await context.self.onmessage({ data: { id: 1, images: ["one", "two"] } });
  const result = messages.at(-1);
  assert.equal(result.id, 1);
  assert.equal(result.backend, "wasm");
  assert.equal(result.vectors.length, 2);
  assert.equal(result.vectors[0].length, 384);
  assert.ok(Math.abs(Math.hypot(...result.vectors[0]) - 1) < 1e-6);
  assert.ok(Math.abs(result.vectors[0][0] - 1 / Math.sqrt(384)) < 1e-6);
  assert.equal(loads, 1);
  assert.equal(calls, 2);
  bad = true;
  await context.self.onmessage({ data: { id: 2, images: ["bad"] } });
  assert.match(messages.at(-1).error, /shape/);
  assert.equal(loads, 1);
  console.log(
    "Worker CLS extraction, normalization, shape validation and model reuse passed",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
