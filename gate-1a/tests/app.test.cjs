// Application-flow test with camera, worker and storage boundaries simulated.
const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const ToolCore = require("../web/core.js");
const path = require("node:path"),
  web = path.resolve(__dirname, "../web");
const drawCalls = [],
  strokeCalls = [],
  boxLabels = [],
  strokeColors = [];
let replyVector;
class Element {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.clientWidth = 900;
    this.clientHeight = 600;
    this.files = [];
  }
  append(...items) {
    this.children.push(...items);
    if (this.id === "selected" && !this.value && items[0])
      this.value = items[0].value;
  }
  replaceChildren() {
    this.children = [];
    if (this.id === "selected") this.value = "";
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  getAttribute(k) {
    return this.attrs[k];
  }
  focus() {
    this.focused = true;
  }
  querySelector() {
    return (this.button ??= new Element());
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1280, height: 720 };
  }
  getContext() {
    return {
      clearRect() {},
      fillRect() {},
      drawImage(...args) {
        drawCalls.push(args);
      },
      strokeRect(...args) {
        strokeCalls.push(args);
        strokeColors.push(this.strokeStyle);
      },
      fillText(label) {
        boxLabels.push(label);
      },
      measureText() {
        return { width: 100 };
      },
    };
  }
  toDataURL() {
    return "data:image/jpeg;base64,/9j/";
  }
  checkValidity() {
    return true;
  }
  addEventListener() {}
  setPointerCapture() {}
}
const elements = {};
for (const match of fs
  .readFileSync(path.join(web, "index.html"), "utf8")
  .matchAll(/id="([^"]+)"/g))
  elements[match[1]] = new Element(match[1]);
for (const [id, value] of Object.entries({
  guideSize: "60",
  threshold: ".30",
  margin: ".00",
}))
  elements[id].value = value;
elements.videoTab.attrs["aria-controls"] = "videoPanel";
elements.referenceTab.attrs["aria-controls"] = "referencePanel";
elements.referencePanel.hidden = true;
const video = elements.video;
video.videoWidth = 1280;
video.videoHeight = 720;
video.parentElement = new Element();
video.play = async () => {};
let stopped = false;
const track = {
  stop() {
    stopped = true;
  },
};
const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
const vector = [1, ...Array(383).fill(0)];
let saved = {
  version: 2,
  model: ToolCore.MODEL,
  tools: [
    {
      id: "retractor",
      name: "Retractor",
      kind: "tool",
      samples: Array.from({ length: 5 }, () => ({
        vector,
        thumbnail: "data:image/jpeg;base64,/9j/",
      })),
    },
  ],
};
let requests = 0,
  createdWorkers = [],
  timers = [],
  stores = {};
let persistedSets;
let packResponse = { version: 1 };
let packFailure = false;
const indexedDB = {
  open() {
    const req = {};
    queueMicrotask(() => {
      req.result = {
        transaction() {
          const tx = {
            objectStore() {
              return {
                get(key) {
                  const r = {};
                  queueMicrotask(() => {
                    r.result =
                      key === "library-v2"
                        ? saved
                        : key === "sets-v1"
                          ? persistedSets
                          : undefined;
                    r.onsuccess();
                  });
                  return r;
                },
                put(data, key) {
                  stores[key] = structuredClone(data);
                  queueMicrotask(() => tx.oncomplete());
                },
              };
            },
          };
          return tx;
        },
      };
      req.onsuccess();
    });
    return req;
  },
};
class Worker {
  constructor(url) {
    this.url = url;
    createdWorkers.push(url);
  }
  postMessage(data) {
    requests++;
    queueMicrotask(() =>
      this.onmessage({
        data: {
          id: data.id,
          vectors: data.images.map(() => replyVector || vector),
          ms: 35,
          backend: "wasm",
        },
      }),
    );
  }
  terminate() {}
}
const context = {
  document: {
    getElementById: (id) => elements[id],
    createElement: () => new Element(),
    addEventListener() {},
  },
  navigator: { mediaDevices: { getUserMedia: async () => stream } },
  window: { addEventListener() {} },
  ResizeObserver: class {
    observe() {}
  },
  Option: class {
    constructor(text, value) {
      this.text = text;
      this.value = value;
    }
  },
  ToolCore,
  Worker,
  indexedDB,
  fetch: async (url) => {
    if (packFailure) throw Error("Network unavailable");
    const file =
      url === "reference-packs/workshop/library.json"
        ? "library.json"
        : url === "reference-packs/workshop/legacy-references.json"
          ? "legacy-references.json"
          : null;
    assert.ok(file);
    return {
      ok: true,
      json: async () =>
        JSON.parse(
          fs.readFileSync(
            path.join(web, "reference-packs/workshop", file),
            "utf8",
          ),
        ),
    };
  },
  crypto: { randomUUID: () => String(Math.random()) },
  setTimeout(fn, ms) {
    timers.push({ fn, ms });
    return timers.length;
  },
  clearTimeout() {},
  URL,
  Blob,
  console,
};
vm.runInNewContext(fs.readFileSync(path.join(web, "app.js"), "utf8"), context);
const flush = () => new Promise((resolve) => setImmediate(resolve));
(async () => {
  await flush();
  assert.equal(elements.toolCount.textContent, "1 tools");
  assert.equal(video.style.transform, "scaleX(-1)");
  await elements.camera.onclick();
  await flush();
  assert.equal(stopped, false);
  assert.equal(elements.placeholder.hidden, true);
  assert.equal(createdWorkers.length, 1);
  assert.match(createdWorkers[0], /worker/);
  assert.equal(requests, 1);
  assert.equal(strokeColors.at(-1), "#4ade80");
  assert.equal(
    elements.results.children[0].children[0].textContent,
    "Retractor",
  );
  const next = timers.find((t) => t.ms === 40);
  assert.ok(next);
  await next.fn();
  await flush();
  assert.equal(
    elements.results.children[0].children[0].textContent,
    "Retractor",
  );
  // Preview mirroring does not restart inference or flip model input pixels.
  const callsBefore = requests;
  elements.mirror.onclick();
  assert.equal(video.style.transform, "none");
  assert.equal(elements.mirror.attrs["aria-pressed"], "false");
  assert.equal(requests, callsBefore);
  elements.mirror.onclick();
  assert.equal(video.style.transform, "scaleX(-1)");
  // A tighter crop changes native source coordinates and invalidates old predictions.
  elements.guideSize.value = "40";
  elements.guideSize.oninput();
  assert.equal(
    elements.results.children[0].children[0].textContent,
    "Waiting for tool",
  );
  replyVector = [0.8, 0.6, ...Array(382).fill(0)];
  await timers
    .filter((t) => t.ms === 40)
    .at(-1)
    .fn();
  await flush();
  assert.equal(
    elements.results.children[0].children[0].textContent,
    "Retractor",
  );
  assert.equal(elements.results.children[0].children.length, 2);
  assert.equal(boxLabels.at(-1), "Retractor · 80% similarity");
  assert.equal(strokeColors.at(-1), "#4ade80");
  replyVector = [0.1, Math.sqrt(0.99), ...Array(382).fill(0)];
  await timers
    .filter((t) => t.ms === 40)
    .at(-1)
    .fn();
  await flush();
  assert.equal(boxLabels.at(-1), "Retractor · 10% similarity");
  assert.equal(strokeColors.at(-1), "#facc15");
  const nativeCrop = drawCalls.filter((c) => c[0] === video).at(-1);
  assert.equal(nativeCrop[3], 288);
  assert.equal(nativeCrop[4], 288);
  assert.ok(
    drawCalls.some((c) => c.length === 5 && c[3] === 384 && c[4] === 384),
  );
  replyVector = null;

  elements.referenceTab.onclick();
  assert.equal(elements.referencePanel.hidden, false);
  assert.equal(elements.videoPanel.hidden, true);
  assert.equal(stopped, false);
  assert.equal(elements.capture.disabled, false);
  await elements.background.onclick();
  await flush();
  assert.ok(stores["library-v2"].tools.some((t) => t.kind === "background"));
  elements.videoTab.onclick();
  assert.equal(elements.videoPanel.hidden, false);
  assert.equal(elements.referencePanel.hidden, true);
  elements.stop.onclick();
  assert.equal(stopped, true);
  assert.equal(elements.placeholder.hidden, false);
  // Sets preserve existing references, train independently, and persist selection.
  assert.equal(elements.sets.children.length, 2);
  await elements.sets.children[0].children[2].children[1].onclick();
  await flush();
  assert.match(elements.status.textContent, /Set 1 trained/);
  assert.equal(stores["sets-v1"].sets[0].trained, true);
  assert.equal(stores["sets-v1"].sets[0].tools[0].id, "retractor");
  await elements.sets.children[1].children[2].children[0].onclick();
  await flush();
  assert.equal(elements.toolCount.textContent, "0 tools");
  await elements.sets.children[1].children[2].children[1].onclick();
  await flush();
  assert.match(elements.status.textContent, /at least 5/);
  assert.equal(stores["sets-v1"].sets[1].trained, false);
  await elements.sets.children[0].children[2].children[0].onclick();
  await flush();
  assert.equal(elements.toolCount.textContent, "1 tools");
  assert.equal(stores["sets-v1"].sets[0].trained, true);
  await elements.newSet.onclick();
  await flush();
  assert.equal(elements.sets.children.length, 3);
  assert.equal(elements.toolCount.textContent, "0 tools");
  assert.equal(stores["sets-v1"].activeSetId, stores["sets-v1"].sets[2].id);
  // Reload migrates previous bundled references and preserves custom camera samples.
  const legacy = JSON.parse(
    fs.readFileSync(
      path.join(web, "reference-packs/workshop/legacy-references.json"),
      "utf8",
    ),
  ).replacements[0];
  const previous = {
    id: "kept-id",
    name: legacy.oldName,
    kind: "tool",
    samples: [
      ...legacy.vectors.map((vector) => ({
        vector,
        thumbnail: "data:image/jpeg;base64,/9j/",
      })),
      { vector, thumbnail: "data:image/jpeg;base64,/9j/" },
    ],
  };
  saved = { version: 2, model: ToolCore.MODEL, tools: [previous] };
  persistedSets = {
    version: 1,
    activeSetId: "one",
    sets: [
      { id: "one", name: "Set 1", tools: [previous], trained: false },
      { id: "two", name: "Set 2", tools: [], trained: false },
    ],
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(web, "app.js"), "utf8"),
    context,
  );
  await flush();
  assert.equal(
    stores["sets-v1"].sets[0].tools[0].name,
    "DeWalt DPG54-1C safety glasses",
  );
  assert.equal(stores["sets-v1"].sets[0].tools[0].samples.length, 6);
  assert.equal(stores["sets-v1"].sets[0].tools[0].id, "kept-id");
  assert.equal(stores["sets-v1"].sets[0].trained, true);
  assert.equal(
    stores["sets-before-reference-update-v2"].sets[0].tools[0].name,
    legacy.oldName,
  );
  // A failed update leaves the old saved examples available.
  packFailure = true;
  vm.runInNewContext(
    fs.readFileSync(path.join(web, "app.js"), "utf8"),
    context,
  );
  await flush();
  assert.equal(elements.toolCount.textContent, "1 tools");
  assert.match(elements.status.textContent, /update unavailable/);
  // First-run Set 1 is seeded with the corrected product pack, with an empty Set 2.
  saved = undefined;
  persistedSets = undefined;
  packFailure = false;
  vm.runInNewContext(
    fs.readFileSync(path.join(web, "app.js"), "utf8"),
    context,
  );
  await flush();
  assert.equal(elements.toolCount.textContent, "4 tools");
  assert.equal(stores["sets-v1"].sets.length, 2);
  assert.equal(stores["sets-v1"].sets[0].trained, true);
  assert.equal(stores["sets-v1"].sets[1].tools.length, 0);
  console.log(
    "Camera, mirroring, immediate threshold display, set isolation, training and persistence passed",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
