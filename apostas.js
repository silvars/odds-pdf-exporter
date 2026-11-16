// Roda dentro da página de histórico de apostas (/betting/bets-history ou similar).
// Varre a lista de apostas, filtra pela data informada, abre a tela de detalhe de
// cada uma, salva um PDF e volta para a lista, repetindo até esgotar a lista ou
// a data deixar de aparecer (assume ordem mais recente → mais antiga).
(() => {
  if (window.__oddsApostasLoaded) return;
  window.__oddsApostasLoaded = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- estado (sobrevive a recarregamento de página) ----------
  const getState = () => new Promise(r => chrome.storage.local.get('stApostas', v => r(v.stApostas || null)));
  const setState = patch => new Promise(async r => {
    const cur = (await getState()) || {};
    chrome.storage.local.set({ stApostas: { ...cur, ...patch } }, r);
  });
  async function log(line) {
    const st = (await getState()) || {};
    const lines = (st.log || []).concat(`${new Date().toLocaleTimeString('pt-BR')}  ${line}`).slice(-300);
    await setState({ log: lines });
  }

  const isVisible = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  // ---------- datas em português ("16 de novembro de 2026 às 12:29") ----------
  const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const stripAccents = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function parsePtDateTime(rawText) {
    const t = stripAccents(rawText).trim().toLowerCase();
    // sem âncora de fim: ícones/textos de acessibilidade podem vir colados depois da hora
    const m = t.match(/^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})(?:\s+as\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    const monthIdx = MONTHS.indexOf(m[2]);
    if (monthIdx < 0) return null;
    return {
      day: parseInt(m[1], 10),
      month: monthIdx + 1,
      year: parseInt(m[3], 10),
      hour: m[4] != null ? parseInt(m[4], 10) : null,
      minute: m[5] != null ? parseInt(m[5], 10) : null
    };
  }
  const dateKey = d => d.year * 10000 + d.month * 100 + d.day;
  const sameDay = (a, b) => a.day === b.day && a.month === b.month && a.year === b.year;
  const pad2 = n => String(n).padStart(2, '0');
  const fileStamp = (d, id) => {
    const hh = d.hour != null ? pad2(d.hour) : '00';
    const mm = d.minute != null ? pad2(d.minute) : '00';
    return `${d.year}-${pad2(d.month)}-${pad2(d.day)}_${hh}-${mm}_${id}.pdf`;
  };

  // ---------- encontrar cartões de aposta na lista ----------
  // Testa o textContent inteiro do elemento (não exige nó de texto puro) para também
  // reconhecer textos acompanhados de ícones (ex.: botão de copiar ao lado do ID) e,
  // em seguida, mantém só os elementos "mínimos" (sem descendente que também combine).
  function minimalMatches(testFn, maxLen = 80) {
    const all = [];
    for (const el of document.body.querySelectorAll('*')) {
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > maxLen) continue;
      if (!isVisible(el)) continue;
      if (testFn(txt)) all.push(el);
    }
    return all.filter(el => !all.some(other => other !== el && el.contains(other)));
  }
  function findDateLeaves() {
    return minimalMatches(txt => parsePtDateTime(txt) !== null, 60)
      .map(el => ({ el, date: parsePtDateTime(el.textContent.trim()) }));
  }
  function findIdLeaves() {
    return minimalMatches(txt => /^ID\s+\d+/i.test(txt), 40)
      .map(el => ({ el, id: el.textContent.trim().match(/^ID\s+(\d+)/i)[1] }));
  }
  // Emparelha cada data com o ID mais próximo (menor ancestral comum), formando os cartões da lista.
  function findBetCards() {
    const dateLeaves = findDateLeaves();
    const idLeaves = findIdLeaves();
    const cards = [];
    for (const d of dateLeaves) {
      let best = null, bestDepth = Infinity;
      for (const i of idLeaves) {
        let a = d.el.parentElement, depth = 0;
        for (; a && depth < 10; a = a.parentElement, depth++) {
          if (a.contains(i.el)) {
            if (depth < bestDepth) { best = { idInfo: i, container: a }; bestDepth = depth; }
            break;
          }
        }
      }
      if (best) cards.push({ dateEl: d.el, date: d.date, idEl: best.idInfo.el, id: best.idInfo.id, container: best.container });
    }
    return cards;
  }

  // ---------- tela de detalhe ----------
  function findBackButton() {
    for (const el of document.body.querySelectorAll('button, [role="button"], a')) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t.length <= 20 && t.includes('voltar') && isVisible(el)) return el;
    }
    return null;
  }
  const isDetailPage = () => !!findBackButton();

  // ---------- scroll ----------
  function scrollers() {
    const list = [document.scrollingElement || document.documentElement];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 50) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') list.push(el);
      }
    }
    return list;
  }
  async function scrollAllTo(pos) { // 'top' | 'bottom'
    for (const s of scrollers()) s.scrollTop = pos === 'top' ? 0 : s.scrollHeight;
    await sleep(300);
  }
  async function scrollMore() {
    for (const s of scrollers()) s.scrollTop += Math.max(400, s.clientHeight * 0.8);
    await sleep(600);
  }

  // ---------- cliques ----------
  function realClick(el) {
    const o = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }
  // Clica no elemento que está visualmente por cima de um ponto da tela (como um clique real
  // faria). Necessário porque muitos cartões usam uma camada/link clicável sobreposta a todo o
  // cartão, que não é ancestral do texto da data/ID.
  function clickAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return false;
    realClick(el);
    return true;
  }
  // Tenta abrir a tela de detalhe de um cartão: primeiro clicando em pontos visíveis do cartão
  // (cobre o caso de overlay clicável), depois subindo pelos ancestrais do cabeçalho (cobre o
  // caso de o próprio contêiner ter o onClick).
  async function openDetail(card) {
    const before = location.href;
    const rects = [card.dateEl.getBoundingClientRect(), card.idEl.getBoundingClientRect(), card.container.getBoundingClientRect()];
    const points = rects.map(r => [r.left + Math.min(r.width, 20) / 2, r.top + r.height / 2]);
    const full = card.container.parentElement || card.container;
    const rFull = full.getBoundingClientRect();
    points.push([rFull.left + 20, rFull.top + rFull.height * 0.6]);

    for (const [x, y] of points) {
      if (x < 0 || y < 0) continue;
      if (!clickAt(x, y)) continue;
      const opened = await waitUntil(() => location.href !== before || isDetailPage(), 1500);
      if (opened) return true;
    }

    let el = card.container;
    for (let i = 0; el && el !== document.body && i < 10; i++, el = el.parentElement) {
      realClick(el);
      const opened = await waitUntil(() => location.href !== before || isDetailPage(), 1200);
      if (opened) return true;
    }
    return false;
  }
  async function waitUntil(fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(200);
    }
    return false;
  }
  async function waitStable(maxMs = 15000) {
    const t0 = Date.now();
    let last = -1, same = 0;
    while (Date.now() - t0 < maxMs) {
      const len = document.body.innerText.length;
      same = len === last ? same + 1 : 0;
      last = len;
      if (same >= 3 && len > 100) return true;
      await sleep(500);
    }
    return false;
  }

  // ---------- preparar impressão (mesma técnica usada para os jogos) ----------
  let restoreList = [];
  async function preparePrint() {
    await scrollAllTo('bottom');
    await scrollAllTo('top');
    const style = document.createElement('style');
    style.id = '__odds_pdf_prep_apostas';
    style.textContent = `
      html, body { height: auto !important; overflow: visible !important; }
      * { overflow: visible !important; max-height: none !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    `;
    document.head.appendChild(style);
    restoreList = [];
    for (const el of document.body.querySelectorAll('*')) {
      const p = getComputedStyle(el).position;
      if (p === 'fixed' || p === 'sticky') {
        restoreList.push([el, el.style.getPropertyValue('position'), el.style.getPropertyPriority('position')]);
        el.style.setProperty('position', 'static', 'important');
      }
    }
    window.scrollTo(0, 0);
    await sleep(700);
    const de = document.documentElement;
    let maxBottom = Math.max(de.scrollHeight, document.body.scrollHeight);
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) maxBottom = Math.max(maxBottom, r.bottom + window.scrollY);
    }
    const w = Math.max(window.innerWidth, de.scrollWidth);
    return { w: Math.ceil(w), h: Math.ceil(maxBottom) };
  }
  function restorePrint() {
    document.getElementById('__odds_pdf_prep_apostas')?.remove();
    for (const [el, v, pr] of restoreList) {
      if (v) el.style.setProperty('position', v, pr); else el.style.removeProperty('position');
    }
    restoreList = [];
  }

  async function backToList() {
    if (!isDetailPage()) return true;
    const btn = findBackButton();
    if (btn) realClick(btn); else history.back();
    let ok = await waitUntil(() => !isDetailPage(), 6000);
    if (!ok) { history.back(); ok = await waitUntil(() => !isDetailPage(), 4000); }
    return ok;
  }

  const progress = i => chrome.runtime.sendMessage({ type: 'PROGRESS', text: i ? `apostas: ${i}` : '' });

  // ---------- laço principal ----------
  async function run() {
    if (window.__oddsApostasRunning) return;
    window.__oddsApostasRunning = true;
    try {
      let st = await getState();
      let ok = 0, fail = 0, noGrowth = 0, scans = 0;
      while (st && st.running) {
        if (isDetailPage()) {
          await backToList();
          st = await getState();
          continue;
        }

        const target = st.targetDate;
        const cards = findBetCards();
        scans++;
        if (scans === 1) await log(`${cards.length} cartão(ões) de aposta reconhecido(s) nesta tela.`);
        const processed = new Set(st.processedIds || []);
        const pending = cards.find(c => sameDay(c.date, target) && !processed.has(c.id));

        if (pending) {
          progress(processed.size + 1);
          const tag = `ID ${pending.id} (${pad2(pending.date.day)}/${pad2(pending.date.month)}/${pending.date.year} ${pending.date.hour != null ? pad2(pending.date.hour) + ':' + pad2(pending.date.minute) : ''})`;
          try {
            pending.container.scrollIntoView({ block: 'center' });
            await sleep(300);
            const opened = await openDetail(pending);
            await waitStable();
            if (!opened && !isDetailPage()) throw new Error('clique não abriu a tela de detalhe');

            const dims = await preparePrint();
            const filename = fileStamp(pending.date, pending.id);
            const res = await chrome.runtime.sendMessage({ type: 'PRINT', filename, ...dims });
            restorePrint();
            if (!res || !res.ok) throw new Error('falha ao gerar PDF: ' + (res && res.error));
            await log(`${tag}: OK → ${filename}`);
            ok++;
          } catch (e) {
            restorePrint();
            await log(`${tag}: FALHOU – ${e.message}`);
            fail++;
          }
          processed.add(pending.id);
          await setState({ processedIds: [...processed] });
          await backToList();
          st = await getState();
          await sleep(500);
          continue;
        }

        // nenhuma aposta pendente visível: tenta carregar mais rolando a lista
        const before = findIdLeaves().length;
        await scrollMore();
        const after = findIdLeaves().length;
        noGrowth = after > before ? 0 : noGrowth + 1;

        const oldestLoaded = cards.length ? cards.reduce((a, b) => (dateKey(a.date) < dateKey(b.date) ? a : b)) : null;
        const passedTarget = oldestLoaded && dateKey(oldestLoaded.date) < dateKey(target);

        if (noGrowth >= 4 || (passedTarget && (ok + fail > 0 || noGrowth >= 2))) {
          await setState({ running: false });
          await log(ok + fail > 0
            ? `Concluído. OK: ${ok}, falhas: ${fail}.`
            : `Nenhuma aposta encontrada na data informada.`);
          break;
        }
        st = await getState();
      }
      progress(0);
    } finally {
      window.__oddsApostasRunning = false;
    }
  }

  // ---------- mensagens do popup ----------
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'APOSTAS_START') {
      setState({
        running: true, targetDate: msg.targetDate, processedIds: [],
        log: [`Iniciando busca de apostas em ${pad2(msg.targetDate.day)}/${pad2(msg.targetDate.month)}/${msg.targetDate.year}…`]
      }).then(() => { run(); sendResponse({ ok: true }); });
      return true;
    }
    if (msg.type === 'APOSTAS_STOP') {
      setState({ running: false }).then(() => log('Parado pelo usuário.')).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === 'APOSTAS_PING') { sendResponse({ ok: true, url: location.href }); }
  });

  // retoma depois de recarregar a página
  getState().then(st => { if (st && st.running) setTimeout(run, 1500); });
})();
