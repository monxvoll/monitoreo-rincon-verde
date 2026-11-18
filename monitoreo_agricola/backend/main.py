import asyncio
import json
import os
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5433/monitoreo",
)
CANAL_TIEMPO_REAL = "fincas_updates"
MAX_HISTORIAL = 50

# Umbrales criticos para generar alertas
UMBRAL_TEMPERATURA = 30.0  # grados Celsius
UMBRAL_CO2 = 800.0         # partes por millon


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Crea y cierra el pool de conexiones a PostgreSQL."""
    app.state.pool = await crear_pool_con_reintentos()
    try:
        yield
    finally:
        await app.state.pool.close()


async def crear_pool_con_reintentos(intentos: int = 10, espera: float = 2.0):
    """Reintenta la conexion inicial mientras PostgreSQL termina de arrancar."""
    for intento in range(1, intentos + 1):
        try:
            return await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
        except (OSError, asyncpg.PostgresError) as e:
            if intento == intentos:
                raise
            print(
                f"PostgreSQL no disponible ({e}). "
                f"Reintentando en {espera} segundos..."
            )
            await asyncio.sleep(espera)


app = FastAPI(title="API Monitoreo Agricola Rincon Verde", lifespan=lifespan)

# Permitir CORS para que el frontend local pueda consumir la API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def serializar_registro(registro: asyncpg.Record) -> dict:
    """Convierte una fila de PostgreSQL al contrato JSON que consume el frontend."""
    return {
        "finca_id": registro["finca_id"],
        "timestamp": registro["ts"].isoformat(),
        "temperatura": registro["temperatura"],
        "humedad": registro["humedad"],
        "co2": registro["co2"],
    }


@app.get("/api/historial/{finca}")
async def obtener_historial(finca: str):
    """Consulta el historial reciente de una finca desde PostgreSQL."""
    registros = await app.state.pool.fetch(
        """
        SELECT finca_id, ts, temperatura, humedad, co2
        FROM lecturas
        WHERE finca_id = $1
        ORDER BY ts DESC
        LIMIT $2
        """,
        finca,
        MAX_HISTORIAL,
    )

    return {"finca": finca, "historial": [serializar_registro(r) for r in registros]}


@app.websocket("/ws/monitoreo")
async def websocket_monitoreo(websocket: WebSocket):
    """WebSocket suscrito a LISTEN/NOTIFY de PostgreSQL para datos en tiempo real."""
    await websocket.accept()

    cola: asyncio.Queue[str] = asyncio.Queue()
    conexion = None

    def al_recibir_notificacion(_conexion, _pid, _canal, payload: str):
        cola.put_nowait(payload)

    try:
        conexion = await asyncpg.connect(DATABASE_URL)
        await conexion.add_listener(CANAL_TIEMPO_REAL, al_recibir_notificacion)
        print(f"Cliente WebSocket conectado y suscrito a {CANAL_TIEMPO_REAL}.")

        while True:
            try:
                payload = await asyncio.wait_for(cola.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            datos = json.loads(payload)

            # Evaluar si algun valor supera los umbrales criticos
            datos["alerta"] = (
                datos.get("temperatura", 0) > UMBRAL_TEMPERATURA
                or datos.get("co2", 0) > UMBRAL_CO2
            )

            # Enviar al cliente conectado
            await websocket.send_json(datos)

    except WebSocketDisconnect:
        print("Cliente WebSocket desconectado.")
    except Exception as e:
        print(f"Error inesperado en WebSocket: {e}")
    finally:
        if conexion is not None:
            try:
                await conexion.remove_listener(
                    CANAL_TIEMPO_REAL, al_recibir_notificacion
                )
            except Exception:
                pass
            await conexion.close()
