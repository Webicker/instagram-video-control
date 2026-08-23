# Publicar e atualizar a extensão

Duas coisas separadas, e vale não confundir:

- **Assinatura** — obrigatória em toda versão. Sem ela o Firefox não instala permanentemente.
  Quem assina é a Mozilla, e isso continua manual pra você.
- **Distribuição** — como a versão nova chega em quem já tem instalado. É isso que o
  GitHub automatiza.

---

## Parte 1 — assinar na Mozilla (toda versão)

O caminho é a submissão **unlisted** (auto-distribuição): revisão automatizada, sem fila de
revisor humano. Costuma sair em minutos.

1. <https://addons.mozilla.org/developers/> — entre com a conta Firefox
2. Nova extensão, ou **Nova versão** se já existir
3. **Escolha "On your own" / "Por conta própria"**. Se escolher "On this site", a extensão vai
   pro catálogo público e entra em fila de revisão humana
4. Suba o `.zip` gerado pelo `release.ps1`
5. Quando perguntar sobre ferramenta de build ou minificador: **não**. É JavaScript puro,
   não precisa enviar fonte separado
6. Baixe o `.xpi` assinado

Avisos (*warnings*) na validação não bloqueiam. Só erros bloqueiam.

---

## Parte 2 — atualização automática pelo GitHub

O manifest tem um campo `update_url` apontando pro `updates.json` do repositório. O Firefox
de quem tem a extensão consulta esse arquivo sozinho — mais ou menos uma vez por dia — e
instala a versão nova. A pessoa não faz nada.

### Requisito: o repositório precisa ser público

O `raw.githubusercontent.com` só serve arquivo de repositório público sem autenticação, e o
`.xpi` da release também precisa ser baixável sem login. Ou seja: **o código-fonte fica
visível pra qualquer um.**

Não há segredo no código — a chave da API de transcrição fica no armazenamento do navegador
de cada pessoa, nunca no repositório. Mas é bom saber que é público.

### A pegadinha do `update_url`

O campo precisa estar **na versão que a pessoa já tem instalada**. A `1.1.0` não tem, então
ela nunca vai procurar atualização.

Por isso a `1.1.1` — a primeira com o campo — ainda vai à mão pro seu amigo, uma última vez.
Da próxima em diante é automático.

### Montar o repositório (uma vez só)

1. Crie um repositório **público** no GitHub
2. No terminal, dentro da pasta `Extensões navegador`:

```bash
git init -b main && git add -A && git commit -m "Instagram Video Control"
```

3. Conecte e envie (troque `SEU-USUARIO`):

```bash
git remote add origin https://github.com/SEU-USUARIO/instagram-video-control.git && git push -u origin main
```

---

## O ciclo de cada versão nova

```bash
powershell -ExecutionPolicy Bypass -File release.ps1 1.1.2
```

O script roda os testes, grava a versão no `manifest.json`, gera o `.zip` e reescreve o
`updates.json`. Se os testes falharem, ele para antes de mexer em qualquer coisa.

Depois, na ordem que ele imprime:

1. Subir o `.zip` na Mozilla e baixar o `.xpi` assinado
2. **Renomear o `.xpi`** para `instagram-video-control-<versão>.xpi`
3. No GitHub: **Releases → Draft a new release**, tag `v<versão>`, anexar o `.xpi`
4. `git add -A && git commit -m "v<versão>" && git push`

O nome do anexo e a tag têm que bater exatamente com o que está no `updates.json` — é ele que
diz ao Firefox onde buscar o arquivo. O script imprime os dois valores prontos.

### Testar se pegou

No Firefox de quem tem instalado: `about:addons` → engrenagem ⚙ → **Verificar se há
atualizações**. Não precisa esperar o ciclo automático.

---

## Instalação manual (a primeira vez, e pra você)

- Arrastar o `.xpi` pra dentro de uma janela do Firefox, **ou**
- `about:addons` → ⚙ → *Instalar extensão de arquivo…*

Se você ainda estiver com a versão temporária carregada pelo `about:debugging`, remova ela
antes — senão as duas rodam juntas e a barra aparece duplicada.

---

## Regras que não dá pra quebrar

- **Versão sempre pra cima.** A Mozilla rejeita upload de versão que já existe.
- **O ID nunca muda.** `browser_specific_settings.gecko.id`, hoje
  `instagram-video-control@mauricio`. É ele que faz o Firefox entender o arquivo novo como
  atualização do mesmo add-on, e não como outra extensão.
- **`manifest.json` na raiz do zip.** É por isso que o script compacta o *conteúdo* da pasta,
  não a pasta.
