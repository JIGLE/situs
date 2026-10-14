# Going live: what the bank feed and Finanças ask of you

Situs runs fully without either connection. A payment can be recorded by hand, and every Finanças
submission is simulated. This page is the list of what each provider requires before the real thing,
set against what Situs already has, so that nothing is discovered at the last step.

Each provider's own page decides, not this one. Where a requirement comes from their documentation
the link is given; **check it again before relying on it**, since both change. Where Situs could not
read the source, the line says so and is not guessed.

## Live bank feed (Enable Banking)

Enable Banking is the licensed account information provider, so an instance needs no PSD2 licence and
no eIDAS certificate of its own. The setup steps are in [truenas.md](truenas.md#bank-movements); what
follows is what their documentation requires before an application may read a real bank.

Sources: [whitelisting your own accounts](https://enablebanking.com/docs/api/linked-accounts/),
[Control Panel overview](https://enablebanking.com/docs/api/control-panel/),
[terms of service](https://enablebanking.com/terms).

| Requirement                                                                                                                                                                                                         | Where it comes from              | Situs today                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Control Panel account, and a **Production** application (a Sandbox one reaches only a synthetic bank)                                                                                                             | Control Panel docs               | Your step; `.env.example` and `truenas.md` say which one                                                                                                    |
| An application description shown to users at consent, a **data protection email**, a **privacy policy URL** and a **terms of service URL**                                                                          | "Whitelisting own accounts" page | `/privacy` and `/terms` exist and publish `DATA_PROTECTION_EMAIL`; they must be reachable at a public address when you register                             |
| An **HTTPS redirect URL**, matching the one the app sends exactly                                                                                                                                                   | Control Panel docs, setup guides | `$NEXTAUTH_URL/api/bank/connections/callback`; the host must be reachable from the internet (`NEXTAUTH_URL` must be your public HTTPS address)              |
| The **public certificate** for a key pair you generate (the private key stays with you)                                                                                                                             | Control Panel docs               | The app signs each request's JWT with the key; mount it as a file (`ENABLE_BANKING_PRIVATE_KEY_FILE`), never inline                                         |
| **Activation** of a production application: link your own accounts ("Activate by linking accounts"), then authorise through the API as usual                                                                        | "Whitelisting own accounts" page | Settings › Integrations › Connect a bank; the connection renews every 90 days or sooner if the bank says so                                                 |
| **Restricted mode reads only the accounts linked to the application**                                                                                                                                               | same page                        | Fits one owner's own accounts. Accounts of **co-owners** are not covered unless they are linked by whoever holds the application: ask                       |
| The terms limit restricted production to **individual, non-commercial use**; business use counts as evaluation until Enable Banking confirms in writing; unrestricted access needs their review, a contract and KYC | Terms of service                 | **A decision, not a task.** Whether letting your own properties is "professional use" is theirs to say: write to info@enablebanking.com and keep the answer |

What Situs adds on its side: read-only access (it cannot move money), the authorisation happens at
your bank and never here, the IBAN is stored encrypted and matched by hash, and removing a
connection revokes the bank session.

## Finanças (AT) rent receipts

Status in Situs: a **test mode** reaches AT's test service; production is deliberately not built,
and every other mode fails closed (`lib/tax/connectors/mode-guard.ts`), so going live is a code
change, not a setting.

The source is AT's _Manual de Integração de Software — Comunicação de contratos de arrendamento e
emissão de recibos de renda à AT_, **version 1.6 of 29/07/2024**, read in full on 14 October 2026.
Section numbers below are the manual's.

**What the webservice can do (§4).** Three operations: `registarDadosContrato` (communicate one
contract), `emitirRecibo` (issue one receipt) and `obterRecibo` (one receipt's PDF, by contract and
receipt number). **None lists or searches** a landlord's contracts or receipts, so the webservice
cannot fill Situs in; reading them needs another route (ROADMAP, "The Finanças reader").

**How a program gets there (§3.1, §5, §6).** A "software producer" may be an individual
("entidades ou indivíduos").

| Phase        | What the manual requires                                                                                                                                                                                                                    | Situs today                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Development  | Email **asi-cd@at.gov.pt** with the manual's template asking for AT's **authentication public key** and an **SSL certificate for the test address**; obtain the **WSDL**                                                                    | `AT_AUTH_PUBLIC_KEY_FILE`, `AT_CLIENT_CERT_FILE`, `AT_CLIENT_KEY_FILE`. The operations' namespace is not in the manual: it is a guess in `lib/tax/at/soap.ts` until the WSDL arrives |
| Tests        | Use the user and password **created for the tests** (the manual's example: 555555555 + password) against the test address; test data may be wiped; a connectivity test page exists (§6.1)                                                   | The test mode and Settings › Integrations, which call `https://servicos.portaldasfinancas.gov.pt:709/ws/arrendamento` (§6.4)                                                         |
| Distribution | Join through the form at e-fatura › Produtores de Software › Aderir ao Serviço, accepting its terms, with a **CSR** (RSA 2048, CN = the producer's NIF, no accented characters); AT emails back the signed certificate, valid **12 months** | Not done; `/admin` warns 30 days before a certificate's twelve months run out                                                                                                        |
| Production   | Switch to the production address and certificate; the program asks for the credentials of those submitting, "as defined in the Portal das Finanças"                                                                                         | **Not built.** Production address `https://servicos.portaldasfinancas.gov.pt:409/ws/arrendamento` (§6.4)                                                                             |

**Credentials (§1, §4.1).** The username is `<NIF>/<UserId>`: `/0000` the main user, `/1` … a
sub-user. The manual says the credentials "só podem ser conhecidas pelos emitentes" and that the
program must be ready to ask for them whenever it needs them. It neither allows nor forbids storing
a sub-user, as Situs does: **ask AT** before going live.

**Checked against the code.** The WS-Security header (§4.1), the response codes (§4.2), the order
of `emitirRecibo`'s fields including `versaoContrato` and `dataRecebimento`, and both addresses
(§6.4) match `lib/tax/at/`. Not sent yet: a tenant's `retencaoFonte` (v1.6 adds `RIRS05`, 17.5% in
the Azores) and `herdeiros`. The manual leaves the RSA padding of the Nonce unstated; the code uses
PKCS#1 v1.5, and AT's test service decides.

General questions about the integration: portal-qt@at.gov.pt (the manual's contact).

## Compliance pages and records

| Item                                                 | Situs today                                                                                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Privacy notice                                       | `/privacy`: what is collected, the bank section, the processors (Enable Banking, Brevo and the Portuguese Tax Authority, "the fiscal filings you choose to submit"), cookies, retention, rights, the contact    |
| Terms                                                | `/terms`, including the PSD2 sentence: connect only accounts you are entitled to access                                                                                                                         |
| Record of processing (GDPR art. 30)                  | [DATA_PROTECTION.md](DATA_PROTECTION.md): controller, supervisory authority (CNPD), no DPO and why, the legal basis of the AT filing (legal obligation, art. 6(1)(c)), recipients, retention, gaps              |
| A contact address                                    | `DATA_PROTECTION_EMAIL`, published on both pages                                                                                                                                                                |
| **Wording to revisit when receipts really go to AT** | Today nothing real reaches AT. When production exists, say what is sent (the rent receipt's parties by NIF, the amount, the period, the contract number) and that AT then holds it under its own responsibility |
| Erasure                                              | The account and everything it owns is deleted, and the only administrator is protected. Known gaps (stored receipt PDFs, a live bank consent, email log rows) are being closed                                  |

## In what order

1. Ask Enable Banking in writing whether your use is professional, and keep the reply.
2. Put the instance on a public HTTPS address; register the Production application with the
   privacy, terms and redirect URLs; link your accounts; connect.
3. Email asi-cd@at.gov.pt for AT's public key, the test certificate, the WSDL and the test
   credentials; run the test mode against AT's test service.
4. Update the AT wording on `/privacy` and the Article 30 record to say what production sends.
5. Only then build and enable the production mode.
