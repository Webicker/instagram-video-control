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

// Escolhe a URL vista mais perto do instante em que o vídeo começou a tocar.
// ponytail: heurística de tempo; erra quando vários vídeos carregam juntos —
// nesse caso o Shift+D abre a lista pra escolher na mão.
function pickNearest(list, t0) {
  if (!list.length) return null;
  if (!t0) return list[list.length - 1].url;
  return list.reduce((a, b) => (Math.abs(b.ts - t0) < Math.abs(a.ts - t0) ? b : a)).url;
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
  module.exports = { cleanUrl, pickNearest, nameFor, vttTime, parseVtt, cuesToText, vttToText, PROVIDERS };
}
