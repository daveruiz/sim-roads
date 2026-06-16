import { App } from "../app.ts";
import { PRESETS } from "../network/presets.ts";
import { VEHICLE_TYPES } from "../sim/vehicleTypes.ts";
import { RULES } from "../sim/rules/index.ts";
import { EditorTool } from "../editor/Editor.ts";

const TOOLS: { id: EditorTool; label: string; hint: string }[] = [
  { id: "road", label: "Vía (V)", hint: "Clic para crear nodos y conectarlos. Esc cancela la cadena." },
  {
    id: "select",
    label: "Editar (E)",
    hint:
      "Arrastra nodos para moverlos y los tiradores naranjas para curvar. Los anillos en los extremos del tramo seleccionado lo desenganchan del cruce; suéltalos sobre otro nodo —o sobre otra vía— para conectar (parte la vía automáticamente).",
  },
  {
    id: "split",
    label: "Dividir (S)",
    hint: "Clic sobre una vía para partirla en ese punto y crear un cruce.",
  },
  {
    id: "connect",
    label: "Conexión (C)",
    hint:
      "En un cruce: clic en un anclaje de ENTRADA (azul) y luego en uno de SALIDA (verde) para crear/quitar ese giro. Tecla A = volver a automático.",
  },
  { id: "sign", label: "Señal (G)", hint: "Clic cerca del extremo de una vía: ninguna → ceda → STOP." },
  { id: "delete", label: "Borrar (D)", hint: "Clic en un nodo o vía para eliminarlo." },
];

const SHORTCUTS = "Atajos: Tab/1/2 modo · V E C G D S herramientas · A auto · Espacio play · R reinicia";

/** Build and wire the entire control panel. */
export function buildUI(app: App, root: HTMLElement): void {
  root.innerHTML = "";

  const h = el("div", "panel");
  root.appendChild(h);

  // ---- Floating toggle to collapse the panel (key on mobile) ----
  let toggle = document.getElementById("panel-toggle") as HTMLButtonElement | null;
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.id = "panel-toggle";
    document.body.appendChild(toggle);
  }
  const syncToggle = () => (toggle!.textContent = root.classList.contains("hidden") ? "☰" : "✕");
  toggle.onclick = () => {
    root.classList.toggle("hidden");
    syncToggle();
  };
  syncToggle();

  // ---- Header / mode toggle ----
  h.appendChild(title("SimRoads"));
  const modeRow = el("div", "row seg-toggle");
  const editorBtn = button("✏️ Editor", () => app.setMode("editor"));
  const simBtn = button("▶️ Simulación", () => app.setMode("sim"));
  modeRow.append(editorBtn, simBtn);
  h.appendChild(modeRow);

  // ---- Editor panel ----
  const editorPanel = el("div", "section");
  h.appendChild(editorPanel);

  editorPanel.appendChild(label("Herramientas"));
  const toolRow = el("div", "row wrap");
  const toolButtons = TOOLS.map((t) =>
    button(t.label, () => {
      app.editor.tool = t.id;
      app.onChange();
    })
  );
  toolRow.append(...toolButtons);
  editorPanel.appendChild(toolRow);
  const hint = el("div", "hint");
  editorPanel.appendChild(hint);

  editorPanel.appendChild(label("Escenarios"));
  const presetRow = el("div", "row");
  const presetSel = document.createElement("select");
  presetSel.className = "grow";
  for (const p of PRESETS) presetSel.append(option(p.id, p.label));
  presetRow.appendChild(presetSel);
  presetRow.appendChild(button("Cargar", () => app.loadPreset(presetSel.value)));
  editorPanel.appendChild(presetRow);

  const fileRow = el("div", "row wrap");
  fileRow.append(
    button("Nuevo", () => confirm("¿Vaciar la pista actual?") && app.clear()),
    button("Guardar", () => app.save()),
    button("Restaurar", () => app.load()),
    button("Exportar", () => download("track.json", app.exportJSON())),
    button("Importar", () => importFile((text) => app.importJSON(text)))
  );
  editorPanel.appendChild(fileRow);

  const segProps = el("div", "section");
  editorPanel.appendChild(segProps);

  // ---- Simulation panel ----
  const simPanel = el("div", "section");
  h.appendChild(simPanel);

  const playRow = el("div", "row");
  const playBtn = button("", () => {
    app.running = !app.running;
    app.onChange();
  });
  playRow.append(
    playBtn,
    button("↺ Reiniciar", () => {
      app.sim.reset();
      app.onChange();
    })
  );
  simPanel.appendChild(playRow);

  simPanel.appendChild(
    slider("Densidad de tráfico", 0, 4, 0.05, () => app.sim.config.spawnRate, (v) => {
      app.sim.config.spawnRate = v;
    }, (v) => `${v.toFixed(2)} veh/s`)
  );
  simPanel.appendChild(
    slider("Velocidad de simulación", 0.25, 4, 0.25, () => app.timeScale, (v) => {
      app.timeScale = v;
    }, (v) => `${v.toFixed(2)}×`)
  );
  simPanel.appendChild(
    slider("Uso de carriles interiores", 0, 1, 0.05, () => app.sim.config.laneStyle, (v) => {
      app.sim.config.laneStyle = v;
    }, (v) => (v === 0 ? "siempre derecha" : `${Math.round(v * 100)}%`))
  );

  simPanel.appendChild(label("Tipos de vehículo"));
  const typeRow = el("div", "row wrap");
  for (const t of VEHICLE_TYPES) {
    typeRow.appendChild(
      checkbox(t.label, () => app.sim.config.enabledTypes.has(t.id), (on) => {
        if (on) app.sim.config.enabledTypes.add(t.id);
        else app.sim.config.enabledTypes.delete(t.id);
      }, t.color)
    );
  }
  simPanel.appendChild(typeRow);

  simPanel.appendChild(label("Reglas de comportamiento"));
  const ruleList = el("div", "rules");
  for (const rule of RULES) {
    ruleList.appendChild(
      checkbox(rule.label, () => rule.enabled, (on) => {
        rule.enabled = on;
      }, undefined, rule.description)
    );
  }
  simPanel.appendChild(ruleList);

  simPanel.appendChild(
    checkbox("Mostrar puntos de conflicto", () => app.showConflicts, (on) => {
      app.showConflicts = on;
    })
  );

  const stats = el("div", "stats");
  simPanel.appendChild(stats);

  // ---- shortcuts footer (always visible) ----
  const footer = el("div", "section");
  const shortcuts = el("div", "hint");
  shortcuts.textContent = SHORTCUTS;
  footer.appendChild(shortcuts);
  h.appendChild(footer);

  // ---- dynamic sync ----
  function sync(): void {
    const editing = app.mode === "editor";
    editorPanel.style.display = editing ? "" : "none";
    simPanel.style.display = editing ? "none" : "";
    editorBtn.classList.toggle("active", editing);
    simBtn.classList.toggle("active", !editing);

    toolButtons.forEach((b, i) => b.classList.toggle("active", app.editor.tool === TOOLS[i].id));
    hint.textContent = TOOLS.find((t) => t.id === app.editor.tool)?.hint ?? "";

    playBtn.textContent = app.running ? "⏸ Pausa" : "▶ Reproducir";
    playBtn.classList.toggle("active", app.running);

    renderSegProps(app, segProps);
  }
  app.onChange = sync;
  sync();

  // ---- per-frame stats ----
  function tick(): void {
    if (app.mode === "sim") {
      const s = app.sim.stats;
      stats.innerHTML = "";
      stats.append(
        statLine("Vehículos", String(s.vehicles)),
        statLine("Velocidad media", `${(s.avgSpeed * 3.6).toFixed(0)} km/h`),
        statLine("Generados", String(s.spawned)),
        statLine("Llegados", String(s.arrived))
      );
    }
    requestAnimationFrame(tick);
  }
  tick();
}

/* ------------------------- segment properties ------------------------ */

function renderSegProps(app: App, container: HTMLElement): void {
  container.innerHTML = "";
  const id = app.editor.selectedSegment;
  const seg = id ? app.net.segments.get(id) : null;
  if (!seg) {
    container.appendChild(hintText("Selecciona una vía (modo Editar) para ver sus propiedades."));
    return;
  }
  container.appendChild(label("Propiedades de la vía"));
  container.appendChild(
    stepper("Carriles (ida)", 0, 4, () => seg.lanesForward, (v) => {
      app.net.updateSegment(seg.id, { lanesForward: v });
    })
  );
  container.appendChild(
    stepper("Carriles (vuelta)", 0, 4, () => seg.lanesBackward, (v) => {
      app.net.updateSegment(seg.id, { lanesBackward: v });
    })
  );
  container.appendChild(
    sliderInline("Ancho de carril", 2.5, 5, 0.1, () => seg.laneWidth, (v) => {
      app.net.updateSegment(seg.id, { laneWidth: v });
    }, (v) => `${v.toFixed(1)} m`)
  );
  container.appendChild(
    sliderInline("Límite de velocidad", 5, 36, 1, () => seg.speedLimit, (v) => {
      app.net.updateSegment(seg.id, { speedLimit: v });
    }, (v) => `${(v * 3.6).toFixed(0)} km/h`)
  );
}

/* ----------------------------- DOM helpers --------------------------- */

function el(tag: string, cls?: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  if (cls) e.className = cls;
  return e;
}

function title(text: string): HTMLElement {
  const e = el("div", "title");
  e.textContent = text;
  return e;
}

function label(text: string): HTMLElement {
  const e = el("div", "label");
  e.textContent = text;
  return e;
}

function hintText(text: string): HTMLElement {
  const e = el("div", "hint");
  e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function option(value: string, text: string): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}

function checkbox(
  text: string,
  get: () => boolean,
  set: (on: boolean) => void,
  color?: string,
  tooltip?: string
): HTMLElement {
  const lab = document.createElement("label");
  lab.className = "check";
  if (tooltip) lab.title = tooltip;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = get();
  input.onchange = () => set(input.checked);
  lab.append(input);
  if (color) {
    const dot = el("span", "dot");
    dot.style.background = color;
    lab.append(dot);
  }
  lab.append(document.createTextNode(text));
  return lab;
}

function slider(
  name: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
  fmt: (v: number) => string
): HTMLElement {
  const wrap = el("div", "field");
  const head = el("div", "field-head");
  const nameEl = el("span");
  nameEl.textContent = name;
  const valEl = el("span", "val");
  valEl.textContent = fmt(get());
  head.append(nameEl, valEl);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(get());
  input.oninput = () => {
    const v = parseFloat(input.value);
    set(v);
    valEl.textContent = fmt(v);
  };
  wrap.append(head, input);
  return wrap;
}

function sliderInline(
  name: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
  fmt: (v: number) => string
): HTMLElement {
  return slider(name, min, max, step, get, set, fmt);
}

function stepper(
  name: string,
  min: number,
  max: number,
  get: () => number,
  set: (v: number) => void
): HTMLElement {
  const wrap = el("div", "field");
  const head = el("div", "field-head");
  const nameEl = el("span");
  nameEl.textContent = name;
  const valEl = el("span", "val");
  const refresh = () => (valEl.textContent = String(get()));
  head.append(nameEl, valEl);
  const row = el("div", "row");
  row.append(
    button("−", () => {
      set(Math.max(min, get() - 1));
      refresh();
    }),
    button("+", () => {
      set(Math.min(max, get() + 1));
      refresh();
    })
  );
  refresh();
  wrap.append(head, row);
  return wrap;
}

function statLine(name: string, value: string): HTMLElement {
  const e = el("div", "stat");
  const n = el("span");
  n.textContent = name;
  const v = el("span", "val");
  v.textContent = value;
  e.append(n, v);
  return e;
}

/* ----------------------------- file I/O ------------------------------ */

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function importFile(onLoad: (text: string) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    file.text().then(onLoad);
  };
  input.click();
}
