const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const web = path.resolve(__dirname, "../web");
const html = fs.readFileSync(path.join(web, "index.html"), "utf8");
const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
assert.equal(new Set(ids).size, ids.length, "DOM IDs must be unique");
for (const [, id] of app.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) {
  assert.ok(ids.includes(id), `Missing control: ${id}`);
}
for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (!url.startsWith("http"))
    assert.ok(
      fs.existsSync(path.join(web, url.split("?")[0])),
      `Missing asset: ${url}`,
    );
}
assert.ok(fs.existsSync(path.join(web, "worker.js")));
const pack = path.join(web, "reference-packs/workshop");
const curation = JSON.parse(
  fs.readFileSync(path.join(pack, "curation.json"), "utf8"),
);
const sources = JSON.parse(
  fs.readFileSync(path.join(pack, "sources.json"), "utf8"),
);
assert.equal(curation.references.length, 20);
assert.equal(sources.images.length, 13);
for (const reference of curation.references) {
  const jpeg = fs.readFileSync(path.join(pack, reference.curated));
  assert.equal(jpeg.readUInt16BE(0), 0xffd8);
  assert.ok(sources.images.some((source) => source.file === reference.file));
}
const core = require("../web/core.js");
const library = core.validate(
  JSON.parse(fs.readFileSync(path.join(pack, "library.json"), "utf8")),
);
assert.equal(library.length, 4);
const classifier = JSON.parse(
  fs.readFileSync(path.join(pack, "classifier.json"), "utf8"),
);
// Compare fitted values after import normalization, which can change float serialization.
const fitted = core.train(library);
for (const tool of library) {
  assert.equal(tool.samples.length, 5);
  assert.ok(
    core.cosine(fitted.prototypes[tool.id], classifier.prototypes[tool.id]) >
      0.999999,
  );
}
console.log(
  "Moved assets, DOM controls, dataset provenance and bundled classifier checks passed",
);
