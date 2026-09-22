/**
 * SAF-T PT (Standard Audit File for Tax - Portugal)
 *
 * Implementation based on Portaria n.º 321-A/2007 and subsequent updates.
 * This module generates SAF-T XML files compliant with Portuguese Tax Authority (AT) requirements.
 *
 * Digital signature: RSA-SHA1 hash chain per Portaria n.º 363/2010.
 * Requires a certified private key (PEM) set via SAFT_SIGNING_KEY_PATH env var.
 *
 * @see https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/SAFT_PT/
 */

import crypto from "crypto";
import fs from "fs";
import { getPrismaClient } from "../services/database/database";
import { validatePortugueseNIF as validateNIF } from "@/lib/utils/tax-id-validation";

// SAF-T PT Version
const SAFT_VERSION = "1.04_01";
const SAFT_NAMESPACE = "urn:OECD:StandardAuditFile-Tax:PT_1.04_01";

// Portuguese Tax Codes for Rental Income
export const TAX_CODES = {
  // IVA (VAT) - usually exempt for residential rentals
  EXEMPT: "ISE", // Isento
  STANDARD: "NOR", // Normal rate (23%)
  REDUCED: "RED", // Reduced rate (13%)
  INTERMEDIATE: "INT", // Intermediate rate (6%)

  // Withholding tax rates for rental income
  WITHHOLDING_RESIDENTIAL: 25, // 25% for residents
  WITHHOLDING_NON_RESIDENTIAL: 25, // 25% for non-residents (can be different)
} as const;

// Document types in SAF-T
export const DOCUMENT_TYPES = {
  INVOICE: "FT", // Fatura
  SIMPLIFIED_INVOICE: "FS", // Fatura Simplificada
  CREDIT_NOTE: "NC", // Nota de Crédito
  DEBIT_NOTE: "ND", // Nota de Débito
  RECEIPT: "RG", // Recibo
} as const;

// Invoice status codes
export const INVOICE_STATUS = {
  NORMAL: "N",
  CANCELLED: "A",
  BILLED: "F",
  SELF_BILLED: "S",
} as const;

export interface SAFTHeader {
  companyID: string; // NIF
  taxRegistrationNumber: string;
  taxAccountingBasis: "C" | "F" | "I" | "P" | "R" | "S" | "T";
  companyName: string;
  companyAddress: SAFTAddress;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  currencyCode: string;
  dateCreated: string;
  taxEntity: string;
  productCompanyTaxID: string;
  softwareCertificateNumber: string;
  productID: string;
  productVersion: string;
}

export interface SAFTAddress {
  buildingNumber?: string;
  streetName?: string;
  addressDetail: string;
  city: string;
  postalCode: string;
  region?: string;
  country: string;
}

export interface SAFTCustomer {
  customerID: string;
  accountID: string;
  customerTaxID: string;
  companyName: string;
  billingAddress: SAFTAddress;
  selfBillingIndicator: 0 | 1;
}

export interface SAFTProduct {
  productType: "P" | "S" | "O" | "E" | "I";
  productCode: string;
  productGroup?: string;
  productDescription: string;
  productNumberCode: string;
}

export interface SAFTLine {
  lineNumber: number;
  productCode: string;
  productDescription: string;
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number;
  taxPointDate: string;
  description: string;
  creditAmount?: number;
  debitAmount?: number;
  tax: {
    taxType: string;
    taxCountryRegion: string;
    taxCode: string;
    taxPercentage: number;
  };
  taxExemptionReason?: string;
  taxExemptionCode?: string;
  settlementAmount?: number;
}

export interface SAFTInvoice {
  invoiceNo: string;
  ATCUD: string;
  documentStatus: {
    invoiceStatus: string;
    invoiceStatusDate: string;
    sourceID: string;
    sourceBilling: string;
  };
  hash: string;
  hashControl: string;
  period: number;
  invoiceDate: string;
  invoiceType: string;
  selfBillingIndicator: 0 | 1;
  sourceID: string;
  systemEntryDate: string;
  customerID: string;
  shipTo?: {
    deliveryID?: string;
    deliveryDate?: string;
    address?: SAFTAddress;
  };
  lines: SAFTLine[];
  documentTotals: {
    taxPayable: number;
    netTotal: number;
    grossTotal: number;
    currency?: {
      currencyCode: string;
      currencyAmount: number;
      exchangeRate: number;
    };
    payment?: {
      paymentMechanism: string;
      paymentAmount: number;
      paymentDate: string;
    }[];
  };
}

export interface SAFTExportOptions {
  fiscalYear: number;
  startMonth?: number; // 1-12, defaults to 1
  endMonth?: number; // 1-12, defaults to 12
  includePayments?: boolean;
  companyInfo: {
    nif: string;
    name: string;
    address: SAFTAddress;
    taxEntity?: string;
  };
}

/**
 * Validate Portuguese NIF (Número de Identificação Fiscal)
 * Re-exported from shared validation module for backward compatibility.
 */
export { validatePortugueseNIF as validateNIF } from "@/lib/utils/tax-id-validation";

/**
 * Generate ATCUD (Código Único do Documento)
 * Format: [Series Validation Code]-[Sequential Number]
 */
export function generateATCUD(seriesCode: string, sequentialNumber: number): string {
  // In production, the series code is obtained from AT registration
  // For now, we use a placeholder format
  return `${seriesCode}-${sequentialNumber}`;
}

/**
 * Generate document hash as required by Portuguese regulations
 * Portaria n.º 363/2010: RSA-SHA1 signature of concatenated fields.
 * Each document's hash includes the previous document's hash (hash chain).
 *
 * If no signing key is configured, falls back to HMAC-SHA256 and logs a warning.
 */

let _signingKey: crypto.KeyObject | null | undefined; // undefined = not loaded yet

function getSigningKey(): crypto.KeyObject | null {
  if (_signingKey !== undefined) return _signingKey;

  const keyPath = process.env.SAFT_SIGNING_KEY_PATH;
  if (!keyPath) {
    console.warn("[SAF-T] SAFT_SIGNING_KEY_PATH not set — using HMAC fallback (not AT-certified)");
    _signingKey = null;
    return null;
  }

  try {
    const pem = fs.readFileSync(keyPath, "utf8");
    _signingKey = crypto.createPrivateKey(pem);
    return _signingKey;
  } catch (err) {
    console.error("[SAF-T] Failed to load signing key:", err instanceof Error ? err.message : err);
    _signingKey = null;
    return null;
  }
}

export function generateDocumentHash(
  invoiceDate: string,
  systemEntryDate: string,
  invoiceNo: string,
  grossTotal: number,
  previousHash?: string,
): string {
  // Data to hash per Portaria n.º 363/2010 Anexo I:
  // InvoiceDate;SystemEntryDate;InvoiceNo;GrossTotal;PreviousHash
  const dataToHash = `${invoiceDate};${systemEntryDate};${invoiceNo};${grossTotal.toFixed(2)};${previousHash || ""}`;

  const key = getSigningKey();

  if (key) {
    // Production: RSA-SHA1 signature (AT-certified key)
    const sign = crypto.createSign("SHA1");
    sign.update(dataToHash);
    sign.end();
    const signature = sign.sign(key, "base64");
    // SAF-T requires first 4 + last 4 characters of Base64 signature
    return signature.substring(0, 4) + signature.slice(-4);
  }

  // Fallback: HMAC-SHA256 (produces deterministic hash for testing/dev)
  const secret = process.env.NEXTAUTH_SECRET || "situs-dev-saft-key";
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(dataToHash);
  const digest = hmac.digest("base64");
  return digest.substring(0, 4) + digest.slice(-4);
}

/**
 * Format date for SAF-T (YYYY-MM-DD)
 */
function formatSAFTDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split("T")[0];
}

/**
 * Format datetime for SAF-T (YYYY-MM-DDTHH:MM:SS)
 */
function formatSAFTDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split(".")[0];
}

/**
 * Escape XML special characters
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate SAF-T PT XML export
 */
export async function generateSAFTPT(userId: string, options: SAFTExportOptions): Promise<string> {
  const prisma = getPrismaClient();
  const { fiscalYear, startMonth = 1, endMonth = 12, companyInfo } = options;

  const startDate = new Date(fiscalYear, startMonth - 1, 1);
  const endDate = new Date(fiscalYear, endMonth, 0); // Last day of endMonth

  // Fetch the period's fiscal documents.
  //
  // These used to be `Invoice` rows. The scope cutdown removed the tenant-facing invoicing
  // and payment stack, and nothing creates an `Invoice` any more — so left as it was, this
  // export would have kept succeeding and produced a SAF-T declaring no activity at all.
  // An empty fiscal file is worse than a failing one: it is a filing, and it is false.
  //
  // `RentReceipt` is what replaced it, and is the better source regardless: the recibo de
  // renda IS the Portuguese fiscal document for rent, it carries its own sequential
  // `receiptNumber` (the unique document number SAF-T and the hash chain both need, which
  // `Receipt` has no equivalent of), and it stores the tenant NIF and property address as
  // filed rather than as they read today.
  const rentReceipts = await prisma.rentReceipt.findMany({
    where: {
      userId,
      receiptDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      tenant: true,
      property: true,
    },
    orderBy: { receiptDate: "asc" },
  });

  // Build unique customers from the receipts
  const customersMap = new Map<string, SAFTCustomer>();
  const productsMap = new Map<string, SAFTProduct>();

  // Default product for rent
  productsMap.set("RENT", {
    productType: "S",
    productCode: "RENT",
    productGroup: "Services",
    productDescription: "Property Rental Services",
    productNumberCode: "RENT",
  });

  for (const receipt of rentReceipts) {
    if (!customersMap.has(receipt.tenantId)) {
      customersMap.set(receipt.tenantId, {
        customerID: receipt.tenantId,
        accountID: "Desconhecido",
        // The NIF as it was filed on the recibo. "999999990" is AT's consumidor final
        // placeholder, correct for a non-resident tenant with no Portuguese NIF.
        customerTaxID: receipt.tenantNif || "999999990",
        companyName: receipt.tenant?.name ?? "Consumidor Final",
        billingAddress: {
          addressDetail: receipt.propertyAddress || "Morada desconhecida",
          city: "Desconhecida",
          postalCode: "0000-000",
          country: "PT",
        },
        selfBillingIndicator: 0,
      });
    }
  }

  // If no customers, add a generic one
  if (customersMap.size === 0) {
    customersMap.set("CONSUMIDOR_FINAL", {
      customerID: "CONSUMIDOR_FINAL",
      accountID: "Desconhecido",
      customerTaxID: "999999990",
      companyName: "Consumidor Final",
      billingAddress: {
        addressDetail: "Desconhecido",
        city: "Desconhecido",
        postalCode: "0000-000",
        country: "PT",
      },
      selfBillingIndicator: 0,
    });
  }

  // Build the XML
  const now = new Date();
  const hashChain: string[] = []; // Track hash chain across invoices
  const certNumber = process.env.SAFT_CERTIFICATE_NUMBER || "0";
  const xml = buildSAFTXML({
    header: {
      companyID: companyInfo.nif,
      taxRegistrationNumber: companyInfo.nif,
      taxAccountingBasis: "F", // Faturação (Invoicing)
      companyName: companyInfo.name,
      companyAddress: companyInfo.address,
      fiscalYear,
      startDate: formatSAFTDate(startDate),
      endDate: formatSAFTDate(endDate),
      currencyCode: "EUR",
      dateCreated: formatSAFTDate(now),
      taxEntity: companyInfo.taxEntity || "Global",
      productCompanyTaxID: companyInfo.nif,
      softwareCertificateNumber: certNumber,
      // Kept as "Situs/Situs" deliberately during the Situs rebrand: this is the
      // AT (Autoridade Tributária) software-certification identifier embedded in every
      // SAF-T export. Renaming it without re-verifying certification implications is a
      // fiscal-compliance risk, not a cosmetic one — do not change without confirming
      // against AT's software certification rules first.
      productID: "Situs/Situs",
      productVersion: "1.0",
    },
    customers: Array.from(customersMap.values()),
    products: Array.from(productsMap.values()),
    invoices: rentReceipts.map((receipt, index) => {
      const grossTotal = receipt.rentAmount;
      const taxAmount = 0; // Residential rental is IVA-exempt under art. 9 CIVA
      const netTotal = grossTotal - taxAmount;

      const invoiceStatus =
        receipt.status === "cancelled" ? INVOICE_STATUS.CANCELLED : INVOICE_STATUS.NORMAL;

      // A recibo covers one rental period, so it is always a single line. The `Invoice`
      // source this replaced could carry multi-line JSON in a `metadata` column; nothing
      // wrote one, and RentReceipt has no equivalent field, so that branch is gone.
      const periodLabel = `${formatSAFTDate(receipt.periodStart)} - ${formatSAFTDate(receipt.periodEnd)}`;
      const lineItems: SAFTLine[] = [
        {
          lineNumber: 1,
          productCode: "RENT",
          productDescription: "Renda mensal",
          quantity: 1,
          unitOfMeasure: "UN",
          unitPrice: grossTotal,
          taxPointDate: formatSAFTDate(receipt.receiptDate),
          description: `Renda ${periodLabel}`,
          creditAmount: grossTotal,
          tax: {
            taxType: "IVA",
            taxCountryRegion: "PT",
            taxCode: TAX_CODES.EXEMPT,
            taxPercentage: 0,
          },
          taxExemptionReason: "M07 - Isento nos termos do art.º 9.º do CIVA",
          taxExemptionCode: "M07",
        },
      ];

      // Hash chain: each document's hash uses the previous document's hash
      const previousHash = index > 0 ? hashChain[index - 1] : undefined;
      const currentHash = generateDocumentHash(
        formatSAFTDate(receipt.receiptDate),
        formatSAFTDateTime(receipt.createdAt),
        receipt.receiptNumber,
        grossTotal,
        previousHash,
      );
      hashChain.push(currentHash);

      return {
        invoiceNo: receipt.receiptNumber,
        ATCUD: generateATCUD("SITUS", index + 1),
        documentStatus: {
          invoiceStatus,
          invoiceStatusDate: formatSAFTDateTime(receipt.updatedAt),
          sourceID: userId,
          sourceBilling: "P", // Produced by invoicing program
        },
        hash: currentHash,
        hashControl: "1",
        period: new Date(receipt.receiptDate).getMonth() + 1,
        invoiceDate: formatSAFTDate(receipt.receiptDate),
        invoiceType: DOCUMENT_TYPES.INVOICE,
        selfBillingIndicator: 0,
        sourceID: userId,
        systemEntryDate: formatSAFTDateTime(receipt.createdAt),
        customerID: receipt.tenantId,
        lines: lineItems,
        documentTotals: {
          taxPayable: taxAmount,
          netTotal,
          grossTotal,
          // `paymentDate` is required on a recibo, so every document carries its payment.
          // The gross rent is reported here, not `netAmount`: IRS withholding (retenção na
          // fonte) is the tenant remitting part of the landlord's income tax, not a
          // reduction of the sum invoiced, and it has no SAF-T IVA representation.
          payment: [
            {
              paymentMechanism: "OU", // Other
              paymentAmount: grossTotal,
              paymentDate: formatSAFTDate(receipt.paymentDate),
            },
          ],
        },
      } as SAFTInvoice;
    }),
  });

  return xml;
}

/**
 * Build the complete SAF-T XML document
 */
function buildSAFTXML(data: {
  header: SAFTHeader;
  customers: SAFTCustomer[];
  products: SAFTProduct[];
  invoices: SAFTInvoice[];
}): string {
  const { header, customers, products, invoices } = data;

  // Calculate totals
  const totalDebit = invoices.reduce((sum, inv) => {
    return sum + inv.lines.reduce((lineSum, line) => lineSum + (line.debitAmount || 0), 0);
  }, 0);

  const totalCredit = invoices.reduce((sum, inv) => {
    return sum + inv.lines.reduce((lineSum, line) => lineSum + (line.creditAmount || 0), 0);
  }, 0);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<AuditFile xmlns="${SAFT_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <AuditFileVersion>${SAFT_VERSION}</AuditFileVersion>
    <CompanyID>${escapeXML(header.companyID)}</CompanyID>
    <TaxRegistrationNumber>${escapeXML(header.taxRegistrationNumber)}</TaxRegistrationNumber>
    <TaxAccountingBasis>${header.taxAccountingBasis}</TaxAccountingBasis>
    <CompanyName>${escapeXML(header.companyName)}</CompanyName>
    <CompanyAddress>
      ${header.companyAddress.buildingNumber ? `<BuildingNumber>${escapeXML(header.companyAddress.buildingNumber)}</BuildingNumber>` : ""}
      ${header.companyAddress.streetName ? `<StreetName>${escapeXML(header.companyAddress.streetName)}</StreetName>` : ""}
      <AddressDetail>${escapeXML(header.companyAddress.addressDetail)}</AddressDetail>
      <City>${escapeXML(header.companyAddress.city)}</City>
      <PostalCode>${escapeXML(header.companyAddress.postalCode)}</PostalCode>
      ${header.companyAddress.region ? `<Region>${escapeXML(header.companyAddress.region)}</Region>` : ""}
      <Country>${header.companyAddress.country}</Country>
    </CompanyAddress>
    <FiscalYear>${header.fiscalYear}</FiscalYear>
    <StartDate>${header.startDate}</StartDate>
    <EndDate>${header.endDate}</EndDate>
    <CurrencyCode>${header.currencyCode}</CurrencyCode>
    <DateCreated>${header.dateCreated}</DateCreated>
    <TaxEntity>${escapeXML(header.taxEntity)}</TaxEntity>
    <ProductCompanyTaxID>${header.productCompanyTaxID}</ProductCompanyTaxID>
    <SoftwareCertificateNumber>${header.softwareCertificateNumber}</SoftwareCertificateNumber>
    <ProductID>${escapeXML(header.productID)}</ProductID>
    <ProductVersion>${header.productVersion}</ProductVersion>
  </Header>
  
  <MasterFiles>
    <Customer>
${customers
  .map(
    (c) => `      <CustomerID>${escapeXML(c.customerID)}</CustomerID>
      <AccountID>${escapeXML(c.accountID)}</AccountID>
      <CustomerTaxID>${escapeXML(c.customerTaxID)}</CustomerTaxID>
      <CompanyName>${escapeXML(c.companyName)}</CompanyName>
      <BillingAddress>
        <AddressDetail>${escapeXML(c.billingAddress.addressDetail)}</AddressDetail>
        <City>${escapeXML(c.billingAddress.city)}</City>
        <PostalCode>${escapeXML(c.billingAddress.postalCode)}</PostalCode>
        <Country>${c.billingAddress.country}</Country>
      </BillingAddress>
      <SelfBillingIndicator>${c.selfBillingIndicator}</SelfBillingIndicator>`,
  )
  .join("\n    </Customer>\n    <Customer>\n")}
    </Customer>
    
    <Product>
${products
  .map(
    (p) => `      <ProductType>${p.productType}</ProductType>
      <ProductCode>${escapeXML(p.productCode)}</ProductCode>
      ${p.productGroup ? `<ProductGroup>${escapeXML(p.productGroup)}</ProductGroup>` : ""}
      <ProductDescription>${escapeXML(p.productDescription)}</ProductDescription>
      <ProductNumberCode>${escapeXML(p.productNumberCode)}</ProductNumberCode>`,
  )
  .join("\n    </Product>\n    <Product>\n")}
    </Product>
  </MasterFiles>
  
  <SourceDocuments>
    <SalesInvoices>
      <NumberOfEntries>${invoices.length}</NumberOfEntries>
      <TotalDebit>${totalDebit.toFixed(2)}</TotalDebit>
      <TotalCredit>${totalCredit.toFixed(2)}</TotalCredit>
${invoices.map((inv) => buildInvoiceXML(inv)).join("\n")}
    </SalesInvoices>
  </SourceDocuments>
</AuditFile>`;

  return xml;
}

/**
 * Build XML for a single invoice
 */
function buildInvoiceXML(invoice: SAFTInvoice): string {
  return `      <Invoice>
        <InvoiceNo>${escapeXML(invoice.invoiceNo)}</InvoiceNo>
        <ATCUD>${escapeXML(invoice.ATCUD)}</ATCUD>
        <DocumentStatus>
          <InvoiceStatus>${invoice.documentStatus.invoiceStatus}</InvoiceStatus>
          <InvoiceStatusDate>${invoice.documentStatus.invoiceStatusDate}</InvoiceStatusDate>
          <SourceID>${escapeXML(invoice.documentStatus.sourceID)}</SourceID>
          <SourceBilling>${invoice.documentStatus.sourceBilling}</SourceBilling>
        </DocumentStatus>
        <Hash>${invoice.hash}</Hash>
        <HashControl>${invoice.hashControl}</HashControl>
        <Period>${invoice.period}</Period>
        <InvoiceDate>${invoice.invoiceDate}</InvoiceDate>
        <InvoiceType>${invoice.invoiceType}</InvoiceType>
        <SelfBillingIndicator>${invoice.selfBillingIndicator}</SelfBillingIndicator>
        <SourceID>${escapeXML(invoice.sourceID)}</SourceID>
        <SystemEntryDate>${invoice.systemEntryDate}</SystemEntryDate>
        <CustomerID>${escapeXML(invoice.customerID)}</CustomerID>
${invoice.lines
  .map(
    (line) => `        <Line>
          <LineNumber>${line.lineNumber}</LineNumber>
          <ProductCode>${escapeXML(line.productCode)}</ProductCode>
          <ProductDescription>${escapeXML(line.productDescription)}</ProductDescription>
          <Quantity>${line.quantity}</Quantity>
          <UnitOfMeasure>${line.unitOfMeasure}</UnitOfMeasure>
          <UnitPrice>${line.unitPrice.toFixed(2)}</UnitPrice>
          <TaxPointDate>${line.taxPointDate}</TaxPointDate>
          <Description>${escapeXML(line.description)}</Description>
          ${line.creditAmount !== undefined ? `<CreditAmount>${line.creditAmount.toFixed(2)}</CreditAmount>` : ""}
          ${line.debitAmount !== undefined ? `<DebitAmount>${line.debitAmount.toFixed(2)}</DebitAmount>` : ""}
          <Tax>
            <TaxType>${line.tax.taxType}</TaxType>
            <TaxCountryRegion>${line.tax.taxCountryRegion}</TaxCountryRegion>
            <TaxCode>${line.tax.taxCode}</TaxCode>
            <TaxPercentage>${line.tax.taxPercentage.toFixed(2)}</TaxPercentage>
          </Tax>
          ${line.taxExemptionReason ? `<TaxExemptionReason>${escapeXML(line.taxExemptionReason)}</TaxExemptionReason>` : ""}
          ${line.taxExemptionCode ? `<TaxExemptionCode>${line.taxExemptionCode}</TaxExemptionCode>` : ""}
        </Line>`,
  )
  .join("\n")}
        <DocumentTotals>
          <TaxPayable>${invoice.documentTotals.taxPayable.toFixed(2)}</TaxPayable>
          <NetTotal>${invoice.documentTotals.netTotal.toFixed(2)}</NetTotal>
          <GrossTotal>${invoice.documentTotals.grossTotal.toFixed(2)}</GrossTotal>
${
  invoice.documentTotals.payment
    ?.map(
      (p) => `          <Payment>
            <PaymentMechanism>${p.paymentMechanism}</PaymentMechanism>
            <PaymentAmount>${p.paymentAmount.toFixed(2)}</PaymentAmount>
            <PaymentDate>${p.paymentDate}</PaymentDate>
          </Payment>`,
    )
    .join("\n") || ""
}
        </DocumentTotals>
      </Invoice>`;
}

/**
 * Validate SAF-T export data before generation
 */
export function validateSAFTData(options: SAFTExportOptions): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!validateNIF(options.companyInfo.nif)) {
    errors.push("Invalid company NIF");
  }

  if (!options.companyInfo.name || options.companyInfo.name.length < 2) {
    errors.push("Company name is required");
  }

  if (!options.companyInfo.address.addressDetail) {
    errors.push("Company address is required");
  }

  if (
    !options.companyInfo.address.postalCode ||
    !/^\d{4}-\d{3}$/.test(options.companyInfo.address.postalCode)
  ) {
    errors.push("Valid Portuguese postal code is required (format: XXXX-XXX)");
  }

  if (options.fiscalYear < 2000 || options.fiscalYear > new Date().getFullYear() + 1) {
    errors.push("Invalid fiscal year");
  }

  if (options.startMonth && (options.startMonth < 1 || options.startMonth > 12)) {
    errors.push("Invalid start month");
  }

  if (options.endMonth && (options.endMonth < 1 || options.endMonth > 12)) {
    errors.push("Invalid end month");
  }

  if (options.startMonth && options.endMonth && options.startMonth > options.endMonth) {
    errors.push("Start month cannot be after end month");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Export type for API
 */
export interface SAFTExportResult {
  success: boolean;
  xml?: string;
  filename?: string;
  errors?: string[];
  invoiceCount?: number;
  totalAmount?: number;
  period?: {
    fiscalYear: number;
    startDate: string;
    endDate: string;
  };
}
