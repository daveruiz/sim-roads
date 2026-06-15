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
  // Active pointers (mouse or touch) for gesture handling.
  private pointers = new Map<number, Vec2>();
  // Single-pointer interaction state.
  private press: {
    startScreen: Vec2;
    lastScreen: Vec2;
    moved: boolean;
    dragging: boolean;
    canTap: boolean; // only the primary button / touch triggers a tool action
  } | null = null;
  // Two-finger pinch/pan gesture baseline.
  private gesture: { dist: number; mid: Vec2 } | null = null;

  private readonly TAP_THRESHOLD = 8; // px of movement before a press becomes a pan

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
      anchors: connectMode ? this.editor.allAnchors() : [],
      endpointGrips: this.mode === "editor" ? this.editor.endpointGrips() : [],
      snapNode: this.mode === "editor" ? this.editor.snapNode : null,
      snapSegment: this.mode === "editor" ? this.editor.snapSegment : null,
    };
  }

  /* ----------------------------- input ---------------------------- */

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e));
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  private screenPos(e: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture?.(e.pointerId);
    const screen = this.screenPos(e);
    this.pointers.set(e.pointerId, screen);

    if (this.pointers.size === 2) {
      // Second finger: abandon the single interaction and start a pinch gesture.
      if (this.press?.dragging) this.editor.onPointerUp();
      this.press = null;
      this.beginGesture();
      return;
    }
    if (this.pointers.size > 2) return;

    // Single pointer. A non-primary mouse button always pans (never taps).
    const canTap = e.button === 0;
    const world = this.camera.screenToWorld(screen);
    if (this.mode === "editor") {
      this.editor.hover(world);
      const dragging = canTap && this.editor.beginDrag(world);
      this.press = { startScreen: screen, lastScreen: screen, moved: false, dragging, canTap };
      if (dragging) this.onChange();
    } else {
      this.press = { startScreen: screen, lastScreen: screen, moved: false, dragging: false, canTap };
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    const screen = this.screenPos(e);
    this.pointers.set(e.pointerId, screen);

    if (this.gesture && this.pointers.size >= 2) {
      this.updateGesture();
      return;
    }
    if (!this.press) return;

    const world = this.camera.screenToWorld(screen);
    if (this.press.dragging) {
      this.editor.onPointerMove(world);
      this.press.lastScreen = screen;
      return;
    }

    if (!this.press.moved) {
      const dx = screen.x - this.press.startScreen.x;
      const dy = screen.y - this.press.startScreen.y;
      if (Math.hypot(dx, dy) > this.TAP_THRESHOLD) this.press.moved = true;
    }
    if (this.press.moved) {
      this.camera.pan(screen.x - this.press.lastScreen.x, screen.y - this.press.lastScreen.y);
    } else if (this.mode === "editor") {
      this.editor.hover(world); // keep anchors/handles highlighted under the cursor
    }
    this.press.lastScreen = screen;
  }

  private onUp(e: PointerEvent): void {
    this.canvas.releasePointerCapture?.(e.pointerId);
    const had = this.pointers.delete(e.pointerId);
    if (!had) return;

    if (this.gesture) {
      // Leaving a two-finger gesture; re-seat a single press on any remaining
      // finger so the view doesn't jump, and don't fire a tap.
      this.gesture = null;
      const remaining = [...this.pointers.values()][0];
      if (remaining) {
        this.press = {
          startScreen: remaining,
          lastScreen: remaining,
          moved: true,
          dragging: false,
          canTap: false,
        };
      }
      return;
    }

    if (this.press) {
      if (this.press.dragging) {
        this.editor.onPointerUp();
        this.onChange();
      } else if (this.press.canTap && !this.press.moved && this.mode === "editor") {
        // A tap: apply the active tool at the tapped point.
        this.editor.tap(this.camera.screenToWorld(this.press.startScreen));
        this.onChange();
      }
      this.press = null;
    }
  }

  private beginGesture(): void {
    const pts = [...this.pointers.values()];
    this.gesture = {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    };
  }

  private updateGesture(): void {
    if (!this.gesture) return;
    const pts = [...this.pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    // Pan by the midpoint movement, then zoom about the new midpoint.
    this.camera.pan(mid.x - this.gesture.mid.x, mid.y - this.gesture.mid.y);
    this.camera.zoomAt(mid, dist / this.gesture.dist);
    this.gesture = { dist, mid };
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
      s: "split",
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
