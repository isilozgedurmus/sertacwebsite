// TrOCR is trained for handwriting. Inference runs in this worker on the device.
import { pipeline, env } from './vendor/transformers-2.17.2.min.js';
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
let recognizer;
let loading;
let activeId;
async function getRecognizer() {
  if (recognizer) return recognizer;
  if (!loading) loading = pipeline('image-to-text', 'Xenova/trocr-small-handwritten', {
    quantized: true,
    revision: '2432e24d184b1d964d07ed04f5d9e21d31a59141',
    progress_callback: event => {
      if (event.status === 'progress') self.postMessage({ id: activeId, type: 'progress', progress: Math.round(event.progress || 0), file: event.file });
    },
  }).then(value => recognizer = value).catch(error => { loading = null; throw error; });
  return loading;
}
self.onmessage = async ({ data }) => {
  activeId = data.id;
  try {
    self.postMessage({ id: data.id, type: 'loading' });
    const pipe = await getRecognizer();
    self.postMessage({ id: data.id, type: 'recognizing' });
    const output = await pipe(data.image, { max_new_tokens: 32 });
    self.postMessage({ id: data.id, type: 'result', text: output[0]?.generated_text || '' });
  } catch (error) {
    self.postMessage({ id: data.id, type: 'error', message: String(error?.message || error) });
  }
};
