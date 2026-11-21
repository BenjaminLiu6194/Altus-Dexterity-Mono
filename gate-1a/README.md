# Gate 1A — Recognition

## Evaluation boundary

Under §7.3.1.1, the system must rapidly identify requested instruments, anatomical structures/landmarks, sterile boundaries, and contaminated items. Tool and anatomy lists are TBD; sterile-field assessment has 10 questions. The wider Medical Knowledge Gate requires complete autonomy under an IV&V surgeon proctor.

This folder implements only a single-object visual tool classifier. Everyday objects are proxies for initial testing, not a surgical instrument benchmark. Anatomy, sterile-field understanding, contamination assessment, spoken requests, autonomous examination control, and measured examination performance remain future work.

## Contents

```text
web/                         Static browser app
  index.html                 Camera and collapsible sets
  app.js                     Camera, storage, training, and UI
  core.js                    Feature matching and fitted prototypes
  worker.js                  DINOv2 inference in a Web Worker
  styles.css                 Black interface
  reference-packs/workshop/  Current references and provenance
scripts/                     Optional reference download/rebuild tools
tests/                       Core, worker, and application-flow checks
.cache/                      Ignored downloaded originals
```

Run `npm start` from the repository root, then open http://localhost:5381.

## Recognition pipeline

1. Capture the square camera region, resize/letterbox to 384 × 384, and encode as JPEG. Preview mirroring maps boxes correctly while model input remains in native orientation.
2. Transformers.js **3.8.1** runs **Xenova/dinov2-small**, with q8 weights. The worker attempts WebGPU initialization and falls back to WASM. It extracts a normalized 384-dimensional CLS token from `[1, 257, 384]` features.
3. Untrained matching averages the two closest reference similarities per eligible class.
4. **Train** fits a normalized mean vector per class. Trained scores blend **85% nearest-reference score + 15% prototype similarity**. DINOv2 weights remain frozen: training fits a small supervised classifier on pretrained features.
5. Display the top candidate and its similarity percentage. The default **0.30** cutoff turns accepted tool candidates green immediately; weaker candidates stay yellow. Separation defaults to 0.00. Background matches show **No tool**. Scores are not calibrated probabilities.

Inference is sequential, with backpressure and model reuse. Pauses, framing/set changes, and camera shutdown invalidate results. There is no automatic localization, tracking, or clinical scene understanding.

## Sets and storage

Each set has separate examples and trained state. An object needs five references to be eligible. Limits: 10 examples per class, 30 objects per set, and 20 sets. Reference changes invalidate a fitted classifier; press Train again. Import/export applies to the active set.

IndexedDB retains the `instrument-lab` database and `references` store. `sets-v1` holds the sets; `library-v2` is an active-library compatibility key. A first-time installation seeds Set 1 with current references and leaves Set 2 empty. Existing references migrate into Set 1.

`legacy-references.json` exists only to identify and replace the old bundled DPG82/Wiha vectors while keeping user camera samples. The pre-update snapshot is saved at `sets-before-reference-update-v2`. This is a data migration, not another recognition pipeline.

## Current reference data

| Class                                          | References                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| WGGE WG-015 wire stripper                      | Five curated references, including multiple crops of one source photo         |
| DeWalt DPG54-1C Protector clear safety glasses | Two source photos plus three rotated variants                                 |
| Stanley STHT60786 PH2 × 4-inch screwdriver     | Two source photos plus three rotated variants                                 |
| Red Allen-key set                              | Five curated references of Tekton 25142; exact user brand remains unspecified |

These are 20 encoded references, not 20 independent photos. Incorrect-product photos, package shots, advertisements, and unused close-ups are excluded from served assets. `sources.json` records original URLs and hashes; `curation.json` records crops and rotations. The JPEG files are the actual curated model inputs. `library.json` holds vectors/previews; `classifier.json` is the bundled prototype audit artifact.

`diagnostics.json` records reference checks and one withheld WGGE product-photo smoke test. There is no held-out evaluation for the two corrected products and no independent live-camera accuracy benchmark. Correlated catalog photos and rotations do not establish discrimination between similar product models.

## Optional rebuild

From the repository root:

```sh
npm ci
npm run references:download
npm run references:build
```

The downloader fetches only source images consumed by the builder and verifies committed SHA-256 hashes. Originals go to ignored `gate-1a/.cache/references`; uncached model weights require internet access. The builder refreshes served crops, vectors, prototypes, and diagnostics. An external Node dependency directory can also be passed as its first argument. Original image ownership is unchanged; source pages are recorded. Camera photos are local and are not committed.

## Verification and remaining work

`npm test` covers normalization, matching, fitting, exact-product migration, preserved camera references, independent sets, persistence, failed updates, worker shape validation/reuse, mirroring, and threshold coloring. Application-flow tests simulate camera/worker/storage boundaries. `npm run check` checks syntax. The optional reference build exercises the real encoder, independently of unit tests.

Next: collect independent camera sessions with known and similar unknown tools, empty scenes, varied lighting/viewpoints, and recorded wrong labels, rejections, and cold/warm latency. A Gate 1A claim additionally needs the actual surgical class list, surgeon-reviewed evaluation, anatomy/sterile-field tasks, and autonomous proctor interaction.
