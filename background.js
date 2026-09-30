// Vídeo do Instagram roda em blob:/MSE, então a URL do <video> não serve nem pra baixar
// nem pra transcrever. Solução: escutar as requisições da CDN e guardar as URLs por aba.

const seen = new Map(); // tabId -> [{ url, ts }]  (.mp4)
const subs = new Map(); // tabId -> [url]          (.vtt)

const remember = (map, tabId, item, cap) => {
  const list = map.get(tabId) || [];
  const key = item.url || item;
  if (!list.some(x => (x.url || x) === key)) list.push(item);
  map.set(tabId, list.slice(-cap));
};

browser.webRequest.onBeforeRequest.addListener(
  d => {
    if (d.tabId < 0) return;
    if (d.url.indexOf('.vtt') !== -1) return remember(subs, d.tabId, cleanUrl(d.url), 10);
    if (d.url.indexOf('.mp4') !== -1) remember(seen, d.tabId, { url: cleanUrl(d.url), ts: Date.now() }, 40);
  },
  { urls: ['*://*.cdninstagram.com/*', '*://*.fbcdn.net/*'] }
);

browser.tabs.onRemoved.addListener(id => {
  seen.delete(id);
  subs.delete(id);
});

function videoUrl(tabId, msg) {
  const direct = /^https?:/.test(msg.src || '') ? cleanUrl(msg.src) : null;
  return msg.url || direct || pickNearest(seen.get(tabId) || [], msg.t0);
}

// ---------- que faixas cada candidato tem ----------
// Em alta resolução o Instagram serve vídeo e áudio em arquivos separados. Sem olhar
// dentro do arquivo, a heurística de tempo pode escolher a faixa muda. O cabeçalho do
// mp4 diz o que tem lá — e ele cabe nos primeiros KB.

const PROBE_BYTES = 262144;
const probes = new Map(); // url -> { audio, video } | null

// Lê só o começo do arquivo. O Range resolve no caso normal; o leitor com cancelamento
// cobre o servidor que ignora Range e começa a mandar o vídeo inteiro.
async function head(url) {
  const r = await fetch(url, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` } });
  if (!r.ok || !r.body) return null;
  const reader = r.body.getReader();
  const parts = [];
  let n = 0;
  try {
    while (n < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      n += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ponytail: só o início do arquivo. Vídeo do Instagram é faststart (moov na frente);
// se algum dia aparecer um com moov no fim, isto devolve null e cai no palpite antigo.
async function probe(url) {
  if (probes.has(url)) return probes.get(url);
  let result = null;
  try {
    const bytes = await head(url);
    if (bytes) result = tracksIn(bytes);
  } catch (e) { /* rede falhou: segue como desconhecido */ }
  probes.set(url, result);
  if (probes.size > 60) probes.delete(probes.keys().next().value);
  return result;
}

// Prefere o candidato que tem vídeo E áudio. Escolha manual do usuário passa direto.
async function bestUrl(tabId, msg) {
  if (msg.url) return cleanUrl(msg.url);
  const direct = /^https?:/.test(msg.src || '') ? cleanUrl(msg.src) : null;
  if (direct) return direct;

  const list = byProximity(seen.get(tabId) || [], msg.t0).slice(0, 6);
  if (!list.length) return null;
  for (const c of list) {
    const t = await probe(c.url);
    if (t && t.audio && t.video) return c.url;
  }
  return list[0].url; // nenhum completo: devolve o palpite por tempo
}

// Degrau 2 (grátis): o Instagram já baixou um .vtt nesta aba?
async function fromSubtitles(tabId) {
  for (const url of (subs.get(tabId) || []).slice().reverse()) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const cues = parseVtt(await r.text());
      if (cues.length) return { ok: true, cues, text: cuesToText(cues), source: 'legenda do Instagram' };
    } catch (e) { /* tenta o próximo */ }
  }
  return { ok: false };
}

// Degrau 3: manda o mp4 pro Whisper. A API aceita mp4 direto e separa o áudio sozinha,
// então não precisa de ffmpeg nem MediaRecorder. verbose_json traz os tempos, que é o
// que faz a mesma chamada servir pra transcrição e pra legenda.
async function transcribe(tabId, msg) {
  const cfg = await browser.storage.local.get(['provider', 'key', 'model', 'language']);
  if (!cfg.key) return { ok: false, needsKey: true };
  const prov = PROVIDERS[cfg.provider] || PROVIDERS.groq;

  const url = videoUrl(tabId, msg);
  if (!url) return { ok: false, error: 'Não achei o arquivo do vídeo — dê play e tente de novo.' };

  const res = await fetch(url);
  if (!res.ok) return { ok: false, error: `Falha ao baixar o vídeo (HTTP ${res.status}).` };
  const blob = await res.blob();
  const mb = blob.size / 1048576;
  if (mb > 24) return { ok: false, error: `Vídeo de ${mb.toFixed(1)} MB — o limite da API é 25 MB.` };

  const fd = new FormData();
  fd.append('file', blob, 'video.mp4');
  fd.append('model', cfg.model || prov.model);
  fd.append('response_format', 'verbose_json');
  if (cfg.language) fd.append('language', cfg.language);

  const api = await fetch(prov.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.key },
    body: fd
  });
  const body = await api.text();
  if (!api.ok) return { ok: false, error: `${prov.label} respondeu ${api.status}: ${body.slice(0, 300)}` };

  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    data = { text: body };
  }
  const cues = (data.segments || [])
    .map(s => ({ start: +s.start, end: +s.end, text: String(s.text || '').trim() }))
    .filter(c => c.text && isFinite(c.start) && isFinite(c.end));
  const text = String(data.text || cuesToText(cues)).trim();
  if (!text) return { ok: false, error: 'A API não devolveu texto (vídeo sem fala?).' };
  return { ok: true, cues, text, source: `Whisper via ${prov.label}` };
}

async function handle(msg, tabId) {
  if (msg.type === 'list') {
    const list = byProximity(seen.get(tabId) || [], msg.t0).slice(0, 8);
    return Promise.all(list.map(async c => ({ url: c.url, tracks: await probe(c.url) })));
  }
  if (msg.type === 'subs') return fromSubtitles(tabId);
  if (msg.type === 'transcribe') {
    try {
      return await transcribe(tabId, msg);
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }
  if (msg.type !== 'download') return;

  const url = await bestUrl(tabId, msg);
  if (!url) {
    return { ok: false, error: 'Nenhum .mp4 capturado nesta aba ainda — dê play no vídeo e tente de novo.' };
  }
  try {
    await browser.downloads.download({ url, filename: nameFor(url), saveAs: false });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

browser.runtime.onMessage.addListener((msg, sender) => handle(msg, sender.tab && sender.tab.id));
