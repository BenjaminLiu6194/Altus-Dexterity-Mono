# Altus Dexterity Mono

Workspace for the Medical Knowledge Gate (§7.3.1). The current implementation is a tool-recognition experiment, separate from future procedural-understanding work.

| Folder              | Evaluation                                        | Current state                                                                                          |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [gate-1a](gate-1a/) | Recognition: instruments, anatomy, sterile fields | DINOv2 camera/reference prototype for tools. Anatomy and sterile-field assessment are not implemented. |
| [gate-1b](gate-1b/) | Procedural step understanding                     | Requirements and implementation boundary only.                                                         |

## Run Gate 1A

Requires Python 3. From the repository root:

```sh
npm start
# Or: python3 -m http.server 5381 --bind 127.0.0.1 --directory gate-1a/web
```

Open http://localhost:5381. Serving the app needs no Node dependency install or asset build. The browser downloads the pinned runtime and pretrained weights on first inference. Camera/image processing runs locally.

Use **Sets** to select examples, capture/upload photos, or **Train** the active set. Return to **Start video** to resume classification. Browser libraries stay available at the same localhost origin after this reorganization.

## Checks

Node.js 22 or newer; no dependency install needed:

```sh
npm test
npm run check
```

Rebuilding the bundled references is optional and requires `npm ci`; see [Gate 1A](gate-1a/README.md).

## Scope

The supplied evaluation requires a fully autonomous, proctor-led simulated oral examination. This prototype does not yet implement that examination, spoken interaction, anatomy recognition, contamination assessment, or Gate 1B reasoning. Visual matching is not proof of exact product identity or clinical readiness. The Physical Capability Gate (§7.3.2) is outside this implementation.

The previous scripted Gates demo, CLIP image demo, OWL-ViT detector, manual multi-region UI, and their tests/assets were removed from the current tree. Gate 1A contains only the DINOv2 prototype and its supporting data, scripts, tests, and documentation.
