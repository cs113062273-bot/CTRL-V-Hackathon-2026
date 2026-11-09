// Main-thread client for the on-device captioning worker. Results are cached per image URL.

export function createCaptioner({ onStatus = () => {}, proxy = null } = {}) {
  const worker = new Worker(new URL('./caption-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  const cache = new Map();
  let seq = 0;
  let markReady;
  const ready = new Promise(r => { markReady = r; });
  worker.onmessage = ({ data: m }) => {
    if (m.type === 'status') return onStatus(m.text);
    if (m.type === 'ready') return markReady(true);
    if (m.type === 'warmup-error') return markReady(false);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === 'result') p.resolve(m.text); else p.reject(new Error(m.message));
  };
  worker.onerror = e => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Caption worker crashed'));
    pending.clear();
  };
  worker.postMessage({ type: 'warmup' }); // start loading the model as soon as the feature is switched on
  const caption = function caption(url) {
    if (cache.has(url)) return cache.get(url);
    const fetchUrl = proxy && /^https?:/i.test(url) && new URL(url).origin !== location.origin ? new URL('api/image?url=' + encodeURIComponent(url), proxy).href : url;
    const promise = new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'caption', id, url: fetchUrl });
    });
    cache.set(url, promise);
    promise.catch(() => cache.delete(url));
    return promise;
  };
  caption.ready = ready;
  return caption;
}
