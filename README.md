# Monitoreo Agricola - Rincon Verde

Sistema de monitoreo en tiempo real para dos fincas agricolas. Mide temperatura, humedad y CO2 cada 5 segundos usando sensores simulados, almacena datos en Redis y los muestra en un dashboard web con actualizacion en vivo via WebSockets.

## Stack

- **Simulador**: Python (`sensor_mock.py`)
- **Base de datos**: Redis (en memoria)
- **Backend**: FastAPI + Uvicorn
- **Frontend**: HTML5 + CSS + JavaScript vanilla

## Requisitos

- Python 3.10+
- Redis (local o Docker)
- pip

## Instalacion

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Ejecucion

 3 terminales y Redis corriendo.

**Redis con Docker:**
```bash
docker run -d --name redis-server -p 6379:6379 redis
```

**Terminal 1 - Backend:**
```bash
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000
```

**Terminal 2 - Simulador:**
```bash
source venv/bin/activate
python sensor_mock.py
```

**Terminal 3 - Frontend:**
```bash
cd frontend
python -m http.server 8080
```

Abrir en el navegador: `http://localhost:8080`

## Estructura

```
monitoreo_agricola/
├── sensor_mock.py          # Simulador de sensores
├── backend/
│   └── main.py             # API REST + WebSocket
├── frontend/
│   ├── index.html          # Panel de control
│   └── main.js             # Logica del cliente
├── requirements.txt
└── .gitignore
```

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/api/historial/{finca}` | Historial reciente de una finca |
| WS | `/ws/monitoreo` | Datos en tiempo real via WebSocket |

## Umbrales de alerta

- Temperatura > 30 C
- CO2 > 800 ppm
