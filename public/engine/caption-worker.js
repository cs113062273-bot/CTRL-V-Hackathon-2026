// Runs Florence-2 (base, fine-tuned) fully in the browser via Transformers.js. No image leaves the device.
import { Florence2ForConditionalGeneration, AutoProcessor, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const MODEL = 'onnx-community/Florence-2-base-ft';
const TASK = '<CAPTION>';
let loading = null;

function status(text) { self.postMessage({ type: 'status', text }); }

async function load() {
  if (loading) return loading;
  loading = (async () => {
    let device = 'wasm';
    try { if (self.navigator?.gpu && await self.navigator.gpu.requestAdapter()) device = 'webgpu'; } catch { /* no WebGPU */ }
    const progress = {};
    const progress_callback = p => {
      if (p.status === 'progress' && p.total) {
        progress[p.file] = [p.loaded, p.total];
        const [l, t] = Object.values(progress).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
        status(`Downloading alt-text model (one time): ${Math.round(l / 1e6)} / ${Math.round(t / 1e6)} MB`);
      }
    };
    const dtype = device === 'webgpu'
      ? { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' }
      : { embed_tokens: 'q8', vision_encoder: 'q8', encoder_model: 'q8', decoder_model_merged: 'q8' };
    let model;
    try {
      model = await Florence2ForConditionalGeneration.from_pretrained(MODEL, { dtype, device, progress_callback });
    } catch (e) {
      if (device !== 'webgpu') throw e;
      device = 'wasm';
      model = await Florence2ForConditionalGeneration.from_pretrained(MODEL, { dtype: { embed_tokens: 'q8', vision_encoder: 'q8', encoder_model: 'q8', decoder_model_merged: 'q8' }, device, progress_callback });
    }
    const processor = await AutoProcessor.from_pretrained(MODEL);
    status(`Alt-text model ready (${device === 'webgpu' ? 'GPU' : 'CPU'})`);
    return { model, processor };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

function clean(text) {
  let t = String(text || '').replace(/<\/?s>|<pad>/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(an? )?(image|picture|photo|photograph) of /i, '');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.replace(/\.$/, '');
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'caption') return;
  try {
    const { model, processor } = await load();
    status('Describing images…');
    const image = await RawImage.fromURL(data.url);
    const prompts = processor.construct_prompts(TASK);
    const textInputs = processor.tokenizer(prompts);
    const visionInputs = await processor(image);
    const ids = await model.generate({ ...textInputs, ...visionInputs, max_new_tokens: 60 });
    const decoded = processor.batch_decode(ids, { skip_special_tokens: false })[0];
    const result = processor.post_process_generation(decoded, TASK, image.size);
    self.postMessage({ type: 'result', id: data.id, text: clean(result[TASK]) });
  } catch (e) {
    self.postMessage({ type: 'error', id: data.id, message: e.message || String(e) });
  }
};
