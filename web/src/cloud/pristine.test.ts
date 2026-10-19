import { describe, expect, it } from "vitest";
import { emptyProject, newImage } from "@/model/defaults";
import { isPristine } from "./pristine";

describe("isPristine", () => {
  it("a fresh face is, whatever its ids", () => {
    expect(isPristine(emptyProject())).toBe(true);
    expect(isPristine(emptyProject("Other name"))).toBe(true);
  });

  it("a face with an edited layer or an extra layer is not", () => {
    const project = emptyProject();
    expect(isPristine({ ...project, elements: [...project.elements, newImage(null, 10, 10)] })).toBe(false);
    expect(isPristine({ ...project, elements: project.elements.map((e) => (e.type === "time" ? { ...e, x: e.x + 1 } : e)) })).toBe(false);
    expect(isPristine({ ...project, author: "me" })).toBe(false);
  });
});
