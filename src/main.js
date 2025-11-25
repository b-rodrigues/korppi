import "./editor.js";
import { showHistory, hideHistory } from "./history.js";

window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("history-toggle");
    const sidebar = document.getElementById("history-sidebar");

    btn.addEventListener("click", () => {
        if (sidebar.style.display === "none") {
            showHistory();
        } else {
            hideHistory();
        }
    });
});
