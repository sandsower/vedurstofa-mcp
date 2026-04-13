import { describe, expect, it } from "vitest";

import { UnknownStationError } from "../src/errors.js";
import {
  normalizeName,
  resolveStation,
  resolveStations,
  suggestStations,
  type Station,
} from "../src/stations.js";

function makeCatalog(): Station[] {
  const rows: Array<Omit<Station, "nameNormalized">> = [
    { id: "1470", name: "Reykjavík" },
    { id: "3471", name: "Akureyri" },
    { id: "570", name: "Egilsstaðir" },
    { id: "4323", name: "Reykjahlíð" },
    { id: "2644", name: "Ísafjörður" },
    { id: "1350", name: "Keflavík" },
  ];
  return rows.map((r) => ({ ...r, nameNormalized: normalizeName(r.name) }));
}

describe("normalizeName", () => {
  it("strips diacritics and lowercases", () => {
    expect(normalizeName("Reykjavík")).toBe("reykjavik");
    expect(normalizeName("Ísafjörður")).toBe("isafjordur");
    expect(normalizeName("  Akureyri  ")).toBe("akureyri");
  });
});

describe("resolveStation", () => {
  const catalog = makeCatalog();

  it("resolves by numeric ID", () => {
    const r = resolveStation("1470", catalog);
    expect(r.station.name).toBe("Reykjavík");
    expect(r.matchedBy).toBe("id");
  });

  it("resolves by exact name regardless of diacritics or case", () => {
    expect(resolveStation("reykjavik", catalog).station.id).toBe("1470");
    expect(resolveStation("ÍSAFJÖRÐUR", catalog).station.id).toBe("2644");
  });

  it("resolves by prefix if no exact match", () => {
    const r = resolveStation("Akur", catalog);
    expect(r.station.id).toBe("3471");
    expect(r.matchedBy).toBe("prefix");
  });

  it("throws UnknownStationError with suggestions for a typo", () => {
    try {
      resolveStation("Reykjabík", catalog);
      expect.fail("expected UnknownStationError");
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownStationError);
      const e = err as UnknownStationError;
      expect(e.message).toContain("Did you mean");
      const names = e.suggestions.map((s) => s.name);
      expect(names).toContain("Reykjavík");
    }
  });

  it("throws with empty suggestions when input is empty", () => {
    expect(() => resolveStation("", catalog)).toThrow(UnknownStationError);
  });
});

describe("suggestStations", () => {
  it("ranks exact-prefix matches highest", () => {
    const catalog = makeCatalog();
    const suggestions = suggestStations("Reyk", catalog, 3);
    expect(suggestions[0]?.name.startsWith("Reyk")).toBe(true);
  });
});

describe("resolveStations", () => {
  it("separates successful and failed inputs", () => {
    const catalog = makeCatalog();
    const result = resolveStations(["1470", "bogus", "Akureyri"], catalog);
    expect(result.resolved).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.input).toBe("bogus");
  });
});
