// Funções puras, usadas pelo background, pelo content script e pelas opções.
// Testadas em test.js.

// O Instagram serve o mesmo mp4 em pedaços via ?bytestart=&byteend=.
// Tirando esses dois params sobra a URL do arquivo inteiro.
function cleanUrl(u) {
  try {
    const x = new URL(u);
    x.searchParams.delete('bytestart');
    x.searchParams.delete('byteend');
    return x.href;
  } catch (e) {
    return u;
  }
}

// Candidatos ordenados pela proximidade com o instante em que o vídeo começou a tocar.
// ponytail: heurística de tempo; erra quando vários vídeos carregam juntos —
// nesse caso o Shift+D abre a lista pra escolher na mão.
function byProximity(list, t0) {
  const out = list.slice();
  if (!t0) return out.reverse(); // sem carimbo: mais recentes primeiro
  return out.sort((a, b) => Math.abs(a.ts - t0) - Math.abs(b.ts - t0));
}

function pickNearest(list, t0) {
  const sorted = byProximity(list, t0);
  return sorted.length ? sorted[0].url : null;
}

// Um mp4 declara cada faixa num box 'hdlr', cujo tipo é 'soun' (áudio) ou 'vide' (vídeo).
// Esses handlers vivem dentro do 'moov'. Procurar no arquivo inteiro daria falso positivo:
// os bytes do vídeo (o 'mdat') contêm a mesma sequência por acaso o tempo todo.
// Devolve null quando o 'moov' não veio no pedaço lido — aí não dá pra afirmar nada.
function tracksIn(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  const at = s.indexOf('moov');
  if (at < 4) return null;
  // os 4 bytes antes do nome são o tamanho do box, incluindo o cabeçalho de 8
  const size =
    ((bytes[at - 4] << 24) | (bytes[at - 3] << 16) | (bytes[at - 2] << 8) | bytes[at - 1]) >>> 0;
  const moov = s.slice(at, size ? Math.min(s.length, at - 4 + size) : s.length);
  return { audio: moov.indexOf('soun') !== -1, video: moov.indexOf('vide') !== -1 };
}

function nameFor(url) {
  let base = 'video';
  try {
    base = new URL(url).pathname.split('/').pop() || base;
  } catch (e) { /* url estranha, fica no default */ }
  base = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
  if (!base.toLowerCase().endsWith('.mp4')) base += '.mp4';
  return 'instagram/' + base;
}

// "00:01:02.500" ou "01:02.500" -> segundos
function vttTime(s) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(String(s).trim());
  if (!m) return null;
  return +(m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

// WebVTT -> [{ start, end, text }]
function parseVtt(vtt) {
  const cues = [];
  let cur = null;
  for (const raw of String(vtt).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(line)) { cur = null; continue; }
    const arrow = line.indexOf('-->');
    if (arrow !== -1) {
      const start = vttTime(line.slice(0, arrow));
      const end = vttTime(line.slice(arrow + 3).trim().split(/\s+/)[0]);
      cur = start === null || end === null ? null : { start, end, text: '' };
      if (cur) cues.push(cur);
      continue;
    }
    if (/^\d+$/.test(line) || !cur) continue;
    const clean = line.replace(/<[^>]+>/g, '').trim();
    if (clean) cur.text = cur.text ? cur.text + ' ' + clean : clean;
  }
  return cues.filter(c => c.text);
}

// Junta os cues num texto corrido. Legenda automática é rolante: cada cue repete o
// fim do anterior. Então em vez de concatenar, costura pelo maior sufixo/prefixo comum.
function cuesToText(cues) {
  let out = '';
  for (const c of cues) {
    const t = (c.text || '').trim();
    if (!t) continue;
    if (!out) { out = t; continue; }
    let k = Math.min(t.length, out.length);
    while (k > 0 && out.slice(-k) !== t.slice(0, k)) k--;
    out += k ? t.slice(k) : ' ' + t;
  }
  return out.trim();
}

function vttToText(vtt) {
  return cuesToText(parseVtt(vtt));
}

// APIs compatíveis com o endpoint de transcrição da OpenAI.
const PROVIDERS = {
  groq: {
    label: 'Groq (grátis)',
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo'
  },
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1'
  }
};

if (typeof module !== 'undefined') {
  module.exports = {
    cleanUrl, byProximity, pickNearest, nameFor, tracksIn,
    vttTime, parseVtt, cuesToText, vttToText, PROVIDERS
  };
}
