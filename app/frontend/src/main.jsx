import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WorkIntegration from "./components/WorkIntegration";
import WorkCodingModelsIntegration from "./components/WorkCodingModelsIntegration";
import WorkAgentIntegration from "./components/WorkAgentIntegration";
import UpdateIntegration from "./components/UpdateIntegration";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <WorkIntegration />
    <WorkCodingModelsIntegration />
    <WorkAgentIntegration />
    <UpdateIntegration />
  </React.StrictMode>,
);
