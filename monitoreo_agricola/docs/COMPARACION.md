# Comparacion: Redis vs PostgreSQL para monitoreo en tiempo real

Este documento compara la implementacion con Redis (rama `main`) y la
implementacion con PostgreSQL (rama `feat/postgres-migracion`).

## Objetivo

Determinar que base de datos conviene para el monitoreo agricola en tiempo real,
midiendo latencia, throughput, tiempo real y consumo de recursos con la misma
carga de trabajo.

## Implementaciones comparadas

| Aspecto | Redis (`main`) | PostgreSQL (esta rama) |
|---------|----------------|------------------------|
| Estado actual | `SET finca:estado_actual` | Ultima fila de `lecturas` |
| Historial | `LPUSH` + `LTRIM` a 50 registros | Tabla `lecturas` + `ORDER BY ts DESC LIMIT 50` |
| Tiempo real | Pub/Sub `fincas_updates` | `LISTEN/NOTIFY` con trigger `AFTER INSERT` |
| Persistencia | Opcional (AOF); el compose de `main` no la activa | WAL y commits ACID por defecto |
| Duracion de datos | Solo ultimos 50 por finca en memoria | Historial completo en disco |
| Consultas | Solo por clave | SQL, filtros, agregaciones e indices |

El contrato de datos de la API y del WebSocket se mantiene igual, por lo que la
migracion no requirio cambios en el frontend. Ambas ramas usan 6 fincas
(`finca_1` a `finca_6`).

## Metodologia

- **Fecha**: 2026-11-18.
- **Equipo**: AMD Ryzen 5 5500U (6 nucleos / 12 hilos), 7.1 GiB de RAM, Linux.
- **Software**: Docker 29.7.2, Docker Compose 5.5.1, PostgreSQL 16.16,
  Redis 8.10.3.
- **Carga**: `--n 2000` escrituras, `--lecturas 500` consultas de historial y
  `--muestras-tiempo-real 50`.
- **Repeticiones**: 3 corridas por escenario, alternando PostgreSQL y Redis para
  reducir el sesgo por temperatura o carga del equipo. Se reporta la mediana.
- **Aislamiento**: durante las mediciones se detuvieron `backend`, `simulador` y
  `frontend`; solo quedaron activos los motores de base de datos.
- **Red**: ambos motores se accedieron desde el host mediante puertos publicados
  en loopback (`127.0.0.1:5433` para PostgreSQL y `127.0.0.1:6379` para Redis).
- **Limpieza**: antes de cada corrida se eliminaron las filas `bench_%` de
  PostgreSQL y se ejecuto `FLUSHALL` en Redis.

La app de `main` usa Redis sin AOF. Para comparar tambien el efecto de la
durabilidad se midieron dos configuraciones de Redis:

- `AOF everysec`: persistencia con ventana de perdida de hasta ~1 segundo.
- `AOF always`: `fsync` en cada escritura, comparable con el commit sincronico de
  PostgreSQL.

## Preparacion

### Dependencias del benchmark

```bash
cd monitoreo_agricola
python3 -m venv /tmp/rincon-bench-venv
/tmp/rincon-bench-venv/bin/pip install -r benchmark/requirements.txt
```

### PostgreSQL (esta rama)

```bash
docker compose up -d postgres
```

PostgreSQL se publica en `127.0.0.1:5433` para no chocar con una instalacion
local en `5432`.

### Redis (linea base)

```bash
# Escenario principal: AOF everysec
docker run -d --rm --name benchmark-redis \
  -p 127.0.0.1:6379:6379 \
  redis:alpine redis-server --appendonly yes --appendfsync everysec

# Escenario de durabilidad estricta: AOF always
docker run -d --rm --name benchmark-redis \
  -p 127.0.0.1:6379:6379 \
  redis:alpine redis-server --appendonly yes --appendfsync always
```

### Aislamiento de servicios

```bash
docker compose stop backend simulador frontend
```

## Ejecucion

```bash
mkdir -p /tmp/rincon-bench

for i in 1 2 3; do
  docker compose exec -T postgres psql -U postgres -d monitoreo \
    -c "DELETE FROM lecturas WHERE finca_id LIKE 'bench_%';"

  /tmp/rincon-bench-venv/bin/python benchmark/bench.py \
    --backend postgres --n 2000 --lecturas 500 --muestras-tiempo-real 50 \
    --json /tmp/rincon-bench/postgres_$i.json

  docker exec benchmark-redis redis-cli FLUSHALL >/dev/null

  /tmp/rincon-bench-venv/bin/python benchmark/bench.py \
    --backend redis --n 2000 --lecturas 500 --muestras-tiempo-real 50 \
    --json /tmp/rincon-bench/redis_$i.json
done
```

Metricas reportadas:

- **Escritura**: latencia por operacion (INSERT + COMMIT vs SET/LPUSH/LTRIM/PUBLISH).
- **Throughput**: operaciones de escritura por segundo.
- **Lectura de historial**: consulta de los ultimos 50 registros.
- **Tiempo real extremo a extremo**: desde la escritura hasta la recepcion de la
  notificacion (trigger `NOTIFY` vs `PUBLISH`/`SUBSCRIBE`).

## Resultados

Medianas de 3 corridas por escenario.

### PostgreSQL vs Redis con AOF everysec

| Metrica | Redis everysec | PostgreSQL | Diferencia |
|---------|----------------|------------|------------|
| Escritura media (ms) | 0.71 | 3.05 | PostgreSQL ~4.3x mas lento |
| Escritura p95 (ms) | 0.85 | 3.49 | PostgreSQL ~4.1x mas lento |
| Escritura p99 (ms) | 0.95 | 3.66 | PostgreSQL ~3.9x mas lento |
| Throughput (ops/s) | 1372.8 | 324.2 | Redis ~4.2x mayor |
| Lectura historial media (ms) | 0.60 | 0.90 | PostgreSQL ~1.5x mas lento |
| Lectura historial p95 (ms) | 0.73 | 1.09 | PostgreSQL ~1.5x mas lento |
| Tiempo real e2e media (ms) | 1.28 | 3.35 | PostgreSQL ~2.6x mas lento |
| Tiempo real e2e p95 (ms) | 1.25 | 3.79 | PostgreSQL ~3.0x mas lento |
| Tiempo real e2e p99 (ms) | 13.74 | 4.79 | Redis ~2.9x peor en cola |

### PostgreSQL vs Redis con AOF always

| Metrica | Redis always | PostgreSQL | Diferencia |
|---------|--------------|------------|------------|
| Escritura media (ms) | 2.58 | 3.05 | Redis ~15% mas rapido |
| Escritura p95 (ms) | 3.14 | 3.49 | Redis ~10% mas rapido |
| Escritura p99 (ms) | 3.37 | 3.66 | Redis ~8% mas rapido |
| Throughput (ops/s) | 384.2 | 324.2 | Redis ~18% mayor |
| Lectura historial media (ms) | 0.59 | 0.90 | PostgreSQL ~1.5x mas lento |
| Lectura historial p95 (ms) | 0.70 | 1.09 | PostgreSQL ~1.6x mas lento |
| Tiempo real e2e media (ms) | 3.10 | 3.35 | PostgreSQL ~1.1x mas lento |
| Tiempo real e2e p95 (ms) | 3.56 | 3.79 | PostgreSQL ~1.1x mas lento |
| Tiempo real e2e p99 (ms) | 8.81 | 4.79 | PostgreSQL ~1.8x mejor en cola |

### Uso de recursos

Medido con `docker stats` durante la carga, con un solo motor bajo prueba a la
vez. El CPU se expresa respecto a un nucleo.

| Recurso | Redis everysec | Redis always | PostgreSQL |
|---------|----------------|--------------|------------|
| CPU pico | 13.5 % | 35.6 % | 43.3 % |
| Memoria maxima | 11.9 MiB | 11.9 MiB | 33.8 MiB |

El almacenamiento no es directamente comparable: PostgreSQL conserva el historial
completo y los datos previos, mientras que Redis se limito a las operaciones del
benchmark y su AOF se reinicia con `FLUSHALL`. Para referencia, el directorio de
PostgreSQL ocupo 63.9 MB y el AOF de Redis 2.6 MB tras las corridas, pero miden
conjuntos de datos distintos.

## Comparación en vivo

Además del benchmark secuencial, esta rama incluye dashboards simultáneos y un
comparador que escribe la misma lectura en PostgreSQL y Redis, alternando el
orden en cada ciclo.

```bash
cd monitoreo_agricola
docker compose --profile comparacion up -d --build
```

Dashboards:

- PostgreSQL: `http://localhost:8080/postgres.html` (backend `8000`)
- Redis: `http://localhost:8080/redis.html` (backend Redis `8001`)
- Comparación de latencias: `http://localhost:8080/comparacion.html`
- Aplicación principal: `http://localhost:8080/index.html`

El servicio `espejo-redis` escucha `LISTEN/NOTIFY` de PostgreSQL y replica en
Redis las mismas lecturas que genera el simulador normal (`finca_1..6`). De esta
forma ambos dashboards muestran valores idénticos, salvo el retardo de
milisegundos que agrega la copia asíncrona. Si Redis está vacío al arrancar, el
espejo rellena el historial reciente desde PostgreSQL.

- API del comparador: `http://localhost:8010/api/resumen`
- WebSocket del comparador: `ws://localhost:8010/ws/comparacion`
- Redis: `127.0.0.1:6379`, con `--appendonly yes` y
  `--appendfsync ${REDIS_APPENDFSYNC:-everysec}`

El comparador usa las fincas `comparacion_1` a `comparacion_6` para no mezclar
sus datos con las fincas normales de la aplicación. El espejo y el backend Redis
filtran ese prefijo, de modo que los dashboards de motores solo muestran
`finca_1..6`. El perfil `comparacion` levanta Redis, el backend Redis, el espejo
y el comparador; el arranque normal (`docker compose up -d`) sigue usando solo
PostgreSQL.

La escritura simultánea comparte CPU y disco entre ambos motores, por lo que sus
latencia y throughput no son directamente comparables con las cifras
secuenciales de las tablas anteriores. Sirve para observar el comportamiento y
la diferencia de cola en tiempo real; para cifras concluyentes, usar el
benchmark aislado.

## Criterios de analisis

1. **Latencia de escritura**: PostgreSQL agrega escritura en disco y COMMIT. Redis
   sin AOF es ~4x mas rapido; con AOF `always` la diferencia se reduce a ~15 %.
2. **Tiempo real**: con AOF `everysec`, Redis gana en mediana y p95, pero su p99
   empeora (~13.7 ms) por las pausas de `fsync`; PostgreSQL mantiene una cola mas
   estable (~4.8 ms). Con AOF `always`, Redis sigue teniendo peor p99 que
   PostgreSQL.
3. **Lectura de historial**: Redis devuelve una lista de 50 elementos; PostgreSQL
   usa un indice compuesto y queda ~1.5x mas lento, aunque por debajo de 1 ms en
   ambos casos.
4. **Duracion y consultas**: Redis pierde el historial al reiniciar (salvo AOF) y
   esta limitado a 50 registros; PostgreSQL conserva todo y permite analisis
   historico, agregaciones y auditoria.
5. **Complejidad operativa**: Redis es mas simple de operar; PostgreSQL requiere
   esquema, migraciones, respaldos y mantenimiento (VACUUM, indices).
6. **Escalamiento**: Redis Pub/Sub escala bien para difusion; PostgreSQL con muchos
   clientes WebSocket requiere una conexion dedicada por cliente para `LISTEN`, por
   lo que conviene un listener central con difusion en memoria si crece la
   concurrencia.

## Conclusion

- **Suficiencia para el caso de uso**: con 6 fincas y una lectura cada 5 segundos
  (~1.2 escrituras/s), ambos motores estan muy por encima de la carga real. Incluso
  PostgreSQL, el mas lento, escribe en ~3 ms y notifica en ~3.4 ms.
- **Rendimiento**: Redis sin AOF o con `everysec` es claramente mas rapido en
  promedio (~4.3x en escritura y ~2.6x en tiempo real), pero con `everysec` tiene
  peor latencia de cola (p99) que PostgreSQL. Con AOF `always`, la escritura de
  Redis se acerca a PostgreSQL (~2.6 vs ~3.1 ms), aunque PostgreSQL sigue ganando
  en p99 de tiempo real (~4.8 vs ~8.8 ms).
- **Durabilidad e historial**: PostgreSQL conserva todo el historial, ofrece ACID,
  sobrevive reinicios y permite consultas SQL. Redis solo mantiene 50 registros y
  Pub/Sub no es durable; con AOF se agrega persistencia, pero no consultas ni
  historial completo.
- **Recursos**: PostgreSQL consumio mas memoria (~34 MiB vs ~12 MiB) y mas CPU
  pico, aunque ambos valores son bajos para este equipo.
- **Recomendacion**: PostgreSQL es la mejor opcion para este proyecto si se
  prioriza historial, auditoria y durabilidad, ya que su latencia es suficiente
  para la frecuencia de monitoreo. Redis seria preferible solo si se busca la
  minima latencia promedio y no se necesita conservar datos ni consultar el
  historial.
