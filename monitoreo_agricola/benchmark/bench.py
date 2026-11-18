"""Benchmark comparativo Redis vs PostgreSQL para monitoreo en tiempo real.

Uso:
    python benchmark/bench.py --backend postgres --n 1000
    python benchmark/bench.py --backend redis --n 1000

Requiere que el backend de datos correspondiente este en ejecucion.
"""

import argparse
import json
import queue
import statistics
import threading
import time
import uuid
from datetime import datetime, timezone

CANAL_TIEMPO_REAL = "fincas_updates"
FINCA_BENCHMARK = "bench_finca"
MAX_HISTORIAL = 50

DEFAULT_URLS = {
    "postgres": "postgresql://postgres:postgres@localhost:5433/monitoreo",
    "redis": "redis://localhost:6379/0",
}


def generar_dato(finca_id: str) -> dict:
    return {
        "finca_id": finca_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "temperatura": 25.0,
        "humedad": 60.0,
        "co2": 500.0,
    }


def resumir(latencias_ms: list[float]) -> dict:
    if not latencias_ms:
        return {"n": 0, "media_ms": 0.0, "p50_ms": 0.0, "p95_ms": 0.0, "p99_ms": 0.0}

    ordenadas = sorted(latencias_ms)

    def percentil(p: float) -> float:
        indice = min(len(ordenadas) - 1, int(round((p / 100) * (len(ordenadas) - 1))))
        return ordenadas[indice]

    return {
        "n": len(ordenadas),
        "media_ms": statistics.fmean(ordenadas),
        "p50_ms": percentil(50),
        "p95_ms": percentil(95),
        "p99_ms": percentil(99),
    }


def imprimir_resumen(nombre: str, resumen: dict, throughput: float | None = None) -> None:
    linea = (
        f"{nombre:<24} n={resumen['n']:>6}  "
        f"media={resumen['media_ms']:>8.2f} ms  "
        f"p50={resumen['p50_ms']:>8.2f} ms  "
        f"p95={resumen['p95_ms']:>8.2f} ms  "
        f"p99={resumen['p99_ms']:>8.2f} ms"
    )
    if throughput is not None:
        linea += f"  throughput={throughput:>8.1f} ops/s"
    print(linea)


class PostgresBackend:
    nombre = "postgres"

    def __init__(self, url: str):
        import psycopg

        self.psycopg = psycopg
        self.url = url
        self.conn = psycopg.connect(url)
        self.listener_conn = None
        self.detener = threading.Event()
        self.hilo_listener = None

    def escribir(self, datos: dict) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO lecturas (finca_id, ts, temperatura, humedad, co2)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    datos["finca_id"],
                    datos["timestamp"],
                    datos["temperatura"],
                    datos["humedad"],
                    datos["co2"],
                ),
            )
        self.conn.commit()

    def leer_historial(self) -> list:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT finca_id, ts, temperatura, humedad, co2
                FROM lecturas
                WHERE finca_id = %s
                ORDER BY ts DESC
                LIMIT %s
                """,
                (FINCA_BENCHMARK, MAX_HISTORIAL),
            )
            return cur.fetchall()

    def iniciar_listener(self, cola: queue.Queue) -> None:
        self.listener_conn = self.psycopg.connect(self.url, autocommit=True)
        self.listener_conn.execute(f"LISTEN {CANAL_TIEMPO_REAL}")

        def escuchar():
            try:
                while not self.detener.is_set():
                    for notify in self.listener_conn.notifies(timeout=0.5):
                        cola.put(notify.payload)
            except Exception:
                pass

        self.hilo_listener = threading.Thread(target=escuchar, daemon=True)
        self.hilo_listener.start()

    def cerrar(self) -> None:
        self.detener.set()
        if self.hilo_listener is not None:
            self.hilo_listener.join(timeout=2)
        if self.listener_conn is not None:
            try:
                self.listener_conn.close()
            except Exception:
                pass
        self.conn.close()


class RedisBackend:
    nombre = "redis"

    def __init__(self, url: str):
        import redis

        self.redis = redis.Redis.from_url(url, decode_responses=True)
        self.pubsub = None
        self.detener = threading.Event()
        self.hilo_listener = None

    def escribir(self, datos: dict) -> None:
        payload = json.dumps(datos)
        clave = datos["finca_id"]
        pipe = self.redis.pipeline()
        pipe.set(f"{clave}:estado_actual", payload)
        pipe.lpush(f"{clave}:historial", payload)
        pipe.ltrim(f"{clave}:historial", 0, MAX_HISTORIAL - 1)
        pipe.publish(CANAL_TIEMPO_REAL, payload)
        pipe.execute()

    def leer_historial(self) -> list:
        return self.redis.lrange(f"{FINCA_BENCHMARK}:historial", 0, MAX_HISTORIAL - 1)

    def iniciar_listener(self, cola: queue.Queue) -> None:
        self.pubsub = self.redis.pubsub(ignore_subscribe_messages=True)
        self.pubsub.subscribe(CANAL_TIEMPO_REAL)

        def escuchar():
            while not self.detener.is_set():
                mensaje = self.pubsub.get_message(timeout=0.5)
                if mensaje and mensaje.get("type") == "message":
                    cola.put(mensaje["data"])

        self.hilo_listener = threading.Thread(target=escuchar, daemon=True)
        self.hilo_listener.start()

    def cerrar(self) -> None:
        self.detener.set()
        if self.hilo_listener is not None:
            self.hilo_listener.join(timeout=2)
        if self.pubsub is not None:
            try:
                self.pubsub.close()
            except Exception:
                pass
        self.redis.close()


def medir_escritura(backend, n: int) -> tuple[list[float], float]:
    latencias = []
    inicio_total = time.perf_counter()

    for _ in range(n):
        datos = generar_dato(FINCA_BENCHMARK)
        inicio = time.perf_counter()
        backend.escribir(datos)
        latencias.append((time.perf_counter() - inicio) * 1000)

    duracion = time.perf_counter() - inicio_total
    return latencias, n / duracion if duracion > 0 else 0.0


def medir_lectura(backend, n: int) -> list[float]:
    latencias = []

    for _ in range(n):
        inicio = time.perf_counter()
        backend.leer_historial()
        latencias.append((time.perf_counter() - inicio) * 1000)

    return latencias


def medir_tiempo_real(backend, muestras: int, timeout_s: float = 5.0) -> list[float]:
    cola: queue.Queue = queue.Queue()
    backend.iniciar_listener(cola)
    time.sleep(0.5)

    latencias = []
    pendientes: dict[str, float] = {}

    for _ in range(muestras):
        marca = f"bench_rt_{uuid.uuid4().hex}"
        pendientes[marca] = time.perf_counter()

        backend.escribir(generar_dato(marca))

        limite = time.perf_counter() + timeout_s
        while time.perf_counter() < limite and marca in pendientes:
            try:
                payload = cola.get(timeout=0.1)
            except queue.Empty:
                continue

            datos = json.loads(payload)
            recibida = datos.get("finca_id")
            if recibida in pendientes:
                latencias.append((time.perf_counter() - pendientes.pop(recibida)) * 1000)

    return latencias


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=sorted(DEFAULT_URLS), required=True)
    parser.add_argument("--url", default=None, help="Cadena de conexion al backend")
    parser.add_argument("--n", type=int, default=1000, help="Escrituras a medir")
    parser.add_argument(
        "--lecturas", type=int, default=200, help="Consultas de historial a medir"
    )
    parser.add_argument(
        "--muestras-tiempo-real",
        type=int,
        default=20,
        help="Muestras de latencia extremo a extremo",
    )
    parser.add_argument("--json", dest="json_out", default=None, help="Archivo JSON de salida")
    args = parser.parse_args()

    url = args.url or DEFAULT_URLS[args.backend]
    backend = PostgresBackend(url) if args.backend == "postgres" else RedisBackend(url)

    print(f"Backend: {args.backend} ({url})")
    print("Calentando...")
    for _ in range(10):
        backend.escribir(generar_dato(FINCA_BENCHMARK))
    backend.leer_historial()

    try:
        latencias_escritura, throughput = medir_escritura(backend, args.n)
        latencias_lectura = medir_lectura(backend, args.lecturas)
        latencias_rt = medir_tiempo_real(backend, args.muestras_tiempo_real)
    finally:
        backend.cerrar()

    resultados = {
        "backend": args.backend,
        "url": url,
        "escritura": resumir(latencias_escritura),
        "throughput_ops_s": throughput,
        "lectura_historial": resumir(latencias_lectura),
        "tiempo_real_extremo_a_extremo": resumir(latencias_rt),
    }

    print()
    imprimir_resumen("Escritura", resultados["escritura"], throughput)
    imprimir_resumen("Lectura historial", resultados["lectura_historial"])
    imprimir_resumen("Tiempo real (e2e)", resultados["tiempo_real_extremo_a_extremo"])

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as archivo:
            json.dump(resultados, archivo, indent=2, ensure_ascii=False)
        print(f"\nResultados guardados en {args.json_out}")


if __name__ == "__main__":
    main()
