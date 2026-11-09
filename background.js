// Service worker: gera o PDF (via DevTools Protocol) e baixa o arquivo.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PRINT') {
    doPrint(sender.tab.id, msg)
      .then(sendResponse)
      .catch(e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // resposta assíncrona
  }
  if (msg.type === 'PROGRESS') {
    chrome.action.setBadgeText({ text: msg.text || '' });
    chrome.action.setBadgeBackgroundColor({ color: '#1565c0' });
  }
});

async function doPrint(tabId, { filename, w, h }) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    if (!/already attached/i.test(e.message || '')) throw e;
  }
  try {
    const send = (method, params) => chrome.debugger.sendCommand(target, method, params);

    // Limite do Chrome para uma página de PDF: ~200 polegadas. Reduz a escala se precisar.
    const MAX_IN = 190;
    let paperW = w / 96;
    let paperH = (h + 40) / 96;
    let scale = 1;
    if (paperH > MAX_IN) {
      scale = Math.max(0.1, MAX_IN / paperH);
      paperW *= scale;
      paperH = MAX_IN;
    }

    await send('Emulation.setEmulatedMedia', { media: 'screen' });
    const res = await send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: false,
      paperWidth: Math.max(paperW, 1),
      paperHeight: Math.max(paperH, 1),
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      scale,
      pageRanges: '1'
    });
    await send('Emulation.setEmulatedMedia', { media: '' });

    const id = await chrome.downloads.download({
      url: 'data:application/pdf;base64,' + res.data,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    });
    return { ok: true, downloadId: id, scale };
  } finally {
    try { await chrome.debugger.detach(target); } catch (_) {}
  }
}
