"""Comparador en tiempo real Redis vs PostgreSQL.

Escribe la misma lectura en ambos motores, alternando el orden, y expone
metricas de latencia por HTTP y WebSocket para el dashboard.
"""

import asyncio
import json
import os
import queue
import random
import statistics
import threading
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from benchmark.backends import PostgresBackend, RedisBackend

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5433/monitoreo",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
INTERVALO_MS = int(os.getenv("INTERVALO_MS", "1000"))
NUM_FINCAS = int(os.getenv("NUM_FINCAS", "6"))
VENTANA_MUESTRAS = int(os.getenv("VENTANA_MUESTRAS", "300"))
PREFIJO_FINCA = os.getenv("PREFIJO_FINCA", "comparacion")

MOTORES = ("postgres", "redis")

RANGOS = {
    "temperatura": (15.0, 35.0, 1.2),
    "humedad": (40.0, 90.0, 2.5),
    "co2": (400.0, 1000.0, 45.0),
}

_estado_sensores: dict[str, dict[str, float]] = {}


def generar_lectura(finca_id: str) -> dict:
    """Genera una lectura con deriva suave para que el dashboard sea legible."""
    if finca_id not in _estado_sensores:
        _estado_sensores[finca_id] = {
            k: random.uniform(lo, hi) for k, (lo, hi, _) in RANGOS.items()
        }

    valores = _estado_sensores[finca_id]
    for clave, (lo, hi, paso) in RANGOS.items():
        valores[clave] = max(lo, min(hi, valores[clave] + random.uniform(-paso, paso)))

    return {
        "finca_id": finca_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "temperatura": round(valores["temperatura"], 1),
        "humedad": round(valores["humedad"], 1),
        "co2": round(valores["co2"], 1),
    }


def normalizar_timestamp(valor) -> str | None:
    if valor is None:
        return None
    try:
        if isinstance(valor, datetime):
            dt = valor
        else:
            dt = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def clave_notificacion(payload: str):
    datos = json.loads(payload)
    finca_id = datos.get("finca_id")
    timestamp = normalizar_timestamp(datos.get("timestamp"))
    if not finca_id or not timestamp:
        return None
    return finca_id, timestamp


def resumir(latencias_ms: list[float]) -> dict:
    if not latencias_ms:
        return {"n": 0, "media_ms": 0.0, "p50_ms": 0.0, "p95_ms": 0.0, "p99_ms": 0.0}

    ordenadas = sorted(latencias_ms)

    def percentil(p: float) -> float:
        indice = min(len(ordenadas) - 1, int(round((p / 100) * (len(ordenadas) - 1))))
        return ordenadas[indice]

    return {
        "n": len(ordenadas),
        "media_ms": round(statistics.fmean(ordenadas), 3),
        "p50_ms": round(percentil(50), 3),
        "p95_ms": round(percentil(95), 3),
        "p99_ms": round(percentil(99), 3),
    }


class EstadoComparacion:
    def __init__(self, ventana: int):
        self._lock = threading.Lock()
        self._escritura = {motor: deque(maxlen=ventana) for motor in MOTORES}
        self._tiempo_real = {motor: deque(maxlen=ventana) for motor in MOTORES}
        self._totales = {motor: 0 for motor in MOTORES}
        self._errores = {motor: 0 for motor in MOTORES}
        self._ultima = {motor: {"escritura_ms": None, "tiempo_real_ms": None} for motor in MOTORES}
        self.inicio = time.time()

    def registrar_escritura(self, motor: str, latencia_ms: float) -> None:
        with self._lock:
            self._escritura[motor].append((time.monotonic(), latencia_ms))
            self._totales[motor] += 1
            self._ultima[motor]["escritura_ms"] = round(latencia_ms, 3)

    def registrar_tiempo_real(self, motor: str, latencia_ms: float) -> None:
        with self._lock:
            self._tiempo_real[motor].append((time.monotonic(), latencia_ms))
            self._ultima[motor]["tiempo_real_ms"] = round(latencia_ms, 3)

    def registrar_error(self, motor: str) -> None:
        with self._lock:
            self._errores[motor] += 1

    def _throughput(self, muestras) -> float:
        if len(muestras) < 2:
            return 0.0
        span = muestras[-1][0] - muestras[0][0]
        return round((len(muestras) - 1) / span, 2) if span > 0 else 0.0

    def snapshot(self) -> dict:
        with self._lock:
            escritura = {
                motor: resumir([ms for _, ms in self._escritura[motor]]) for motor in MOTORES
            }
            tiempo_real = {
                motor: resumir([ms for _, ms in self._tiempo_real[motor]]) for motor in MOTORES
            }
            throughput = {
                motor: self._throughput(self._escritura[motor]) for motor in MOTORES
            }
            return {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "uptime_s": round(time.time() - self.inicio, 1),
                "config": {
                    "intervalo_ms": INTERVALO_MS,
                    "fincas": NUM_FINCAS,
                    "ventana_muestras": VENTANA_MUESTRAS,
                },
                "escritura": escritura,
                "tiempo_real": tiempo_real,
                "throughput_ops_s": throughput,
                "total": dict(self._totales),
                "errores": dict(self._errores),
                "ultima": {
                    motor: dict(valores) for motor, valores in self._ultima.items()
                },
            }


class GestorClientes:
    def __init__(self):
        self._clientes: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def conectar(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clientes.add(websocket)

    async def desconectar(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clientes.discard(websocket)

    async def broadcast(self, payload: dict) -> None:
        async with self._lock:
            clientes = list(self._clientes)

        for websocket in clientes:
            try:
                await websocket.send_json(payload)
            except Exception:
                await self.desconectar(websocket)


gestor = GestorClientes()


def crear_backends():
    """Reintenta la conexion inicial mientras los motores terminan de arrancar."""
    ultimo_error = None
    for intento in range(1, 16):
        postgres = redis = None
        try:
            postgres = PostgresBackend(DATABASE_URL)
            redis = RedisBackend(REDIS_URL)
            return postgres, redis
        except Exception as e:
            ultimo_error = e
            if postgres is not None:
                try:
                    postgres.cerrar()
                except Exception:
                    pass
            print(f"Motores no disponibles ({e}). Reintentando {intento}/15...")
            time.sleep(2)
    raise RuntimeError(f"No se pudieron conectar los motores: {ultimo_error}")


def drenar_cola(cola: queue.Queue, motor: str, pendientes: dict, estado: EstadoComparacion) -> None:
    while True:
        try:
            payload = cola.get_nowait()
        except queue.Empty:
            return

        try:
            clave = clave_notificacion(payload)
        except Exception:
            continue

        if clave is None:
            continue

        inicio = pendientes.pop((motor, *clave), None)
        if inicio is not None:
            estado.registrar_tiempo_real(motor, (time.perf_counter() - inicio) * 1000)


def bucle_comparacion(
    postgres: PostgresBackend,
    redis: RedisBackend,
    cola_postgres: queue.Queue,
    cola_redis: queue.Queue,
    estado: EstadoComparacion,
    parar: threading.Event,
    loop: asyncio.AbstractEventLoop,
) -> None:
    pendientes: dict[tuple, float] = {}
    intervalo = INTERVALO_MS / 1000
    ciclo = 0

    while not parar.is_set():
        inicio_ciclo = time.perf_counter()

        for indice in range(NUM_FINCAS):
            finca = f"{PREFIJO_FINCA}_{indice + 1}"
            datos = generar_lectura(finca)
            clave = (datos["finca_id"], normalizar_timestamp(datos["timestamp"]))

            motores = [("postgres", postgres), ("redis", redis)]
            if ciclo % 2:
                motores.reverse()

            for motor, backend in motores:
                pendientes[(motor, *clave)] = time.perf_counter()
                inicio = time.perf_counter()
                try:
                    backend.escribir(datos)
                    estado.registrar_escritura(motor, (time.perf_counter() - inicio) * 1000)
                except Exception as e:
                    pendientes.pop((motor, *clave), None)
                    estado.registrar_error(motor)
                    print(f"Error escribiendo en {motor}: {e}")

            ciclo += 1

        fin_ciclo = inicio_ciclo + intervalo
        while not parar.is_set() and time.perf_counter() < fin_ciclo:
            drenar_cola(cola_postgres, "postgres", pendientes, estado)
            drenar_cola(cola_redis, "redis", pendientes, estado)
            time.sleep(0.01)

        drenar_cola(cola_postgres, "postgres", pendientes, estado)
        drenar_cola(cola_redis, "redis", pendientes, estado)

        ahora = time.perf_counter()
        for clave_pendiente, inicio in list(pendientes.items()):
            if ahora - inicio > 5:
                pendientes.pop(clave_pendiente, None)

        try:
            asyncio.run_coroutine_threadsafe(gestor.broadcast(estado.snapshot()), loop)
        except RuntimeError:
            return


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    postgres, redis = await asyncio.to_thread(crear_backends)

    cola_postgres: queue.Queue = queue.Queue()
    cola_redis: queue.Queue = queue.Queue()
    postgres.iniciar_listener(cola_postgres)
    redis.iniciar_listener(cola_redis)

    estado = EstadoComparacion(VENTANA_MUESTRAS)
    parar = threading.Event()
    hilo = threading.Thread(
        target=bucle_comparacion,
        args=(postgres, redis, cola_postgres, cola_redis, estado, parar, loop),
        daemon=True,
    )
    hilo.start()

    app.state.estado = estado
    print(
        f"Comparador iniciado: {NUM_FINCAS} fincas cada {INTERVALO_MS} ms "
        f"(PostgreSQL + Redis con AOF)."
    )

    try:
        yield
    finally:
        parar.set()
        await asyncio.to_thread(hilo.join, 3)
        await asyncio.to_thread(postgres.cerrar)
        await asyncio.to_thread(redis.cerrar)


app = FastAPI(title="Comparador Redis vs PostgreSQL", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "uptime_s": round(time.time() - app.state.estado.inicio, 1),
        "motores": list(MOTORES),
    }


@app.get("/api/resumen")
async def resumen():
    return app.state.estado.snapshot()


@app.websocket("/ws/comparacion")
async def websocket_comparacion(websocket: WebSocket):
    await websocket.accept()
    await gestor.conectar(websocket)

    try:
        await websocket.send_json(app.state.estado.snapshot())
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await gestor.desconectar(websocket)
