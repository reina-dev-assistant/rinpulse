import { i18n } from "@/i18n";
import { installNodeCanvas } from "./node-canvas";

installNodeCanvas();
// The suites assert the English wording; the language switch and the key parity have their own tests (src/i18n).
await i18n.changeLanguage("en");
