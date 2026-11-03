import React from "react";
import ReactDOM from "react-dom/client";
import { LanguageProvider } from "./context/LanguageProvider";
import App from "./App";
import "@fontsource-variable/noto-sans-bengali";
import "./styles.css";
import "./styles-v2.css";
import "./styles-v3.css";
import "./styles-v4.css";
import "./theme.css";
import "./semantic-colors.css";
import "./scrollbars.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
