import { parseSearch, stringifySearch } from "./router-search";

describe("router search", () => {
  it("keeps plain values as strings", () => {
    expect(parseSearch("?returned=1")).toEqual({ returned: "1" });
    expect(parseSearch("month=2026-09")).toEqual({ month: "2026-09" });
    expect(stringifySearch({ returned: "1" })).toBe("?returned=1");
    expect(stringifySearch({ month: "2026-09" })).toBe("?month=2026-09");
  });

  it("round-trips an encoded path", () => {
    expect(parseSearch("?returnTo=%2Fbillings%2Fnew")).toEqual({ returnTo: "/billings/new" });
    expect(stringifySearch({ returnTo: "/billings/new" })).toBe("?returnTo=%2Fbillings%2Fnew");
  });

  it("reads a repeated key as an ordered array and writes it back", () => {
    expect(parseSearch("?tag=a&tag=b&tag=c")).toEqual({ tag: ["a", "b", "c"] });
    expect(stringifySearch({ tag: ["a", "b"] })).toBe("?tag=a&tag=b");
  });

  it("writes nothing for an empty object", () => {
    expect(stringifySearch({})).toBe("");
    expect(parseSearch("")).toEqual({});
  });

  it("skips undefined and null values", () => {
    expect(stringifySearch({ a: undefined, b: null, c: "x" })).toBe("?c=x");
    expect(stringifySearch({ a: undefined })).toBe("");
  });
});
