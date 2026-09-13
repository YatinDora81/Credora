import { describe, it, expect } from "bun:test";
import { canonicaliseSector } from "./sectors";

describe("canonicaliseSector — the table, first match wins", () => {
  it("maps the crypto family", () => {
    expect(canonicaliseSector("Trading in virtual digital assets")).toBe("crypto_trading");
    expect(canonicaliseSector("CRYPTO exchange")).toBe("crypto_trading");
    expect(canonicaliseSector("cryptocurrency brokerage")).toBe("crypto_trading");
    expect(canonicaliseSector("Bitcoin ATM operator")).toBe("crypto_trading");
    expect(canonicaliseSector("web3 token issuance")).toBe("crypto_trading");
  });

  it("maps gambling, unregistered lending, wholesale, trade and electronics", () => {
    expect(canonicaliseSector("Online Betting")).toBe("gambling");
    expect(canonicaliseSector("casino operations")).toBe("gambling");
    expect(canonicaliseSector("Chit fund operator")).toBe("unregistered_lending");
    expect(canonicaliseSector("unlicensed credit provider")).toBe("unregistered_lending");
    expect(canonicaliseSector("Wholesale of electronic goods")).toBe("wholesale_distribution");
    expect(canonicaliseSector("FMCG distribution")).toBe("wholesale_distribution");
    expect(canonicaliseSector("Import of consumer electronics")).toBe("import_export");
    expect(canonicaliseSector("Export house")).toBe("import_export");
    expect(canonicaliseSector("consumer electronics retail")).toBe("electronics");
  });

  it("is case-insensitive and matches on substrings", () => {
    expect(canonicaliseSector("WHOLESALE")).toBe("wholesale_distribution");
    expect(canonicaliseSector("retail electronics showroom")).toBe("electronics");
  });

  it("returns null for anything unmatched", () => {
    expect(canonicaliseSector("Textile manufacturing")).toBeNull();
    expect(canonicaliseSector("")).toBeNull();
    expect(canonicaliseSector("services")).toBeNull();
  });

  it("honours the table order when several tags could match", () => {
    expect(canonicaliseSector("Wholesale of crypto mining rigs")).toBe("crypto_trading");
    expect(canonicaliseSector("Wholesale import of electronics")).toBe("wholesale_distribution");
    expect(canonicaliseSector("Import of electronics")).toBe("import_export");
  });
});

describe("canonicaliseSector — the A.2.3 activities line", () => {
  const LINE =
    "Wholesale of electronic goods; Trading in virtual digital assets; Import of consumer electronics";

  it("tokenised on ';' yields wholesale_distribution, crypto_trading, import_export", () => {
    const tags = LINE.split(";").map((t) => canonicaliseSector(t.trim()));
    expect(tags).toEqual([
      "wholesale_distribution",
      "crypto_trading",
      "import_export",
    ]);
  });

  it("matched whole, the line returns crypto_trading — the table's first row wins", () => {
    expect(canonicaliseSector(LINE)).toBe("crypto_trading");
  });
});
