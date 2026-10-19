import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, matchLocale, resolveLocale } from "./locale";
import { resources } from "./resources";

type Tree = { readonly [key: string]: string | Tree };

/** `namespace.path.to.key` for every leaf, plural suffixes folded (`_one`, `_other` are one key). */
function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = `${prefix}${prefix ? "." : ""}${key}`;
    if (typeof value === "string") out.set(path.replace(/_(zero|one|two|few|many|other)$/, ""), value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]).sort();

describe("locale resolution", () => {
  it("takes the stored device choice, then the browser languages, then Indonesian", () => {
    expect(resolveLocale({ stored: "en", device: ["id-ID"] })).toBe("en");
    expect(resolveLocale({ stored: "xx", device: ["fr-FR", "en-GB", "id"] })).toBe("en");
    expect(resolveLocale({ stored: null, device: ["in"] })).toBe("id");
    expect(resolveLocale({ stored: null, device: ["fr-FR"] })).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({})).toBe("id");
  });

  it("knows the shipped locales", () => {
    expect(isLocale("id") && isLocale("en") && !isLocale("fr") && !isLocale(null)).toBe(true);
    expect(matchLocale("en_US")).toBe("en");
    expect(matchLocale(undefined)).toBeNull();
  });
});

describe("resources", () => {
  for (const ns of Object.keys(resources.id) as (keyof typeof resources.id)[]) {
    it(`${ns}: Indonesian and English hold the same keys, with the same placeholders, and no empty text`, () => {
      const id = leaves(resources.id[ns] as Tree);
      const en = leaves(resources.en[ns] as Tree);
      expect([...en.keys()].sort()).toEqual([...id.keys()].sort());
      for (const [key, text] of id) {
        expect(text.trim(), `id ${ns}.${key}`).not.toBe("");
        expect(en.get(key)?.trim(), `en ${ns}.${key}`).not.toBe("");
        expect(placeholders(en.get(key) ?? ""), `placeholders ${ns}.${key}`).toEqual(placeholders(text));
      }
    });
  }
});
