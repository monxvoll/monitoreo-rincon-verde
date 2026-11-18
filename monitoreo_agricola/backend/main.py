import json
import time
import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import os
import redis.asyncio as redis

app = FastAPI(title="API Monitoreo Agricola Rincon Verde")

# Permitir CORS para que el frontend local pueda consumir la API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Conexion asincrona a Redis
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
redis_client = redis.Redis(host=REDIS_HOST, port=6379, db=0, decode_responses=True)

# Rangos de cada variable: un unico archivo compartido con el frontend
# (nginx lo sirve en /config/rangos.json y el backend lo lee desde disco).
RANGOS_PATH = Path(__file__).resolve().parent.parent / "frontend" / "config" / "rangos.json"
CONFIG = json.loads(RANGOS_PATH.read_text(encoding="utf-8"))
FINCAS = list(CONFIG["fincas"].keys())
CANAL = "fincas_updates"


def clasificar(finca: str, variable: str, valor: float) -> str:
    """Nivel ('bien', 'atencion' o 'actuar') de un valor segun los tramos del tipo de finca
    (ganaderia, papa o tomate tienen rangos distintos)."""
    tipo = CONFIG["fincas"][finca]["tipo"]
    for tramo in CONFIG["tipos"][tipo]["variables"][variable]["tramos"]:
        if tramo["hasta"] is None or valor <= tramo["hasta"]:
            return tramo["nivel"]
    return "bien"


def evaluar(datos: dict) -> dict:
    """Agrega el nivel de cada variable y el flag de alerta (alguna variable en 'actuar')."""
    finca = datos.get("finca_id")
    if finca not in CONFIG["fincas"]:
        datos["niveles"], datos["alerta"] = {}, False
        return datos
    niveles = {v: clasificar(finca, v, datos[v]) for v in CONFIG["variables"] if v in datos}
    datos["tipo"] = CONFIG["fincas"][finca]["tipo"]
    datos["niveles"] = niveles
    datos["alerta"] = "actuar" in niveles.values()
    return datos


@app.get("/api/config")
async def obtener_config():
    """Rangos, nombres de fincas y textos que usa la interfaz."""
    return CONFIG


@app.get("/api/estado")
async def obtener_estado():
    """Ultima lectura de todas las fincas con una sola consulta MGET a Redis."""
    claves = [f"{finca}:estado_actual" for finca in FINCAS]
    valores = await redis_client.mget(claves)
    return {
        finca: evaluar(json.loads(valor)) if valor else None
        for finca, valor in zip(FINCAS, valores)
    }


@app.get("/api/historial/{finca}")
async def obtener_historial(finca: str):
    """Consulta el historial reciente de una finca desde Redis."""
    historial_key = f"{finca}:historial"
    registros_str = await redis_client.lrange(historial_key, 0, -1)

    registros = [evaluar(json.loads(registro)) for registro in registros_str]
    return {"finca": finca, "historial": registros}


@app.get("/api/redis")
async def obtener_info_redis():
    """Datos de Redis para la vista tecnica: metricas del servidor, cada clave con su
    tipo y tamano, suscriptores del canal y la latencia de un PING."""
    inicio = time.perf_counter()
    await redis_client.ping()
    latencia_ms = (time.perf_counter() - inicio) * 1000

    pipe = redis_client.pipeline()
    for finca in FINCAS:
        pipe.strlen(f"{finca}:estado_actual")
        pipe.llen(f"{finca}:historial")
    tamanos = await pipe.execute()

    claves = []
    for i, finca in enumerate(FINCAS):
        claves.append({"clave": f"{finca}:estado_actual", "tipo": "string",
                       "tamano": tamanos[2 * i], "unidad": "bytes"})
        claves.append({"clave": f"{finca}:historial", "tipo": "list",
                       "tamano": tamanos[2 * i + 1], "unidad": "elementos"})

    info = await redis_client.info()
    suscriptores = dict(await redis_client.pubsub_numsub(CANAL))
    return {
        "version": info.get("redis_version"),
        "segundos_activo": info.get("uptime_in_seconds"),
        "claves_totales": await redis_client.dbsize(),
        "memoria_usada": info.get("used_memory_human"),
        "clientes_conectados": info.get("connected_clients"),
        "operaciones_por_segundo": info.get("instantaneous_ops_per_sec"),
        "comandos_procesados": info.get("total_commands_processed"),
        "latencia_ping_ms": round(latencia_ms, 2),
        "canal": CANAL,
        "suscriptores_canal": suscriptores.get(CANAL, 0),
        "claves": claves,
    }


@app.websocket("/ws/monitoreo")
async def websocket_monitoreo(websocket: WebSocket):
    """WebSocket suscrito al Pub/Sub de Redis. Envia datos en tiempo real con su nivel."""
    await websocket.accept()

    pubsub = redis_client.pubsub()
    await pubsub.subscribe("fincas_updates")
    print("Cliente WebSocket conectado y suscrito a fincas_updates.")

    try:
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)

            if message:
                datos = evaluar(json.loads(message['data']))
                await websocket.send_json(datos)

            await asyncio.sleep(0.01)

    except WebSocketDisconnect:
        print("Cliente WebSocket desconectado.")
    except Exception as e:
        print(f"Error inesperado en WebSocket: {e}")
    finally:
        await pubsub.unsubscribe("fincas_updates")
        await pubsub.close()
