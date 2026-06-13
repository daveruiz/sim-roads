import "./ui/styles.css";
import { App } from "./app.ts";
import { buildUI } from "./ui/panels.ts";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;

const app = new App(canvas);
buildUI(app, ui);

// Centre the view on the initial preset.
app.camera.x = 0;
app.camera.y = 0;
app.camera.zoom = 4;
