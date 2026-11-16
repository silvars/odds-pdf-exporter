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
  // Procura um link real (<a href>) para a tela de detalhe deste cartão: primeiro verifica se o
  // próprio cabeçalho ou algum ancestral é um link; depois procura dentro do wrapper imediato do
  // cartão (cobre o caso comum de um link transparente sobreposto ao cartão inteiro). Só aceita
  // o link se o href contiver o próprio ID da aposta — evita pegar por engano um link de
  // navegação qualquer (ex.: menu "Esportes" → /betting) que por acaso esteja por perto no DOM.
  function findDetailHref(container, id) {
    const matches = href => !!href && href.includes(id);
    let el = container;
    for (let i = 0; el && i < 10; i++, el = el.parentElement) {
      if (el.tagName === 'A') {
        const href = el.getAttribute('href');
        if (matches(href)) return href;
      }
    }
    const wrap = container.parentElement;
    if (wrap) {
      for (const a of wrap.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href');
        if (matches(href)) return href;
      }
    }
    return null;
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
      if (best) cards.push({
        dateEl: d.el, date: d.date, idEl: best.idInfo.el, id: best.idInfo.id,
        container: best.container, href: findDetailHref(best.container, best.idInfo.id)
      });
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
    await sleep(900);
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
  const hasSize = r => r.width > 0 && r.height > 0;
  // Reconsulta o DOM e localiza de novo o cartão pelo ID. A lista de apostas parece reciclar
  // elementos conforme rola (virtualização): a referência capturada antes de rolar pode ficar
  // "morta" (desconectada) ou passar a representar outro item por quando formos clicar.
  async function relocateCard(id, hintEl) {
    for (let i = 0; i < 5; i++) {
      const found = findBetCards().find(c => c.id === id);
      if (found && hasSize(found.container.getBoundingClientRect())) return found;
      if (hintEl && hintEl.isConnected) hintEl.scrollIntoView({ block: 'center' });
      await sleep(400);
    }
    return null;
  }
  // Tenta abrir a tela de detalhe de um cartão: primeiro clicando em pontos visíveis do cartão
  // (cobre o caso de overlay clicável), depois subindo pelos ancestrais do cabeçalho (cobre o
  // caso de o próprio contêiner ter o onClick).
  async function openDetail(card) {
    const before = location.href;
    const headerR = card.container.getBoundingClientRect();
    const fullEl = card.container.parentElement || card.container;
    const fullR = fullEl.getBoundingClientRect();
    const points = [];
    if (hasSize(headerR)) {
      points.push([headerR.left + 20, headerR.top + headerR.height / 2]);
      points.push([headerR.left + headerR.width / 2, headerR.top + headerR.height / 2]);
    }
    if (hasSize(fullR)) {
      points.push([fullR.left + 20, fullR.top + fullR.height * 0.5]);
      points.push([fullR.left + fullR.width / 2, fullR.top + fullR.height * 0.5]);
      points.push([fullR.left + 20, fullR.top + fullR.height * 0.75]);
    }

    for (const [x, y] of points) {
      if (x <= 0 || y <= 0) continue;
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
      if (same >= 4 && len > 100) return true;
      await sleep(600);
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

  async function backToListByClick() {
    if (!isDetailPage()) return true;
    const btn = findBackButton();
    if (btn) realClick(btn); else history.back();
    let ok = await waitUntil(() => !isDetailPage(), 6000);
    if (!ok) { history.back(); ok = await waitUntil(() => !isDetailPage(), 4000); }
    return ok;
  }

  // ---------- URL direta da aposta ----------
  // Preferência: usar o href real encontrado no HTML do cartão (templateFromHref). Se não houver
  // link no HTML, cai para um template aprendido antes a partir de uma navegação bem-sucedida
  // (guardado fora do estado da busca atual, valendo também para buscas futuras).
  const PLACEHOLDER = '__ID__';
  const getTemplate = () => new Promise(r => chrome.storage.local.get('apostasUrlTemplate', v => r(v.apostasUrlTemplate || null)));
  const setTemplate = tmpl => new Promise(r => chrome.storage.local.set({ apostasUrlTemplate: tmpl }, r));
  function templateFromHref(href, id) {
    const abs = new URL(href, location.href).href;
    const idx = abs.indexOf(id);
    if (idx < 0) return null;
    return abs.slice(0, idx) + PLACEHOLDER + abs.slice(idx + id.length);
  }
  function learnTemplate(id) {
    const idx = location.href.indexOf(id);
    if (idx < 0) return null;
    return location.href.slice(0, idx) + PLACEHOLDER + location.href.slice(idx + id.length);
  }

  function tagFor(id, date) {
    const time = date.hour != null ? `${pad2(date.hour)}:${pad2(date.minute)}` : '';
    return `ID ${id} (${pad2(date.day)}/${pad2(date.month)}/${date.year} ${time})`;
  }

  async function printCurrentDetail(id, date) {
    // espera o conteúdo específico desta aposta aparecer (não só o esqueleto da página,
    // que carrega rápido mas pode ainda estar buscando os dados da aposta via API)
    const idShown = await waitUntil(() => findIdLeaves().some(x => x.id === id), 10000);
    await waitStable(12000);
    if (!idShown) {
      await log(`${tagFor(id, date)}: aviso – ID esperado não apareceu a tempo na tela, seguindo mesmo assim.`);
    }
    const dims = await preparePrint();
    const filename = fileStamp(date, id);
    const res = await chrome.runtime.sendMessage({ type: 'PRINT', filename, ...dims });
    restorePrint();
    if (!res || !res.ok) throw new Error('falha ao gerar PDF: ' + (res && res.error));
    return filename;
  }

  const progress = (i, n) => chrome.runtime.sendMessage({ type: 'PROGRESS', text: n ? `apostas: ${i}/${n}` : '' });

  // Resolve a URL de detalhe de um item da fila: prefere o href real já capturado durante a
  // coleta; cai para o template aprendido (desta busca ou de uma anterior) se precisar.
  async function resolveUrl(item) {
    if (item.href) {
      const abs = new URL(item.href, location.href).href;
      if (abs.includes(item.id)) return abs;
    }
    const tmpl = await getTemplate();
    if (tmpl) {
      const u = tmpl.replace(PLACEHOLDER, item.id);
      if (u.includes(item.id)) return u;
    }
    return null;
  }

  // Clica nesta aposta (ainda na lista) só para descobrir o padrão da URL de detalhe, quando o
  // HTML do cartão não trouxe um link direto. É o único momento em que ainda se clica — acontece
  // no máximo uma vez por busca, durante a coleta, nunca durante o processamento da fila.
  async function bootstrapHref(card) {
    try {
      card.container.scrollIntoView({ block: 'center' });
      await sleep(400);
      const fresh = (await relocateCard(card.id, card.container)) || card;
      const opened = await openDetail(fresh);
      if (!opened) return null;
      await waitStable();
      const learned = learnTemplate(card.id);
      if (learned) { await setTemplate(learned); await log('URL de detalhe identificada; as apostas serão abertas direto por ela.'); }
      return location.href;
    } finally {
      await backToListByClick();
    }
  }

  // Avança pela fila a partir de queueIndex até achar um item navegável (ou ela acabar),
  // navegando direto para a tela de detalhe dele — sem passar pela lista de novo.
  async function goToNextNavigable(fromIndex) {
    let st = await getState();
    let idx = fromIndex;
    while (idx < st.queue.length) {
      const item = st.queue[idx];
      const url = await resolveUrl(item);
      if (url) {
        await setState({ queueIndex: idx });
        location.href = url;
        return;
      }
      await log(`${tagFor(item.id, item.date)}: FALHOU – não foi possível determinar a URL desta aposta.`);
      await setState({ fail: (st.fail || 0) + 1 });
      st = await getState();
      idx++;
    }
    await setState({ queueIndex: idx, running: false });
    await log(`Concluído. OK: ${st.ok || 0}, falhas: ${st.fail || 0}.`);
    progress(0, 0);
  }

  // Fase 2: já estamos (ou deveríamos estar) na tela de detalhe do item st.queueIndex. Imprime e
  // segue direto para o próximo item da fila, sem voltar para a lista entre um e outro.
  async function processQueueItem(st) {
    const item = st.queue[st.queueIndex];
    progress(st.queueIndex + 1, st.queue.length);
    const arrived = await waitUntil(isDetailPage, 10000);
    if (arrived) {
      try {
        const filename = await printCurrentDetail(item.id, item.date);
        await log(`${tagFor(item.id, item.date)}: OK → ${filename}`);
        await setState({ ok: (st.ok || 0) + 1 });
      } catch (e) {
        restorePrint();
        await log(`${tagFor(item.id, item.date)}: FALHOU – ${e.message}`);
        await setState({ fail: (st.fail || 0) + 1 });
      }
    } else {
      await log(`${tagFor(item.id, item.date)}: FALHOU – a navegação direta não abriu a tela de detalhe.`);
      await setState({ fail: (st.fail || 0) + 1 });
    }
    await goToNextNavigable(st.queueIndex + 1);
  }

  // Fase 1: rola a lista inteira uma única vez, juntando todos os IDs/links da data pedida numa
  // fila. Só depois de terminar de coletar é que começa a abrir as telas de detalhe.
  async function collectQueueThenStart(st) {
    if (isDetailPage()) { await backToListByClick(); st = await getState(); }

    const target = st.targetDate;
    const queue = st.queue ? [...st.queue] : [];
    const seen = new Set(queue.map(q => q.id));
    let noGrowth = 0, scans = 0;

    while (st && st.running) {
      let cards = findBetCards();
      scans++;
      if (scans === 1 && cards.length === 0) {
        // a lista pode ainda estar carregando logo após voltar de uma aposta ou recarregar
        await waitUntil(() => findIdLeaves().length > 0, 12000);
        cards = findBetCards();
      }
      if (scans === 1) await log(`${cards.length} cartão(ões) de aposta reconhecido(s) nesta tela.`);

      for (const c of cards) {
        if (!sameDay(c.date, target) || seen.has(c.id)) continue;
        seen.add(c.id);
        let href = c.href;
        if (href) {
          const tmpl = templateFromHref(href, c.id);
          if (tmpl) await setTemplate(tmpl);
        } else if (!(await getTemplate())) {
          href = await bootstrapHref(c);
        }
        queue.push({ id: c.id, date: c.date, href: href || null });
        await setState({ queue });
        await log(`${tagFor(c.id, c.date)}: adicionada à fila (${queue.length} até agora).`);
      }

      const before = findIdLeaves().length;
      await scrollMore();
      const after = findIdLeaves().length;
      noGrowth = after > before ? 0 : noGrowth + 1;

      const oldestLoaded = cards.length ? cards.reduce((a, b) => (dateKey(a.date) < dateKey(b.date) ? a : b)) : null;
      const passedTarget = oldestLoaded && dateKey(oldestLoaded.date) < dateKey(target);

      if (noGrowth >= 6 || (passedTarget && (queue.length > 0 || noGrowth >= 3))) break;
      st = await getState();
      if (!st || !st.running) return;
    }

    if (!queue.length) {
      await setState({ running: false });
      await log('Nenhuma aposta encontrada na data informada.');
      return;
    }
    await log(`${queue.length} aposta(s) encontrada(s) na data informada. Baixando os PDFs…`);
    await setState({ phase: 'process', queue, queueIndex: 0 });
    await goToNextNavigable(0);
  }

  // ---------- laço principal ----------
  async function run() {
    if (window.__oddsApostasRunning) return;
    window.__oddsApostasRunning = true;
    try {
      const st = await getState();
      if (!st || !st.running) return;

      if (st.phase === 'process' && st.queue && st.queueIndex < st.queue.length) {
        await processQueueItem(st);
      } else {
        await collectQueueThenStart(st);
      }
    } finally {
      window.__oddsApostasRunning = false;
    }
  }

  // ---------- mensagens do popup ----------
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'APOSTAS_START') {
      setState({
        running: true, targetDate: msg.targetDate, phase: 'collect', queue: [], queueIndex: 0,
        listUrl: location.href, ok: 0, fail: 0,
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

  // Retoma depois de a página (re)carregar — inclusive quando restaurada do cache de
  // voltar/avançar (bfcache), caso em que o script não é reexecutado do zero, mas o evento
  // "pageshow" dispara mesmo assim.
  window.addEventListener('pageshow', () => {
    getState().then(st => { if (st && st.running) setTimeout(run, 1800); });
  });
})();
