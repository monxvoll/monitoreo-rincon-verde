"""Benchmark comparativo Redis vs PostgreSQL para monitoreo en tiempo real.

Uso:
    python benchmark/bench.py --backend postgres --n 1000
    python benchmark/bench.py --backend redis --n 1000

Requiere que el backend de datos correspondiente este en ejecucion.
"""

import argparse
import json
import os
import queue
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from benchmark.backends import FINCA_BENCHMARK, PostgresBackend, RedisBackend

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
