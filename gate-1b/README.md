# Gate 1B — Procedural Step Understanding

## Required evaluation

Under §7.3.1.2, an IV&V surgeon proctor presents a clinical scenario and verbally asks about workflow planning, next steps, instruments, pathological indicators, risks, and related knowledge. Scoring considers correctness and response time. A list of potential procedures will be provided. The Medical Knowledge Gate requires complete system autonomy.

## Current state

No Gate 1B implementation is present. The earlier scripted workflow demo was removed rather than presented as autonomous clinical reasoning. The DINOv2 prototype in `../gate-1a` classifies images; it does not answer procedural questions.

## Future implementation boundary

- Scenario/procedure context, including uncertain or missing information.
- Spoken proctor question intake and autonomous answer delivery.
- Procedure-grounded reasoning about sequence, instruments, findings, and risks.
- Timestamps and evidence logs for correctness and latency evaluation.
- A surgeon-reviewed question set, scoring rubric, and independent test split.

Keep future code and tests here. Introduce shared packages only when both gates need them. Physical tool manipulation and simulator control belong to the separate Physical Capability Gate (§7.3.2).
