---
title: Circuit Reader API
emoji: ⚡
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
license: agpl-3.0
short_description: Reads component values from hand-drawn circuit diagrams
---

# Circuit Reader API

Live backend of [Circuit Reader Studio](https://fogued.github.io/circuit-reader/): a YOLO11m detector finds the
components and the handwritten values, a fine-tuned TrOCR reads each value, and a unit-aware rule attaches it to the
right component.

- Source code, training notebook and metrics: [github.com/Fogued/circuit-reader](https://github.com/Fogued/circuit-reader)
- Weights: [Fogued/circuit-reader-models](https://huggingface.co/Fogued/circuit-reader-models)

| Endpoint | |
| --- | --- |
| `GET /api/health` | model status |
| `POST /api/read` | multipart `file` (PNG, JPEG or WebP, max 10 MB): components, values and links as JSON |
| `GET /api/metrics` | test and validation metrics |

Uploaded images are processed in memory and not stored. This Space is deployed automatically from the GitHub
repository; edit it there, not here.
