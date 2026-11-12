# ADR-0003 · Lógica de control en un núcleo JavaScript independiente de Node-RED

- Estado: aceptada
- Fecha: 2026-10-08

## Contexto

La lógica de control (prioridad de la emergencia, mando manual, cierre automático con histéresis, supresión de la alarma de caudal con la válvula cerrada) es la parte crítica del sistema y la que se evalúa en los escenarios EP-01 a EP-06. Si se escribe dentro de nodos Function, no se puede probar con pruebas unitarias ni revisar con facilidad.

## Decisión

El dominio vive en `core/` como módulos CommonJS sin dependencias externas (arquitectura de puertos y adaptadores en pequeño):

- `config.js`, `simulacion.js`, `control.js`, `eventos.js`, `metricas.js`: reglas del dominio.
- `line-protocol.js`: adaptador de salida hacia InfluxDB.
- `api.js`: adaptador de entrada HTTP (enrutador con listas blancas).
- `index.js`: fachada que usa Node-RED.

`settings.js` carga la fachada en `functionGlobalContext` y los nodos Function solo orquestan (`global.get('simcvi')`).

## Consecuencias

- 14 pruebas unitarias con `node --test`, sin Node-RED ni InfluxDB (`npm test`).
- Cambiar una regla de control no requiere tocar los flujos; reiniciar Node-RED carga el núcleo nuevo.
- El estado vive en memoria: al reiniciar Node-RED se reinician métricas y eventos recientes (el histórico permanece en InfluxDB). Si se requiere continuidad, el siguiente paso es persistir el estado en el almacenamiento de contexto de Node-RED.
