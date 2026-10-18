import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./ride.css";
import { getLang } from "./i18n.ts";
import { RideApp } from "./ui/RideApp.tsx";

document.documentElement.lang = getLang();
createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <RideApp />
  </StrictMode>,
);
