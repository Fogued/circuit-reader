import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-ext-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-ext-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-ext-600.css";
import "@fontsource/barlow-semi-condensed/latin-500.css";
import "@fontsource/barlow-semi-condensed/latin-ext-500.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "@fontsource/barlow-semi-condensed/latin-ext-600.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
