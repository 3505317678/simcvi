'use strict';

/**
 * Pruebas unitarias del núcleo de SIMCVI.
 * Ejecutar:  node --test "core/test/*.test.js"
 * (o dentro del contenedor: docker compose exec node-red node --test "/srv/simcvi-core/test/*.test.js")
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('..');
const { validarCambios, configDesdeEntorno, CONFIG_BASE } = require('../config');
const lp = require('../line-protocol');

const ENTORNO_VACIO = {};
const T0 = 1_760_000_000_000;

function nuevoEstado(config = {}) {
  return core.crearEstado({ entorno: ENTORNO_VACIO, autoinicio: true, config: { probAnomaliaPct: 0, probIncendioPct: 0, intervaloSeg: 1, ...config } }, T0);
}

/** Ejecuta n ciclos de 1 s con un generador reproducible. */
function correrCiclos(estado, n, inicioMs = T0, semilla = 7) {
  const aleatorio = core.crearAleatorio(semilla);
  const resultados = [];
  for (let i = 1; i <= n; i += 1) {
    const r = core.ciclo(estado, inicioMs + i * 1000, aleatorio);
    if (r) resultados.push(r);
  }
  return resultados;
}

function solicitar(estado, metodo, ruta, cuerpo, ahoraMs = T0) {
  return core.atenderSolicitud(estado, { metodo, ruta, cuerpo }, ahoraMs);
}

test('crea el estado con la configuración por defecto y las zonas', () => {
  const estado = core.crearEstado({ entorno: ENTORNO_VACIO }, T0);
  assert.equal(estado.config.zonas, CONFIG_BASE.zonas);
  assert.deepEqual(Object.keys(estado.zonas).map(Number), [1, 2, 3, 4]);
  assert.equal(estado.simulacion.activa, true);
  assert.ok(estado.eventos.length >= 1);
});

test('lee la configuración desde el entorno e ignora valores inválidos', () => {
  const { config, autoinicio, errores } = configDesdeEntorno({ SIM_ZONAS: '6', SIM_INTERVALO_SEG: 'abc', SIM_AUTOINICIO: 'false' });
  assert.equal(config.zonas, 6);
  assert.equal(config.intervaloSeg, CONFIG_BASE.intervaloSeg);
  assert.equal(autoinicio, false);
  assert.ok(errores.length > 0);
});

test('la validación de configuración es atómica', () => {
  const { config, errores } = validarCambios(CONFIG_BASE, { zonas: 3, rangos: { presion: { min: 9, max: 2 } } });
  assert.ok(errores.some((e) => e.includes('mínimo')));
  assert.equal(config.zonas, CONFIG_BASE.zonas, 'no debe aplicar cambios parciales');
  assert.ok(validarCambios(CONFIG_BASE, { zonas: 99 }).errores.length);
  assert.ok(validarCambios(CONFIG_BASE, { desconocido: 1 }).errores.length);
  assert.ok(validarCambios(CONFIG_BASE, { modoAuto: 'si' }).errores.length);
  assert.deepEqual(validarCambios(CONFIG_BASE, { zonas: 6, modoAuto: false }).errores, []);
});

test('en operación normal no hay falsas alarmas y todas las válvulas siguen abiertas', () => {
  const estado = nuevoEstado();
  correrCiclos(estado, 300);
  const vista = core.instantanea(estado, T0);
  assert.equal(vista.metricas.alarmasEmitidas, 0);
  assert.equal(vista.metricas.falsasAlarmas, 0);
  assert.equal(vista.kpis.valvulasAbiertas, 4);
  for (const zona of vista.zonas) {
    assert.ok(zona.presion > 2 && zona.presion < 8, `presión fuera de rango en zona ${zona.id}`);
  }
});

test('una anomalía inyectada genera alarma, cierra la válvula y la reabre con histéresis', () => {
  const estado = nuevoEstado({ ticksReapertura: 2 });
  correrCiclos(estado, 2, T0, 1);
  const r = solicitar(estado, 'POST', '/api/pruebas/anomalia/2', { variable: 'presion', direccion: 'alta' });
  assert.equal(r.estado, 202);

  core.ciclo(estado, T0 + 10_000, core.crearAleatorio(3));
  let zona = estado.zonas[2];
  assert.equal(zona.estado, 'alerta');
  assert.equal(zona.valvula, 'cerrada');
  assert.ok(zona.presion > 8);
  const alarma = estado.eventos.find((e) => e.tipo === 'alarma' && e.zona === 2);
  assert.ok(alarma, 'debe registrar la alarma');
  assert.equal(alarma.accion, 'Cierre automático de la válvula');
  assert.ok(estado.eventos.find((e) => e.tipo === 'cierre_auto' && e.zona === 2).tiempoRespuestaMs >= 0);

  core.ciclo(estado, T0 + 11_000, core.crearAleatorio(4));
  assert.equal(estado.zonas[2].valvula, 'cerrada', 'primer ciclo normal: aún cerrada');
  core.ciclo(estado, T0 + 12_000, core.crearAleatorio(5));
  zona = estado.zonas[2];
  assert.equal(zona.valvula, 'abierta', 'tras 2 ciclos normales se reabre');

  const m = core.instantanea(estado, T0).metricas;
  assert.equal(m.anomaliasDetectadas, 1);
  assert.equal(m.anomaliasNoDetectadas, 0);
  assert.equal(m.falsasAlarmas, 0);
  assert.equal(m.tasaDeteccionPct, 100);
  assert.equal(m.tiempoRespuesta.n, 1);
});

test('con el caudal cerrado no se dispara la alarma de caudal mínimo (supresión por estado)', () => {
  const estado = nuevoEstado();
  solicitar(estado, 'POST', '/api/valvulas/1/cerrar');
  correrCiclos(estado, 5);
  const zona = estado.zonas[1];
  assert.equal(zona.valvula, 'cerrada');
  assert.ok(zona.caudal < 1);
  assert.equal(zona.estado, 'normal');
  assert.equal(estado.metricas.alarmasEmitidas, 0);
});

test('el mando manual tiene prioridad y "auto" lo libera', () => {
  const estado = nuevoEstado();
  solicitar(estado, 'POST', '/api/valvulas/3/abrir');
  solicitar(estado, 'POST', '/api/pruebas/anomalia/3', { variable: 'temperatura', direccion: 'alta' });
  core.ciclo(estado, T0 + 1000, core.crearAleatorio(9));
  assert.equal(estado.zonas[3].estado, 'alerta');
  assert.equal(estado.zonas[3].valvula, 'abierta', 'el operador la mantiene abierta');
  assert.match(estado.eventos.find((e) => e.tipo === 'alarma').accion, /mando manual/);

  solicitar(estado, 'POST', '/api/valvulas/3/auto');
  assert.equal(estado.zonas[3].override, null);
  core.ciclo(estado, T0 + 2000, core.crearAleatorio(10));
  if (estado.zonas[3].estado === 'alerta') assert.equal(estado.zonas[3].valvula, 'cerrada');
});

test('con el modo automático apagado solo se notifica', () => {
  const estado = nuevoEstado({ modoAuto: false });
  solicitar(estado, 'POST', '/api/pruebas/anomalia/1', { variable: 'caudal', direccion: 'alta' });
  core.ciclo(estado, T0 + 1000, core.crearAleatorio(2));
  assert.equal(estado.zonas[1].estado, 'alerta');
  assert.equal(estado.zonas[1].valvula, 'abierta');
  assert.match(estado.eventos.find((e) => e.tipo === 'alarma').accion, /Solo notificación/);
});

test('un incendio activa la parada de emergencia y bloquea la reapertura hasta restablecer', () => {
  const estado = nuevoEstado({ ticksReapertura: 1 });
  correrCiclos(estado, 1);
  assert.equal(solicitar(estado, 'POST', '/api/pruebas/incendio/4').estado, 202);
  core.ciclo(estado, T0 + 5000, core.crearAleatorio(11));

  assert.equal(estado.emergencia.activa, true);
  assert.equal(estado.emergencia.zona, 4);
  assert.ok(Object.values(estado.zonas).every((z) => z.valvula === 'cerrada'));
  const incendio = estado.eventos.find((e) => e.tipo === 'incendio');
  assert.equal(incendio.severidad, 'critica');
  assert.ok(incendio.tiempoRespuestaMs >= 0);

  const intento = solicitar(estado, 'POST', '/api/valvulas/2/abrir');
  assert.equal(intento.estado, 409);
  assert.equal(solicitar(estado, 'POST', '/api/pruebas/incendio/1').estado, 409);

  correrCiclos(estado, 3, T0 + 6000);
  assert.ok(Object.values(estado.zonas).every((z) => z.valvula === 'cerrada'), 'sigue bloqueado');
  assert.ok(estado.zonas[4].temperatura > 75, 'la zona en incendio supera la temperatura máxima');

  assert.equal(solicitar(estado, 'POST', '/api/emergencia/restablecer').estado, 200);
  assert.equal(estado.emergencia.activa, false);
  correrCiclos(estado, 2, T0 + 20_000);
  assert.ok(Object.values(estado.zonas).every((z) => z.valvula === 'abierta'), 'reabre tras restablecer');
  assert.equal(solicitar(estado, 'POST', '/api/emergencia/restablecer').estado, 409);
  assert.equal(core.instantanea(estado, T0).metricas.falsasAlarmas, 0);
});

test('el ciclo respeta el intervalo y se detiene con la simulación', () => {
  const estado = nuevoEstado({ intervaloSeg: 3 });
  assert.ok(core.ciclo(estado, T0 + 3000));
  assert.equal(core.ciclo(estado, T0 + 4000), null, 'aún no se cumple el intervalo');
  assert.ok(core.ciclo(estado, T0 + 6000));
  solicitar(estado, 'POST', '/api/simulacion/detener');
  assert.equal(core.ciclo(estado, T0 + 20_000), null);
});

test('la API valida rutas, zonas, acciones y configuración', () => {
  const estado = nuevoEstado();
  assert.equal(solicitar(estado, 'GET', '/api/estado').estado, 200);
  assert.equal(solicitar(estado, 'GET', '/api/historial').estado, 200);
  assert.equal(solicitar(estado, 'GET', '/api/no-existe').estado, 404);
  assert.equal(solicitar(estado, 'POST', '/api/valvulas/99/abrir').estado, 404);
  assert.equal(solicitar(estado, 'POST', '/api/valvulas/1/romper').estado, 400);
  assert.equal(solicitar(estado, 'POST', '/api/valvulas/todas/cerrar').estado, 200);
  assert.ok(Object.values(estado.zonas).every((z) => z.valvula === 'cerrada'));
  assert.equal(solicitar(estado, 'POST', '/api/pruebas/anomalia/1', { variable: 'humedad' }).estado, 400);

  const invalida = solicitar(estado, 'PUT', '/api/config', { zonas: 50 });
  assert.equal(invalida.estado, 422);
  assert.ok(invalida.cuerpo.error.detalles.length);

  const valida = solicitar(estado, 'PUT', '/api/config', { zonas: 6, rangos: { caudal: { max: 150 } } });
  assert.equal(valida.estado, 200);
  assert.equal(Object.keys(estado.zonas).length, 6);
  assert.equal(estado.config.rangos.caudal.max, 150);
  assert.equal(estado.config.rangos.caudal.min, 20);
});

test('el protocolo de línea escapa etiquetas y textos y usa marcas en ns', () => {
  const l = lp.linea('eventos', { zona: 1, tipo: 'a b', vacio: '' }, [
    ['mensaje', 'Valor "alto", ruta C:\\x', 'texto'],
    ['valor', 9.123456, 'flotante'],
    ['id', 7, 'entero'],
    ['ok', true, 'booleano'],
  ], lp.marcaNs(T0, 3));
  assert.equal(l, 'eventos,tipo=a\\ b,zona=1 mensaje="Valor \\"alto\\", ruta C:\\\\x",valor=9.1235,id=7i,ok=true 1760000000000000003');
  assert.throws(() => lp.linea('x', {}, [['n', 1.5, 'entero']], '1'));
});

test('el ciclo produce líneas válidas de telemetría, planta, límites y eventos', () => {
  const estado = nuevoEstado();
  const r = core.ciclo(estado, T0 + 1000, core.crearAleatorio(1));
  const telemetria = r.lineas.filter((l) => l.startsWith('telemetria,'));
  assert.equal(telemetria.length, 4);
  assert.match(telemetria[0], /^telemetria,zona=1 presion=[\d.]+,temperatura=[\d.]+,caudal=[\d.]+,valvula_abierta=true,en_alerta=false,incendio=false,anomalia_inyectada=false,mando_manual=false \d{19}$/);
  assert.ok(r.lineas.some((l) => l.startsWith('planta ')));
  assert.equal(r.lineas.filter((l) => l.startsWith('limites,')).length, 3);
  assert.ok(r.lineas.some((l) => l.startsWith('eventos,')), 'incluye el evento de inicio pendiente');
  const segundo = core.ciclo(estado, T0 + 2000, core.crearAleatorio(2));
  assert.ok(!segundo.lineas.some((l) => l.startsWith('eventos,')), 'no repite eventos ya persistidos');
});

test('registra la persistencia y emite eventos solo en los cambios de estado', () => {
  const estado = nuevoEstado();
  core.registrarEnvio(estado, 10);
  core.registrarEscritura(estado, { ok: false, error: 'ECONNREFUSED', latenciaMs: 5 }, T0);
  core.registrarEscritura(estado, { ok: false, error: 'ECONNREFUSED', latenciaMs: 5 }, T0);
  core.registrarEnvio(estado, 10);
  core.registrarEscritura(estado, { ok: true, lineas: 10, latenciaMs: 12 }, T0);
  const avisos = estado.eventos.filter((e) => e.tipo === 'persistencia');
  assert.equal(avisos.length, 2, 'un aviso de fallo y uno de restablecimiento');
  const vista = core.instantanea(estado, T0);
  assert.equal(vista.metricas.integridadPct, 50);
  assert.equal(vista.persistencia.estado, 'ok');
});
