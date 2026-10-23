import { startBridge } from "@/services/bridge";
import "@/App";

startBridge();

// A file dropped from outside would navigate the window to it
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
});
document.addEventListener("drop", (e) => e.preventDefault());
