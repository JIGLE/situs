import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/tests/helpers/render-with-providers";
import ptMessages from "@/messages/pt.json";
import { sampleExtraction } from "@/tests/fixtures/contract-extraction";
import { ContractImport } from "./contract-import";

const { app, toast, router, nav } = vi.hoisted(() => ({
  app: { refreshData: vi.fn(async () => {}) },
  toast: { success: vi.fn(), error: vi.fn() },
  router: { push: vi.fn(), replace: vi.fn() },
  nav: { search: "" },
}));

vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: { properties: [], owners: [], tenants: [] },
    refreshData: app.refreshData,
  }),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/pt/leases",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const pt = ptMessages.leases.import;
const noMatches = { property: null, landlords: [null, null], tenants: [null, null] };

type Handler = (init?: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that answers only the calls the sheet is expected to make, by method and path. */
function stubApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const configured: Record<string, Handler> = {
  "GET /api/contracts/extract": () => json({ data: { configured: true } }),
};
const pdf = () => new File(["%PDF-1.7 contrato"], "contrato.pdf", { type: "application/pdf" });

/**
 * The review sheet, in Portuguese: asserting English cannot catch hardcoded English. Only the
 * network is stubbed; the draft, its problems and the review sent to the import route are the
 * real ones (lib/services/contracts/draft.ts).
 */
describe("ContractImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    nav.search = "";
  });

  it("shows no button on an instance that cannot read contracts", async () => {
    const fetchMock = stubApi({
      "GET /api/contracts/extract": () => json({ data: { configured: false } }),
    });
    renderWithProviders(<ContractImport />, { initialLocale: "pt" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: pt.button })).not.toBeInTheDocument();
  });

  it("opens the sheet through the address, so a link can open it too", async () => {
    stubApi(configured);
    const user = userEvent.setup();
    renderWithProviders(<ContractImport />, { initialLocale: "pt" });

    await user.click(await screen.findByRole("button", { name: pt.button }));
    expect(router.push).toHaveBeenCalledWith("/pt/leases?import=contract", { scroll: false });
  });

  it("says before sending that the PDF goes to Anthropic, and refuses a file that is not a PDF", async () => {
    nav.search = "import=contract";
    stubApi(configured);
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<ContractImport />, { initialLocale: "pt" });

    expect(await screen.findByText(pt.transfer)).toBeInTheDocument();
    const read = screen.getByRole("button", { name: pt.read });
    expect(read).toBeDisabled();

    await user.upload(
      screen.getByLabelText(pt.contractFile),
      new File(["hello"], "notas.txt", { type: "text/plain" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(ptMessages.leases.toast.pdfOnly);
    expect(read).toBeDisabled();
  });

  it("reads, holds Confirm until each problem is fixed, then imports and stores the contract", async () => {
    nav.search = "import=contract";
    let sentLanguage: FormDataEntryValue | null = null;
    let review: Record<string, unknown> | null = null;
    const fetchMock = stubApi({
      ...configured,
      "POST /api/contracts/extract": (init) => {
        sentLanguage = (init?.body as FormData).get("language");
        return json({ data: { reading: sampleExtraction, matches: noMatches } });
      },
      "POST /api/contracts/import": (init) => {
        review = JSON.parse(String(init?.body));
        return json({ data: { leaseId: "lease-new", propertyId: "p-new", tenantId: "t-new" } });
      },
      "PUT /api/leases/lease-new/contract": () => json({ data: { stored: true } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<ContractImport />, { initialLocale: "pt" });

    await user.upload(await screen.findByLabelText(pt.contractFile), pdf());
    await user.click(screen.getByRole("button", { name: pt.read }));

    // The contract names no landlord email, and Situs needs one for each new owner.
    const problems = await screen.findByTestId("import-problems");
    expect(problems).toHaveTextContent(pt.problemsTitle);
    expect(problems).toHaveTextContent(
      pt.problems.email.replace("{name}", "Maria Fernandes").replace(/\s+$/, ""),
    );
    const confirm = screen.getByRole("button", { name: pt.confirm });
    expect(confirm).toBeDisabled();
    expect(sentLanguage).toBe("pt");

    // Each value shows the words it was read from.
    expect(
      screen.getByText(
        pt.source
          .replace("{page}", "2")
          .replace("{quote}", sampleExtraction.terms.monthlyRent.source!.quote),
      ),
    ).toBeInTheDocument();

    // Pasted rather than typed: each keystroke re-renders the whole review, and typing two
    // addresses a key at a time takes seconds in jsdom.
    await user.click(document.getElementById("import-landlord-0-email")!);
    await user.paste("maria@example.pt");
    await user.click(document.getElementById("import-landlord-1-email")!);
    await user.paste("paulo@example.pt");

    await waitFor(() => expect(screen.queryByTestId("import-problems")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: pt.confirm }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(pt.created));
    expect(review).toMatchObject({
      property: { mode: "new", cadasterReference: "2321", fraction: "C" },
      landlords: [
        { mode: "new", email: "maria@example.pt", share: 50 },
        { mode: "new", email: "paulo@example.pt", share: 50 },
      ],
      tenant: { mode: "new", name: "Ana Costa", taxId: "246813571" },
      lease: { monthlyRent: 950, atContractNumber: "20240012345" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/leases/lease-new/contract",
      expect.objectContaining({ method: "PUT" }),
    );

    // The sheet closes, the data reloads, and the new lease opens.
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/pt/leases?detail=lease%3Alease-new", {
        scroll: false,
      }),
    );
    expect(router.replace).toHaveBeenCalledWith("/pt/leases", { scroll: false });
    expect(app.refreshData).toHaveBeenCalledTimes(1);
  });

  it("says why a reading failed in the owner's language", async () => {
    nav.search = "import=contract";
    stubApi({
      ...configured,
      "POST /api/contracts/extract": () =>
        json({ error: "The model declined to read this contract", reason: "refused" }, 422),
    });
    const user = userEvent.setup();
    renderWithProviders(<ContractImport />, { initialLocale: "pt" });

    await user.upload(await screen.findByLabelText(pt.contractFile), pdf());
    await user.click(screen.getByRole("button", { name: pt.read }));

    expect(await screen.findByRole("alert")).toHaveTextContent(pt.errors.refused);
    expect(screen.queryByText(/declined/)).not.toBeInTheDocument();
    // Back on the first step, with the file still chosen.
    expect(screen.getByRole("button", { name: pt.read })).toBeEnabled();
  });

  it("keeps the lease when its contract fails to store, and says so", async () => {
    nav.search = "import=contract";
    stubApi({
      ...configured,
      "POST /api/contracts/extract": () =>
        json({
          data: {
            reading: {
              ...sampleExtraction,
              landlords: sampleExtraction.landlords.map((l, i) => ({
                ...l,
                email: `owner-${i}@example.pt`,
              })),
            },
            matches: noMatches,
          },
        }),
      "POST /api/contracts/import": () =>
        json({ data: { leaseId: "lease-new", propertyId: "p-new", tenantId: "t-new" } }),
      "PUT /api/leases/lease-new/contract": () => json({ error: "Server error" }, 500),
    });
    const user = userEvent.setup();
    renderWithProviders(<ContractImport />, { initialLocale: "pt" });

    await user.upload(await screen.findByLabelText(pt.contractFile), pdf());
    await user.click(screen.getByRole("button", { name: pt.read }));
    await user.click(await screen.findByRole("button", { name: pt.confirm }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(ptMessages.leases.toast.contractUploadFailed),
    );
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(app.refreshData).toHaveBeenCalledTimes(1));
  });
});
