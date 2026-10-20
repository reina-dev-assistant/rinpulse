// Writes src/timbangan.ts from the scale protocol registry. Run by `bun run build`; run `bun run timbangan`
// after changing the registry or GROUPS in scripts/timbangan.ts.
import { writeFileSync } from "node:fs";
import { render } from "./timbangan";

writeFileSync(new URL("../src/timbangan.ts", import.meta.url), render());
