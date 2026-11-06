import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { estadoContrato, FORMAS_PAGO, hoyLocal } from './public/calculos.js';

const app = express();
const raiz = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(join(raiz, 'public')));

// ---------- utilidades ----------
const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const mayus = (v) => texto(v).toUpperCase();
const soloDigitos = (v) => texto(v).replace(/\D/g, '');

function telefonoValido(t) {
  // Colombia: celular de 10 dígitos o fijo de 7
  return t.length === 10 || t.length === 7;
}

function usuarioActual(req) {
  const id = Number(req.get('X-Usuario-Id'));
  if (!id) return null;
  return db.prepare('SELECT id, nombre FROM usuarios WHERE id = ?').get(id) ?? null;
}

function leerCliente(body) {
  const c = {
    nombre: mayus(body.nombre),
    direccion: mayus(body.direccion),
    direccion2: mayus(body.direccion2) || null,
    ocupacion: mayus(body.ocupacion),
    telefono: soloDigitos(body.telefono),
    telefono2: soloDigitos(body.telefono2) || null,
    whatsapp: soloDigitos(body.whatsapp) || null,
    ruta: body.ruta === '' || body.ruta == null ? null : Number(body.ruta),
    observaciones: texto(body.observaciones) || null,
  };

  const errores = {};
  if (!c.nombre) errores.nombre = 'Escriba el nombre.';
  if (!c.direccion) errores.direccion = 'Escriba la dirección.';
  if (!c.ocupacion) errores.ocupacion = 'Indique en qué trabaja.';
  if (!c.telefono) errores.telefono = 'Escriba un número de contacto.';
  else if (!telefonoValido(c.telefono)) errores.telefono = 'Debe tener 10 dígitos (celular) o 7 (fijo).';
  if (c.telefono2 && !telefonoValido(c.telefono2)) errores.telefono2 = 'Debe tener 10 o 7 dígitos.';
  if (c.whatsapp && c.whatsapp.length !== 10) errores.whatsapp = 'Debe tener 10 dígitos.';
  if (c.ruta !== null && (!Number.isInteger(c.ruta) || c.ruta < 0)) errores.ruta = 'Debe ser un número entero.';

  return { c, errores };
}

function responderErrores(res, errores) {
  return res.status(400).json({ error: 'Revise los campos marcados.', campos: errores });
}

// ---------- usuarios ----------
app.get('/api/usuarios', (_req, res) => {
  res.json(db.prepare('SELECT id, nombre, creado FROM usuarios ORDER BY nombre').all());
});

app.post('/api/usuarios', (req, res) => {
  const nombre = mayus(req.body?.nombre);
  if (!nombre) return res.status(400).json({ error: 'Escriba el nombre del usuario.' });
  if (nombre.length > 40) return res.status(400).json({ error: 'El nombre no puede pasar de 40 caracteres.' });

  const existe = db.prepare('SELECT id FROM usuarios WHERE nombre = ?').get(nombre);
  if (existe) return res.status(409).json({ error: `El usuario ${nombre} ya existe.` });

  const r = db.prepare('INSERT INTO usuarios (nombre) VALUES (?)').run(nombre);
  res.status(201).json(db.prepare('SELECT id, nombre, creado FROM usuarios WHERE id = ?').get(r.lastInsertRowid));
});

// ---------- clientes ----------
const SELECT_CLIENTE = `
  SELECT c.*, u.nombre AS creado_por_nombre
  FROM clientes c LEFT JOIN usuarios u ON u.id = c.creado_por`;

// Estado de todos los contratos, agrupado por cliente
const RESUMEN_VACIO = {
  contratos_activos: 0, saldo: 0, atrasado: false, dias_atraso: 0, cuota_hoy: 0, valor_atrasos: 0, por_cobrar_hoy: 0,
};

function resumenPorCliente() {
  const contratos = db.prepare('SELECT * FROM contratos').all();
  const pagos = db.prepare('SELECT * FROM pagos WHERE anulado = 0').all();
  const pagosPorContrato = Map.groupBy(pagos, (p) => p.contrato_id);
  const resumen = new Map();
  for (const k of contratos) {
    const e = estadoContrato(k, pagosPorContrato.get(k.id) ?? []);
    const r = resumen.get(k.cliente_id) ?? { ...RESUMEN_VACIO };
    if (e.estado !== 'pagado') {
      r.contratos_activos += 1;
      r.saldo += e.saldo;
      // lo que vence hoy y aún no se ha pagado
      r.cuota_hoy += e.plan.filter((c) => c.estado === 'hoy').reduce((s, c) => s + (c.valor - c.pagado), 0);
      r.valor_atrasos += e.valorAtrasos;
      r.por_cobrar_hoy = r.cuota_hoy + r.valor_atrasos;
    }
    if (e.estado === 'atrasado') {
      r.atrasado = true;
      r.dias_atraso = Math.max(r.dias_atraso, e.diasAtraso);
    }
    resumen.set(k.cliente_id, r);
  }
  return resumen;
}

app.get('/api/clientes', (req, res) => {
  const q = mayus(req.query.q);
  const filas = q
    ? db.prepare(`${SELECT_CLIENTE}
        WHERE c.nombre LIKE ? OR c.telefono LIKE ? OR c.direccion LIKE ?
        ORDER BY c.nombre`).all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare(`${SELECT_CLIENTE} ORDER BY c.nombre`).all();
  const resumen = resumenPorCliente();
  res.json(filas.map((c) => ({ ...c, ...(resumen.get(c.id) ?? RESUMEN_VACIO) })));
});

app.get('/api/clientes/:id', (req, res) => {
  const c = db.prepare(`${SELECT_CLIENTE} WHERE c.id = ?`).get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado.' });
  res.json(c);
});

app.post('/api/clientes', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });

  const { c, errores } = leerCliente(req.body ?? {});
  if (Object.keys(errores).length) return responderErrores(res, errores);

  const r = db.prepare(`
    INSERT INTO clientes (nombre, direccion, direccion2, ocupacion, telefono, telefono2, whatsapp, ruta, observaciones, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    c.nombre, c.direccion, c.direccion2, c.ocupacion, c.telefono, c.telefono2, c.whatsapp, c.ruta, c.observaciones, usuario.id,
  );
  res.status(201).json(db.prepare(`${SELECT_CLIENTE} WHERE c.id = ?`).get(r.lastInsertRowid));
});

app.put('/api/clientes/:id', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });

  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM clientes WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Cliente no encontrado.' });
  }

  const { c, errores } = leerCliente(req.body ?? {});
  if (Object.keys(errores).length) return responderErrores(res, errores);

  db.prepare(`
    UPDATE clientes SET nombre = ?, direccion = ?, direccion2 = ?, ocupacion = ?, telefono = ?, telefono2 = ?,
      whatsapp = ?, ruta = ?, observaciones = ?, modificado = datetime('now', 'localtime')
    WHERE id = ?`).run(
    c.nombre, c.direccion, c.direccion2, c.ocupacion, c.telefono, c.telefono2, c.whatsapp, c.ruta, c.observaciones, id,
  );
  res.json(db.prepare(`${SELECT_CLIENTE} WHERE c.id = ?`).get(id));
});

// ---------- totales (como el pie del listado impreso) ----------
const TOTALES_VACIO = () => ({
  registros: 0, prestamos: 0, creditos: 0, cuotas_dia: 0, cuotas: 0,
  atrasos_dia: 0, atrasos: 0, saldo_creditos: 0, saldo_mora: 0, total_saldos: 0,
});

app.get('/api/totales', (req, res) => {
  const ruta = String(req.query.ruta ?? '');
  const contratos = db.prepare(`
    SELECT k.*, c.ruta FROM contratos k JOIN clientes c ON c.id = k.cliente_id`).all()
    .filter((k) => !ruta || (ruta === 'sin' ? k.ruta == null : String(k.ruta) === ruta));
  const pagos = Map.groupBy(db.prepare('SELECT * FROM pagos WHERE anulado = 0').all(), (p) => p.contrato_id);

  const hoy = hoyLocal();
  const nuevos = TOTALES_VACIO();
  const total = TOTALES_VACIO();
  const porRuta = new Map();

  for (const k of contratos) {
    const lista = pagos.get(k.id) ?? [];
    const e = estadoContrato(k, lista);
    if (e.estado === 'pagado') continue;

    const deHoy = e.plan.filter((c) => c.estado === 'hoy');
    const fila = {
      registros: 1,
      prestamos: k.prestamo,
      creditos: k.credito,
      cuotas_dia: deHoy.reduce((s, c) => s + c.valor, 0),
      cuotas: k.valor_cuota,
      atrasos_dia: e.valorAtrasos,
      atrasos: e.valorAtrasos + deHoy.reduce((s, c) => s + (c.valor - c.pagado), 0),
      saldo_creditos: e.saldo,
      saldo_mora: 0, // la mora se cobra a mano en cada pago; no queda saldo pendiente
      total_saldos: e.saldo,
    };
    const claveRuta = k.ruta == null ? 'sin' : String(k.ruta);
    if (!porRuta.has(claveRuta)) porRuta.set(claveRuta, { ruta: k.ruta, ...TOTALES_VACIO() });
    const destinos = [total, porRuta.get(claveRuta)];
    if (k.fecha_inicio === hoy) destinos.push(nuevos); // préstamos hechos hoy
    for (const d of destinos) for (const [campo, v] of Object.entries(fila)) d[campo] += v;
  }

  res.json({
    fecha: new Date().toISOString(),
    nuevos,
    total,
    porRuta: [...porRuta.values()].sort((a, b) => (a.ruta ?? 1e9) - (b.ruta ?? 1e9)),
  });
});

// ---------- contratos ----------
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const entero = (v) => {
  const n = Number(String(v ?? '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
};

function contratoCompleto(id) {
  const k = db.prepare(`
    SELECT k.*, c.nombre AS cliente_nombre, u.nombre AS creado_por_nombre
    FROM contratos k JOIN clientes c ON c.id = k.cliente_id LEFT JOIN usuarios u ON u.id = k.creado_por
    WHERE k.id = ?`).get(id);
  if (!k) return null;
  const pagos = db.prepare(`
    SELECT p.*, u.nombre AS creado_por_nombre, ua.nombre AS anulado_por_nombre
    FROM pagos p LEFT JOIN usuarios u ON u.id = p.creado_por LEFT JOIN usuarios ua ON ua.id = p.anulado_por
    WHERE p.contrato_id = ? ORDER BY p.fecha DESC, p.id DESC`).all(id);
  return { ...k, pagos, estado: estadoContrato(k, pagos) };
}

app.get('/api/clientes/:id/contratos', (req, res) => {
  const ids = db.prepare('SELECT id FROM contratos WHERE cliente_id = ? ORDER BY id DESC').all(Number(req.params.id));
  const lista = ids.map(({ id }) => {
    const { pagos, estado, ...k } = contratoCompleto(id);
    const { plan, ...resto } = estado;
    return { ...k, estado: resto };
  });
  res.json(lista);
});

app.get('/api/contratos/:id', (req, res) => {
  const k = contratoCompleto(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Contrato no encontrado.' });
  res.json(k);
});

app.post('/api/contratos', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });
  const b = req.body ?? {};

  const k = {
    cliente_id: Number(b.cliente_id),
    fecha_inicio: b.fecha_inicio,
    fecha_primera_cuota: b.fecha_primera_cuota,
    forma_pago: b.forma_pago,
    prestamo: entero(b.prestamo),
    num_cuotas: entero(b.num_cuotas),
    valor_cuota: entero(b.valor_cuota),
    observaciones: texto(b.observaciones) || null,
  };

  const errores = {};
  if (!db.prepare('SELECT id FROM clientes WHERE id = ?').get(k.cliente_id)) errores.cliente_id = 'Cliente no encontrado.';
  if (!esFecha(k.fecha_inicio)) errores.fecha_inicio = 'Fecha no válida.';
  if (!esFecha(k.fecha_primera_cuota)) errores.fecha_primera_cuota = 'Fecha no válida.';
  else if (esFecha(k.fecha_inicio) && k.fecha_primera_cuota < k.fecha_inicio) errores.fecha_primera_cuota = 'No puede ser antes del inicio.';
  if (!FORMAS_PAGO[k.forma_pago]) errores.forma_pago = 'Escoja la forma de pago.';
  if (k.prestamo <= 0) errores.prestamo = 'Escriba el valor prestado.';
  if (k.num_cuotas <= 0) errores.num_cuotas = 'Mínimo 1 cuota.';
  else if (k.num_cuotas > 400) errores.num_cuotas = 'Máximo 400 cuotas.';
  if (k.valor_cuota <= 0) errores.valor_cuota = 'Escriba el valor de la cuota.';
  if (Object.keys(errores).length) return responderErrores(res, errores);

  k.credito = k.valor_cuota * k.num_cuotas;
  k.interes = Math.round(((k.credito / k.prestamo) - 1) * 10000) / 100;
  if (k.credito < k.prestamo) return responderErrores(res, { valor_cuota: 'El total de cuotas no cubre lo prestado.' });

  const r = db.prepare(`
    INSERT INTO contratos (cliente_id, fecha_inicio, fecha_primera_cuota, forma_pago, prestamo, interes,
      num_cuotas, valor_cuota, credito, observaciones, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    k.cliente_id, k.fecha_inicio, k.fecha_primera_cuota, k.forma_pago, k.prestamo, k.interes,
    k.num_cuotas, k.valor_cuota, k.credito, k.observaciones, usuario.id,
  );
  res.status(201).json(contratoCompleto(Number(r.lastInsertRowid)));
});

// ---------- pagos ----------
app.post('/api/contratos/:id/pagos', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });
  const k = contratoCompleto(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Contrato no encontrado.' });

  const b = req.body ?? {};
  const p = {
    fecha: b.fecha,
    abono: entero(b.abono),
    int_mora: entero(b.int_mora),
    observacion: texto(b.observacion) || null,
  };

  const errores = {};
  if (!esFecha(p.fecha)) errores.fecha = 'Fecha no válida.';
  else if (p.fecha < k.fecha_inicio) errores.fecha = 'No puede ser antes del inicio del contrato.';
  if (p.abono <= 0 && p.int_mora <= 0) errores.abono = 'Escriba el valor del abono.';
  if (p.abono > k.estado.saldo) errores.abono = `El saldo es $${k.estado.saldo.toLocaleString('es-CO')}; el abono no puede ser mayor.`;
  if (Object.keys(errores).length) return responderErrores(res, errores);

  db.prepare(`INSERT INTO pagos (contrato_id, fecha, abono, int_mora, observacion, creado_por) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(k.id, p.fecha, p.abono, p.int_mora, p.observacion, usuario.id);
  res.status(201).json(contratoCompleto(k.id));
});

app.post('/api/pagos/:id/anular', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });
  const p = db.prepare('SELECT * FROM pagos WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Pago no encontrado.' });
  if (p.anulado) return res.status(409).json({ error: 'Ese pago ya estaba anulado.' });
  db.prepare(`UPDATE pagos SET anulado = 1, anulado_por = ?, anulado_en = datetime('now', 'localtime') WHERE id = ?`)
    .run(usuario.id, p.id);
  res.json(contratoCompleto(p.contrato_id));
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

app.listen(PUERTO, () => {
  console.log(`Soluciones Financieras en http://localhost:${PUERTO}`);
});
