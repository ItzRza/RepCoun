import "@fontsource-variable/inter";
import "./styles/main.css";
import { App } from "./app";
import { installCustoms } from "./data/custom";

installCustoms(); // register user-created exercises before the UI starts

const root = document.getElementById("app")!;
new App(root).start();
