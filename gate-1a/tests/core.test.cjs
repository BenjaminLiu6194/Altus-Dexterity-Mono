const path = require("node:path"),
  web = path.resolve(__dirname, "../web");
const assert = require("node:assert/strict");
const C = require("../web/core.js");
const v = (a, b, c = 0) => [a, b, c, ...Array(C.DIM - 3).fill(0)];
const sample = (vector) => ({
  vector: C.normalize(vector),
  thumbnail: "data:image/jpeg;base64,/9j/",
});
const tool = (id, vector, n = 5, kind = "tool") => ({
  id,
  name: id,
  kind,
  samples: Array.from({ length: n }, () => sample(vector)),
});
const library = [tool("scissors", v(1, 0)), tool("retractor", v(0, 1))];
assert.equal(C.decide(v(1, 0), library).label, "scissors");
assert.equal(C.decide(v(0, 1), library).label, "retractor");
assert.equal(C.decide(v(1, 1), library).accepted, false);
assert.equal(C.decide(v(-1, 0), library).accepted, false);
assert.equal(
  C.decide(v(1, 0), [tool("undertrained", v(1, 0), 4)]).reason,
  "no-examples",
);
assert.equal(
  C.decide(v(1, 0), [tool("a", v(1, 0)), tool("b", v(1, 0))]).reason,
  "ambiguous",
);
assert.throws(() => C.normalize(v(0, 0)));
assert.throws(() => C.normalize([NaN]));
assert.throws(() => C.cosine([1], [1, 2]));
const data = { version: C.VERSION, model: C.MODEL, tools: library };
assert.throws(() => C.validate({ ...data, model: "other" }));
assert.throws(() => C.validate({ ...data, version: 1 }));
assert.equal(C.validate(data).length, 2);
assert.throws(() => C.validate({ ...data, tools: [library[0], library[0]] }));
assert.throws(() => C.validate({ ...data, tools: [tool("bad", [NaN])] }));
assert.throws(() =>
  C.validate({ ...data, tools: [{ ...library[0], name: " " }] }),
);
assert.throws(() =>
  C.validate({ ...data, tools: [{ ...library[0], kind: "invalid" }] }),
);
assert.throws(() =>
  C.validate({
    ...data,
    tools: [
      {
        ...library[0],
        samples: [{ vector: [1, 0], thumbnail: "data:image/jpeg;base64,/9j/" }],
      },
    ],
  }),
);
const bg = tool("empty", v(0, 0, 1), 1, "background");
assert.equal(C.decide(v(0, 0, 1), [...library, bg]).reason, "background");
assert.equal(C.decide(v(0, 0, 1), [...library, bg]).label, "No tool");
assert.equal(C.decide(v(1, 0), [...library, bg]).label, "scissors");
assert.equal(
  C.validate({ ...data, tools: [...library, bg] })[2].kind,
  "background",
);
assert.equal(C.decide(v(0.7, 0.7), library, 0.99).reason, "weak-match");
assert.equal(
  C.assess(library).every((x) => x.correct === 5),
  true,
);
assert.equal(
  C.assess([tool("a", v(1, 0)), tool("b", v(1, 0))]).every(
    (x) => x.correct === 0,
  ),
  true,
);
assert.equal(C.calibrate(library).scissors, 0.87);
assert.equal(C.rank(v(1, 0), library)[0].name, "scissors");
console.log(
  "26 visual matching, background, calibration and library checks passed",
);
// Training fits normalized class prototypes and uses them in prediction scores.
assert.throws(() => C.train([]), /5 examples/);
assert.throws(() => C.train([tool("short", v(1, 0), 4)]), /5 examples/);
const varied = tool("varied", v(0, 1));
varied.samples[0] = sample(v(1, 0));
const fitted = C.train([varied]);
assert.ok(Math.abs(Math.hypot(...fitted.prototypes.varied) - 1) < 1e-10);
const blend = C.rank(v(1, 0), [varied], fitted)[0].score;
assert.ok(Math.abs(blend - (0.85 * 0.5 + 0.15 / Math.sqrt(17))) < 1e-10);
assert.notEqual(
  C.fingerprint([varied]),
  C.fingerprint([tool("varied", v(1, 0))]),
);
// Upgrades replace the old bundled images, preserving custom references and IDs.
const fs = require("node:fs");
const pack = JSON.parse(
  fs.readFileSync(
    path.join(web, "reference-packs/workshop/library.json"),
    "utf8",
  ),
).tools;
const legacy = JSON.parse(
  fs.readFileSync(
    path.join(web, "reference-packs/workshop/legacy-references.json"),
    "utf8",
  ),
);
const old = legacy.replacements[0];
const custom = sample(v(1, 0));
const prior = {
  id: "saved-custom-id",
  name: old.oldName,
  kind: "tool",
  samples: [...old.vectors.map(sample), custom],
};
const upgraded = C.upgradeReferences([prior], pack, legacy);
assert.equal(upgraded.changed, true);
assert.equal(upgraded.tools[0].id, prior.id);
assert.equal(upgraded.tools[0].name, "DeWalt DPG54-1C safety glasses");
assert.equal(upgraded.tools[0].samples.length, 6);
assert.equal(upgraded.tools[0].samples[5], custom);
assert.equal(C.upgradeReferences(upgraded.tools, pack, legacy).changed, false);
assert.equal(
  C.upgradeReferences([{ ...prior, samples: [custom] }], pack, legacy).changed,
  false,
);
assert.equal(prior.name, old.oldName);
console.log(
  "Prototype fitting, blended prediction, exact-product migration and camera-example preservation passed",
);
