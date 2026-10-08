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

What AT's integration manuals describe (the producer-side pattern shared by their webservices; the
rent-receipt manual is _Comunicação de contratos de arrendamento e emissão de recibos de renda_,
version 1.6, July 2024, from the Portal das Finanças producers pages):

| Requirement                                                                                                                                                                   | Situs today                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An **SSL certificate** you generate, **signed by AT** through an adhesion request on the Portal das Finanças producers pages; AT replies by email with the signed certificate | Mounted as `AT_CLIENT_CERT_FILE` and `AT_CLIENT_KEY_FILE`; `/admin` warns 30 days before its twelve months run out                                                 |
| **AT's authentication public key**, used to encrypt the user's password in each call                                                                                          | `AT_AUTH_PUBLIC_KEY_FILE`                                                                                                                                          |
| **Testing** with a sub-user created under your own NIF at acesso.gov.pt, given the webservice profile; test data stays in a separate environment                              | The test mode and Settings › Integrations (sub-user and password, stored encrypted)                                                                                |
| **Production** acts for the taxpayer, with the taxpayer's own credentials                                                                                                     | **Not built.** Open question for the manual: whether production may use a stored sub-user the way the test mode does, or must prompt for the credentials each time |
| The producer is responsible for transmitting the data correctly; the certificate only secures the channel                                                                     | Receipt requests are built and checked in `lib/tax/at/receipt-request.ts`, and a test records nothing                                                              |
| A contact for questions about the integration                                                                                                                                 | The manual names portal-qt@at.gov.pt                                                                                                                               |

**Not verified from here:** the manual's own section on going from test to production (adhesion
steps for production, endpoints, whether certification of the software is required). Send the PDF
and this table becomes a checklist; until then treat the production column as unknown.

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
3. Send the AT rent-receipt manual; request AT's signed certificate and a test sub-user; run the
   test mode against AT's test service.
4. Update the AT wording on `/privacy` and the Article 30 record to say what production sends.
5. Only then build and enable the production mode.
