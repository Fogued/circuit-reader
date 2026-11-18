import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/greek-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/greek-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/greek-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/greek-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
