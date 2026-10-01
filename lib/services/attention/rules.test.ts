import { describe, expect, it } from "vitest";
import { receiptBlockers } from "@/lib/tax/at/receipt-request";
import { attentionCounts, attentionItems, type AttentionItem, type AttentionLease } from "./rules";

/**
 * The list of what a receipt still needs from the owner. NIFs here pass their check digit unless a
 * test says otherwise: 123456789 and 234567899 are individuals', 501234560 a company's.
 */

function lease(overrides: Partial<AttentionLease> = {}): AttentionLease {
  return {
    id: "lease-1",
    property: "T2 na Rua Augusta",
    contractNumber: "1234567",
    tenant: { id: "tenant-1", name: "Rui Silva", nif: "234567899", country: "PT", document: null },
    landlords: [{ id: "owner-1", name: "Ana Costa", nif: "123456789" }],
    ...overrides,
  };
}

const kinds = (items: AttentionItem[]) => items.map((item) => item.kind);

describe("attentionItems", () => {
  it("lists nothing for a lease a receipt could go out for", () => {
    expect(attentionItems([lease()])).toEqual([]);
    expect(attentionItems([])).toEqual([]);
  });

  describe("a lease's AT contract number", () => {
    it.each([
      ["none", null],
      ["blank", "   "],
    ])("is missing when it is %s", (_name, contractNumber) => {
      expect(attentionItems([lease({ contractNumber })])).toEqual([
        {
          id: "contract_number:lease-1",
          kind: "contract_number",
          weight: "blocks_receipt",
          record: { type: "lease", id: "lease-1" },
          name: "Rui Silva",
          property: "T2 na Rua Augusta",
          problem: "missing",
          current: null,
        },
      ]);
    });

    it("is invalid when it is not digits, and says what is stored", () => {
      const [item] = attentionItems([lease({ contractNumber: " 12AB " })]);

      expect(item).toMatchObject({ kind: "contract_number", problem: "invalid", current: "12AB" });
    });
  });

  describe("a landlord's NIF", () => {
    it("is missing when the owner has none, and the owner is the record", () => {
      const [item] = attentionItems([
        lease({ landlords: [{ id: "owner-1", name: "Ana Costa", nif: null }] }),
      ]);

      expect(item).toMatchObject({
        id: "landlord_nif:owner-1",
        kind: "landlord_nif",
        record: { type: "owner", id: "owner-1" },
        name: "Ana Costa",
        property: "T2 na Rua Augusta",
        problem: "missing",
        current: null,
      });
    });

    it("is invalid when its check digit is wrong, and says what is stored", () => {
      const [item] = attentionItems([
        lease({ landlords: [{ id: "owner-1", name: "Ana Costa", nif: "123456780" }] }),
      ]);

      expect(item).toMatchObject({
        kind: "landlord_nif",
        problem: "invalid",
        current: "123456780",
      });
    });

    it("is asked once for an owner of two properties, and once for each co-owner", () => {
      const noNif = (id: string, name: string) => ({ id, name, nif: null });
      const items = attentionItems([
        lease({ id: "lease-1", landlords: [noNif("owner-1", "Ana"), noNif("owner-2", "Bruno")] }),
        lease({
          id: "lease-2",
          property: "T1 na Rua do Ouro",
          landlords: [noNif("owner-1", "Ana")],
        }),
      ]);

      expect(items.map((item) => item.record.id)).toEqual(["owner-1", "owner-2"]);
      // The first lease places the question.
      expect(items[0].property).toBe("T2 na Rua Augusta");
    });
  });

  describe("a tenant", () => {
    const tenant = (overrides: Partial<AttentionLease["tenant"]>) => ({
      id: "tenant-1",
      name: "Rui Silva",
      nif: "234567899",
      country: "PT",
      document: null,
      ...overrides,
    });

    it("needs a NIF when Portuguese and has none", () => {
      const [item] = attentionItems([lease({ tenant: tenant({ nif: null }) })]);

      expect(item).toMatchObject({
        id: "tenant_nif:tenant-1",
        kind: "tenant_nif",
        record: { type: "tenant", id: "tenant-1" },
        problem: "missing",
      });
    });

    it("needs a country's document, not a NIF, when foreign and has none", () => {
      const [item] = attentionItems([
        lease({ tenant: tenant({ nif: null, country: "FR", document: " " }) }),
      ]);

      expect(item).toMatchObject({ kind: "tenant_document", problem: "missing" });
    });

    it("asks for nothing more of a foreign tenant who has a document", () => {
      expect(
        attentionItems([
          lease({ tenant: tenant({ nif: null, country: "FR", document: "12AB34" }) }),
        ]),
      ).toEqual([]);
    });

    it("is invalid when the NIF fails its check digit", () => {
      const [item] = attentionItems([lease({ tenant: tenant({ nif: "234567890" }) })]);

      expect(item).toMatchObject({ kind: "tenant_nif", problem: "invalid", current: "234567890" });
    });

    it("lists no field for a company, which stops the receipt but has nothing to type in", () => {
      expect(attentionItems([lease({ tenant: tenant({ nif: "501234560" }) })])).toEqual([]);
    });

    it("is asked once for a tenant of two leases", () => {
      const items = attentionItems([
        lease({ id: "lease-1", tenant: tenant({ nif: null }) }),
        lease({ id: "lease-2", tenant: tenant({ nif: null }) }),
      ]);

      expect(items).toHaveLength(1);
    });
  });

  it("puts what blocks a receipt in the order the review lists it, then by name", () => {
    const items = attentionItems([
      lease({
        id: "lease-b",
        contractNumber: null,
        tenant: { id: "t-b", name: "Zé", nif: null, country: "PT", document: null },
        landlords: [{ id: "o-1", name: "Ana", nif: null }],
      }),
      lease({
        id: "lease-a",
        contractNumber: null,
        tenant: { id: "t-a", name: "Alberto", nif: null, country: "PT", document: null },
        landlords: [{ id: "o-1", name: "Ana", nif: null }],
      }),
    ]);

    expect(items.map((item) => item.id)).toEqual([
      "contract_number:lease-a",
      "contract_number:lease-b",
      "landlord_nif:o-1",
      "tenant_nif:t-a",
      "tenant_nif:t-b",
    ]);
  });
});

/**
 * The list and the receipt review answer one question, whether a field is good enough, so they must
 * never answer it differently: a field the review refuses is listed, and one it accepts is not.
 */
describe("the list and the receipt review agree", () => {
  const contractNumbers = [null, "", "  ", "1234567", "12AB", "1".repeat(19)];
  const nifs = [null, "123456789", "123456780", "501234560", "45123456", "abc"];
  const tenants = [
    { country: "PT", document: null },
    { country: "FR", document: null },
    { country: "FR", document: "AB123" },
  ];

  const cases = contractNumbers.flatMap((contractNumber) =>
    nifs.flatMap((nif) => tenants.map((who) => ({ contractNumber, nif, ...who }))),
  );

  it.each(cases)(
    "contract $contractNumber, NIF $nif, country $country, document $document",
    ({ contractNumber, nif, country, document }) => {
      const subject = lease({
        contractNumber,
        landlords: [{ id: "owner-1", name: "Ana Costa", nif }],
        tenant: { id: "tenant-1", name: "Rui Silva", nif, country, document },
      });

      const blocked = receiptBlockers({
        contractNumber,
        contractVersion: null,
        landlords: subject.landlords,
        tenants: [subject.tenant],
        year: 2026,
        month: 9,
        amount: 750,
        receivedOn: "2026-09-03",
        today: "2026-09-27",
      }).map((blocker) => blocker.code);
      const listed = kinds(attentionItems([subject]));

      expect(listed.includes("contract_number")).toBe(
        blocked.some((code) => code.startsWith("contract_number")),
      );
      expect(listed.includes("landlord_nif")).toBe(
        blocked.some((code) => code.startsWith("landlord_nif")),
      );
      expect(listed.includes("tenant_nif")).toBe(
        blocked.some((code) => code === "tenant_nif_missing" || code === "tenant_nif_invalid"),
      );
      expect(listed.includes("tenant_document")).toBe(blocked.includes("tenant_document_missing"));
    },
  );
});

describe("attentionCounts", () => {
  it("counts the items, and by how much they matter", () => {
    const items = attentionItems([
      lease({
        contractNumber: null,
        landlords: [{ id: "owner-1", name: "Ana Costa", nif: null }],
      }),
    ]);

    expect(attentionCounts(items)).toEqual({
      total: 2,
      blocksReceipt: 2,
      reminders: 0,
      niceToHave: 0,
    });
    expect(attentionCounts([])).toEqual({
      total: 0,
      blocksReceipt: 0,
      reminders: 0,
      niceToHave: 0,
    });
  });
});
