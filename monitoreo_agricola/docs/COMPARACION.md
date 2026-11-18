# Comparacion: Redis vs PostgreSQL para monitoreo en tiempo real

Este documento describe la metodologia para comparar la implementacion con Redis
(rama `main`) y la implementacion con PostgreSQL (rama `feat/postgres-migracion`).

## Objetivo

Determinar que base de datos conviene para el monitoreo agricola en tiempo real,
midiendo latencia, throughput y complejidad operativa con la misma carga de trabajo.

## Implementaciones comparadas

| Aspecto | Redis (`main`) | PostgreSQL (esta rama) |
|---------|----------------|------------------------|
| Estado actual | `SET finca:estado_actual` | Ultima fila de `lecturas` |
| Historial | `LPUSH` + `LTRIM` a 50 registros | Tabla `lecturas` + `ORDER BY ts DESC LIMIT 50` |
| Tiempo real | Pub/Sub `fincas_updates` | `LISTEN/NOTIFY` con trigger `AFTER INSERT` |
| Duracion de datos | Solo ultimos 50 por finca (en memoria) | Historial completo en disco |
| Consultas | Solo por clave | SQL, filtros, agregaciones e indices |

El contrato de la API y del WebSocket se mantiene igual, por lo que el frontend
no cambia entre ramas.

## Preparacion

### PostgreSQL (esta rama)

```bash
cd monitoreo_agricola
docker compose down -v
docker compose up -d --build
```

PostgreSQL se publica por defecto en `127.0.0.1:5433` para no chocar con una
instalacion local en `5432`. Si se usa otro puerto, pasar `--url` al benchmark.

### Redis (linea base)

Levantar un Redis temporal mientras se ejecuta el benchmark de esta rama:

```bash
docker run -d --name benchmark-redis -p 6379:6379 redis:alpine
```

O bien ejecutar el mismo script desde `main` con el Redis del `docker-compose`
original.

### Dependencias del benchmark

```bash
pip install -r benchmark/requirements.txt
```

## Ejecucion

Se recomienda reiniciar los servicios antes de cada corrida y ejecutar varias
veces para reducir el ruido.

```bash
python benchmark/bench.py --backend postgres --n 1000 --json resultados_postgres.json
python benchmark/bench.py --backend redis   --n 1000 --json resultados_redis.json
```

Metricas reportadas:

- **Escritura**: latencia por operacion (INSERT + COMMIT vs SET/LPUSH/LTRIM/PUBLISH).
- **Throughput**: operaciones de escritura por segundo.
- **Lectura de historial**: consulta de los ultimos 50 registros.
- **Tiempo real extremo a extremo**: desde la escritura hasta la recepcion de la
  notificacion (trigger `NOTIFY` vs `PUBLISH`/`SUBSCRIBE`).

## Resultados

Corrida preliminar en el equipo de desarrollo: PostgreSQL 16-alpine y Redis alpine,
ambos accedidos desde el host mediante puerto publicado, `--n 500`,
`--lecturas 200`, `--muestras-tiempo-real 20`. Repetir en el entorno objetivo para
obtener cifras definitivas. Redis se ejecuto con su configuracion por defecto (sin
persistencia en disco); habilitar AOF reduce la diferencia de escritura.

| Metrica | Redis | PostgreSQL | Diferencia |
|---------|-------|------------|------------|
| Escritura media (ms) | 0.69 | 3.09 | PostgreSQL ~4.5x mas lento |
| Escritura p95 (ms) | 0.89 | 3.54 | PostgreSQL ~4.0x mas lento |
| Escritura p99 (ms) | 0.94 | 5.55 | PostgreSQL ~5.9x mas lento |
| Throughput (ops/s) | 1405.7 | 319.6 | PostgreSQL ~4.4x menor |
| Lectura historial media (ms) | 0.57 | 0.86 | PostgreSQL ~1.5x mas lento |
| Lectura historial p95 (ms) | 0.71 | 1.14 | PostgreSQL ~1.6x mas lento |
| Tiempo real e2e media (ms) | 1.24 | 3.70 | PostgreSQL ~3.0x mas lento |
| Tiempo real e2e p95 (ms) | 1.17 | 3.94 | PostgreSQL ~3.4x mas lento |

### Uso de recursos

Medido con `docker stats --no-stream` en reposo (PostgreSQL con datos de la
corrida, Redis vacio). Sirve solo como referencia de consumo base.

| Recurso | Redis | PostgreSQL |
|---------|-------|------------|
| Memoria | 10.18 MiB | 41.18 MiB |
| CPU | 0.23 % | 0.00 % |
| Almacenamiento | 385 kB | 51.4 MB |


## Criterios de analisis

1. **Latencia de escritura**: PostgreSQL agrega escritura en disco y COMMIT, por lo
   que se espera mayor latencia que Redis; evaluar si sigue siendo aceptable para
   lecturas cada 5 segundos.
2. **Tiempo real**: comparar `PUBLISH`/`SUBSCRIBE` contra `LISTEN/NOTIFY`. Ambos son
   no durables: si no hay consumidor, el mensaje se pierde. La diferencia esta en la
   latencia y en la carga que agrega el trigger.
3. **Lectura de historial**: Redis solo devuelve 50 elementos de una lista; PostgreSQL
   usa un indice compuesto. Comparar a medida que crece la tabla.
4. **Duracion y consultas**: Redis pierde el historial al reiniciar (salvo persistencia
   configurada) y esta limitado a 50 registros; PostgreSQL conserva todo y permite
   analisis historico, agregaciones y auditoria.
5. **Complejidad operativa**: Redis es mas simple de operar; PostgreSQL requiere
   esquema, migraciones, respaldos y mantenimiento (VACUUM, indices).
6. **Escalamiento**: Redis Pub/Sub escala bien para difusion; PostgreSQL con muchos
   clientes WebSocket requiere una conexion dedicada por cliente para `LISTEN`, por lo
   que conviene un listener central con difusion en memoria si crece la concurrencia.

## Conclusion

Conclusion preliminar con los datos actuales:

- **Rendimiento**: Redis es claramente mas rapido (~4.5x en escritura y ~3x en
  tiempo real), gracias a que trabaja en memoria y no sincroniza a disco.
- **Suficiencia para el caso de uso**: el simulador escribe cada 5 segundos para 2
  fincas (0.4 escrituras/s) y PostgreSQL entrega las notificaciones en ~4 ms. La
  diferencia de rendimiento no afecta la experiencia en este escenario.
- **Durabilidad e historial**: PostgreSQL conserva todo el historial, soporta
  consultas SQL y sobrevive reinicios; Redis solo mantiene 50 registros en memoria
  y el Pub/Sub no es durable.
- **Recomendacion preliminar**: PostgreSQL si se prioriza historial, auditoria y
  durabilidad; Redis si se prioriza latencia minima y simplicidad operativa y no se
  necesita conservar datos.

Reejecutar el benchmark con la carga real esperada antes de tomar la decision final.
