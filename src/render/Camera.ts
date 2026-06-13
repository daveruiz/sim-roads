import { Vec2 } from "../core/vec.ts";

/** Pan/zoom camera mapping world coordinates (metres) to screen pixels. */
export class Camera {
  x = 0; // world point at screen centre
  y = 0;
  zoom = 4; // pixels per metre

  constructor(public canvas: HTMLCanvasElement) {}

  worldToScreen(p: Vec2): Vec2 {
    return {
      x: (p.x - this.x) * this.zoom + this.canvas.clientWidth / 2,
      y: (p.y - this.y) * this.zoom + this.canvas.clientHeight / 2,
    };
  }

  screenToWorld(p: Vec2): Vec2 {
    return {
      x: (p.x - this.canvas.clientWidth / 2) / this.zoom + this.x,
      y: (p.y - this.canvas.clientHeight / 2) / this.zoom + this.y,
    };
  }

  /** Apply the camera transform to a context (so we can draw in world units). */
  apply(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  zoomAt(screen: Vec2, factor: number): void {
    const before = this.screenToWorld(screen);
    this.zoom = Math.max(0.5, Math.min(40, this.zoom * factor));
    const after = this.screenToWorld(screen);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }
}
