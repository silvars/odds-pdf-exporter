# Odds PDF Exporter

Extensão para Chrome/Edge/Brave com duas funções:

- **Jogos**: percorre uma lista de jogos em uma página de apostas, abre cada um e salva um PDF por jogo (`05.pdf`, `06.pdf`, ...).
- **Apostas**: percorre o histórico de apostas (`/betting/bets-history`), filtra pela data informada, entra na tela de detalhe de cada aposta e salva um PDF por aposta.

## Como funciona

### Aba "Jogos"

1. Você cola no popup da extensão uma lista de jogos, um por linha, no formato:
   ```
   05. Holanda × Grécia
   06. Alemanha × Sérvia
   ```
   Separadores aceitos entre os times: `×`, `x`, `vs`, `-`. A ordem dos times não importa.
2. A extensão localiza cada jogo na página (`content.js`), expande os mercados de apostas e aciona a geração do PDF.
3. O PDF é gerado via Chrome DevTools Protocol (`Page.printToPDF`, em `background.js`) e salvo automaticamente na pasta Downloads com o nome `<id>.pdf`.

### Aba "Apostas"

1. Abra a página do histórico de apostas (`/betting/bets-history`).
2. No popup, mude para a aba **Apostas** e informe a data desejada no formato `dd/mm/aaaa` (ex.: `16/11/2026`).
3. A extensão (`apostas.js`) varre os cartões da lista (rolando a página quando necessário), identifica os que têm aquela data e, um de cada vez:
   - abre a tela de detalhe da aposta;
   - gera o PDF via `background.js`, salvo como `<ano>-<mês>-<dia>_<hora>-<minuto>_<ID>.pdf` (ex.: `2026-11-16_12-29_398896726.pdf`);
   - volta para a lista (botão **Voltar**) e segue para a próxima aposta daquela data.
4. O processo para sozinho quando não encontra mais apostas pendentes daquela data (assumindo que a lista é ordenada da mais recente para a mais antiga) ou quando chega ao fim da lista.

## Instalação

1. Baixe/clone este repositório.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta do projeto.

## Uso

### Aba "Jogos"

1. Abra a página com a lista de jogos (a URL precisa conter `/betting/...`). Se a extensão acabou de ser instalada com a página já aberta, dê um F5.
2. Clique no ícone da extensão, na aba **Jogos**. A lista padrão (05–15) já vem preenchida; edite conforme necessário.
3. Marque **Modo teste** na primeira vez para gerar apenas o PDF do primeiro jogo e conferir o resultado.
4. Clique em **Iniciar** e deixe a aba aberta e visível — não interaja com ela até o processo terminar.
5. Os PDFs serão salvos em Downloads como `05.pdf`, `06.pdf`, etc.

### Aba "Apostas"

1. Abra a página do histórico de apostas (`/betting/bets-history`).
2. Clique no ícone da extensão, mude para a aba **Apostas** e informe a data no formato `dd/mm/aaaa`.
3. Clique em **Iniciar** e deixe a aba aberta e visível — a extensão abre cada aposta daquela data, uma de cada vez, volta para a lista e continua.
4. Os PDFs serão salvos em Downloads como `2026-11-16_12-29_398896726.pdf` (data/hora da aposta + ID).

### Seletor CSS extra

Se algum mercado não expandir automaticamente, clique com o botão direito no cabeçalho do mercado → **Inspecionar**, identifique uma classe CSS e informe-a no campo **Seletor CSS extra** do popup (ex.: `[class*=market-title]`). Esse campo vale apenas para a aba **Jogos**.

### Parar o processo

O botão **Parar** de cada aba interrompe a exportação no item atual.

## Observações

- Durante a geração, o Chrome exibe a faixa *"Odds PDF Exporter começou a depurar este navegador"* — isso é esperado, pois é assim que o PDF de página única é gerado via DevTools Protocol. A faixa desaparece ao final.
- Páginas muito longas (acima de ~190 polegadas) têm a escala reduzida automaticamente para respeitar o limite do Chrome de geração de PDF.
- Na aba **Apostas**, a extensão assume que o histórico é ordenado da aposta mais recente para a mais antiga; ao passar da data informada sem novas apostas pendentes, o processo é encerrado automaticamente.

## Permissões usadas

| Permissão   | Motivo |
|-------------|--------|
| `debugger`  | Gerar o PDF de página única via DevTools Protocol |
| `downloads` | Salvar os PDFs gerados na pasta Downloads |
| `storage`   | Persistir a lista de jogos, data de apostas e logs entre sessões |
| `tabs`      | Identificar a aba ativa e enviar mensagens ao content script |

## Estrutura do projeto

```
manifest.json   Configuração da extensão (Manifest V3)
popup.html/js   Interface com as abas "Jogos" e "Apostas" e controle do processo
content.js      Localiza jogos na página e expande os mercados
apostas.js      Localiza apostas por data no histórico e abre a tela de detalhe de cada uma
background.js   Service worker: gera o PDF e dispara o download
LEIAME.txt      Instruções rápidas em português
```
