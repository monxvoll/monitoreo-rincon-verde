# Explicación de los cambios — Monitoreo Agrícola Rincón Verde

Guía para exponer las dos mejoras de esta entrega:

1. **Ampliar el número de fincas** (de 2 a 6).
2. **Añadir una gráfica** que explique los datos por sí sola.

---

## 1. Punto de partida

Arquitectura existente (no cambió):

```
sensor_mock.py ──► Redis (historial + Pub/Sub) ──► FastAPI (REST + WebSocket) ──► Frontend (nginx)
```

- El **simulador** genera temperatura, humedad y CO₂ cada 5 s por finca.
- **Redis** guarda las últimas 50 lecturas por finca y publica cada lectura en un canal.
- El **backend** expone `/api/historial/{finca}` y el WebSocket `/ws/monitoreo`, y marca `alerta` si temperatura > 30 °C o CO₂ > 800 ppm.
- El **frontend** mostraba tarjetas con medidores y tablas de historial, pero **sin ninguna vista de tendencia**.

**Problemas detectados:**
- La lista de fincas estaba repetida en el simulador, en `config.js` y en `index.html` (HTML copiado a mano por finca). Añadir una finca implicaba tocar varios archivos.
- Una etiqueta de alerta tenía escrito a mano `"Finca 1" / "Finca 2"`.
- Los valores eran aleatorios puros, así que una gráfica habría sido solo ruido.

---

## 2. Ampliar a 6 fincas

**Backend:** no hubo que cambiarlo. Ya funciona con cualquier identificador de finca, porque lee `{finca}:historial` y difunde todos los mensajes del canal.

### Simulador — [sensor_mock.py](sensor_mock.py)
- `NUM_FINCAS` (variable de entorno, 6 por defecto) genera `finca_1 … finca_6`.
- Cada finca avanza con una **deriva suave** (*random walk* acotado): en cada lectura el valor cambia un poco, nunca fuera de rango. Esto da tendencias legibles y fincas que a veces cruzan el umbral.

### Frontend
- [config.js](frontend/js/config.js): **fuente única** de la lista de fincas (`NUM_FINCAS`, `FINCAS`, `nombreFinca()`).
- [render.js](frontend/js/render.js) (nuevo): genera por JS las tarjetas y las tablas de historial a partir de `FINCAS`. Se borró el HTML duplicado de [index.html](frontend/index.html).
- [ui.js](frontend/js/ui.js): el nombre en las alertas usa `nombreFinca(id)`.
- [history.css](frontend/css/history.css): el historial pasó de 2 columnas fijas a un grid `auto-fit`, para que quepan las 6 tablas.

**Qué decir:** *"Antes, agregar una finca era copiar bloques de HTML. Ahora cambiar un número en `config.js` basta para que la interfaz crezca."*

---

## 3. La gráfica

Archivos: [chart.js](frontend/js/chart.js), [chart.css](frontend/css/chart.css) y la sección nueva en `index.html`. Usa **Chart.js** cargado por CDN, sin proceso de build.

### Qué muestra
- **Líneas en tiempo real** de las últimas 50 lecturas por finca.
- **Selector de métrica:** temperatura, humedad o CO₂.
- **Selector de finca:** todas superpuestas (una línea de color por finca) o una sola.
- **Línea punteada roja del umbral** (30 °C y 800 ppm), para ver *cuándo y por cuánto* se dispara una alerta.

### Por qué "explica los datos por sí sola"
Debajo del gráfico hay un **resumen en texto generado automáticamente** a partir de los datos actuales:
- Promedio de las fincas.
- Finca con el valor más alto y con el más bajo.
- Cuántas fincas superan el umbral y cuáles.
- Con una finca elegida, su tendencia reciente (estable, al alza o a la baja).

Quien mire el panel no tiene que interpretar las líneas: el texto ya lo dice.

### Cómo se alimenta
```
cargarHistorial()  ──► cargarPuntosGrafica()   (carga inicial, invertida a orden cronológico)
WebSocket (cada 5 s) ─► agregarPuntoGrafica()  (punto nuevo en vivo; máximo 50 por serie)
```
Los dos caminos ya existían para las tarjetas y las tablas; solo se les añadió una llamada.

---

## 4. Resumen de archivos

| Archivo | Cambio |
|---|---|
| `sensor_mock.py` | 6 fincas, deriva suave |
| `frontend/js/config.js` | lista única de fincas |
| `frontend/js/render.js` | **nuevo**, genera tarjetas y tablas |
| `frontend/js/chart.js` | **nuevo**, gráfica y resumen |
| `frontend/css/chart.css` | **nuevo**, estilos de la gráfica |
| `frontend/index.html` | contenedores vacíos, sección de gráfica, CDN de Chart.js |
| `frontend/js/{main,api,websocket,ui}.js` | conectan render, gráfica y nombres |
| `frontend/css/{history,main}.css` | grid del historial e import de `chart.css` |

---

## 5. Cómo demostrarlo

```bash
docker compose up --build
# abrir http://localhost:8080
```
1. Mostrar las **6 tarjetas** y las 6 tablas.
2. Mostrar la **gráfica** y cambiar entre temperatura, humedad y CO₂.
3. Seleccionar una finca y leer el **resumen** y la tendencia.
4. Señalar la **línea roja** del umbral y esperar a que una finca la cruce: se ve la alerta en la tarjeta y en el texto.

> **Nota:** durante el desarrollo no se pudo ejecutar el sistema completo (Docker no estaba activo). Se verificó la sintaxis de todo el JS y el comportamiento del simulador. Conviene hacer una prueba completa antes de exponer.

## 6. Posibles preguntas
- **¿Por qué Chart.js y no SVG propio?** Es más rápido de implementar, maneja ejes, leyendas y *tooltips*, y no necesita build.
- **¿Por qué deriva suave en el simulador?** Con valores independientes en cada lectura, la gráfica sería ruido y no mostraría tendencias.
- **¿Se puede escalar a más fincas?** Sí: se cambia `NUM_FINCAS` en `config.js` y en el simulador (variable de entorno).
