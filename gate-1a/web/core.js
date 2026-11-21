(function (root) {
  "use strict";
  const MODEL = "Xenova/dinov2-small",
    DIM = 384,
    VERSION = 2,
    MIN_EXAMPLES = 5;
  function normalize(v) {
    if (!Array.isArray(v) || !v.length || !v.every(Number.isFinite))
      throw Error("Invalid image embedding");
    const n = Math.hypot(...v);
    if (!n) throw Error("Invalid image embedding");
    return v.map((x) => x / n);
  }
  function cosine(a, b) {
    if (a.length !== b.length) throw Error("Incompatible image embeddings");
    return a.reduce((s, x, i) => s + x * b[i], 0);
  }
  const eligible = (t) =>
    t.samples.length >= (t.kind === "background" ? 1 : MIN_EXAMPLES);
  function score(v, samples) {
    const similarities = samples
      .map((s) => cosine(v, s.vector))
      .sort((a, b) => b - a);
    const k = Math.min(2, similarities.length);
    return similarities.slice(0, k).reduce((a, b) => a + b, 0) / k;
  }
  // Fit a small supervised prototype classifier on frozen DINOv2 features.
  function train(library) {
    const classes = library.filter((t) => t.kind !== "background");
    if (!classes.length || classes.some((t) => !eligible(t)))
      throw Error("Add at least 5 examples per object before training.");
    const prototypes = Object.fromEntries(
      library
        .filter(eligible)
        .map((t) => [
          t.id,
          normalize(
            t.samples.reduce(
              (mean, s) => mean.map((x, i) => x + s.vector[i]),
              Array(DIM).fill(0),
            ),
          ),
        ]),
    );
    return { signature: fingerprint(library), prototypes };
  }
  function fingerprint(library) {
    return JSON.stringify(
      library.map((t) => [
        t.id,
        t.name,
        t.kind,
        t.samples.map((s) => s.vector),
      ]),
    );
  }
  function rank(vector, library, model = null) {
    const v = normalize(vector);
    return library
      .filter(eligible)
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind || "tool",
        score: model?.prototypes[t.id]
          ? 0.85 * score(v, t.samples) +
            0.15 * cosine(v, model.prototypes[t.id])
          : score(v, t.samples),
      }))
      .sort((a, b) => b.score - a.score);
  }
  // Leave-one-out reference consistency determines a conservative per-class floor.
  function calibrate(library) {
    return Object.fromEntries(
      library.filter(eligible).map((t) => {
        const held =
          t.samples.length < 3
            ? []
            : t.samples
                .map((s, i) =>
                  score(
                    s.vector,
                    t.samples.filter((_, j) => i !== j),
                  ),
                )
                .sort((a, b) => a - b);
        return [
          t.id,
          held.length
            ? Math.max(0.55, held[Math.floor((held.length - 1) * 0.2)] - 0.13)
            : 0.6,
        ];
      }),
    );
  }
  function decide(
    vector,
    library,
    threshold = 0.6,
    margin = 0.03,
    floors = calibrate(library),
    model = null,
  ) {
    const rankings = rank(vector, library, model),
      top = rankings[0],
      gap = top ? top.score - (rankings[1]?.score ?? 0) : 0;
    const floor = top
      ? Math.max(threshold, floors[top.id] ?? threshold)
      : threshold;
    const reason = !top
      ? "no-examples"
      : top.kind === "background"
        ? "background"
        : top.score < floor
          ? "weak-match"
          : gap < margin
            ? "ambiguous"
            : "accepted";
    const accepted = reason === "accepted";
    return {
      accepted,
      label: accepted
        ? top.name
        : reason === "background"
          ? "No tool"
          : "Unknown / ambiguous",
      id: accepted ? top.id : null,
      score: top?.score ?? 0,
      gap,
      floor,
      reason,
      rankings,
    };
  }
  function assess(library) {
    const floors = calibrate(library);
    const results = [];
    for (const t of library.filter(
      (t) => t.kind !== "background" && eligible(t),
    )) {
      let correct = 0;
      for (let i = 0; i < t.samples.length; i++) {
        const reduced = library.map((k) =>
          k.id === t.id
            ? { ...k, samples: k.samples.filter((_, j) => i !== j) }
            : k,
        ); // Keep the held-out class eligible for this diagnostic only.
        const v = t.samples[i].vector;
        const candidates = reduced
          .filter((k) => k.samples.length && (k.id === t.id || eligible(k)))
          .map((k) => ({ id: k.id, score: score(v, k.samples) }))
          .sort((a, b) => b.score - a.score);
        if (
          candidates[0]?.id === t.id &&
          candidates[0].score >= floors[t.id] &&
          candidates[0].score - (candidates[1]?.score ?? 0) >= 0.03
        )
          correct++;
      }
      results.push({ id: t.id, correct, total: t.samples.length });
    }
    return results;
  }
  // Replace only known bundled vectors, retaining user-captured examples and IDs.
  function upgradeReferences(tools, pack, legacy) {
    let changed = false;
    const updated = tools.map((tool) => {
      const old = legacy.replacements.find((r) => r.oldName === tool.name);
      if (!old) return tool;
      const replacement = pack.find((t) => t.id === old.id);
      if (
        !replacement ||
        tools.some(
          (t) =>
            t.id !== tool.id &&
            t.name.toLowerCase() === replacement.name.toLowerCase(),
        )
      )
        return tool;
      const custom = tool.samples.filter(
        (s) => !old.vectors.some((v) => cosine(s.vector, v) > 0.999999),
      );
      if (custom.length === tool.samples.length) return tool;
      changed = true;
      return {
        ...tool,
        name: replacement.name,
        samples: [...replacement.samples, ...custom].slice(0, 10),
      };
    });
    return { tools: updated, changed };
  }
  function validate(data) {
    if (
      data.version !== VERSION ||
      data.model !== MODEL ||
      !Array.isArray(data.tools) ||
      data.tools.length > 31
    )
      throw Error(
        "This library needs DINOv2 references. Re-upload the original photos to use the new matcher.",
      );
    const ids = new Set(),
      names = new Set();
    return data.tools.map((t) => {
      const name = typeof t.name === "string" ? t.name.trim() : "";
      if (
        typeof t.id !== "string" ||
        !t.id ||
        ids.has(t.id) ||
        !name ||
        names.has(name.toLowerCase()) ||
        name.length > 64 ||
        !Array.isArray(t.samples) ||
        t.samples.length > 10 ||
        !["tool", "background", undefined].includes(t.kind)
      )
        throw Error("Invalid instrument");
      ids.add(t.id);
      names.add(name.toLowerCase());
      return {
        id: t.id,
        name,
        kind: t.kind || "tool",
        samples: t.samples.map((s) => {
          if (
            !Array.isArray(s.vector) ||
            s.vector.length !== DIM ||
            !s.vector.every(Number.isFinite) ||
            typeof s.thumbnail !== "string" ||
            s.thumbnail.length > 150000 ||
            !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s.thumbnail)
          )
            throw Error("Invalid reference sample");
          return { vector: normalize(s.vector), thumbnail: s.thumbnail };
        }),
      };
    });
  }
  const api = {
    MODEL,
    DIM,
    VERSION,
    MIN_EXAMPLES,
    upgradeReferences,
    train,
    fingerprint,
    normalize,
    cosine,
    eligible,
    rank,
    calibrate,
    decide,
    assess,
    validate,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.ToolCore = api;
})(globalThis);
