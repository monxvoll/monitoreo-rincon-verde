# Monitoreo Agricola - Rincon Verde

## Ejecución con Docker

El proyecto se debe iniciar utilizando Docker Compose.

1. Es necesario tener Docker en ejecución.
2. Desde una terminal en la raíz del proyecto, ejecutar el siguiente comando:

```bash
docker compose up -d --build
```

Este comando iniciará:
- El servidor de Redis
- El Backend (FastAPI) en el puerto `8000`
- El Frontend (Nginx/Servidor estático) en el puerto `8080`
- El Simulador de sensores en segundo plano

Para detener todos los servicios, ejecutar:
```bash
docker compose down
```
