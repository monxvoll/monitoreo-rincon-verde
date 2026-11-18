# Monitoreo Agricola - Rincon Verde

La aplicación principal usa PostgreSQL para historial y tiempo real
(`LISTEN/NOTIFY`). La rama `feat/comparacion-tiempo-real` agrega un perfil
opcional para levantar Redis en paralelo, dashboards por motor y un comparador
de latencias.

## Ejecución con Docker

El proyecto se debe iniciar utilizando Docker Compose.

1. Es necesario tener Docker en ejecución.
2. Desde una terminal en la raíz del proyecto, ejecutar el siguiente comando:

```bash
cd monitoreo_agricola
docker compose up -d --build
```

Este comando iniciará:
- El servidor de PostgreSQL en `127.0.0.1:5433`
- El Backend (FastAPI) en el puerto `8000`
- El Frontend (Nginx/Servidor estático) en el puerto `8080`
- El Simulador de sensores en segundo plano

El esquema de la base de datos se crea automáticamente desde `db/init.sql`.
Este script solo se ejecuta cuando el volumen de PostgreSQL está vacío. Para
reinicializar la base de datos:

```bash
docker compose down -v
docker compose up -d --build
```

Para detener todos los servicios, ejecutar:
```bash
docker compose down
```

## Variables de entorno

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL | `postgresql://postgres:postgres@localhost:5433/monitoreo` |
| `POSTGRES_PORT` | Puerto del host publicado por Docker (solo en `127.0.0.1`) | `5433` |
| `REDIS_APPENDFSYNC` | Política AOF del Redis del comparador (`everysec` o `always`) | `everysec` |
| `REDIS_PORT` | Puerto local de Redis para la comparación | `6379` |
| `REDIS_BACKEND_PORT` | Puerto del backend que lee desde Redis | `8001` |
| `COMPARADOR_PORT` | Puerto del servicio comparador | `8010` |
| `INTERVALO_MS` | Intervalo entre ciclos del comparador | `1000` |
| `NUM_FINCAS` | Fincas del simulador, espejo y comparador | `6` |
| `VENTANA_MUESTRAS` | Muestras usadas para las métricas rolling | `300` |

PostgreSQL se publica en `127.0.0.1` para evitar conflictos con instalaciones
locales y no exponer la base a la red. Para conectarse desde el host:

```bash
psql -h localhost -p 5433 -U postgres -d monitoreo
```

Si el puerto `5433` también está ocupado, iniciar con otro puerto:

```bash
POSTGRES_PORT=55432 docker compose up -d --build
```

Backend y simulador comparten la misma `DATABASE_URL`; Docker Compose la define
apuntando al servicio `postgres`.

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/historial/{finca}` | Historial reciente de una finca |
| WS | `/ws/monitoreo` | Datos en tiempo real vía WebSocket |

El backend PostgreSQL escucha en `8000`. Con el perfil `comparacion` se agrega
un backend equivalente en `8001` que lee el historial y el Pub/Sub desde Redis.

## Comparación Redis vs PostgreSQL

El benchmark y la metodología están documentados en
[`monitoreo_agricola/docs/COMPARACION.md`](monitoreo_agricola/docs/COMPARACION.md).

```bash
pip install -r monitoreo_agricola/benchmark/requirements.txt
python monitoreo_agricola/benchmark/bench.py --backend postgres --n 1000
# Linea base con Redis (docker run -d --name benchmark-redis -p 6379:6379 redis:alpine)
python monitoreo_agricola/benchmark/bench.py --backend redis --n 1000
```

### Comparación en vivo

El arranque normal sigue usando solo PostgreSQL. Redis, el backend Redis, el
espejo de datos y el comparador se levantan con el perfil `comparacion`:

```bash
cd monitoreo_agricola
docker compose --profile comparacion up -d --build
```

Dashboards:

- PostgreSQL: `http://localhost:8080/postgres.html` (backend `8000`)
- Redis: `http://localhost:8080/redis.html` (backend `8001`)
- Comparación de latencias: `http://localhost:8080/comparacion.html` (comparador `8010`)
- Aplicación principal: `http://localhost:8080/index.html`

El servicio `espejo-redis` escucha las lecturas que el simulador inserta en
PostgreSQL y replica exactamente las mismas en Redis (`finca_1` a `finca_6`).
Así los dashboards de ambos motores muestran los mismos valores, con una
diferencia de milisegundos por la copia asíncrona. El comparador mantiene sus
propias fincas `comparacion_1..6` para medir latencia sin mezclarse con los
datos de la aplicación.

- Redis: `127.0.0.1:6379` con AOF (`everysec` por defecto)
- Espejo PostgreSQL → Redis: activo mientras el perfil `comparacion` esté levantado
- Comparador: `http://localhost:8010`

El comparador escribe cada lectura en ambos motores, alternando el orden, y
publica métricas por `GET /api/resumen` y `WS /ws/comparacion`. Para usar
`fsync` en cada escritura:

```bash
REDIS_APPENDFSYNC=always docker compose --profile comparacion up -d --build
```

La comparación simultánea es demostrativa: ambos motores compiten por CPU y
disco, así que no sustituye las cifras secuenciales del benchmark.

Si se cambia `COMPARADOR_PORT` o `REDIS_BACKEND_PORT`, también hay que ajustar
las URLs correspondientes en `monitoreo_agricola/frontend/js/config.js`.
