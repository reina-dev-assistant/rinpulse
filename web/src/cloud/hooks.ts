import { useMemo } from "react";
import { useEditor } from "@/editor/store";
import { isChanged, useCloud } from "./store";

/** Whether the open face differs from the cloud copy it is linked to (false when it is not linked). */
export function useCloudChanged(): boolean {
  const project = useEditor((s) => s.project);
  const linked = useCloud((s) => s.linked !== null);
  const baseline = useCloud((s) => s.baseline);
  return useMemo(() => linked && isChanged(project, baseline), [project, linked, baseline]);
}
