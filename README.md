# Odds PDF Exporter

Extensão para Chrome/Edge/Brave que percorre uma lista de jogos em uma página de apostas, abre cada um e salva um PDF por jogo (`05.pdf`, `06.pdf`, ...).

## Como funciona

1. Você cola no popup da extensão uma lista de jogos, um por linha, no formato:
   ```
   05. Holanda × Grécia
   06. Alemanha × Sérvia
   ```
   Separadores aceitos entre os times: `×`, `x`, `vs`, `-`. A ordem dos times não importa.
2. A extensão localiza cada jogo na página (`content.js`), expande os mercados de apostas e aciona a geração do PDF.
3. O PDF é gerado via Chrome DevTools Protocol (`Page.printToPDF`, em `background.js`) e salvo automaticamente na pasta Downloads com o nome `<id>.pdf`.

## Instalação

1. Baixe/clone este repositório.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta do projeto.

## Uso

1. Abra a página com a lista de jogos (a URL precisa conter `/betting/...`). Se a extensão acabou de ser instalada com a página já aberta, dê um F5.
2. Clique no ícone da extensão. A lista padrão (05–15) já vem preenchida; edite conforme necessário.
3. Marque **Modo teste** na primeira vez para gerar apenas o PDF do primeiro jogo e conferir o resultado.
4. Clique em **Iniciar** e deixe a aba aberta e visível — não interaja com ela até o processo terminar.
5. Os PDFs serão salvos em Downloads como `05.pdf`, `06.pdf`, etc.

### Seletor CSS extra

Se algum mercado não expandir automaticamente, clique com o botão direito no cabeçalho do mercado → **Inspecionar**, identifique uma classe CSS e informe-a no campo **Seletor CSS extra** do popup (ex.: `[class*=market-title]`).

### Parar o processo

O botão **Parar** interrompe a exportação no jogo atual.

## Observações

- Durante a geração, o Chrome exibe a faixa *"Odds PDF Exporter começou a depurar este navegador"* — isso é esperado, pois é assim que o PDF de página única é gerado via DevTools Protocol. A faixa desaparece ao final.
- Páginas muito longas (acima de ~190 polegadas) têm a escala reduzida automaticamente para respeitar o limite do Chrome de geração de PDF.

## Permissões usadas

| Permissão   | Motivo |
|-------------|--------|
| `debugger`  | Gerar o PDF de página única via DevTools Protocol |
| `downloads` | Salvar os PDFs gerados na pasta Downloads |
| `storage`   | Persistir a lista de jogos, seletor CSS e log entre sessões |
| `tabs`      | Identificar a aba ativa e enviar mensagens ao content script |

## Estrutura do projeto

```
manifest.json   Configuração da extensão (Manifest V3)
popup.html/js   Interface de entrada da lista de jogos e controle do processo
content.js      Localiza jogos na página e expande os mercados
background.js   Service worker: gera o PDF e dispara o download
LEIAME.txt      Instruções rápidas em português
```
