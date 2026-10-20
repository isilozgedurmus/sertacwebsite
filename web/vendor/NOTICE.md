# Client handwriting recognition

- Transformers.js v2.17.2, Hugging Face / Xenova. Apache License 2.0.
  Source: https://github.com/huggingface/transformers.js/tree/2.17.2
  Distribution: https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js
- ONNX Runtime Web, Microsoft. MIT License. Included in the Transformers.js distribution; runtime WASM files use the same pinned distribution.
  https://github.com/microsoft/onnxruntime/blob/main/LICENSE
- TrOCR small handwritten ONNX conversion by Xenova, original model by Microsoft (TrOCR / UniLM). See the upstream model card and project license.
  https://huggingface.co/Xenova/trocr-small-handwritten
  https://huggingface.co/microsoft/trocr-small-handwritten

The model files are downloaded directly into the browser cache, not included in this deployment. The distribution includes the upstream library licenses. See the accompanying LICENSE files for full terms.
