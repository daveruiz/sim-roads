import { RoadNetwork, SerializedNetwork } from "./network/RoadNetwork.ts";
import { Simulation } from "./sim/Simulation.ts";
import { Editor, EditorTool } from "./editor/Editor.ts";
import { Camera } from "./render/Camera.ts";
import { Renderer, RenderOptions } from "./render/Renderer.ts";
import { Vec2 } from "./core/vec.ts";
import { PRESETS } from "./network/presets.ts";

export type Mode = "editor" | "sim";

const STORAGE_KEY = "simroads.track";

/** Top-level application: owns state, the render loop and input handling. */
export class App {
  net: RoadNetwork;
  sim: Simulation;
  camera: Camera;
  editor: Editor;
  renderer: Renderer;

  mode: Mode = "editor";
  running = false;
  timeScale = 1;
  showConflicts = false;

  /** Called after any change the UI should reflect (rebuilds panels). */
  onChange: () => void = () => {};

  private lastTime = 0;
  private panning = false;
  private lastPointer: Vec2 = { x: 0, y: 0 };

  constructor(public canvas: HTMLCanvasElement) {
    this.net = PRESETS[0].build();
    this.sim = new Simulation(this.net);
    this.camera = new Camera(canvas);
    this.editor = new Editor(this.net, this.camera);
    this.renderer = new Renderer(canvas, this.camera, this.net, this.sim);

    this.bindInput();
    requestAnimationFrame((t) => this.loop(t));
  }

  /* ----------------------------- state ---------------------------- */

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === "sim") {
      this.editor.cancel();
    } else {
      this.running = false;
      this.sim.reset();
    }
    this.onChange();
  }

  loadNetwork(net: RoadNetwork): void {
    this.net = net;
    this.sim = new Simulation(net);
    this.editor = new Editor(net, this.camera);
    this.renderer.net = net;
    this.renderer.sim = this.sim;
    this.running = false;
    this.onChange();
  }

  loadPreset(id: string): void {
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) this.loadNetwork(preset.build());
  }

  clear(): void {
    this.loadNetwork(new RoadNetwork());
  }

  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.net.serialize()));
  }

  load(): void {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as SerializedNetwork;
      this.loadNetwork(RoadNetwork.deserialize(data));
    } catch {
      /* ignore corrupt save */
    }
  }

  exportJSON(): string {
    return JSON.stringify(this.net.serialize(), null, 2);
  }

  importJSON(text: string): boolean {
    try {
      const data = JSON.parse(text) as SerializedNetwork;
      this.loadNetwork(RoadNetwork.deserialize(data));
      return true;
    } catch {
      return false;
    }
  }

  /* --------------------------- main loop -------------------------- */

  private loop(t: number): void {
    const dtReal = Math.min(0.05, (t - this.lastTime) / 1000 || 0);
    this.lastTime = t;

    if (this.mode === "sim" && this.running) {
      // Sub-step for stability at high time scales.
      const dt = dtReal * this.timeScale;
      const steps = Math.max(1, Math.ceil(dt / 0.04));
      const sub = dt / steps;
      for (let i = 0; i < steps; i++) this.sim.step(sub);
    }

    this.renderer.render(this.renderOptions());
    requestAnimationFrame((next) => this.loop(next));
  }

  private renderOptions(): RenderOptions {
    const connectMode = this.mode === "editor" && this.editor.tool === "connect";
    return {
      mode: this.mode,
      selectedSegment: this.editor.selectedSegment,
      showConflicts: this.showConflicts,
      hoverNode: this.mode === "editor" ? this.editor.hoverNode : null,
      pendingStart:
        this.mode === "editor" && this.editor.pendingNode
          ? this.net.nodes.get(this.editor.pendingNode)?.pos ?? null
          : null,
      cursorWorld: this.editor.cursorWorld,
      connectMode,
      linkHoverNode: connectMode ? this.editor.linkHoverNode : null,
      linkFrom: connectMode ? this.editor.linkFrom?.ref ?? null : null,
      anchors:
        connectMode && this.editor.linkHoverNode
          ? this.editor.anchorsAt(this.editor.linkHoverNode)
          : [],
    };
  }

  /* ----------------------------- input ---------------------------- */

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", () => this.onUp());
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  private screenPos(e: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onDown(e: PointerEvent): void {
    const screen = this.screenPos(e);
    this.lastPointer = screen;
    const world = this.camera.screenToWorld(screen);
    const isPanButton = e.button !== 0;

    if (this.mode === "editor" && !isPanButton) {
      const consumed = this.editor.onPointerDown(world);
      this.onChange();
      if (consumed) return;
    }
    this.panning = true;
  }

  private onMove(e: PointerEvent): void {
    const screen = this.screenPos(e);
    const world = this.camera.screenToWorld(screen);
    if (this.panning) {
      this.camera.pan(screen.x - this.lastPointer.x, screen.y - this.lastPointer.y);
    } else if (this.mode === "editor") {
      this.editor.onPointerMove(world);
    }
    this.lastPointer = screen;
  }

  private onUp(): void {
    this.panning = false;
    this.editor.onPointerUp();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.camera.zoomAt(screen, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  private onKey(e: KeyboardEvent): void {
    // Ignore when typing into a form control.
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();

    if (key === "escape") {
      this.editor.cancel();
      this.onChange();
      return;
    }

    // Mode switching.
    if (key === "tab") {
      e.preventDefault();
      this.setMode(this.mode === "editor" ? "sim" : "editor");
      return;
    }
    if (key === "1") return this.setMode("editor");
    if (key === "2") return this.setMode("sim");

    if (this.mode === "sim") {
      if (key === " ") {
        e.preventDefault();
        this.running = !this.running;
        this.onChange();
      }
      if (key === "r") {
        this.sim.reset();
        this.onChange();
      }
      return;
    }

    // Editor tool shortcuts.
    const tools: Record<string, EditorTool> = {
      v: "road",
      e: "select",
      c: "connect",
      g: "sign",
      d: "delete",
    };
    if (key === "delete" || key === "backspace" || key === "x") {
      this.editor.tool = "delete";
      this.onChange();
      return;
    }
    if (key === "a" && this.editor.tool === "connect") {
      this.editor.resetHoveredNodeToAuto();
      this.onChange();
      return;
    }
    if (tools[key]) {
      this.editor.tool = tools[key];
      this.editor.cancel();
      this.onChange();
    }
  }
}
