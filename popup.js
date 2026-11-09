const DEFAULT_LIST = `05. Holanda × Grécia
06. Alemanha × Sérvia
07. Suíça × Eslovênia
08. Eslováquia × Ilhas Faroé
09. Azerbaijão × Liechtenstein
10. Turquia × Bélgica
11. Itália × França
12. Portugal × Dinamarca
13. Noruega × País de Gales
14. Romênia × Polônia
15. Bulgária × Islândia`;

const $ = id => document.getElementById(id);

function parseList(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s*[.\-)]?\s*(.+)$/);
    if (!m) continue;
    const id = m[1].padStart(2, '0');
    const teams = m[2].split(/\s*×\s*|\s+x\s+|\s+vs\.?\s+|\s+-\s+/i).map(s => s.trim()).filter(Boolean);
    if (teams.length !== 2) continue;
    items.push({ id, home: teams[0], away: teams[1] });
  }
  return items;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderLog(st) {
  const el = $('log');
  el.textContent = ((st && st.log) || []).join('\n');
  el.scrollTop = el.scrollHeight;
}

(async () => {
  const saved = await chrome.storage.local.get(['listText', 'expandSel', 'st']);
  $('list').value = saved.listText || DEFAULT_LIST;
  $('sel').value = saved.expandSel || '';
  renderLog(saved.st);

  chrome.storage.onChanged.addListener(ch => { if (ch.st) renderLog(ch.st.newValue); });

  $('start').onclick = async () => {
    let items = parseList($('list').value);
    if (!items.length) { alert('Nenhum jogo reconhecido. Use o formato: 05. Holanda × Grécia'); return; }
    if ($('test').checked) items = items.slice(0, 1);
    await chrome.storage.local.set({ listText: $('list').value, expandSel: $('sel').value });
    const tab = await activeTab();
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
    } catch (_) {
      alert('Esta aba não é a página de apostas (/betting/...). Se acabou de instalar a extensão, recarregue a página (F5) e tente de novo.');
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'START', items, expandSel: $('sel').value });
  };
  $('stop').onclick = async () => {
    const tab = await activeTab();
    chrome.tabs.sendMessage(tab.id, { type: 'STOP' }).catch(() => {});
    const { st } = await chrome.storage.local.get('st');
    if (st) chrome.storage.local.set({ st: { ...st, running: false } });
  };
  $('clear').onclick = async () => {
    const { st } = await chrome.storage.local.get('st');
    if (st) chrome.storage.local.set({ st: { ...st, log: [] } });
  };
})();
