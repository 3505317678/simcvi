# ADR-0001 · Node-RED integra simulación, control, API y WebSocket, sin broker MQTT

- Estado: aceptada
- Fecha: 2026-10-08

## Contexto

El proyecto retiró el broker MQTT del alcance. Los sensores son simulados y corren en el mismo proceso que la lógica de control, de modo que no hay dispositivos de campo que publiquen mensajes. La interfaz necesita recibir el estado en tiempo real y enviar órdenes (abrir, cerrar, restablecer emergencia).

## Decisión

Node-RED ejecuta el ciclo de simulación y control, expone una API REST (`/api/...`), difunde el estado por WebSocket (`/ws/simcvi`) y sirve la interfaz web como archivos estáticos (`/`). El editor queda en `/admin`, protegido con usuario y contraseña.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Broker MQTT (Mosquitto) entre simulador, Node-RED e interfaz | Agrega un servicio, autenticación y temas sin aportar valor mientras no haya dispositivos reales. |
| Servidor web aparte (Express, FastAPI) para la API | Duplica responsabilidades que Node-RED ya cubre y aleja el proyecto del enfoque de programación por flujos del curso. |
| Node-RED Dashboard 2 como interfaz | Ver ADR-0004. |

## Consecuencias

- Un servicio menos que operar; la latencia lectura→decisión→interfaz queda dentro de un proceso.
- La API no tiene autenticación propia: se compensa publicando el puerto solo en `127.0.0.1` (ADR-0005).
- Cuando existan sensores físicos (ESP32, PLC), lo natural es reintroducir MQTT como entrada de datos: el núcleo de control no cambia, solo se reemplaza la fuente de lecturas en el flujo.
