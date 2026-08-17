import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WorkIntegration from "./components/WorkIntegration";
import UpdateIntegration from "./components/UpdateIntegration";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <WorkIntegration />
    <UpdateIntegration />
  </React.StrictMode>,
);
