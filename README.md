# SimRoads — Simulador de tráfico web

Simulador de tráfico en el navegador con **editor de pistas** y **modo
simulación**. Permite reproducir carreteras reales (no un grid) conectando vías
curvables, definir carriles y sentidos, colocar señales (ceda el paso / STOP) y
observar el comportamiento de distintos tipos de vehículos bajo distintas
densidades de tráfico.

Construido con **TypeScript + Canvas 2D + Vite**, sin dependencias de runtime.

## Arrancar

```bash
npm install
npm run dev        # servidor de desarrollo (Vite)
npm run build      # typecheck + build de producción a dist/
npm run smoke      # prueba de humo headless del motor de simulación
```

## Cómo se usa

### Modo Editor
- **Vía**: clic para crear nodos y conectarlos con segmentos. Los clics
  encadenan vías conectadas; `Esc` corta la cadena.
- **Editar**: arrastra nodos para moverlos y los tiradores naranjas de un
  segmento seleccionado para **curvar** la vía (Bézier cúbica). Selecciona un
  segmento para editar nº de carriles por sentido, ancho y límite de velocidad.
  Los **anillos** en sus dos extremos permiten **desenganchar** el tramo de un
  cruce (se le crea un nodo propio) y, soltándolos sobre otro nodo, **reconectar**
  sin tener que borrar y volver a dibujar.
- **Conexión**: define a mano qué carril conecta con qué a través de un cruce.
  Acércate a un nodo y verás los **anclajes** de cada carril: clic en uno de
  ENTRADA (azul) y luego en uno de SALIDA (verde) para crear/quitar ese giro.
  Mientras un nodo no tenga conexiones manuales, se generan automáticamente
  todos los giros posibles; al añadir la primera pasa a modo manual. Tecla `A`
  para devolver el nodo a automático.
- **Señal**: clic cerca del extremo de una vía para alternar
  `ninguna → ceda el paso → STOP` en esa aproximación.
- **Borrar**: elimina nodos (y sus vías) o vías sueltas.

Las flechas claras sobre cada carril indican el **sentido de circulación**.

**Atajos de teclado:** `Tab` / `1` / `2` cambian de modo · `V E C G D`
seleccionan herramienta · `A` vuelve un nodo a automático (en Conexión) ·
`Esc` cancela · en simulación, `Espacio` play/pausa y `R` reinicia.
- **Escenarios** (desplegable): intersección con STOP, cruce en T (ceda),
  STOP de 4 direcciones, rotonda (2 carriles), incorporación a autovía, salida de
  autovía, carretera con curvas y un **mapa grande** (rotonda de 3 carriles +
  intersección + autovía con entrada y salida interconectadas). Los multicarril usan conexiones manuales para imponer
  disciplina de carril (p. ej. la incorporación entra solo al carril derecho).
- Guardar/Restaurar (localStorage) y Exportar/Importar la pista como JSON.

**Navegación e interacción.** En el editor el modelo es "tocar = actuar,
arrastrar = mover la cámara": un toque/clic aplica la herramienta activa en ese
punto, y arrastrar desplaza la vista (salvo al agarrar un nodo o un tirador con
la herramienta Editar). La rueda hace zoom en escritorio.

**Móvil / táctil.** Funciona con gestos: un dedo toca (herramienta) o arrastra
(desplaza), **dos dedos** hacen *pinch* para zoom y desplazamiento simultáneos.
El panel de control es un *bottom sheet* plegable; el botón flotante (☰ / ✕)
lo muestra u oculta para dejar sitio al lienzo.

### Modo Simulación
- Play/Pausa (`Espacio`), Reiniciar.
- **Densidad de tráfico** (veh/s) y **velocidad de simulación** (time scale).
- Activar/desactivar **tipos de vehículo** (coche, furgoneta, camión, autobús),
  cada uno con longitud, aceleración, frenada y velocidad máxima propias.
- Activar/desactivar **reglas de comportamiento** en caliente.
- Estadísticas en vivo (vehículos, velocidad media, generados, llegados).

## Arquitectura

```
src/
  core/        Matemáticas: vectores, Bézier, polilíneas (recorrido por arco).
  network/     Modelo editable (nodos, segmentos, señales) y su compilación
               al grafo de ejecución (carriles + conectores + conflictos).
  editor/      Herramientas e interacción del editor.
  sim/         Motor de simulación: vehículos, enrutado y el sistema de reglas.
  render/      Cámara (pan/zoom) y renderizador Canvas.
  ui/          Panel de control (DOM) y estilos.
```

### Modelo de red (editable → ejecutable)
El usuario manipula un modelo sencillo: **nodos** (uniones), **segmentos**
(vías entre dos nodos con forma de Bézier, nº de carriles por sentido, ancho y
límite) y **señales**. De ahí se *compila* un grafo de ejecución:

- **Carriles** (`Lane`): polilíneas desplazadas del eje del segmento (sentido
  ida a la derecha del eje, vuelta a la izquierda — conducción por la derecha).
- **Conectores** (`Connector`): tramos cortos que unen un carril entrante con
  uno saliente dentro de un nodo (los movimientos de giro). Así una intersección
  o una rotonda emergen de conectar segmentos, sin casos especiales.
- **Conflictos** (`Conflict`): puntos donde dos conectores se cruzan,
  precalculados para resolver prioridades en tiempo de simulación.

Cualquier edición marca el grafo como sucio y se recompila de forma perezosa.

### Enrutado (estilo GPS)
Cuando un vehículo aparece, se le asigna un **destino** (una salida alcanzable) y
se le calcula la **ruta más rápida** con Dijkstra sobre el grafo de carriles
(las aristas son los conectores, ponderadas por tiempo estimado = longitud /
velocidad). El vehículo sigue esa ruta fija hasta salir, en lugar de decidir los
giros al azar (`src/sim/Router.ts`). En cruces y rotondas esto produce
trayectorias coherentes y evita que los coches den vueltas sin sentido.

**Reparto entre carriles.** En vías y rotondas de varios carriles, todos los
carriles tienen prácticamente el mismo coste, así que un Dijkstra puro metería
todo el tráfico en uno solo (normalmente el interior, más corto). Para evitarlo,
cada vehículo recibe un **carril preferido** que abarata ligeramente ese índice
de carril en todo su trayecto, repartiendo el tráfico entre los carriles
paralelos sin necesidad de modelar cambios de carril. Las rotondas multicarril
usan disciplina de carril (sin *weaving*): se circula en el carril elegido y la
entrada puede alimentar cualquier carril y cualquier carril puede salir.

Las incorporaciones (entradas de rotonda, *on-ramps*) aplican **metering de
entrada**: un vehículo que cede no entra a la unión salvo que haya hueco temporal
en la vía prioritaria **y** espacio físico justo después de la fusión
("don't block the box"), lo que evita el bloqueo en bucle cerrado.

### Sistema de reglas (extensible)
El comportamiento vive en **un único array de reglas** (`src/sim/rules/index.ts`).
Cada regla recibe un `RuleContext` (líder delante, señal próxima, si el cruce
está libre…) y devuelve una **aceleración deseada** (o `null` si no aplica). El
motor aplica la **más restrictiva** (mínimo), acotada al confort del vehículo.

Reglas incluidas:
| Regla | Qué hace |
|-------|----------|
| `cruise` | Acelera hasta la velocidad deseada (límite de vía / vehículo). |
| `car-following` | Distancia de seguridad al líder (modelo IDM). |
| `proximity` | Anticolisión de proximidad (frena ante vehículos del mismo sentido físicamente delante, en cualquier carril). |
| `junction` | Prioridad y anticolisión cooperativa en cruces, fusiones y rotondas. |
| `curve-speed` | Reduce la velocidad según el radio de las curvas. |

**Anticolisión.** Los cruces tienen área real (los carriles se retraen del nodo
y los conectores cruzan el interior). La regla `junction` resuelve la prioridad
con un **orden total por nodo** (señal → si hay empate, quien esté más cerca de
entrar; desempate por id), lo que evita ciclos de cesión (deadlocks) y mantiene
exclusión mutua: no se entra a un cruce mientras un movimiento en conflicto esté
en curso. Además, tras integrar el movimiento, una **salvaguarda de separación**
empuja hacia atrás a cualquier vehículo que solape al de delante en su ruta.

**Añadir un comportamiento** = escribir una regla y añadirla al array. Por
ejemplo, semáforos, límites por tramo, distancia de cortesía, agresividad del
conductor, cambios de carril, etc. No hay que tocar el bucle de simulación.

## Limitaciones conocidas / próximos pasos
- **Demanda**: el destino se elige al azar entre las salidas alcanzables.
  Siguiente paso: matrices origen→destino configurables por entrada/salida.
- **Cambios de carril / incorporaciones**: aún no hay maniobras de cambio de
  carril ni *gap acceptance* lateral con carril de aceleración. En una
  incorporación muy saturada, el coche que cede espera en el punto de unión y
  puede solaparse visualmente con el tráfico del carril principal (su "línea de
  ceda" cae sobre el carril). Es la siguiente regla a incorporar (y lo que
  permitiría rotondas y autovías de varios carriles de verdad). En el resto de
  escenarios la anticolisión mantiene los vehículos separados.
- **Saturación**: un cruce o rotonda muy por encima de su capacidad se congestiona
  (fenómeno real). A densidades moderadas fluye con normalidad.
- **Semáforos** y **carriles de giro dedicados**: pendientes (encajan como una
  regla y un tipo de control de nodo más).
- Prioridad en cruces con control mutuo (p. ej. STOP de 4 direcciones) usa una
  heurística simple (ceder ante vías prioritarias + evitar ocupación); puede
  mejorarse con orden de llegada.
