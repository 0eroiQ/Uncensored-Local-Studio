import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WorkIntegration from "./components/WorkIntegration";
import WorkTextChatChrome from "./components/WorkTextChatChrome";
import WorkCodingModelsIntegration from "./components/WorkCodingModelsIntegration";
import WorkDownloadMonitor from "./components/WorkDownloadMonitor";
import WorkAgentIntegration from "./components/WorkAgentIntegration";
import WorkHandoffIntegration from "./components/WorkHandoffIntegration";
import UpdateIntegration from "./components/UpdateIntegration";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <WorkIntegration />
    <WorkTextChatChrome />
    <WorkCodingModelsIntegration />
    <WorkDownloadMonitor />
    <WorkAgentIntegration />
    <WorkHandoffIntegration />
    <UpdateIntegration />
  </React.StrictMode>,
);
