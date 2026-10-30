# Preço Delivery-HNM — Versão 1.1.0

**Data:** 30/10/2026
**Site:** https://hnunes2026.github.io/preco-delivery-web/

## O que é

Calculadora web que converte o preço de balcão no preço ideal para **iFood** e **99Food**, considerando todas as taxas configuradas. Sem cadastro, login ou histórico: só conversão de preço.

## Novidades da 1.1.0

- **Manual na tela "Sobre":** passo a passo de uso, explicação do resultado, como o cálculo funciona (com exemplo), arredondamento e dicas.
- **Removido** o card "Quer ir além do preço ideal?" e o botão "Saiba mais", que não são mais necessários.
- A assinatura **HNUNES DELIVERY_CONSULT · (21) 97037-6887** continua aparecendo depois do cálculo, agora como texto simples, sem a caixa.
- Número da versão atualizado para 1.1.0.

## Como funciona

1. **Configure suas taxas** do iFood e da 99Food (comissão, taxa de pagamento, taxa fixa por pedido, investimento em campanhas, anúncios e outras taxas). Fica salvo no navegador.
2. **Informe o preço vendido na loja** (balcão).
3. **Escolha a meta de recebimento:** igual ao balcão, + R$ fixo ou + % margem.
4. **Toque em CALCULAR** e veja, para cada plataforma: preço ideal, valor líquido recebido, total de taxas e diferença para o balcão.

Também há **Detalhes** (passo a passo do preço final ao líquido), **Copiar Cálculo** e **Trocar Plataforma Principal**.

## Regras do cálculo

- O investimento em campanhas (valor fixo em R$) é descontado primeiro, direto do preço final.
- Comissão, taxa de pagamento e, quando em %, anúncios e outras taxas incidem sobre o preço já líquido de campanhas.
- Taxa fixa por pedido e taxas em R$ são somadas ao valor que o preço precisa cobrir.
- A soma das taxas percentuais precisa ser menor que 100%.
- Arredondamento opcional (Nenhum, Final ,90, Final ,99, Inteiro), sempre para cima.

Exemplo ilustrativo (taxas fictícias): balcão R$ 30,00, taxas percentuais somando 25%, meta igual ao balcão → preço ideal R$ 40,00 (R$ 40,00 − R$ 10,00 = R$ 30,00).

## Arquivos desta versão

- `index.html`, `styles.css`, `app.js` — site publicado no GitHub Pages
- `PrecoDelivery.html` — versão em arquivo único
- `RELEASE.md` — estas notas

## Versões anteriores

- **1.0.0:** lançamento (calculadora iFood x 99Food), marca Preço Delivery-HNM, barra permanente de acesso às taxas e opção de restaurar configurações padrão.
