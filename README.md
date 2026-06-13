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
- **Escenarios**: intersección con STOP, rotonda e incorporación a autovía.
- Guardar/Restaurar (localStorage) y Exportar/Importar la pista como JSON.

Navegación: rueda para zoom, arrastrar con botón central/derecho (o botón
izquierdo sobre vacío) para desplazar.

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
| `give-way` | Ceda el paso / STOP con *gap acceptance* en cruces. |
| `curve-speed` | Reduce la velocidad según el radio de las curvas. |

**Añadir un comportamiento** = escribir una regla y añadirla al array. Por
ejemplo, semáforos, límites por tramo, distancia de cortesía, agresividad del
conductor, cambios de carril, etc. No hay que tocar el bucle de simulación.

## Limitaciones conocidas / próximos pasos
- **Demanda**: el destino se elige al azar entre las salidas alcanzables.
  Siguiente paso: matrices origen→destino configurables por entrada/salida.
- **Cambios de carril**: aún no hay maniobras de cambio de carril ni
  *gap acceptance* lateral; las incorporaciones se resuelven por car-following
  sobre el carril común y metering de entrada. Es la siguiente regla a
  incorporar (y lo que permitiría rotondas y autovías de varios carriles).
- **Saturación**: una rotonda de un solo carril muy saturada puede acabar
  bloqueándose (fenómeno real en rotondas pequeñas, agravado aquí por no tener
  cambios de carril). A densidades moderadas fluye con normalidad.
- **Semáforos** y **carriles de giro dedicados**: pendientes (encajan como una
  regla y un tipo de control de nodo más).
- Prioridad en cruces con control mutuo (p. ej. STOP de 4 direcciones) usa una
  heurística simple (ceder ante vías prioritarias + evitar ocupación); puede
  mejorarse con orden de llegada.
