/**
 * SIMCVI · Configuración de Node-RED 5.
 *
 * Solo se definen los ajustes que el proyecto necesita; el resto usa los
 * valores por defecto de Node-RED. Referencia:
 * https://nodered.org/docs/user-guide/runtime/configuration
 *
 * Rutas:
 *   /            interfaz de operación (archivos de ./ui)
 *   /api/...     API HTTP de SIMCVI (nodos HTTP In)
 *   /ws/simcvi   WebSocket de tiempo real
 *   /admin       editor de Node-RED (protegido con usuario y contraseña)
 *
 * Los secretos llegan por variables de entorno desde el archivo .env;
 * nunca se escriben en este archivo ni en los flujos.
 */
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const DIR_NUCLEO = process.env.SIMCVI_CORE_DIR || '/srv/simcvi-core';
const DIR_UI = process.env.SIMCVI_UI_DIR || '/srv/simcvi-ui';

const USUARIO_ADMIN = process.env.NR_ADMIN_USER || 'admin';
const CLAVE_ADMIN = process.env.NR_ADMIN_PASSWORD || '';
const SECRETO_CREDENCIALES = process.env.NR_CREDENTIAL_SECRET || '';

// Falla de forma segura: sin contraseña robusta, Node-RED no arranca.
if (CLAVE_ADMIN.length < 12) {
  throw new Error('NR_ADMIN_PASSWORD debe tener al menos 12 caracteres. Ejecute scripts/init-env para generar el archivo .env.');
}
if (SECRETO_CREDENCIALES.length < 16) {
  throw new Error('NR_CREDENTIAL_SECRET debe tener al menos 16 caracteres.');
}

/** Comparación en tiempo constante para no filtrar información por tiempos. */
function iguales(a, b) {
  const resumenA = crypto.createHash('sha256').update(String(a)).digest();
  const resumenB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(resumenA, resumenB);
}

const usuarioAdmin = Object.freeze({ username: USUARIO_ADMIN, permissions: '*' });

module.exports = {
  uiPort: Number(process.env.PORT) || 1880,
  flowFile: 'flows.json',
  flowFilePretty: true,
  credentialSecret: SECRETO_CREDENCIALES,

  httpAdminRoot: '/admin',
  httpNodeRoot: '/',
  httpStatic: [{ path: DIR_UI, root: '/' }],

  // Autenticación del editor con usuario y contraseña tomados del entorno.
  adminAuth: {
    type: 'credentials',
    users: (username) => Promise.resolve(username === USUARIO_ADMIN ? usuarioAdmin : null),
    authenticate: (username, password) => Promise.resolve(
      iguales(username, USUARIO_ADMIN) && iguales(password, CLAVE_ADMIN) ? usuarioAdmin : null,
    ),
    default: () => Promise.resolve(null),
  },

  // El núcleo de dominio queda disponible en los nodos Function como global.get('simcvi').
  functionGlobalContext: {
    simcvi: require(path.join(DIR_NUCLEO, 'index.js')),
  },
  exportGlobalContextKeys: false,
  functionExternalModules: false,

  logging: {
    console: { level: 'info', metrics: false, audit: false },
  },

  editorTheme: {
    page: { title: 'SIMCVI · Node-RED' },
    header: { title: 'SIMCVI · Node-RED' },
    projects: { enabled: false },
    tours: false,
  },
};
