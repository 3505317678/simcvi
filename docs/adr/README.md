# Registro de decisiones de arquitectura (ADR)

Cada archivo documenta una decisión con su contexto, las alternativas evaluadas y sus consecuencias, siguiendo la idea de ISO/IEC/IEEE 42010 de registrar decisiones y su justificación junto a la descripción de la arquitectura.

| ADR | Decisión | Estado |
|---|---|---|
| [0001](0001-node-red-sin-broker.md) | Node-RED integra simulación, control, API y WebSocket, sin broker MQTT | Aceptada |
| [0002](0002-influxdb-2-flux.md) | InfluxDB 2.9 con Flux en lugar de InfluxDB 3 Core con SQL | Aceptada |
| [0003](0003-nucleo-dominio.md) | Lógica de control en un núcleo JavaScript independiente de Node-RED | Aceptada |
| [0004](0004-interfaz-propia-y-grafana.md) | Interfaz de operación propia y Grafana embebido para el histórico | Aceptada |
| [0005](0005-seguridad-entorno-local.md) | Controles de seguridad para un despliegue local | Aceptada |

Para agregar una decisión, copie el formato de cualquiera de ellas, use el número siguiente y enlácela en esta tabla. Una decisión no se borra: si cambia, se marca como «Reemplazada por ADR-XXXX».
