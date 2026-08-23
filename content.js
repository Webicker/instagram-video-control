(() => {
  if (window.__igvc) return;
  window.__igvc = true;

  // v2: a chave antiga guardava unmute:false e sobrescrevia o novo padrão com som.
  const P = 'igvc2';
  const prefs = Object.assign(
    { volume: 1, rate: 1, loop: false, unmute: true, collapsed: false, captions: false },
    JSON.parse(localStorage.getItem(P) || '{}')
  );
  const save = () => localStorage.setItem(P, JSON.stringify(prefs));

  const SEEK_STEP = 3; // segundos por seta

  let active = null;
  let dragging = false;
  let soundOk = true; // vira false se o Firefox barrar autoplay com áudio
  let capCues = null;

  const fmt = s =>
    isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';

  // ---------- UI ----------
  // O dock é ancorado pelo rodapé do vídeo (bottom), então a legenda pode crescer pra
  // cima sem precisar remedir altura nenhuma.
  const dock = document.createElement('div');
  dock.id = 'igvc-dock';

  const caps = document.createElement('div');
  caps.id = 'igvc-caps';
  caps.hidden = true;

  const bar = document.createElement('div');
  bar.id = 'igvc-bar';
  bar.hidden = true;
  bar.innerHTML = `
    <button data-a="play" title="Play/Pause (espaço)">&#9654;</button>
    <span id="igvc-time">0:00 / 0:00</span>
    <input id="igvc-seek" type="range" min="0" max="100" step="0.01" value="0" title="Posição (← →, 0-9 pula pra %)">
    <button data-a="mute" title="Mudo (M)">&#128266;</button>
    <input id="igvc-vol" type="range" min="0" max="1" step="0.01" title="Volume (↑ ↓)">
    <select id="igvc-rate" title="Velocidade ([ e ], R volta pra 1x)">
      ${[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
        .map(r => `<option value="${r}">${r}x</option>`)
        .join('')}
    </select>
    <button data-a="caps" title="Legendas (C)">CC</button>
    <button data-a="full" title="Tela cheia (F ou F11)">&#9974;</button>
    <button data-a="menu" title="Mais opções">&#9776;</button>
  `;
  dock.append(caps, bar);

  const menu = document.createElement('div');
  menu.id = 'igvc-menu';
  menu.hidden = true;
  menu.innerHTML = `
    <button data-a="caps">CC Legendas</button>
    <button data-a="link">&#128279; Copiar link do vídeo</button>
    <button data-a="loop">&#128257; Repetir</button>
    <button data-a="dl">&#11015; Baixar vídeo</button>
    <button data-a="dllist">&#9776; Escolher arquivo pra baixar</button>
    <button data-a="txt">&#128221; Transcrever fala do vídeo</button>
    <button data-a="pip">&#9114; Picture-in-picture</button>
    <button data-a="hide">&#10005; Esconder barra</button>
  `;

  const panel = document.createElement('div');
  panel.id = 'igvc-panel';
  panel.hidden = true;
  const ta = document.createElement('textarea');
  ta.readOnly = true;
  const listBox = document.createElement('div');
  listBox.className = 'igvc-list';
  listBox.hidden = true;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'fechar';
  closeBtn.onclick = () => (panel.hidden = true);
  panel.append(ta, listBox, closeBtn);

  const toast = document.createElement('div');
  toast.id = 'igvc-toast';
  toast.hidden = true;
  let toastT;
  const say = m => {
    toast.textContent = m;
    toast.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (toast.hidden = true), 3000);
  };

  const host = document.createElement('div');
  host.id = 'igvc-host';
  host.append(dock, menu, panel, toast);
  document.documentElement.appendChild(host);
  // Em tela cheia só renderiza quem está dentro do elemento fullscreen.
  document.addEventListener('fullscreenchange', () => {
    (document.fullscreenElement || document.documentElement).appendChild(host);
    lastRect = '';
  });

  const $ = s => bar.querySelector(s);
  const seek = $('#igvc-seek');
  const vol = $('#igvc-vol');
  const rate = $('#igvc-rate');
  const timeLbl = $('#igvc-time');
  const playBtn = $('[data-a=play]');
  const muteBtn = $('[data-a=mute]');
  const capsBtn = $('[data-a=caps]');
  vol.value = prefs.volume;
  rate.value = prefs.rate;

  // ---------- posiciona o dock colado no rodapé do vídeo ----------
  // ponytail: fixed + getBoundingClientRect em vez de mover o dock pra dentro do DOM
  // do Instagram — assim nenhum overflow:hidden ou z-index deles corta ele.
  let lastRect = '';
  function place() {
    if (!active || !active.isConnected) {
      dock.classList.add('igvc-off');
      menu.hidden = true;
      return;
    }
    const r = active.getBoundingClientRect();
    const off = r.width < 100 || r.bottom < 40 || r.top > innerHeight - 20;
    dock.classList.toggle('igvc-off', off);
    if (off) {
      menu.hidden = true;
      return;
    }
    const k = `${r.left}|${r.width}|${r.bottom}`;
    if (k === lastRect) return;
    lastRect = k;
    dock.style.left = Math.round(r.left) + 'px';
    dock.style.width = Math.round(r.width) + 'px';
    dock.style.bottom = Math.round(innerHeight - r.bottom) + 'px';
    if (!menu.hidden) placeMenu();
  }
  function placeMenu() {
    const r = bar.getBoundingClientRect();
    menu.style.left =
      Math.round(Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))) + 'px';
    menu.style.top = Math.round(Math.max(8, r.top - menu.offsetHeight - 6)) + 'px';
  }
  let lastPick = 0;
  (function frame(ts) {
    place();
    if (ts - lastPick > 200) { lastPick = ts; pick(); }
    requestAnimationFrame(frame);
  })(0);

  // ---------- vídeo ----------
  // O Instagram reseta velocidade e mudo a cada vídeo novo; devolve o que ficou salvo.
  function enforce(v) {
    if (v.playbackRate !== prefs.rate) v.playbackRate = prefs.rate;
    if (Math.abs(v.volume - prefs.volume) > 0.001) v.volume = prefs.volume;
    v.loop = prefs.loop;
    if (soundOk && v.muted === prefs.unmute) {
      v.muted = !prefs.unmute;
      if (!v.muted) v.__unmutedAt = Date.now();
    }
  }

  // Um único vídeo manda por vez: o maior/mais visível na tela.
  // ponytail: medido na hora com getBoundingClientRect em vez de IntersectionObserver —
  // o observer só avisa ao cruzar um threshold, e é aí que a home deixava vídeo tocando
  // sem nenhum evento pra reagir. O laço de rAF já roda de qualquer jeito.
  const videos = new Set();

  const visRatio = r => {
    if (!r.width || !r.height) return 0;
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return (w * h) / (r.width * r.height);
  };

  // Pausa que veio da extensão, não do usuário: não marca __userPaused.
  function autoPause(v) {
    v.__auto = true;
    v.pause();
  }

  function pick() {
    const vis = new Map();
    let winner = null;
    let top = 0;

    for (const v of videos) {
      if (!v.isConnected) { videos.delete(v); continue; }
      const r = v.getBoundingClientRect();
      const ratio = visRatio(r);
      vis.set(v, ratio);
      // ignora miniatura de grade: precisa ocupar um naco real da janela
      if (r.width < 150 || (r.width * r.height) / (innerWidth * innerHeight) < 0.08) continue;
      // o ativo leva um bônus pra não ficar trocando de vencedor no meio do scroll
      const score = ratio * r.width * r.height * (v === active ? 1.25 : 1);
      if (ratio >= 0.35 && score > top) { top = score; winner = v; }
    }

    // Quem não é o vencedor para. É isso que faltava na home: o Instagram não pausa
    // vídeo que ele mesmo não iniciou.
    for (const [v, ratio] of vis) {
      if (v !== winner && !v.paused) autoPause(v);
      if (ratio < 0.2) v.__userPaused = false;
    }

    if (!winner) return;
    setActive(winner);
    if (vis.get(winner) >= 0.6 && winner.paused && !winner.ended && !winner.__userPaused) {
      winner.play().catch(() => {});
    }
  }

  function adopt(v) {
    if (v.__igvc) return;
    v.__igvc = true;
    v.addEventListener('ratechange', () => enforce(v));
    v.addEventListener('volumechange', () => enforce(v));
    v.addEventListener('play', () => (v.__userPaused = false));
    v.addEventListener('playing', () => {
      v.__t0 = Date.now();
      enforce(v);
    });
    v.addEventListener('pause', () => {
      // Antes de tudo: pausa nossa (saiu da tela) não conta como escolha do usuário
      // nem dispara o resgate de autoplay abaixo.
      if (v.__auto) { v.__auto = false; return; }
      if (v.ended) return;
      // O Firefox pausa o vídeo se tirarmos o mudo antes do site ter permissão de
      // autoplay com áudio. Se foi isso, volta a tocar; se nem assim, desiste do som
      // até o próximo clique do usuário.
      if (Date.now() - (v.__unmutedAt || 0) <= 800) {
        v.play().catch(() => {
          soundOk = false;
          v.muted = true;
          v.play().catch(() => {});
        });
        return;
      }
      v.__userPaused = true; // pause de verdade: não insistir
    });
    videos.add(v);
    enforce(v);
  }

  function setActive(v) {
    if (active === v) return;
    active = v;
    lastRect = '';
    capCues = null;
    caps.hidden = true;
    bar.hidden = prefs.collapsed;
    enforce(v);
    sync();
    // Legenda ligada só busca as fontes de graça ao trocar de vídeo — chamar a API
    // sozinha a cada scroll queimaria a cota sem você pedir.
    if (prefs.captions) loadCaps(v, false);
  }

  function paintSeek(value, max) {
    const p = max ? (Math.min(value, max) / max) * 100 : 0;
    let b = p;
    if (active) {
      try {
        const bf = active.buffered;
        if (bf.length && max) b = (bf.end(bf.length - 1) / max) * 100;
      } catch (e) { /* buffered indisponível em stream ao vivo */ }
    }
    seek.style.setProperty('--p', p.toFixed(2) + '%');
    seek.style.setProperty('--b', Math.min(100, Math.max(p, b)).toFixed(2) + '%');
  }

  const setHTML = (el, html) => { if (el.innerHTML !== html) el.innerHTML = html; };

  function renderCaps() {
    if (!prefs.captions || !capCues || !active) {
      if (!caps.hidden) caps.hidden = true;
      return;
    }
    const t = active.currentTime;
    const cue = capCues.find(c => t >= c.start && t <= c.end);
    const txt = cue ? cue.text : '';
    if (caps.textContent !== txt) caps.textContent = txt;
    caps.hidden = !txt;
  }

  function sync() {
    if (!active) return;
    setHTML(playBtn, active.paused ? '&#9654;' : '&#10074;&#10074;');
    setHTML(muteBtn, active.muted || !active.volume ? '&#128263;' : '&#128266;');
    capsBtn.classList.toggle('on', !!prefs.captions);
    vol.style.setProperty('--p', Math.round(vol.value * 100) + '%');
    renderCaps();
    if (dragging) return;
    const d = active.duration || 0;
    seek.max = d || 100;
    seek.value = active.currentTime;
    timeLbl.textContent = `${fmt(active.currentTime)} / ${fmt(d)}`;
    paintSeek(active.currentTime, d);
  }

  // Eventos de mídia não sobem, mas passam pela fase de captura.
  const cap = (type, fn) =>
    document.addEventListener(type, e => e.target.tagName === 'VIDEO' && fn(e.target), true);

  cap('loadedmetadata', adopt);
  cap('play', v => { adopt(v); pick(); });
  cap('timeupdate', v => { adopt(v); if (v === active) sync(); });
  cap('pause', v => v === active && sync());
  cap('volumechange', v => { if (v === active) { vol.value = v.volume; sync(); } });

  setInterval(() => {
    if (active && !active.isConnected) {
      active = null;
      bar.hidden = true;
      caps.hidden = true;
      menu.hidden = true;
    }
  }, 2000);

  // ---------- controles ----------
  const setVol = x => {
    prefs.volume = Math.min(1, Math.max(0, x));
    prefs.unmute = prefs.volume > 0;
    save();
    if (active) { active.volume = prefs.volume; active.muted = prefs.volume === 0; }
    vol.value = prefs.volume;
    sync();
  };

  const setRate = r => {
    prefs.rate = Math.min(16, Math.max(0.0625, Math.round(r * 100) / 100));
    save();
    rate.value = prefs.rate;
    if (active) active.playbackRate = prefs.rate;
    say(`Velocidade ${prefs.rate}x`);
  };

  seek.addEventListener('input', () => {
    dragging = true;
    const d = (active && active.duration) || 0;
    timeLbl.textContent = `${fmt(+seek.value)} / ${fmt(d)}`;
    paintSeek(+seek.value, +seek.max);
  });
  seek.addEventListener('change', () => {
    dragging = false;
    if (active) active.currentTime = +seek.value;
  });
  vol.addEventListener('input', () => setVol(+vol.value));
  rate.addEventListener('change', () => setRate(+rate.value));

  // ---------- download ----------
  async function download(choose) {
    if (choose) return showList(await browser.runtime.sendMessage({ type: 'list' }));
    say('Procurando o arquivo…');
    const r = await browser.runtime.sendMessage({
      type: 'download',
      src: active && active.currentSrc,
      t0: active && active.__t0
    });
    say(r && r.ok ? 'Baixando…' : (r && r.error) || 'Falhou');
  }

  function showList(urls) {
    if (!urls || !urls.length) return say('Nenhum .mp4 capturado nesta aba ainda.');
    ta.hidden = true;
    listBox.hidden = false;
    listBox.textContent = '';
    urls.slice(0, 15).forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'igvc-cand';
      b.textContent = `${i + 1}. ${(u.split('?')[0].split('/').pop() || u).slice(0, 60)}`;
      b.title = u;
      b.onclick = async () => {
        const r = await browser.runtime.sendMessage({ type: 'download', url: u });
        say(r && r.ok ? 'Baixando…' : (r && r.error) || 'Falhou');
      };
      listBox.append(b);
    });
    panel.hidden = false;
  }

  const showText = t => {
    listBox.hidden = true;
    ta.hidden = false;
    ta.value = t;
    panel.hidden = false;
    ta.select();
  };

  // ---------- link do post ----------
  function postLink(v) {
    if (/^\/(p|reel|reels|tv)\//.test(location.pathname)) {
      return location.origin + location.pathname;
    }
    const box = v.closest('article') || v.parentElement;
    const a = box && box.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
    return a
      ? new URL(a.getAttribute('href'), location.origin).href
      : location.href.split('?')[0];
  }

  function copyLink() {
    const url = postLink(active);
    navigator.clipboard.writeText(url).then(
      () => say('Link copiado'),
      () => showText(url)
    );
  }

  // ---------- legendas / transcrição ----------
  // Uma fonte só de cues alimenta as duas features: legenda na tela e texto copiado.
  const cueCache = new Map();
  const remember = (k, val) => {
    cueCache.set(k, val);
    if (cueCache.size > 20) cueCache.delete(cueCache.keys().next().value);
    return val;
  };

  async function getCues(v, allowApi) {
    const key = v.currentSrc || v.src || 'x';
    if (cueCache.has(key)) return cueCache.get(key);

    // 1) faixa embutida no próprio <video> (mode hidden: quem desenha somos nós)
    for (const tt of v.textTracks) if (tt.mode === 'disabled') tt.mode = 'hidden';
    await new Promise(r => setTimeout(r, 400));
    for (const tt of v.textTracks) {
      if (!tt.cues || !tt.cues.length) continue;
      const cues = [...tt.cues]
        .map(c => ({
          start: c.startTime,
          end: c.endTime,
          text: String(c.text).replace(/<[^>]+>/g, '').trim()
        }))
        .filter(c => c.text);
      if (cues.length) {
        return remember(key, { ok: true, cues, text: cuesToText(cues), source: 'legenda embutida no vídeo' });
      }
    }

    // 2) .vtt que o Instagram baixou nesta aba
    const s = await browser.runtime.sendMessage({ type: 'subs' });
    if (s && s.ok) return remember(key, s);

    if (!allowApi) return { ok: false, quiet: true };

    // 3) Whisper
    const r = await browser.runtime.sendMessage({
      type: 'transcribe',
      src: v.currentSrc,
      t0: v.__t0
    });
    if (r && r.ok) return remember(key, r);
    return r || { ok: false, error: 'sem resposta do background' };
  }

  async function loadCaps(v, allowApi) {
    const r = await getCues(v, allowApi);
    if (v !== active) return r; // rolou pra outro vídeo enquanto carregava
    capCues = r && r.ok ? r.cues : null;
    if (!capCues) caps.hidden = true;
    return r;
  }

  const keyHelp = () =>
    showText(
      'Este vídeo não tem legenda pronta, então a fala precisa ser transcrita por uma API.\n\n' +
        'Configure uma vez em:\n' +
        '  about:addons → Instagram Video Control → Preferências\n\n' +
        'A do Groq é gratuita: https://console.groq.com/keys\n\n' +
        'Sem chave, só funciona em vídeo que já vem com legenda.'
    );

  async function toggleCaptions() {
    if (prefs.captions) {
      prefs.captions = false;
      save();
      capCues = null;
      caps.hidden = true;
      sync();
      return say('Legendas desligadas');
    }
    prefs.captions = true;
    save();
    sync();
    say('Procurando legendas…');
    const r = await loadCaps(active, true);
    if (r && r.ok) return say('Legendas: ' + r.source);
    prefs.captions = false;
    save();
    sync();
    if (r && r.needsKey) { say('Falta configurar a chave'); return keyHelp(); }
    say((r && r.error) || 'Este vídeo não tem legenda disponível.');
  }

  function finishText(text, source) {
    showText(`[${source}]\n\n${text}`);
    navigator.clipboard.writeText(text).then(
      () => say('Texto copiado'),
      () => say('Texto extraído — copie do painel')
    );
  }

  async function grabText() {
    say('Procurando transcrição…');
    const r = await getCues(active, true);
    if (r && r.ok) return finishText(r.text || cuesToText(r.cues), r.source);
    if (r && r.needsKey) { say('Falta configurar a chave'); return keyHelp(); }
    say('Falhou');
    showText('Não consegui transcrever.\n\n' + ((r && r.error) || 'erro desconhecido'));
  }

  // ---------- ações ----------
  function openMenu() {
    setHTML(
      menu.querySelector('[data-a=caps]'),
      'CC Legendas: ' + (prefs.captions ? 'ligadas' : 'desligadas')
    );
    setHTML(menu.querySelector('[data-a=loop]'), '&#128257; Repetir' + (prefs.loop ? ' &#10003;' : ''));
    menu.hidden = false;
    placeMenu();
  }

  const goFull = () => {
    lastRect = '';
    return document.fullscreenElement
      ? document.exitFullscreen()
      : (active.parentElement || active)
          .requestFullscreen()
          .catch(e => say('Tela cheia: ' + e.message));
  };

  const actions = {
    play: () => (active.paused ? active.play() : active.pause()),
    mute: () => {
      active.muted = !active.muted;
      prefs.unmute = !active.muted;
      save();
    },
    loop: () => { prefs.loop = !prefs.loop; save(); if (active) active.loop = prefs.loop; },
    caps: toggleCaptions,
    link: copyLink,
    pip: () =>
      active.requestPictureInPicture
        ? active.requestPictureInPicture().catch(e => say('PiP: ' + e.message))
        : say('Firefox: use Ctrl+Shift+] para o picture-in-picture nativo'),
    full: goFull,
    dl: e => download(!!(e && e.shiftKey)),
    dllist: () => download(true),
    txt: grabText,
    menu: () => (menu.hidden ? openMenu() : (menu.hidden = true)),
    hide: () => {
      prefs.collapsed = true;
      save();
      bar.hidden = true;
      menu.hidden = true;
      say('Barra escondida — tecla B traz de volta');
    }
  };

  const run = (a, e, fromMenu) => {
    if (a === 'hide' || a === 'menu') return actions[a](e);
    if (!active) return say('Nenhum vídeo tocando ainda');
    actions[a](e);
    if (fromMenu && a !== 'loop' && a !== 'caps') menu.hidden = true;
    sync();
  };

  bar.addEventListener('click', e => {
    e.stopPropagation();
    const el = e.target.closest('[data-a]');
    if (!el) return;
    e.preventDefault();
    run(el.dataset.a, e, false);
  });
  menu.addEventListener('click', e => {
    e.stopPropagation();
    const el = e.target.closest('[data-a]');
    if (!el) return;
    e.preventDefault();
    const a = el.dataset.a;
    run(a, e, true);
    if (a === 'loop' || a === 'caps') openMenu();
  });
  // A barra fica em cima do vídeo: não deixa o clique virar pause/like do Instagram.
  ['pointerdown', 'mousedown', 'touchstart', 'dblclick'].forEach(t => {
    bar.addEventListener(t, e => e.stopPropagation());
    menu.addEventListener(t, e => e.stopPropagation());
  });
  panel.addEventListener('click', e => e.stopPropagation());

  // ---------- teclado ----------
  const editable = el =>
    el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // Clique do usuário devolve a permissão de autoplay com áudio.
  addEventListener(
    'pointerdown',
    e => {
      soundOk = true;
      if (!menu.hidden && !menu.contains(e.target) && !bar.contains(e.target)) menu.hidden = true;
    },
    true
  );

  addEventListener(
    'keydown',
    e => {
      soundOk = true;

      // Esc sai em cascata: menu -> painel -> tela cheia -> pausa o vídeo.
      // A saída da tela cheia fica com o próprio Firefox, então aqui não cancelamos.
      if (e.key === 'Escape') {
        if (!menu.hidden) { menu.hidden = true; e.stopPropagation(); return; }
        if (!panel.hidden) { panel.hidden = true; e.stopPropagation(); return; }
        if (document.fullscreenElement) return;
        if (active && !active.paused) { active.pause(); sync(); e.stopPropagation(); }
        return;
      }

      if (editable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'b' || e.key === 'B') {
        prefs.collapsed = false;
        save();
        if (active) bar.hidden = false;
        return;
      }
      if (!active) return;

      if (/^[0-9]$/.test(e.key)) {
        active.currentTime = (active.duration || 0) * (+e.key / 10);
        e.preventDefault();
        e.stopPropagation();
        return sync();
      }

      const map = {
        ' ': actions.play,
        ArrowRight: () => (active.currentTime += SEEK_STEP),
        ArrowLeft: () => (active.currentTime -= SEEK_STEP),
        ArrowUp: () => setVol(active.volume + 0.05),
        ArrowDown: () => setVol(active.volume - 0.05),
        ']': () => setRate(prefs.rate + 0.25),
        '[': () => setRate(prefs.rate - 0.25),
        '.': () => setRate(prefs.rate + 0.25),
        ',': () => setRate(prefs.rate - 0.25),
        F11: goFull,
        m: actions.mute, M: actions.mute,
        c: actions.caps, C: actions.caps,
        l: actions.loop, L: actions.loop,
        f: goFull, F: goFull,
        p: actions.pip, P: actions.pip,
        t: actions.txt, T: actions.txt,
        r: () => setRate(1), R: () => setRate(1),
        d: () => download(false),
        D: () => download(true)
      };
      const fn = map[e.key];
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      fn();
      sync();
    },
    true
  );
})();
