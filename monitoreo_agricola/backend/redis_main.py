"""API de monitoreo respaldada por Redis.

Expone el mismo contrato que el backend PostgreSQL para que el dashboard pueda
usarse sin cambios, pero lee historial y Pub/Sub desde Redis.
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager

import redis.asyncio as redis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CANAL_TIEMPO_REAL = "fincas_updates"
MAX_HISTORIAL = 50
PREFIJO_FINCAS = os.getenv("PREFIJO_FINCAS", "finca_")

UMBRAL_TEMPERATURA = 30.0
UMBRAL_CO2 = 800.0


async def crear_cliente_con_reintentos(intentos: int = 15, espera: float = 2.0):
    for intento in range(1, intentos + 1):
        cliente = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        try:
            await cliente.ping()
            return cliente
        except Exception as e:
            await cerrar_cliente(cliente)
            if intento == intentos:
                raise
            print(
                f"Redis no disponible ({e}). "
                f"Reintentando en {espera} segundos..."
            )
            await asyncio.sleep(espera)


async def cerrar_cliente(cliente) -> None:
    if cliente is None:
        return
    try:
        await cliente.aclose()
    except AttributeError:
        await cliente.close()


async def cerrar_pubsub(pubsub) -> None:
    if pubsub is None:
        return
    try:
        await pubsub.aclose()
    except AttributeError:
        await pubsub.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = await crear_cliente_con_reintentos()
    try:
        yield
    finally:
        await cerrar_cliente(app.state.redis)


app = FastAPI(title="API Monitoreo Agricola Rincon Verde - Redis", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/historial/{finca}")
async def obtener_historial(finca: str):
    registros = await app.state.redis.lrange(
        f"{finca}:historial", 0, MAX_HISTORIAL - 1
    )

    historial = []
    for registro in registros:
        try:
            historial.append(json.loads(registro))
        except (TypeError, ValueError):
            continue

    return {"finca": finca, "historial": historial}


@app.websocket("/ws/monitoreo")
async def websocket_monitoreo(websocket: WebSocket):
    await websocket.accept()
    pubsub = app.state.redis.pubsub()
    await pubsub.subscribe(CANAL_TIEMPO_REAL)
    print(f"Cliente WebSocket Redis conectado y suscrito a {CANAL_TIEMPO_REAL}.")

    try:
        while True:
            mensaje = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if not mensaje:
                continue

            try:
                datos = json.loads(mensaje["data"])
            except (TypeError, ValueError):
                continue

            if not str(datos.get("finca_id", "")).startswith(PREFIJO_FINCAS):
                continue

            datos["alerta"] = (
                datos.get("temperatura", 0) > UMBRAL_TEMPERATURA
                or datos.get("co2", 0) > UMBRAL_CO2
            )

            await websocket.send_json(datos)

    except WebSocketDisconnect:
        print("Cliente WebSocket Redis desconectado.")
    except Exception as e:
        print(f"Error inesperado en WebSocket Redis: {e}")
    finally:
        try:
            await pubsub.unsubscribe(CANAL_TIEMPO_REAL)
        except Exception:
            pass
        await cerrar_pubsub(pubsub)
