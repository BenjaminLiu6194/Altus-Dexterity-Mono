(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    video = $("video"),
    overlay = $("overlay"),
    ctx = overlay.getContext("2d");
  let library = [],
    stream = null,
    regions = [],
    worker = null,
    pending = null,
    sequence = 0,
    busy = false,
    running = false,
    generation = 0,
    timer = null,
    db = null,
    ready = false,
    starting = false,
    expiry = null,
    mirrored = true,
    sets = [],
    activeSetId = null,
    trainedModel = null,
    setButtons = [];
  // Keep the camera mounted while changing the controls shown alongside it.
  const tabs = [$("videoTab"), $("referenceTab")];
  function selectTab(index) {
    if (index === 1 && running) {
      stopRecognition();
      status("Paused.");
    }
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(tab.getAttribute("aria-controls")).hidden = !selected;
    });
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => selectTab(index);
    tab.onkeydown = (e) => {
      let next;
      if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (e.key === "ArrowLeft")
        next = (index + tabs.length - 1) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      else return;
      e.preventDefault();
      selectTab(next);
      tabs[next].focus();
    };
  });
  function defaultRegion() {
    const side =
      Math.min(video.videoWidth, video.videoHeight) *
      (Number($("guideSize").value) / 100);
    return {
      x: (1 - side / video.videoWidth) / 2,
      y: (1 - side / video.videoHeight) / 2,
      w: side / video.videoWidth,
      h: side / video.videoHeight,
      result: null,
    };
  }
  function ensureRegion() {
    if (stream) regions = [defaultRegion()];
  }
  // Mirror only the preview. Coordinates and pixels sent to the model stay native.
  function mirrorPreview() {
    video.style.transform = mirrored ? "scaleX(-1)" : "none";
    $("mirror").setAttribute("aria-pressed", String(mirrored));
    $("mirror").textContent = mirrored
      ? "Mirror preview: on"
      : "Mirror preview: off";
    draw();
  }
  $("mirror").onclick = () => {
    mirrored = !mirrored;
    mirrorPreview();
  };
  $("guideSize").oninput = () => {
    ensureRegion();
    invalidate();
    sync();
  };
  $("improve").onclick = () => {
    selectTab(1);
    status("Select an object, then capture examples.");
  };

  const status = (message) => ($("status").textContent = message);
  function sync() {
    const active = !!stream,
      eligible = library.some(
        (t) => t.kind !== "background" && ToolCore.eligible(t),
      );
    $("camera").disabled = active || starting || busy;
    $("stop").disabled = !active && !starting;
    $("run").disabled =
      !active || !eligible || !regions.length || (busy && !running);
    $("background").disabled = !active || busy || running;
    $("testPhoto").disabled = busy || running || !eligible;
    $("capture").disabled =
      !active || !regions.length || !$("selected").value || busy || running;
    $("photos").disabled = busy || running || !$("selected").value;
    $("selected").disabled = busy || running;
    $("addForm").querySelector("button").disabled = busy || running || !ready;
    $("import").disabled = busy || running || !ready;
    $("newSet").disabled = busy || running || !ready;
    setButtons.forEach((b) => (b.disabled = busy || running || !ready));
    $("threshold").disabled = running;
    $("margin").disabled = running;
    $("run").textContent = running
      ? "Pause recognition"
      : active
        ? "Resume recognition"
        : "Start recognition";
    $("toolCount").textContent =
      `${library.filter((t) => t.kind !== "background").length} tools`;
  }
  function invalidate() {
    if (
      trainedModel &&
      trainedModel.signature !== ToolCore.fingerprint(library)
    )
      trainedModel = null;
    generation++;
    clearTimeout(expiry);
    for (const r of regions) {
      r.result = null;
      r.score = undefined;
      r.decision = null;
    }
    renderResults();
    draw();
  }
  function render() {
    renderSets();
    const selected = $("selected").value;
    $("selected").replaceChildren();
    if (!library.length)
      $("selected").append(new Option("Add an object first", ""));
    for (const tool of library)
      $("selected").append(new Option(tool.name, tool.id));
    if (library.some((t) => t.id === selected)) $("selected").value = selected;
    $("library").replaceChildren();
    for (const t of library) {
      const card = document.createElement("div");
      card.className = "instrument";
      const head = document.createElement("header"),
        name = document.createElement("strong"),
        remove = document.createElement("button");
      name.textContent = t.name;
      remove.textContent = "Remove";
      remove.disabled = busy || running;
      remove.onclick = async () => {
        library = library.filter((x) => x.id !== t.id);
        invalidate();
        render();
        await save();
      };
      head.append(name, remove);
      const count = document.createElement("div");
      count.className = "count";
      count.textContent =
        t.kind === "background"
          ? `${t.samples.length} empty-view examples`
          : `${t.samples.length} / 10 examples · ${ToolCore.eligible(t) ? "Ready" : "Needs 5"}`;
      const pics = document.createElement("div");
      pics.className = "examples";
      for (const sample of t.samples) {
        const img = document.createElement("img");
        img.src = sample.thumbnail;
        img.alt = `${t.name} reference`;
        pics.append(img);
      }
      card.append(head, count, pics);
      $("library").append(card);
    }
    sync();
  }

  function renderSets() {
    const active = sets.find((s) => s.id === activeSetId);
    if (active) {
      active.tools = library;
      active.trained = !!trainedModel;
    }
    $("sets").replaceChildren();
    setButtons = [];
    for (const set of sets) {
      const card = document.createElement("details");
      card.className = "modelSet";
      card.open = set.open ?? set.id === activeSetId;
      card.ontoggle = () => {
        set.open = card.open;
      };
      const summary = document.createElement("summary");
      summary.textContent =
        set.name + (set.id === activeSetId ? " · Active" : "");
      const info = document.createElement("p");
      info.className = "muted";
      info.textContent = `${set.tools.filter((t) => t.kind !== "background").length} objects · ${set.id === activeSetId ? (trainedModel ? "Trained" : "Not trained") : set.trained ? "Trained" : "Not trained"}`;
      const actions = document.createElement("div");
      actions.className = "toolbar";
      const use = document.createElement("button");
      use.textContent = "Use";
      use.onclick = () => activateSet(set.id);
      const train = document.createElement("button");
      train.textContent = "Train";
      train.className = "primary";
      train.onclick = async () => {
        if (busy || running) return;
        await activateSet(set.id);
        try {
          trainedModel = ToolCore.train(library);
          await save();
          invalidate();
          render();
          status(set.name + " trained.");
        } catch (e) {
          status(e.message);
        }
      };
      actions.append(use, train);
      setButtons.push(use, train);
      card.append(summary, info, actions);
      $("sets").append(card);
    }
  }
  async function activateSet(id) {
    if (busy || running || !ready) return;
    busy = true;
    sync();
    try {
      await save();
      const next = sets.find((s) => s.id === id);
      if (!next) return;
      activeSetId = id;
      library = next.tools;
      trainedModel = null;
      if (next.trained)
        try {
          trainedModel = ToolCore.train(library);
        } catch (e) {
          next.trained = false;
        }
      invalidate();
      await save();
      status(next.name + " active.");
    } finally {
      busy = false;
      render();
    }
  }
  $("newSet").onclick = async () => {
    if (busy || running || !ready) return;
    if (sets.length >= 20) {
      status("Maximum 20 sets.");
      return;
    }
    const next = {
      id: crypto.randomUUID(),
      name: "Set " + (sets.length + 1),
      tools: [],
      trained: false,
    };
    sets.push(next);
    await activateSet(next.id);
  };

  function payload() {
    return { version: ToolCore.VERSION, model: ToolCore.MODEL, tools: library };
  }
  async function save() {
    const active = sets.find((s) => s.id === activeSetId);
    if (
      trainedModel &&
      trainedModel.signature !== ToolCore.fingerprint(library)
    )
      trainedModel = null;
    if (active) {
      active.tools = library;
      active.trained = !!trainedModel;
    }
    try {
      if (!db) throw Error("Browser storage unavailable");
      await new Promise((resolve, reject) => {
        const tx = db.transaction("references", "readwrite");
        tx.objectStore("references").put(payload(), "library-v2");
        tx.objectStore("references").put(
          { version: 1, activeSetId, sets },
          "sets-v1",
        );
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      $("storage").textContent = "Saved.";
    } catch (e) {
      $("storage").textContent =
        "Could not save in this browser. Export the library before closing this tab.";
    }
  }
  async function init() {
    let fresh = false;
    try {
      db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("instrument-lab", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("references");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const data = await new Promise((resolve, reject) => {
        const req = db
          .transaction("references")
          .objectStore("references")
          .get("library-v2");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (data) library = ToolCore.validate(data);
      const savedSets = await new Promise((resolve, reject) => {
        const req = db
          .transaction("references")
          .objectStore("references")
          .get("sets-v1");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      fresh = !data && !savedSets;
      if (savedSets) {
        if (
          savedSets.version !== 1 ||
          !Array.isArray(savedSets.sets) ||
          !savedSets.sets.length ||
          savedSets.sets.length > 20
        )
          throw Error("Invalid saved sets");
        const ids = new Set();
        sets = savedSets.sets.map((s) => {
          if (
            typeof s.id !== "string" ||
            ids.has(s.id) ||
            typeof s.name !== "string" ||
            !s.name.trim() ||
            s.name.length > 64
          )
            throw Error("Invalid saved set");
          ids.add(s.id);
          return {
            ...s,
            tools: ToolCore.validate({
              version: ToolCore.VERSION,
              model: ToolCore.MODEL,
              tools: s.tools,
            }),
          };
        });
        activeSetId = sets.some((s) => s.id === savedSets.activeSetId)
          ? savedSets.activeSetId
          : sets[0].id;
        const active = sets.find((s) => s.id === activeSetId);
        library = active.tools;
        if (active.trained)
          try {
            trainedModel = ToolCore.train(library);
          } catch (e) {
            active.trained = false;
          }
      }
    } catch (e) {
      $("storage").textContent =
        "Saved references could not be loaded. You can import a backup or start a temporary library.";
    }
    if (!sets.length) {
      activeSetId = crypto.randomUUID();
      sets = [
        { id: activeSetId, name: "Set 1", tools: library, trained: false },
        { id: crypto.randomUUID(), name: "Set 2", tools: [], trained: false },
      ];
    }
    await initializeReferences(fresh);
    ready = true;
    render();
    if (!library.some((t) => t.kind !== "background")) {
      selectTab(1);
      status("Add examples, then train this set.");
    }
  }
  async function initializeReferences(fresh) {
    if (
      !fresh &&
      !sets.some((s) =>
        s.tools.some((t) =>
          ["DeWalt safety goggles", "Screwdriver"].includes(t.name),
        ),
      )
    )
      return;
    try {
      const responses = await Promise.all([
        fetch("reference-packs/workshop/library.json", { cache: "no-store" }),
        fetch("reference-packs/workshop/legacy-references.json", {
          cache: "no-store",
        }),
      ]);
      if (responses.some((r) => !r.ok))
        throw Error("Reference download failed");
      const [packData, legacy] = await Promise.all(
        responses.map((r) => r.json()),
      );
      const pack = ToolCore.validate(packData);
      if (
        !legacy ||
        !Array.isArray(legacy.replacements) ||
        legacy.replacements.some(
          (r) =>
            !Array.isArray(r.vectors) ||
            r.vectors.some(
              (v) =>
                !Array.isArray(v) ||
                v.length !== ToolCore.DIM ||
                !v.every(Number.isFinite),
            ),
        )
      )
        throw Error("Invalid reference update");
      const proposals = sets.map((s) => ({
        set: s,
        update: ToolCore.upgradeReferences(s.tools, pack, legacy),
      }));
      if (proposals.some((p) => p.update.changed) && db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction("references", "readwrite");
          tx.objectStore("references").put(
            { version: 1, activeSetId, sets },
            "sets-before-reference-update-v2",
          );
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }
      for (const { set, update } of proposals) {
        if (update.changed) {
          set.tools = update.tools;
          try {
            ToolCore.train(set.tools);
            set.trained = true;
          } catch (e) {
            set.trained = false;
          }
        }
      }
      if (fresh) {
        const active = sets.find((s) => s.id === activeSetId);
        active.tools = pack;
        active.trained = true;
      }
      const active = sets.find((s) => s.id === activeSetId);
      library = active.tools;
      trainedModel = active.trained ? ToolCore.train(library) : null;
      await save();
      status("References updated.");
    } catch (e) {
      status("Reference update unavailable. " + e.message);
    }
  }
  function request(images) {
    if (pending) return Promise.reject(Error("Model is already busy"));
    if (!worker) {
      worker = new Worker("worker.js?v=1", { type: "module" });
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") {
          status(data.message);
          return;
        }
        if (!pending || pending.id !== data.id) return;
        clearTimeout(pending.timeout);
        const job = pending;
        pending = null;
        data.error ? job.reject(Error(data.error)) : job.resolve(data);
      };
      worker.onerror = (e) => resetWorker(e.message || "Model worker failed");
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending = {
        id,
        resolve,
        reject,
        timeout: setTimeout(
          () =>
            resetWorker("Model timed out. Check the connection and try again."),
          240000,
        ),
      };
      worker.postMessage({ id, images });
    });
  }
  function resetWorker(message) {
    worker?.terminate();
    worker = null;
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(Error(message));
      pending = null;
    }
  }
  // Square letterboxing keeps the full tool visible to the encoder instead of center-cropping its ends.
  function crop(source, region) {
    const c = document.createElement("canvas");
    const width = source.videoWidth || source.naturalWidth || source.width,
      height = source.videoHeight || source.naturalHeight || source.height;
    const r = region || { x: 0, y: 0, w: 1, h: 1 };
    const sw = width * r.w,
      sh = height * r.h,
      size = 384,
      scale = size / Math.max(sw, sh);
    c.width = size;
    c.height = size;
    const cx = c.getContext("2d");
    cx.fillStyle = "#edf0f2";
    cx.fillRect(0, 0, size, size);
    cx.drawImage(
      source,
      r.x * width,
      r.y * height,
      sw,
      sh,
      (size - sw * scale) / 2,
      (size - sh * scale) / 2,
      sw * scale,
      sh * scale,
    );
    return c;
  }
  function thumbnail(c) {
    const t = document.createElement("canvas");
    t.width = 96;
    t.height = 96;
    t.getContext("2d").drawImage(c, 0, 0, 96, 96);
    return t.toDataURL("image/jpeg", 0.7);
  }
  async function collect(sources, toolId) {
    if (busy || running) return;
    const tool = library.find((t) => t.id === toolId);
    if (!tool) return;
    const room = 10 - tool.samples.length;
    if (!room) {
      status(
        "This tool already has 10 examples. Remove and re-add it to replace its reference set.",
      );
      return;
    }
    busy = true;
    render();
    try {
      for (const source of sources.slice(0, room)) {
        status("Saving example…");
        const c = await source(),
          image = c.toDataURL("image/jpeg", 0.9);
        const result = await request([image]);
        const vector = ToolCore.normalize(result.vectors[0]);
        if (
          tool.samples.some((s) => ToolCore.cosine(vector, s.vector) > 0.9995)
        ) {
          status(
            "That example is nearly identical. Change the tool’s pose before capturing again.",
          );
          continue;
        }
        tool.samples.push({ vector, thumbnail: thumbnail(c) });
        await save();
        render();
      }
      invalidate();
      status(
        `${tool.name}: ${tool.samples.length} examples saved. ${tool.kind === "background" ? "Empty-view rejection enabled." : tool.samples.length < 5 ? "Add varied examples to reach 5." : "Ready for live matching."}`,
      );
    } catch (e) {
      status("Reference collection failed: " + e.message);
    } finally {
      busy = false;
      render();
    }
  }
  $("addForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!ready || busy || running) return;
    const name = $("name").value.trim();
    if (!name) return;
    if (library.filter((t) => t.kind !== "background").length >= 30) {
      status("Maximum 30 objects per library.");
      return;
    }
    if (library.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      status("That object already exists. Select it to add examples.");
      return;
    }
    const t = { id: crypto.randomUUID(), name, kind: "tool", samples: [] };
    library.push(t);
    $("name").value = "";
    invalidate();
    render();
    $("selected").value = t.id;
    sync();
    await save();
  };
  $("selected").onchange = sync;
  $("photos").onchange = async (e) => {
    const files = [...e.target.files],
      id = $("selected").value;
    e.target.value = "";
    await collect(
      files.map((file) => async () => {
        if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024)
          throw Error("Use image files smaller than 25 MB");
        const url = URL.createObjectURL(file);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          return crop(image);
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
      id,
    );
  };
  $("background").onclick = async () => {
    if (!stream || !regions.length) return;
    let t = library.find((t) => t.kind === "background");
    if (!t) {
      t = {
        id: crypto.randomUUID(),
        name: "Empty view / background",
        kind: "background",
        samples: [],
      };
      library.push(t);
    }
    const snapshot = crop(video, regions[0]);
    await collect([async () => snapshot], t.id);
  };
  $("capture").onclick = () => {
    if (!video.videoWidth || !regions.length) return;
    const snapshot = crop(video, regions[0]);
    collect([async () => snapshot], $("selected").value);
  };
  function stopRecognition() {
    running = false;
    clearTimeout(timer);
    invalidate();
    if (pending) resetWorker("Recognition cancelled");
    sync();
  }
  function stopCamera() {
    starting = false;
    stopRecognition();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    regions = [];
    draw();
    $("placeholder").hidden = false;
    $("timing").textContent = "Camera off";
    $("modelPreview").getContext("2d").clearRect(0, 0, 384, 384);
    sync();
  }
  $("camera").onclick = async () => {
    if (starting || stream) return;
    starting = true;
    const ticket = ++sequence;
    sync();
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("Open this page on localhost or HTTPS to use the camera");
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!starting || ticket !== sequence) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = acquired;
      video.srcObject = stream;
      await video.play();
      if (!stream) return;
      for (const track of stream.getVideoTracks()) track.onended = stopCamera;
      $("placeholder").hidden = true;
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      $("timing").textContent = "Camera live";
      ensureRegion();
      status("Select a set to begin.");
      fit();
      draw();
      if (library.some((t) => t.kind !== "background" && ToolCore.eligible(t)))
        startRecognition();
    } catch (e) {
      stopCamera();
      status("Camera unavailable: " + e.message);
    } finally {
      starting = false;
      sync();
    }
  };
  $("stop").onclick = () => {
    sequence++;
    stopCamera();
    status("Camera stopped.");
  };
  // Match the canvas to the contained video, including portrait camera streams.
  function fit() {
    if (!video.videoWidth) return;
    const box = video.parentElement,
      w = box.clientWidth,
      h = box.clientHeight,
      ratio = video.videoWidth / video.videoHeight;
    const dw = Math.min(w, h * ratio),
      dh = dw / ratio;
    Object.assign(overlay.style, {
      width: dw + "px",
      height: dh + "px",
      left: (w - dw) / 2 + "px",
      top: (h - dh) / 2 + "px",
    });
  }
  new ResizeObserver(fit).observe(video.parentElement);
  video.addEventListener("loadedmetadata", fit);
  function draw() {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    regions.forEach((r) => {
      const top = r.decision?.rankings[0];
      const label = top
        ? `${top.kind === "background" ? "No tool" : top.name} · ${Math.round(Math.max(0, Math.min(1, top.score)) * 100)}% similarity`
        : "Waiting for tool";
      box(r, label, r.decision?.accepted ? "#4ade80" : "#facc15");
    });
  }
  function box(r, text, color) {
    const x = (mirrored ? 1 - r.x - r.w : r.x) * overlay.width,
      y = r.y * overlay.height,
      w = r.w * overlay.width,
      h = r.h * overlay.height;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.font = "18px sans-serif";
    const tw = ctx.measureText(text).width + 16,
      ty = Math.max(0, y - 30);
    ctx.fillStyle = "#000000";
    ctx.fillRect(x, ty, Math.min(tw, overlay.width - x), 29);
    ctx.fillStyle = color;
    ctx.fillText(text, x + 8, ty + 21);
  }
  function renderResults() {
    const output = $("results");
    output.replaceChildren();
    if (!regions.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Waiting for camera.";
      output.append(p);
    }
    regions.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "match";
      const title = document.createElement("strong"),
        detail = document.createElement("span");
      const candidate = r.decision?.rankings[0];
      title.textContent = candidate
        ? candidate.kind === "background"
          ? "No tool"
          : candidate.name
        : "Waiting for tool";
      detail.textContent = `Tool in guide${r.score !== undefined && r.result ? " · similarity " + r.score.toFixed(3) : ""}`;
      row.append(title, detail);
      output.append(row);
    });
  }
  async function tick() {
    if (!running || busy || !stream) return;
    busy = true;
    sync();
    const revision = generation;
    try {
      const images = regions.map((r, i) => {
        const frame = crop(video, r);
        if (i === 0)
          $("modelPreview").getContext("2d").drawImage(frame, 0, 0, 384, 384);
        return frame.toDataURL("image/jpeg", 0.9);
      });
      const data = await request(images);
      if (!running || generation !== revision) return;
      data.vectors.forEach((v, i) => {
        const r = regions[i],
          d = ToolCore.decide(
            v,
            library,
            Number($("threshold").value),
            Number($("margin").value),
            {},
            trainedModel,
          );
        r.score = d.score;
        r.decision = d;
        r.result = d.accepted
          ? d.label
          : d.reason === "background"
            ? "No tool"
            : "Unknown / ambiguous";
      });
      renderResults();
      draw();
      $("timing").textContent =
        `${data.ms} ms · ${data.backend === "webgpu" ? "GPU" : "CPU"}`;
      status("Recognizing…");
      clearTimeout(expiry);
      expiry = setTimeout(
        () => {
          for (const r of regions) {
            r.result = null;
            r.score = undefined;
            r.decision = null;
          }
          draw();
          renderResults();
        },
        Math.max(1500, Math.min(5000, data.ms * 3)),
      );
    } catch (e) {
      if (generation === revision) {
        stopRecognition();
        status("Recognition stopped: " + e.message);
      }
    } finally {
      busy = false;
      sync();
      if (running) timer = setTimeout(tick, 40);
    }
  }
  function startRecognition() {
    if (!stream || busy || running) return;
    if (!regions.length) ensureRegion();
    if (!library.some((t) => t.kind !== "background" && ToolCore.eligible(t))) {
      status("Collect at least five examples for an object first.");
      return;
    }
    if (
      !["threshold", "margin"].every(
        (id) => $(id).value !== "" && $(id).checkValidity(),
      )
    ) {
      status("Set matching thresholds between 0 and 1.");
      return;
    }
    running = true;
    invalidate();
    render();
    status("Loading model…");
    tick();
  }
  $("run").onclick = () => {
    if (running) {
      stopRecognition();
      render();
      status("Paused.");
    } else startRecognition();
  };
  $("testPhoto").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || busy || running) return;
    busy = true;
    sync();
    let url;
    try {
      if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024)
        throw Error("Use an image smaller than 25 MB");
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      const data = await request([crop(image).toDataURL("image/jpeg", 0.9)]);
      const d = ToolCore.decide(
        data.vectors[0],
        library,
        Number($("threshold").value),
        Number($("margin").value),
        {},
        trainedModel,
      );
      $("testResult").textContent =
        `${d.label} · ${data.ms} ms. Candidates: ${d.rankings
          .slice(0, 3)
          .map((r) => r.name + " " + r.score.toFixed(3))
          .join(", ")}. Result: ${d.reason}.`;
      status("Test complete. This image was not added to the library.");
    } catch (e) {
      $("testResult").textContent = e.message;
    } finally {
      if (url) URL.revokeObjectURL(url);
      busy = false;
      sync();
    }
  };
  function exportLibrary(data, filename) {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("export").onclick = () =>
    exportLibrary(payload(), "instrument-library.json");
  $("import").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || busy || running) return;
    try {
      if (file.size > 25 * 1024 * 1024)
        throw Error("Library must be under 25 MB");
      const incoming = ToolCore.validate(JSON.parse(await file.text()));
      const names = new Set(library.map((t) => t.name.toLowerCase()));
      const additions = incoming.filter(
        (t) => !names.has(t.name.toLowerCase()),
      );
      if (library.length + additions.length > 31)
        throw Error("Combined library exceeds 30 instruments");
      library.push(
        ...additions.map((t) => ({ ...t, id: crypto.randomUUID() })),
      );
      invalidate();
      render();
      await save();
      status(
        `Imported ${additions.length} instruments. Existing names were kept.`,
      );
    } catch (e) {
      status("Import failed: " + e.message);
    }
  };
  mirrorPreview();
  window.addEventListener("pagehide", () => {
    stopCamera();
    resetWorker("Page closed");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopRecognition();
      status("Recognition paused while this tab is hidden.");
    }
  });
  sync();
  init();
})();
