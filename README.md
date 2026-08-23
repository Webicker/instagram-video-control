# Instagram Video Control

Barra de player colada no rodapé do próprio vídeo do Instagram (feed, reels, stories em vídeo).

## Instalar no Firefox

1. Abra `about:debugging#/runtime/this-firefox`
2. **Carregar extensão temporária…**
3. Selecione o `manifest.json` desta pasta
4. Abra o instagram.com e dê play em qualquer vídeo — a barra aparece no rodapé do vídeo

> Extensão temporária some ao fechar o Firefox. Pra ficar permanente é preciso assinar no
> addons.mozilla.org, ou usar o Firefox Developer Edition com `xpinstall.signatures.required=false`.

## Teclado

| Tecla | O quê |
|---|---|
| `espaço` | pausa / despausa |
| `←` `→` | volta / avança 3 segundos |
| `↑` `↓` | aumenta / abaixa o volume |
| `0`–`9` | pula pra 0%–90% do vídeo |
| `M` | muta |
| `C` | liga / desliga legendas |
| `F` ou `F11` | tela cheia |
| `Esc` | sai — em cascata: fecha o menu, depois o painel, depois a tela cheia, depois pausa |
| `L` | repetir |
| `[` `]` (ou `,` `.`) | velocidade; `R` volta pra 1x |
| `D` | baixar vídeo — `Shift+D` abre a lista |
| `T` | transcrever a fala |
| `P` | picture-in-picture |
| `B` | traz a barra de volta depois de escondê-la |

> `F11` é uma tecla reservada do Firefox. A extensão tenta interceptá-la, mas se o navegador
> pegar primeiro você vai entrar em tela cheia *do navegador* em vez do vídeo. `F` sempre
> funciona e é o caminho confiável.

## Na barra

▶ · tempo · barra de progresso · 🔊 volume · velocidade · **CC** · ⛶ tela cheia · ☰

Na barra de progresso: azul = já visto, cinza claro = já baixado (buffer).

## No menu ☰

- **CC Legendas: ligadas / desligadas**
- 🔗 **Copiar link do vídeo** — o permalink do post, não a URL temporária do arquivo
- 🔁 Repetir
- ⬇ Baixar vídeo · ☰ Escolher arquivo pra baixar
- 📝 Transcrever fala do vídeo
- ⧉ Picture-in-picture — o Firefox não expõe a API, cai no `Ctrl+Shift+]` nativo
- ✕ Esconder barra

## Som e autoplay

Volume, velocidade, loop e o estado de mudo ficam salvos e são reaplicados em **todo vídeo
novo** — inclusive quando o Instagram tenta resetar sozinho no meio da reprodução (a extensão
escuta `ratechange`/`volumechange` e devolve o valor salvo).

**Um vídeo manda por vez.** A cada 200ms a extensão mede a visibilidade de todos os vídeos da
página e elege um só vencedor: o de maior `visibilidade × área`, ignorando qualquer um que
ocupe menos de 8% da janela (isso corta as miniaturas da grade do Explorar). O vencedor atual
leva um bônus de 25% na pontuação, pra não ficar trocando no meio do scroll.

- só o vencedor toca — a partir de 60% visível;
- **todo o resto é pausado.** O Instagram não pausa vídeo que ele mesmo não iniciou, então na
  home sobrava áudio tocando de posts que você já tinha passado;
- se você pausar na mão, ele fica pausado: o pause é marcado como seu e a extensão não insiste
  até o vídeo sair da tela.

**Som ligado por padrão.** A extensão tenta tirar o mudo já no primeiro vídeo. Se o Firefox
barrar (a política de autoplay bloqueia áudio antes de você interagir com a página), ela
percebe o pause, volta a tocar mudo e só tenta o som de novo depois do seu primeiro clique.
Pra ter som desde o primeiro frame, libere o autoplay com áudio pro instagram.com:
clique no ícone à esquerda da barra de endereço → **Reproduzir automaticamente** → *Permitir
áudio e vídeo*.

Apertou `M`? Ele lembra e passa a mutar tudo, até você desmutar de novo.

## Legendas e transcrição

As duas features saem da mesma fonte de cues, buscada em três degraus — para no primeiro que
der resultado:

1. **Faixa de legenda embutida** no `<video>` — grátis, instantâneo.
2. **Arquivo `.vtt`** que o Instagram baixou nesta aba (o background sniffa junto com os mp4)
   — grátis, instantâneo.
3. **Whisper** — transcrição de verdade da fala, com tempos. Só roda com chave configurada.

`C` liga a legenda na tela; `T` copia o texto corrido pro clipboard. Ambas mostram a fonte
usada. As legendas são desenhadas pela própria extensão (não pelo Firefox), logo aparecem
igual em tela cheia e não dependem do player do Instagram.

Legenda automática é rolante — cada trecho repete o fim do anterior. Por isso o texto corrido
é costurado pelo maior sufixo/prefixo comum em vez de concatenado, senão sairia tudo duplicado.

### Economia de cota

Com a legenda ligada, trocar de vídeo busca **só os degraus 1 e 2** (de graça). O degrau 3
custa dinheiro/cota, então só roda quando você pede: aperte `C` (ou `T`) naquele vídeo.
O resultado fica em cache — reativar no mesmo vídeo não chama a API de novo.

### Configurar o Whisper

`about:addons` → *Instagram Video Control* → **Preferências**. Escolha o serviço, cole a
chave, salve.

**Recomendado: Groq.** Free tier generoso, `whisper-large-v3-turbo`, poucos segundos por reel,
português nativo. Chave em <https://console.groq.com/keys>. A OpenAI cobra e é mais lenta pro
mesmo resultado.

O campo **Idioma** já vem `pt` — sem ele o Whisper às vezes devolve português como se fosse
outro idioma. Em branco, ele detecta sozinho.

> **O que sai da sua máquina:** no degrau 3 o arquivo do vídeo é enviado para o serviço
> escolhido. Se não quiser isso, é só não configurar chave nenhuma — os degraus 1 e 2
> continuam funcionando e são 100% locais.

O mp4 vai direto pra API — ela aceita vídeo e extrai o áudio sozinha, então não tem ffmpeg
nem gravação em tempo real no meio. Limite de 25 MB por arquivo; acima disso ele avisa.

## Download — como funciona e quando falha

O `<video>` do Instagram usa `blob:` (MSE), então a URL dele não dá pra baixar. A extensão
escuta as requisições pra `cdninstagram.com` / `fbcdn.net`, guarda as URLs `.mp4` daquela aba
e remove `bytestart`/`byteend` (que é o que corta o arquivo em pedaços).

- **Baixar vídeo** pega o `.mp4` capturado mais perto do momento em que o vídeo atual começou.
- Errou o vídeo? **Escolher arquivo** (`Shift+D`) lista as últimas URLs capturadas.
- Nada na lista? Dê play no vídeo primeiro — sem requisição não há o que capturar.
- Em alta resolução o Instagram separa faixa de vídeo e de áudio; nesse caso o mp4 baixado
  pode vir **sem som**. Tente outro item da lista.

Os arquivos vão pra `Downloads/instagram/`.

## Testes

```bash
node test.js
```

Cobre limpeza de URL, escolha do candidato de download, parsing de WebVTT e a costura da
legenda rolante.
