// node test.js
const assert = require('assert');
const {
  cleanUrl, byProximity, pickNearest, nameFor, tracksIn,
  vttTime, parseVtt, cuesToText, vttToText, PROVIDERS
} = require('./lib.js');

// tira só bytestart/byteend, preserva o resto da query (a URL é assinada)
assert.strictEqual(
  cleanUrl('https://scontent.cdninstagram.com/v/abc.mp4?oh=1&bytestart=0&byteend=999'),
  'https://scontent.cdninstagram.com/v/abc.mp4?oh=1'
);
assert.strictEqual(cleanUrl('nao-e-url'), 'nao-e-url');

const list = [{ url: 'a', ts: 100 }, { url: 'b', ts: 900 }];
assert.strictEqual(pickNearest([], 500), null);
assert.strictEqual(pickNearest(list, 1000), 'b');
assert.strictEqual(pickNearest(list, 200), 'a');
assert.strictEqual(pickNearest(list, null), 'b'); // sem t0 -> mais recente

assert.deepStrictEqual(byProximity(list, 200).map(x => x.url), ['a', 'b']);
assert.deepStrictEqual(byProximity(list, null).map(x => x.url), ['b', 'a']);
assert.deepStrictEqual(list.map(x => x.url), ['a', 'b']); // não mexe no original

assert.strictEqual(nameFor('https://x.com/a/b/1234_n.mp4?oh=1'), 'instagram/1234_n.mp4');
assert.strictEqual(nameFor('https://x.com/a/seg?oh=1'), 'instagram/seg.mp4');

// --- faixas dentro do mp4 ---
const box = (type, payload) => {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(8 + payload.length, 0);
  b.write(type, 4, 'latin1');
  payload.copy(b, 8);
  return b;
};
const ftyp = box('ftyp', Buffer.from('isom', 'latin1'));
const mp4 = (moovPayload, mdatPayload) =>
  Buffer.concat([
    ftyp,
    box('moov', Buffer.from(moovPayload, 'latin1')),
    box('mdat', Buffer.from(mdatPayload, 'latin1'))
  ]);

assert.deepStrictEqual(
  tracksIn(mp4('....hdlrsoun....hdlrvide', 'lixo')),
  { audio: true, video: true }
);

// o caso que justifica a leitura do box: 'soun' solto no mdat nao e faixa de audio
assert.deepStrictEqual(
  tracksIn(mp4('....hdlrvide', 'xxsounxx')),
  { audio: false, video: true }
);

// sem moov no pedaco lido nao da pra afirmar nada
assert.strictEqual(tracksIn(Buffer.concat([ftyp, box('mdat', Buffer.from('sounvide'))])), null);

// tempos: com e sem hora, vírgula ou ponto
assert.strictEqual(vttTime('00:00:02.500'), 2.5);
assert.strictEqual(vttTime('01:02.250'), 62.25);
assert.strictEqual(vttTime('01:00:00,000'), 3600);
assert.strictEqual(vttTime('lixo'), null);

const vtt = [
  'WEBVTT',
  '',
  '1',
  '00:00:00.000 --> 00:00:02.000 align:start',
  'Olá <b>pessoal</b>',
  '',
  '2',
  '00:00:02.000 --> 00:00:04.000',
  'Olá pessoal',
  'tudo bem?',
  ''
].join('\n');

const cues = parseVtt(vtt);
assert.strictEqual(cues.length, 2);
assert.deepStrictEqual(cues[0], { start: 0, end: 2, text: 'Olá pessoal' }); // tag removida
assert.strictEqual(cues[1].text, 'Olá pessoal tudo bem?'); // linhas do mesmo cue juntas
assert.strictEqual(cues[1].end, 4); // "align:start" não vira parte do tempo

// legenda rolante: costura pelo trecho repetido em vez de concatenar
assert.strictEqual(vttToText(vtt), 'Olá pessoal tudo bem?');
assert.strictEqual(cuesToText([{ text: 'a b' }, { text: 'a b' }]), 'a b'); // repetição exata
assert.strictEqual(cuesToText([{ text: 'um' }, { text: 'dois' }]), 'um dois'); // sem overlap
assert.strictEqual(cuesToText([]), '');
assert.strictEqual(vttToText('WEBVTT\n\n'), '');

// todo provider precisa de url e modelo padrão, senão a transcrição quebra sem aviso
for (const [id, p] of Object.entries(PROVIDERS)) {
  assert.ok(p.url.startsWith('https://'), `${id}: url`);
  assert.ok(p.model && p.label, `${id}: model/label`);
}

console.log('ok');
