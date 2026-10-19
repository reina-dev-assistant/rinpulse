import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProject } from "@/model/defaults";
import { LINK_KEY, isChanged, readLink, useCloud, writeLink } from "./store";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

describe("persisted link", () => {
  it("round-trips id, revision, name and the autosave switch", () => {
    const storage = new MemoryStorage();
    writeLink({ linked: { id: "p1", rev: 4, name: "Face" }, autosave: true }, storage);
    expect(JSON.parse(storage.getItem(LINK_KEY)!)).toEqual({ id: "p1", rev: 4, name: "Face", autosave: true });
    expect(readLink(storage)).toEqual({ linked: { id: "p1", rev: 4, name: "Face" }, autosave: true });
  });

  it("never holds a document", () => {
    const storage = new MemoryStorage();
    writeLink({ linked: { id: "p1", rev: 1, name: "Face" }, autosave: false }, storage);
    expect(Object.keys(JSON.parse(storage.getItem(LINK_KEY)!)).sort()).toEqual(["autosave", "id", "name", "rev"]);
  });

  it("keeps the autosave choice with no link, and forgets everything when both are off", () => {
    const storage = new MemoryStorage();
    writeLink({ linked: null, autosave: true }, storage);
    expect(readLink(storage)).toEqual({ linked: null, autosave: true });
    writeLink({ linked: null, autosave: false }, storage);
    expect(storage.getItem(LINK_KEY)).toBeNull();
  });

  it.each([
    ["nothing", null],
    ["not JSON", "{oops"],
    ["not an object", "5"],
    ["no id", JSON.stringify({ rev: 1 })],
    ["a zero revision", JSON.stringify({ id: "p", rev: 0 })],
    ["a fractional revision", JSON.stringify({ id: "p", rev: 1.5 })],
    ["a string revision", JSON.stringify({ id: "p", rev: "1" })],
  ])("starts unlinked from %s", (_label, raw) => {
    const storage = new MemoryStorage();
    if (raw !== null) storage.setItem(LINK_KEY, raw);
    expect(readLink(storage).linked).toBeNull();
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLink(broken)).toEqual({ linked: null, autosave: false });
    expect(() => writeLink({ linked: null, autosave: true }, broken)).not.toThrow();
  });
});

describe("cloud store", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    useCloud.setState({ linked: null, status: "idle", autosave: false, access: "unknown", baseline: null, conflict: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("linking records the face as the baseline, marks it saved and persists the link", () => {
    const project = emptyProject("A");
    useCloud.getState().link({ id: "p1", rev: 2, name: "A" }, project);
    const state = useCloud.getState();
    expect(state.linked).toEqual({ id: "p1", rev: 2, name: "A" });
    expect(state.status).toBe("saved");
    expect(state.baseline?.project).toBe(project);
    expect(JSON.parse(storage.getItem(LINK_KEY)!)).toMatchObject({ id: "p1", rev: 2 });
  });

  it("linking clears a conflict", () => {
    useCloud.setState({ status: "conflict", conflict: { rev: 9, updatedAt: 1 } });
    useCloud.getState().link({ id: "p1", rev: 3, name: "A" }, emptyProject());
    expect(useCloud.getState().conflict).toBeNull();
    expect(useCloud.getState().status).toBe("saved");
  });

  it("relinking changes revision and name but keeps the baseline", () => {
    const project = emptyProject("A");
    useCloud.getState().link({ id: "p1", rev: 1, name: "A" }, project);
    useCloud.getState().relink({ id: "p1", rev: 2, name: "B" });
    expect(useCloud.getState().linked).toEqual({ id: "p1", rev: 2, name: "B" });
    expect(useCloud.getState().baseline?.project).toBe(project);
    expect(JSON.parse(storage.getItem(LINK_KEY)!)).toMatchObject({ rev: 2, name: "B" });
  });

  it("unlinking forgets the link and the baseline but keeps the autosave choice", () => {
    useCloud.getState().setAutosave(true);
    useCloud.getState().link({ id: "p1", rev: 1, name: "A" }, emptyProject());
    useCloud.getState().unlink();
    expect(useCloud.getState()).toMatchObject({ linked: null, baseline: null, status: "idle", autosave: true });
    expect(readLink(storage)).toEqual({ linked: null, autosave: true });
  });

  it("the autosave switch is persisted", () => {
    useCloud.getState().setAutosave(true);
    expect(readLink(storage).autosave).toBe(true);
    useCloud.getState().setAutosave(false);
    expect(storage.getItem(LINK_KEY)).toBeNull();
  });
});

describe("isChanged", () => {
  it("an unknown baseline counts as changed", () => {
    expect(isChanged(emptyProject(), null)).toBe(true);
  });

  it("the same object, or one with the same content, is unchanged", () => {
    const project = emptyProject();
    const baseline = { project, json: JSON.stringify(project) };
    expect(isChanged(project, baseline)).toBe(false);
    expect(isChanged(structuredClone(project), baseline)).toBe(false);
  });

  it("an edit is a change, and undoing it is not", () => {
    const project = emptyProject("A");
    const baseline = { project, json: JSON.stringify(project) };
    expect(isChanged({ ...project, name: "B" }, baseline)).toBe(true);
    expect(isChanged({ ...project, name: "A" }, baseline)).toBe(false);
  });
});
