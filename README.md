# Monitoreo Agricola - Rincon Verde

Rama `feat/postgres-migracion`: el almacenamiento y el tiempo real usan PostgreSQL
(historial en tabla + `LISTEN/NOTIFY`). La rama `main` conserva la implementacion
con Redis y sirve como linea base para la comparacion.

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

## Comparación Redis vs PostgreSQL

El benchmark y la metodología están documentados en
[`monitoreo_agricola/docs/COMPARACION.md`](monitoreo_agricola/docs/COMPARACION.md).

```bash
pip install -r monitoreo_agricola/benchmark/requirements.txt
python monitoreo_agricola/benchmark/bench.py --backend postgres --n 1000
# Linea base con Redis (docker run -d --name benchmark-redis -p 6379:6379 redis:alpine)
python monitoreo_agricola/benchmark/bench.py --backend redis --n 1000
```
