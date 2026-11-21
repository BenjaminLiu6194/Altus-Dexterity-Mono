// Run after download-references.py. Dependencies may live outside this static app.
// npm install --prefix /tmp/surgical-cv-check @huggingface/transformers@3.8.1
// node gate-1a/scripts/build-workshop.mjs /tmp/surgical-cv-check/node_modules
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(
  path.resolve(process.argv[2] || "node_modules", "package.json"),
);
const { pipeline, env, RawImage } = require("@huggingface/transformers");
const sharp = require("sharp");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../web/reference-packs/workshop",
);
const originals = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.cache/references",
);
const core = createRequire(import.meta.url)("../web/core.js");
env.allowLocalModels = false;
env.cacheDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.cache/models",
);
env.backends.onnx.wasm.numThreads = 1;
const sources = JSON.parse(
  await fs.readFile(path.join(root, "sources.json"), "utf8"),
);
// Coordinates are fractions of each original image. Exclude packaging, charts,
// isolated tips and collages; these are curated object crops, not new photographs.
const specs = [
  {
    id: "wgge",
    name: "WGGE WG-015 wire stripper",
    views: [
      ["wgge-1.jpg", [0, 0, 0.65, 1]],
      ["wgge-3.jpg", [0, 0, 0.35, 1]],
      ["wgge-3.jpg", [0.35, 0, 0.35, 1]],
      ["wgge-4.jpg"],
      ["wgge-5.jpg"],
    ],
  },
  {
    id: "goggles",
    name: "DeWalt DPG54-1C safety glasses",
    views: [
      ["protector-hd.jpg"],
      ["protector-gallery-3.webp"],
      ["protector-hd.jpg", null, 90],
      ["protector-gallery-3.webp", null, -45],
      ["protector-gallery-3.webp", null, 90],
    ],
  },
  {
    id: "screwdriver",
    name: "Stanley STHT60786 screwdriver",
    views: [
      ["stanley-acme-1.jpg"],
      ["stanley-acme-2.jpg"],
      ["stanley-acme-1.jpg", null, 90],
      ["stanley-acme-2.jpg", null, 90],
      ["stanley-acme-2.jpg", null, 180],
    ],
  },
  {
    id: "hex",
    name: "Red Allen-key set",
    views: [
      ["hex-1.jpg"],
      ["hex-2.jpg"],
      ["hex-4.jpg"],
      ["hex-5.jpg", [0, 0, 1, 0.5]],
      ["hex-5.jpg", [0, 0.5, 1, 0.5]],
    ],
  },
];
const encoder = await pipeline("image-feature-extraction", core.MODEL, {
  device: "cpu",
  dtype: "q8",
});
const tools = [],
  provenance = [];
for (const group of specs) {
  const samples = [];
  for (const [file, rect, rotation = 0] of group.views) {
    let image = sharp(path.join(originals, file)).flatten({
      background: "#edf0f2",
    });
    const meta = await image.metadata();
    if (rect) {
      const [x, y, w, h] = rect,
        left = Math.round(x * meta.width),
        top = Math.round(y * meta.height);
      image = image.extract({
        left,
        top,
        width: Math.min(meta.width - left, Math.round(w * meta.width)),
        height: Math.min(meta.height - top, Math.round(h * meta.height)),
      });
    }
    if (rotation) {
      image = sharp(await image.png().toBuffer()).rotate(rotation, {
        background: "#edf0f2",
      });
    }
    const buffer = await image
      .resize(384, 384, { fit: "contain", background: "#edf0f2" })
      .jpeg({ quality: 90 })
      .toBuffer();
    const input = await RawImage.fromBlob(
      new Blob([buffer], { type: "image/jpeg" }),
    );
    const features = await encoder(input, { pool: false });
    if (features.dims.length !== 3 || features.dims[2] !== core.DIM)
      throw Error("Unexpected encoder dimensions");
    const vector = core.normalize(Array.from(features.data.slice(0, core.DIM)));
    if (samples.some((s) => core.cosine(vector, s.vector) > 0.9995)) {
      console.log("Skipped duplicate", file);
      continue;
    }
    const thumbnail =
      "data:image/jpeg;base64," +
      (
        await sharp(buffer).resize(96, 96).jpeg({ quality: 70 }).toBuffer()
      ).toString("base64");
    samples.push({ vector, thumbnail });
    const cropFile = `curated-${group.id}-${samples.length}.jpg`;
    await fs.writeFile(path.join(root, cropFile), buffer);
    provenance.push({
      id: group.id,
      file,
      crop: rect || null,
      rotation,
      augmented: rotation !== 0,
      curated: cropFile,
      ...sources.images.find((s) => s.file === file),
    });
    console.log(group.name, samples.length, features.dims.join("x"));
  }
  if (samples.length < core.MIN_EXAMPLES)
    throw Error(`${group.name} has too few distinct references`);
  tools.push({
    id: "workshop-" + group.id,
    name: group.name,
    kind: "tool",
    samples,
  });
}
const data = { version: core.VERSION, model: core.MODEL, tools };
const classifier = core.train(tools);
await fs.writeFile(
  path.join(root, "classifier.json"),
  JSON.stringify(classifier),
);
core.validate(data);
await fs.writeFile(path.join(root, "library.json"), JSON.stringify(data));
await fs.writeFile(
  path.join(root, "curation.json"),
  JSON.stringify(
    {
      note: "Exact glasses and screwdriver each use two source photos plus three rotated variants. These are correlated references, not five independent photos. Reference checks are not test accuracy.",
      references: provenance,
    },
    null,
    2,
  ),
);
// Reference diagnostics only. A crop from a source cannot be a held-out test for another crop of that source.
const heldOut = [];
for (const [file, expected] of [["wgge-7.jpg", "WGGE WG-015 wire stripper"]]) {
  const buffer = await sharp(path.join(originals, file))
    .flatten({ background: "#edf0f2" })
    .resize(384, 384, { fit: "contain", background: "#edf0f2" })
    .jpeg({ quality: 90 })
    .toBuffer();
  const features = await encoder(
    await RawImage.fromBlob(new Blob([buffer], { type: "image/jpeg" })),
    { pool: false },
  );
  const decision = core.decide(
    Array.from(features.data.slice(0, core.DIM)),
    tools,
    0.3,
    0,
    {},
    classifier,
  );
  heldOut.push({
    file,
    expected,
    actual: decision.label,
    accepted: decision.accepted,
    reason: decision.reason,
    score: decision.score,
    gap: decision.gap,
    floor: decision.floor,
  });
}
const diagnostics = {
  model: core.MODEL,
  referenceChecks: core.assess(tools),
  floors: core.calibrate(tools),
  heldOutPhotos: heldOut,
  heldOutAccuracy: null,
  notes:
    "One WGGE source photo withheld as a smoke test. Exact glasses and screwdriver have two source photos plus three rotated variants each. No held-out test of either exact item; no independent camera accuracy benchmark.",
};
await fs.writeFile(
  path.join(root, "diagnostics.json"),
  JSON.stringify(diagnostics, null, 2),
);
console.log(JSON.stringify(diagnostics, null, 2));
