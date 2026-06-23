# Guia real de integração — como obter cada API (Ticash Pay)

> Foco nos corredores atuais: **Brasil → Haiti** e **Brasil → Rep. Dominicana**.
> O que dá pra fazer **agora e de graça** é o ambiente de testes (sandbox) da MonCash
> e da Asaas/PIX. Produção (dinheiro real) precisa de cadastro de empresa e aprovação.

---

## 1. MonCash (Haiti) — PRIORIDADE ⭐

### A) Sandbox (grátis, agora — pra desenvolver e testar)
1. Acesse: **https://sandbox.moncashbutton.digicelgroup.com/Moncash-business/New**
2. Crie a conta e **confirme o e-mail**.
3. Faça login → aba **"General Info"** → clique **"New"** pra adicionar um business.
4. Preencha os dados do negócio: nome, website, **Return URL** e **Alert URL**
   (essas duas URLs eu te passo certinho — são da nossa plataforma).
5. Salve → clique em **"View"** no business → ali aparecem o **client_id** e o
   **client_secret** da API REST. Copie os dois.
6. **Me manda o client_id + client_secret do sandbox** → eu ligo no sistema e a gente
   testa um pagamento Haiti de ponta a ponta, sem dinheiro real.

### B) Produção (dinheiro real — começar já, é a mais lenta)
- ⚠️ Importante: a API pública da MonCash é feita pra **receber** pagamento. Pra **pagar
  na carteira da pessoa no Haiti** (payout/disbursement — o que a gente precisa pro envio
  chegar) é preciso um **acordo de disbursement** com a Digicel. Tem que pedir isso
  explicitamente.
- Contato: time **MonCash Business da Digicel** → e-mail **MFS_B.Services@digicelgroup.com**
  (no Haiti também atende pelo **202**).
- Peça: (1) conta MonCash Business de **produção**; (2) API de **collection E
  disbursement/transfer**.
- Costumam pedir: registro/CNPJ da empresa, documento do responsável, dados bancários
  (confirmar com eles).

## 2. Asaas — PIX (Brasil), a entrada do dinheiro

### A) Sandbox (grátis, agora)
1. Crie conta em **https://sandbox.asaas.com**
2. Login → menu do usuário → **"Integrações"** → gere uma **API Key**
   (a do sandbox começa com `$aact_hmlg_...`).
3. Menu **Pix → Minhas Chaves** → crie uma chave Pix.
4. **Me manda a API Key do sandbox** → endpoint de teste é `api-sandbox.asaas.com/v3`.

### B) Produção
- Mesma coisa na conta real (**asaas.com**): depois de validar a empresa, a chave de
  produção começa com `$aact_prod_...` e o endpoint é `api.asaas.com`.
- Equivalentes (te indico pela taxa/aprovação): **Iugu**, **Pagar.me**.

## 3. NatCash (Haiti) — segunda opção de payout
- O NatCash (Natcom / National Telecom) **não tem portal de desenvolvedor público**.
  A integração de merchant/API é por **contato direto** com a Natcom.
- O que fazer: falar com o **comercial/business da Natcom** e pedir o acordo de
  **API de pagamento e payout** pra merchant. Me repassa a documentação + credenciais
  que eles enviarem.

## 4. tPago / Azul (Rep. Dominicana) — corredor 2
- **Azul** (Grupo Popular): a API é **por solicitação** — pedir acesso de API/e-commerce
  pelo contato comercial no site **azul.com.do**.
- **tPago**: via contato comercial do provedor da carteira.
- Entra quando ligarmos o corredor da República Dominicana.

## 5. KYC — verificação de identidade
- **Sumsub** (sumsub.com): no dashboard, em Developers/Integrations, pega o **App Token**
  e a **Secret Key**.
- Alternativa BR: **Idwall** (idwall.co) — forte em documentos brasileiros.

---

## ✅ O que dá pra fazer AGORA (grátis, sem esperar aprovação)
1. Abrir o **sandbox da MonCash** e me mandar o `client_id` + `client_secret`.
2. Abrir o **sandbox da Asaas** e me mandar a `API Key`.

Com esses dois eu já consigo testar o fluxo real **Brasil → Haiti** (PIX entra, MonCash
paga) no ambiente de testes — sem risco e sem custo. Em paralelo, você abre os pedidos de
**produção** (MonCash Business + Asaas produção), que são os que demoram.

> Lembrando: obter as APIs é orientação minha (incluso). A **construção das integrações**
> reais na plataforma é a **Fase 2**, orçada à parte.

### Fontes (verificadas)
- MonCash sandbox/portal: https://sandbox.moncashbutton.digicelgroup.com/Moncash-business/New · doc REST: https://sandbox.moncashbutton.digicelgroup.com/Moncash-business/resources/doc/RestAPI_MonCash_doc.pdf
- Asaas: https://docs.asaas.com/docs/chaves-de-api · https://sandbox.asaas.com
- NatCash (sem API pública): https://natcashagent.natcom.com.ht/
- Azul (DR): https://www.azul.com.do
