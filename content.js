// Roda dentro da página de apostas. Percorre a lista, abre cada jogo, expande os
// mercados e pede ao background para salvar o PDF.
(() => {
  if (window.__oddsPdfLoaded) return;
  window.__oddsPdfLoaded = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- estado (sobrevive a recarregamento de página) ----------
  const getState = () => new Promise(r => chrome.storage.local.get('st', v => r(v.st || null)));
  const setState = patch => new Promise(async r => {
    const cur = (await getState()) || {};
    chrome.storage.local.set({ st: { ...cur, ...patch } }, r);
  });
  async function log(line) {
    const st = (await getState()) || {};
    const lines = (st.log || []).concat(`${new Date().toLocaleTimeString('pt-BR')}  ${line}`).slice(-300);
    await setState({ log: lines });
  }

  // ---------- nomes de times ----------
  const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '').replace(/feroe/g, 'faroe');

  function lev(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function sameTeam(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const L = Math.max(a.length, b.length);
    return lev(a, b) <= (L >= 12 ? 2 : 1);
  }

  const isVisible = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  function leavesFor(team) {
    const t = norm(team);
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.children.length) continue;
      const txt = (el.textContent || '').trim();
      if (txt.length < 2 || txt.length > 40) continue;
      if (sameTeam(norm(txt), t) && isVisible(el)) out.push(el);
    }
    return out;
  }

  function findRow(item) {
    const homes = leavesFor(item.home), aways = leavesFor(item.away);
    for (const h of homes) {
      let a = h.parentElement;
      for (let i = 0; a && i < 8; i++, a = a.parentElement) {
        if (aways.some(x => a.contains(x) && x !== h)) return { row: a, anchor: h };
      }
    }
    return null;
  }

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
  async function findRowWithScroll(item) {
    let r = findRow(item);
    if (r) return r;
    for (let i = 0; i < 14 && !r; i++) {
      for (const s of scrollers()) s.scrollTop += Math.max(300, s.clientHeight * 0.8);
      await sleep(450);
      r = findRow(item);
    }
    return r;
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
  async function waitHrefChange(prev, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (location.href !== prev) return true;
      await sleep(150);
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

  // ---------- expandir mercados ----------
  async function expandAll(customSel) {
    let total = 0;
    for (let pass = 0; pass < 8; pass++) {
      const cand = new Set();
      document.querySelectorAll('[aria-expanded="false"]').forEach(e => cand.add(e));
      if (customSel) {
        try { document.querySelectorAll(customSel).forEach(e => cand.add(e)); } catch (_) {}
      }
      document.querySelectorAll('button, [role="button"]').forEach(e => {
        const t = (e.textContent || '').trim().toLowerCase();
        if (/^(mostrar mais|ver mais|mostrar tudo|ver tudo|show more|expandir)/.test(t)) cand.add(e);
      });
      const vis = [...cand].filter(isVisible);
      if (!vis.length) break;
      for (const e of vis) { realClick(e); total++; await sleep(120); }
      await sleep(500);
      // percorre a página para carregar o que for "lazy"
      await scrollAllTo('bottom');
      await scrollAllTo('top');
    }
    return total;
  }

  // ---------- preparar impressão ----------
  let restoreList = [];
  async function preparePrint() {
    await scrollAllTo('bottom');
    await scrollAllTo('top');
    const style = document.createElement('style');
    style.id = '__odds_pdf_prep';
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
    document.getElementById('__odds_pdf_prep')?.remove();
    for (const [el, v, pr] of restoreList) {
      if (v) el.style.setProperty('position', v, pr); else el.style.removeProperty('position');
    }
    restoreList = [];
  }

  // ---------- navegação de volta à lista ----------
  const samePath = (a, b) => { try { return new URL(a).pathname === new URL(b).pathname; } catch (_) { return false; } };

  async function backToList(listUrl) {
    if (samePath(location.href, listUrl)) return true;
    history.back();
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      if (samePath(location.href, listUrl)) { await sleep(1500); return true; }
      await sleep(200);
    }
    location.href = listUrl; // recarrega; o script retoma sozinho
    return false;
  }

  const progress = (i, n) => chrome.runtime.sendMessage({ type: 'PROGRESS', text: i >= n ? '' : `${i + 1}/${n}` });

  // ---------- laço principal ----------
  async function run() {
    if (window.__oddsRunning) return;
    window.__oddsRunning = true;
    try {
      let st = await getState();
      let ok = 0, fail = 0;
      while (st && st.running && st.idx < st.items.length) {
        const it = st.items[st.idx];
        progress(st.idx, st.items.length);

        if (!samePath(location.href, st.listUrl)) {
          const back = await backToList(st.listUrl);
          if (!back) return; // página será recarregada
          st = await getState();
          continue;
        }

        const tag = `[${it.id}] ${it.home} × ${it.away}`;
        try {
          await log(`${tag}: procurando na lista…`);
          const found = await findRowWithScroll(it);
          if (!found) throw new Error('jogo não encontrado na lista');

          found.anchor.scrollIntoView({ block: 'center' });
          await sleep(300);
          const before = location.href;
          realClick(found.anchor);
          let moved = await waitHrefChange(before, 4000);
          if (!moved) { realClick(found.row); moved = await waitHrefChange(before, 4000); }
          if (!moved) throw new Error('clique não abriu a página do jogo');

          await waitStable();
          const bodyN = norm(document.body.innerText);
          if (!(bodyN.includes(norm(it.home)) && bodyN.includes(norm(it.away))))
            await log(`${tag}: aviso – não consegui confirmar os nomes na página aberta (seguindo mesmo assim)`);

          const n = await expandAll(st.expandSel);
          await log(`${tag}: ${n} blocos expandidos, gerando PDF…`);

          const dims = await preparePrint();
          const res = await chrome.runtime.sendMessage({ type: 'PRINT', filename: `${it.id}.pdf`, ...dims });
          restorePrint();
          if (!res || !res.ok) throw new Error('falha ao gerar PDF: ' + (res && res.error));
          await log(`${tag}: OK → ${it.id}.pdf (${dims.w}×${dims.h}px)`);
          ok++;
        } catch (e) {
          restorePrint();
          await log(`${tag}: FALHOU – ${e.message}`);
          fail++;
        }

        await setState({ idx: st.idx + 1 });
        st = await getState();
        if (st.running && st.idx < st.items.length) await backToList(st.listUrl);
        await sleep(800);
      }
      if (st && st.running) {
        await setState({ running: false });
        await log(`Concluído. Veja a pasta Downloads. (OK nesta sessão: ${ok}, falhas: ${fail})`);
      }
      progress(0, 0);
    } finally {
      window.__oddsRunning = false;
    }
  }

  // ---------- mensagens do popup ----------
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'START') {
      setState({
        running: true, idx: 0, items: msg.items, expandSel: msg.expandSel || '',
        listUrl: location.href, log: [`Iniciando ${msg.items.length} jogo(s)…`]
      }).then(() => { run(); sendResponse({ ok: true }); });
      return true;
    }
    if (msg.type === 'STOP') {
      setState({ running: false }).then(() => log('Parado pelo usuário.')).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === 'PING') { sendResponse({ ok: true, url: location.href }); }
  });

  // retoma depois de recarregar a página
  getState().then(st => { if (st && st.running) setTimeout(run, 1500); });
})();
