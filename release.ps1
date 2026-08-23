# Prepara uma versao nova da extensao.
#
#   .\release.ps1 1.1.2
#
# Roda os testes, grava a versao no manifest, gera o .zip pra assinar na Mozilla
# (na pasta acima, fora do repositorio) e reescreve o updates.json que o Firefox
# de quem tem a extensao instalada consulta sozinho.
#
# Nota: este arquivo e mantido em ASCII puro de proposito. O PowerShell 5.1 le
# .ps1 sem BOM como ANSI, entao caractere acentuado aqui dentro vira lixo.

param([Parameter(Mandatory = $true)][string]$Version)

$ErrorActionPreference = 'Stop'

# ---------------- configuracao ----------------
$Repo    = 'Webicker/instagram-video-control'
$Branch  = 'main'
$AddonId = 'instagram-video-control@mauricio'
# ----------------------------------------------

if ($Version -notmatch '^\d+(\.\d+)*$') {
  throw "Versao invalida: '$Version'. Use algo como 1.1.2"
}

# Este script mora dentro da pasta da extensao, que e tambem a raiz do repositorio.
$Src    = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir = Split-Path -Parent $Src
$Mf     = Join-Path $Src 'manifest.json'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# Fica de fora do pacote: teste, ferramenta de release e documentacao interna.
$NotShipped = @('test.js', 'release.ps1', 'updates.json', 'PUBLICAR-NA-MOZILLA.md', '.gitignore', '*.zip')

# 1. testes primeiro: se quebrar, nada e alterado
Push-Location $Src
try { & node test.js } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Testes falharam - nada foi empacotado.' }

# 2. versao no manifest.
# Ler com ReadAllText, e nao com Get-Content -Raw: no PowerShell 5.1 o Get-Content
# assume ANSI em arquivo sem BOM e destroi os acentos da descricao na regravacao.
$json = [System.IO.File]::ReadAllText($Mf)

# O padrao casa so com a chave "version" do topo: "manifest_version" e
# "strict_min_version" tem um "_" antes de version, entao nao batem.
$rx     = [regex]'("version"\s*:\s*")([^"]*)(")'
$match  = $rx.Match($json)
if (-not $match.Success) { throw 'Nao achei a chave "version" no manifest.json' }
$oldVer = $match.Groups[2].Value
$new    = $rx.Replace($json, ('${1}' + $Version + '${3}'), 1)

$sizeBefore = (Get-Item $Mf).Length
[System.IO.File]::WriteAllText($Mf, $new, $Utf8NoBom)
$sizeAfter = (Get-Item $Mf).Length

# O arquivo so pode ter mudado no tamanho da string de versao. Qualquer outra
# diferenca significa que a acentuacao da descricao foi reescrita errado.
$expected = $Version.Length - $oldVer.Length
if (($sizeAfter - $sizeBefore) -ne $expected) {
  throw "manifest.json mudou $($sizeAfter - $sizeBefore) bytes, esperado $expected. Provavel corrupcao de acentuacao - desfaca com: git checkout manifest.json"
}

$mf = [System.IO.File]::ReadAllText($Mf) | ConvertFrom-Json
if ($mf.version -ne $Version) { throw 'Nao consegui gravar a versao em manifest.json' }
if (-not $mf.browser_specific_settings.gecko.update_url) {
  Write-Warning 'manifest.json sem update_url: esta versao nao vai se atualizar sozinha.'
}

# 3. pacote pra Mozilla
$Zip = Join-Path $OutDir "instagram-video-control-$Version.zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Get-ChildItem $Src -Exclude $NotShipped | Compress-Archive -DestinationPath $Zip -CompressionLevel Optimal

# 4. updates.json. A URL do .xpi e previsivel, entao da pra gerar antes de subir
#    o arquivo - desde que a tag e o nome do anexo sejam exatamente estes.
$XpiName = "instagram-video-control-$Version.xpi"
$Tag     = "v$Version"
$updates = @{
  addons = @{
    $AddonId = @{
      updates = @(
        @{
          version     = $Version
          update_link = "https://github.com/$Repo/releases/download/$Tag/$XpiName"
        }
      )
    }
  }
}
[System.IO.File]::WriteAllText((Join-Path $Src 'updates.json'), ($updates | ConvertTo-Json -Depth 6), $Utf8NoBom)

Write-Host ""
Write-Host "Versao $Version preparada." -ForegroundColor Green
Write-Host ""
Write-Host "Agora, nesta ordem:"
Write-Host "  1. Suba na Mozilla (Nova versao -> 'On your own'):"
Write-Host "     $Zip"
Write-Host "  2. Baixe o .xpi assinado e RENOMEIE para exatamente:"
Write-Host "     $XpiName" -ForegroundColor Yellow
Write-Host "  3. GitHub -> Releases -> Draft a new release"
Write-Host "     tag: $Tag   e anexe o .xpi" -ForegroundColor Yellow
Write-Host "  4. git add -A; git commit -m ""v$Version""; git push"
Write-Host ""
Write-Host "A tag e o nome do anexo precisam bater com o updates.json,"
Write-Host "senao o Firefox nao encontra o arquivo."
