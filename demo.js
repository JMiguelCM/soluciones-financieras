// Arranca la app con datos simulados en data/demo.db (la base real no se toca).
// Uso: node demo.js   → http://localhost:3001
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const rutaDemo = join(raiz, 'data', 'demo.db');
for (const sufijo of ['', '-journal', '-wal', '-shm']) rmSync(rutaDemo + sufijo, { force: true });

process.env.SF_DB = rutaDemo;
process.env.PORT ||= '3001';

const { db } = await import('./db.js');
const { cronograma, primeraCuotaSugerida, cuotaSugerida, sumarDias, hoyLocal } = await import('./public/calculos.js');

// ---------- azar reproducible ----------
let semilla = 20261104;
const azar = () => ((semilla = (semilla * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const uno = (lista) => lista[Math.floor(azar() * lista.length)];
const ponderado = (pares) => {
  let r = azar() * pares.reduce((s, [, p]) => s + p, 0);
  for (const [v, p] of pares) if ((r -= p) <= 0) return v;
  return pares[pares.length - 1][0];
};

const hoy = hoyLocal();

// ---------- usuarios ----------
const usuarios = ['JOSE', 'MARIA', 'CARLOS'].map((n) => Number(db.prepare('INSERT INTO usuarios (nombre) VALUES (?)').run(n).lastInsertRowid));

// ---------- clientes ----------
const NOMBRES = [
  'ANDREA PATRICIA LOZANO RUIZ', 'BRAYAN STIVEN MOSQUERA CAICEDO', 'CAROLINA OSORIO MEJIA', 'DIEGO FERNANDO RIASCOS',
  'ELIZABETH CUERO VALENCIA', 'FABIAN ANDRES HURTADO', 'GLORIA INES CARABALI', 'HECTOR FABIO MINA LUCUMI',
  'ISABEL CRISTINA PALACIOS', 'JHON JAIRO BALANTA', 'KAREN DAYANA OCORO', 'LUIS EDUARDO VIVEROS',
  'MARTHA LUCIA GONZALEZ', 'NELSON ENRIQUE ARBOLEDA', 'OLGA LUCIA MANCILLA', 'PEDRO PABLO ZAPATA',
  'ROSA ELENA BANGUERO', 'SANDRA MILENA POPO', 'TATIANA ANGULO RENTERIA', 'VICTOR HUGO CANDELO',
  'WILLIAM ALBERTO SINISTERRA', 'YAMILETH GRUESO', 'ZORAIDA MUÑOZ ORTIZ', 'ALEXANDER CHARA OBANDO',
  'BEATRIZ ELENA CASTRO', 'CRISTIAN CAMILO LASSO', 'DORIS AMPARO GARCES', 'EDWIN ARLEY TORRES',
];
const OCUPACIONES = [['INDEPENDIENTE', 8], ['COMERCIANTE', 4], ['EMPLEADO', 2], ['SERVICIO AL CLIENTE', 1], ['MOTORRATÓN', 2], ['COSTURERA', 1], ['TENDERO', 1], ['ESTILISTA', 1]];
const VIAS = ['CLL', 'KRA', 'DG', 'TV', 'CALLE', 'AV'];
const OBS = [null, null, null, 'COBRAR EN LA TARDE', 'TIENDA EN LA ESQUINA, PREGUNTAR POR ELLA', 'NO COBRAR LOS LUNES', 'REFERIDO POR OTRO CLIENTE', 'CASA DE REJAS VERDES'];

const direccion = () => `${uno(VIAS)} ${entre(5, 80)}${azar() < 0.3 ? uno(['A', 'B', 'C']) : ''} # ${entre(1, 99)}-${entre(1, 99)}`;
const celular = () => `3${uno(['00', '01', '04', '10', '13', '14', '15', '16', '17', '18', '20', '22', '23'])}${String(entre(0, 9999999)).padStart(7, '0')}`;

const insCliente = db.prepare(`
  INSERT INTO clientes (nombre, direccion, direccion2, ocupacion, telefono, telefono2, whatsapp, ruta, observaciones, creado_por, creado)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const clientes = NOMBRES.map((nombre) => {
  const tel = celular();
  const creado = `${sumarDias(hoy, -entre(130, 200))} ${String(entre(8, 18)).padStart(2, '0')}:${String(entre(0, 59)).padStart(2, '0')}:00`;
  const r = insCliente.run(
    nombre, direccion(), azar() < 0.3 ? direccion() : null, ponderado(OCUPACIONES),
    tel, azar() < 0.25 ? celular() : null, azar() < 0.8 ? tel : null,
    uno([13, 30, 36, 50]), uno(OBS), uno(usuarios), creado,
  );
  return Number(r.lastInsertRowid);
});

// ---------- contratos y pagos ----------
const insContrato = db.prepare(`
  INSERT INTO contratos (cliente_id, fecha_inicio, fecha_primera_cuota, forma_pago, prestamo, interes, num_cuotas, valor_cuota, credito, observaciones, creado_por, creado)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insPago = db.prepare(`
  INSERT INTO pagos (contrato_id, fecha, abono, int_mora, observacion, creado_por, creado, anulado, anulado_por, anulado_en)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const CUOTAS = { D: [20, 30], S: [4, 10], Q: [4, 8], M: [1, 4] };
const MESES_POR_CUOTA = { D: 1 / 26, S: 1 / 4.3, Q: 1 / 2, M: 1 };

function crearContrato(clienteId, perfil) {
  const forma = ponderado([['D', 4], ['S', 4], ['Q', 3], ['M', 1]]);
  const n = entre(...CUOTAS[forma]);
  const prestamo = uno([200, 250, 300, 400, 500, 600, 700, 800, 1000, 1200, 1500]) * 1000;
  const interes = Math.max(20, Math.round((20 * n * MESES_POR_CUOTA[forma]) / 5) * 5);
  const vc = cuotaSugerida(prestamo, interes, n);

  // Inicio: los pagados empiezan lo bastante atrás para haber terminado.
  let inicio = perfil === 'nuevo' ? hoy : sumarDias(hoy, -entre(3, 50));
  if (perfil === 'pagado') {
    const dur = cronograma(primeraCuotaSugerida(hoy, forma), forma, n);
    const dias = Math.round((Date.parse(dur[dur.length - 1]) - Date.parse(hoy)) / 864e5);
    inicio = sumarDias(hoy, -(dias + entre(20, 60)));
  }
  const primera = primeraCuotaSugerida(inicio, forma);
  const fechas = cronograma(primera, forma, n);
  const credito = vc * n;
  const usuario = uno(usuarios);

  const id = Number(insContrato.run(
    clienteId, inicio, primera, forma, prestamo, Math.round((credito / prestamo - 1) * 10000) / 100,
    n, vc, credito, azar() < 0.15 ? 'Codeudor: familiar que vive en la misma casa' : null, usuario, `${inicio} 09:${String(entre(10, 59))}:00`,
  ).lastInsertRowid);

  // Pagos según el comportamiento del cliente
  const vencidas = fechas.filter((f) => f < hoy); // la cuota de hoy queda pendiente de cobro
  let pagado = 0;
  const pagar = (fecha, abono, mora = 0, obs = null) => {
    abono = Math.min(abono, credito - pagado);
    if (abono <= 0 && !mora) return;
    if (fecha > hoy) fecha = hoy;
    pagado += abono;
    const quien = uno(usuarios);
    insPago.run(id, fecha, abono, mora, obs, quien, `${fecha} ${String(entre(8, 17)).padStart(2, '0')}:${String(entre(0, 59)).padStart(2, '0')}:00`, 0, null, null);
  };

  if (perfil === 'pagado') {
    fechas.forEach((f) => pagar(sumarDias(f, entre(0, 1)), vc));
  } else if (perfil === 'puntual') {
    vencidas.forEach((f) => pagar(f, vc));
  } else if (perfil === 'adelantado') {
    vencidas.forEach((f, i) => pagar(f, i % 2 === 0 ? vc * 2 : vc));
  } else if (perfil === 'picos') {
    vencidas.forEach((f) => pagar(sumarDias(f, entre(0, 2)), azar() < 0.5 ? Math.round(vc * 0.6 / 1000) * 1000 : vc));
  } else if (perfil === 'atrasado') {
    const deja = Math.min(vencidas.length, entre(1, 3));
    vencidas.slice(0, vencidas.length - deja).forEach((f, i) => {
      const tarde = entre(0, 6);
      pagar(sumarDias(f, tarde), vc, tarde > 3 ? uno([5000, 10000, 15000]) : 0, tarde > 3 ? 'Pagó tarde, se cobró mora' : null);
    });
  } else if (perfil === 'moroso') {
    vencidas.slice(0, Math.min(1, vencidas.length)).forEach((f) => pagar(f, vc));
  }
  return id;
}

const PERFILES = [['puntual', 6], ['atrasado', 4], ['picos', 2], ['adelantado', 2], ['moroso', 1], ['nuevo', 2]];

db.exec('BEGIN');
clientes.forEach((cid, i) => {
  if (i % 9 === 8) return; // algunos clientes sin contrato
  if (azar() < 0.35) crearContrato(cid, 'pagado'); // historial: contrato ya terminado
  const perfil = ponderado(PERFILES);
  crearContrato(cid, perfil);
  if (azar() < 0.12) crearContrato(cid, ponderado(PERFILES.slice(0, 2)));
});

// Un par de pagos anulados (digitados por error)
const paraAnular = db.prepare('SELECT id, fecha FROM pagos ORDER BY random() LIMIT 2').all();
for (const p of paraAnular) {
  const orig = db.prepare('SELECT * FROM pagos WHERE id = ?').get(p.id);
  db.prepare(`UPDATE pagos SET anulado = 1, anulado_por = ?, anulado_en = ? WHERE id = ?`).run(usuarios[0], `${orig.fecha} 18:30:00`, p.id);
  insPago.run(orig.contrato_id, orig.fecha, orig.abono, orig.int_mora, 'Se volvió a registrar (el anterior tenía error)', usuarios[0], `${orig.fecha} 18:31:00`, 0, null, null);
}
db.exec('COMMIT');

const cuenta = (t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
console.log(`Demo: ${cuenta('usuarios')} usuarios, ${cuenta('clientes')} clientes, ${cuenta('contratos')} contratos, ${cuenta('pagos')} pagos.`);

await import('./server.js');
