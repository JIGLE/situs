/**
 * Lease contract template: Contrato de Arrendamento Urbano (NRAU regime), with the clauses
 * Portuguese tenancy law requires.
 */

export interface LeaseTemplateData {
  // Landlord
  landlordName: string;
  landlordNif: string;
  landlordAddress: string;
  landlordEmail?: string;
  landlordPhone?: string;

  // Tenant
  tenantName: string;
  tenantNif: string;
  tenantAddress: string;
  tenantEmail?: string;
  tenantPhone?: string;

  // Property
  propertyAddress: string;
  propertyDescription?: string;
  propertyTypology?: string; // e.g., T2, T3
  cadasterReference?: string; // Artigo matricial
  licencaHabitacao?: string; // Portugal: licença de habitação number
  energyCertificateClass?: string; // A+, A, B, C, D, E, F

  // Lease Terms
  startDate: string;
  endDate: string;
  monthlyRent: number;
  deposit: number;
  paymentDueDay?: number;
  autoRenew: boolean;
  renewalNoticeDays?: number;

  isRendaAcessivel?: boolean; // Programa de Arrendamento Acessível

  // Additional
  includedUtilities?: string[];
  specialClauses?: string[];
  signatureDate?: string;
}

function formatDatePT(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-PT", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatEuro(amount: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

const CSS = `
  body {
    font-family: 'Times New Roman', Georgia, serif;
    line-height: 1.8;
    max-width: 800px;
    margin: 0 auto;
    padding: 40px;
    color: #1a1a1a;
    font-size: 13px;
  }
  h1 {
    text-align: center;
    font-size: 20px;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  h2 {
    font-size: 14px;
    margin-top: 24px;
    margin-bottom: 8px;
    text-transform: uppercase;
    border-bottom: 1px solid #ccc;
    padding-bottom: 4px;
  }
  .subtitle {
    text-align: center;
    font-size: 12px;
    color: #666;
    margin-bottom: 30px;
  }
  .parties { margin-bottom: 24px; }
  .section { margin-bottom: 16px; }
  .highlight { font-weight: bold; }
  .clause { margin-bottom: 12px; text-align: justify; }
  .signature-block {
    margin-top: 50px;
    display: flex;
    justify-content: space-between;
    page-break-inside: avoid;
  }
  .signature-line {
    width: 44%;
    text-align: center;
  }
  .signature-line .line {
    border-bottom: 1px solid #000;
    height: 40px;
    margin-bottom: 5px;
  }
  .signature-line .label { font-size: 11px; color: #666; }
  ul { margin: 8px 0; padding-left: 20px; }
  .legal-note {
    font-size: 11px;
    color: #666;
    margin-top: 30px;
    border-top: 1px solid #ccc;
    padding-top: 15px;
  }
`;

/**
 * Generate Portuguese Contrato de Arrendamento Urbano
 * Compliant with NRAU (Lei n.º 6/2006) and subsequent amendments
 */
export function generatePortugueseLease(data: LeaseTemplateData): string {
  const fd = formatDatePT;
  const fe = formatEuro;

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <title>Contrato de Arrendamento Urbano</title>
  <style>${CSS}</style>
</head>
<body>
  <h1>Contrato de Arrendamento Urbano</h1>
  <p class="subtitle">Nos termos do Novo Regime do Arrendamento Urbano (NRAU) — Lei n.º 6/2006</p>

  <div class="parties">
    <p>Entre:</p>
    <p><strong>PRIMEIRO OUTORGANTE (Senhorio):</strong> ${data.landlordName}, contribuinte fiscal n.º ${data.landlordNif}, 
    com domicílio em ${data.landlordAddress}${data.landlordEmail ? `, e-mail: ${data.landlordEmail}` : ""}${data.landlordPhone ? `, telefone: ${data.landlordPhone}` : ""},
    adiante designado por "Senhorio";</p>
    
    <p><strong>SEGUNDO OUTORGANTE (Arrendatário):</strong> ${data.tenantName}, contribuinte fiscal n.º ${data.tenantNif}, 
    com domicílio em ${data.tenantAddress}${data.tenantEmail ? `, e-mail: ${data.tenantEmail}` : ""}${data.tenantPhone ? `, telefone: ${data.tenantPhone}` : ""},
    adiante designado por "Arrendatário";</p>
    
    <p>É celebrado o presente contrato de arrendamento urbano para fins habitacionais, que se rege pelas cláusulas seguintes:</p>
  </div>

  <h2>Cláusula Primeira — Objecto</h2>
  <div class="section">
    <p class="clause">O Senhorio dá de arrendamento ao Arrendatário o imóvel sito em 
    <span class="highlight">${data.propertyAddress}</span>${data.propertyTypology ? `, tipologia ${data.propertyTypology}` : ""},
    destinado exclusivamente a habitação permanente do Arrendatário.</p>
    ${data.licencaHabitacao ? `<p class="clause">Licença de utilização n.º ${data.licencaHabitacao}.</p>` : ""}
    ${data.energyCertificateClass ? `<p class="clause">Certificado energético: classe ${data.energyCertificateClass}.</p>` : ""}
    ${data.propertyDescription ? `<p class="clause">Descrição: ${data.propertyDescription}</p>` : ""}
  </div>

  <h2>Cláusula Segunda — Prazo</h2>
  <div class="section">
    <p class="clause">O presente contrato tem início em <span class="highlight">${fd(data.startDate)}</span> 
    e termo em <span class="highlight">${fd(data.endDate)}</span>.</p>
    ${
      data.autoRenew
        ? `<p class="clause">O contrato renova-se automaticamente por períodos iguais ao inicial, salvo denúncia por qualquer das partes, mediante comunicação por escrito com antecedência mínima de ${data.renewalNoticeDays ?? 120} dias relativamente ao seu termo.</p>`
        : `<p class="clause">O contrato não se renova automaticamente, cessando no termo do prazo convencionado.</p>`
    }
  </div>

  <h2>Cláusula Terceira — Renda</h2>
  <div class="section">
    <p class="clause">A renda mensal é fixada em <span class="highlight">${fe(data.monthlyRent)}</span> (${numberToWordsPT(data.monthlyRent)}), 
    pagável até ao dia <span class="highlight">${data.paymentDueDay ?? 8}</span> do mês a que respeita.</p>
    <p class="clause">A renda é actualizada anualmente nos termos do artigo 24.º do NRAU, de acordo com o coeficiente de actualização publicado pelo INE.</p>
    ${
      data.isRendaAcessivel
        ? `<p class="clause"><strong>Programa Renda Acessível:</strong> Este contrato é celebrado ao abrigo do Programa de Arrendamento Acessível (Decreto-Lei n.º 68/2019), beneficiando o Senhorio da taxa autónoma de IRS de 10% sobre os rendimentos prediais.</p>`
        : ""
    }
  </div>

  <h2>Cláusula Quarta — Caução</h2>
  <div class="section">
    <p class="clause">O Arrendatário entrega ao Senhorio, a título de caução, o montante de 
    <span class="highlight">${fe(data.deposit)}</span>, correspondente a ${Math.round(data.deposit / data.monthlyRent)} mês(es) de renda.</p>
    <p class="clause">A caução será devolvida no prazo de 30 dias após a cessação do contrato, deduzidas eventuais importâncias devidas pelo Arrendatário.</p>
  </div>

  <h2>Cláusula Quinta — Obrigações do Arrendatário</h2>
  <div class="section">
    <p class="clause">a) Pagar pontualmente a renda;</p>
    <p class="clause">b) Manter o locado em bom estado de conservação;</p>
    <p class="clause">c) Não realizar obras sem autorização prévia e por escrito do Senhorio;</p>
    <p class="clause">d) Não subarrendar nem ceder a sua posição contratual sem consentimento do Senhorio;</p>
    <p class="clause">e) Comunicar ao Senhorio quaisquer defeitos do locado que exijam reparação;</p>
    <p class="clause">f) Restituir o locado no estado em que o recebeu, salvo deteriorações inerentes ao uso normal e prudente.</p>
  </div>

  <h2>Cláusula Sexta — Obrigações do Senhorio</h2>
  <div class="section">
    <p class="clause">a) Entregar o locado em condições de habitabilidade;</p>
    <p class="clause">b) Assegurar o gozo pacífico do locado;</p>
    <p class="clause">c) Realizar as obras de conservação ordinária e extraordinária;</p>
    <p class="clause">d) Emitir o recibo de renda electrónico até 5 dias após o recebimento da renda, nos termos do artigo 78.º-A do CIRS.</p>
  </div>

  ${
    data.includedUtilities && data.includedUtilities.length > 0
      ? `
  <h2>Cláusula Sétima — Despesas e Encargos</h2>
  <div class="section">
    <p class="clause">Estão incluídas na renda as seguintes despesas:</p>
    <ul>${data.includedUtilities.map((u) => `<li>${u}</li>`).join("\n      ")}</ul>
    <p class="clause">Todas as restantes despesas são da responsabilidade do Arrendatário.</p>
  </div>
  `
      : ""
  }

  ${
    data.specialClauses && data.specialClauses.length > 0
      ? `
  <h2>Cláusulas Especiais</h2>
  <div class="section">
    <ul>${data.specialClauses.map((c) => `<li>${c}</li>`).join("\n      ")}</ul>
  </div>
  `
      : ""
  }

  <h2>Disposições Finais</h2>
  <div class="section">
    <p class="clause">O presente contrato é regido pela legislação portuguesa, designadamente pelo Código Civil, pelo NRAU (Lei n.º 6/2006 e alterações posteriores) e pela demais legislação aplicável.</p>
    <p class="clause">Qualquer litígio emergente do presente contrato será dirimido pelo tribunal da comarca da situação do imóvel arrendado.</p>
    <p class="clause">O presente contrato é feito em duplicado, sendo um exemplar para cada parte.</p>
  </div>

  <div class="signature-block">
    <div class="signature-line">
      <div class="line"></div>
      <div class="label">O Senhorio</div>
      <p>${data.landlordName}</p>
      <p>NIF: ${data.landlordNif}</p>
      <p>Data: ${data.signatureDate ? fd(data.signatureDate) : "_______________"}</p>
    </div>
    <div class="signature-line">
      <div class="line"></div>
      <div class="label">O Arrendatário</div>
      <p>${data.tenantName}</p>
      <p>NIF: ${data.tenantNif}</p>
      <p>Data: ${data.signatureDate ? fd(data.signatureDate) : "_______________"}</p>
    </div>
  </div>

  <div class="legal-note">
    <p>Nota: Nos termos do artigo 2.º do Decreto-Lei n.º 160/2006, o presente contrato deve ser comunicado à Autoridade Tributária e Aduaneira no prazo de 30 dias.</p>
  </div>
</body>
</html>`;
}

// Helper: number to words in Portuguese (simplified for amounts up to €99,999)
function numberToWordsPT(amount: number): string {
  const euros = Math.floor(amount);
  const cents = Math.round((amount - euros) * 100);

  const units = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  const teens = [
    "dez",
    "onze",
    "doze",
    "treze",
    "catorze",
    "quinze",
    "dezasseis",
    "dezassete",
    "dezoito",
    "dezanove",
  ];
  const tens = [
    "",
    "",
    "vinte",
    "trinta",
    "quarenta",
    "cinquenta",
    "sessenta",
    "setenta",
    "oitenta",
    "noventa",
  ];
  const hundreds = [
    "",
    "cem",
    "duzentos",
    "trezentos",
    "quatrocentos",
    "quinhentos",
    "seiscentos",
    "setecentos",
    "oitocentos",
    "novecentos",
  ];

  function convertBelow1000(n: number): string {
    if (n === 0) return "";
    if (n < 10) return units[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) {
      const t = Math.floor(n / 10);
      const u = n % 10;
      return u === 0 ? tens[t] : `${tens[t]} e ${units[u]}`;
    }
    const h = Math.floor(n / 100);
    const remainder = n % 100;
    if (remainder === 0) return hundreds[h];
    const hWord = h === 1 ? "cento" : hundreds[h];
    return `${hWord} e ${convertBelow1000(remainder)}`;
  }

  function convert(n: number): string {
    if (n === 0) return "zero";
    if (n >= 1000) {
      const thousands = Math.floor(n / 1000);
      const remainder = n % 1000;
      const tWord = thousands === 1 ? "mil" : `${convertBelow1000(thousands)} mil`;
      if (remainder === 0) return tWord;
      return `${tWord} e ${convertBelow1000(remainder)}`;
    }
    return convertBelow1000(n);
  }

  let result = `${convert(euros)} euro${euros !== 1 ? "s" : ""}`;
  if (cents > 0) {
    result += ` e ${convert(cents)} cêntimo${cents !== 1 ? "s" : ""}`;
  }
  return result;
}
