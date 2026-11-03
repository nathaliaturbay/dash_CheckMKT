# Dashboards de clientes

Página bonita, com link aberto e sem login, para cada cliente. Atualiza sozinha todo dia às 8h e às 14h (horário de Brasília).

Como funciona:
1. A Stract atualiza as planilhas do Google de cada cliente.
2. O GitHub baixa essas planilhas (pelo link de "Publicar na Web" em CSV, guardado como segredo) e monta a página.
3. A página fica em `https://<seu-usuario>.github.io/<este-repositorio>/<cliente>/`.

O repositório guarda só o código. Os números e os links das planilhas não ficam aqui.

## Adicionar um cliente

1. Na planilha da Stract do cliente: **Arquivo → Compartilhar → Publicar na Web**, escolha a aba e **CSV**, publique e copie o link.
2. No GitHub: **Settings → Secrets and variables → Actions → New repository secret**, um segredo por planilha (ex.: `XYZ_META_CSV`).
3. Crie `clients/<nome-do-cliente>.json` copiando o da AJ e troque nome, moeda e os nomes dos segredos. Se o cliente só tem uma plataforma, apague a linha da outra.
4. Em `.github/workflows/daily.yml`, adicione os segredos novos na seção `env`.

## Atualizar na hora

**Actions → Update dashboards → Run workflow**.
