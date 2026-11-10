import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import {
  mayus, leerUsuario, leerCliente, leerContrato, leerPago, resumenPorCliente, calcularTotales,
  armarContrato, calcularPlanilla, leerVisita, leerMora, leerRefinanciacion, RESUMEN_VACIO, ERROR_CAMPOS,
} from './public/logica.js';
import { hoyLocal } from './public/calculos.js';

const app = express();
const raiz = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(join(raiz, 'public')));

// ---------- utilidades ----------
function usuarioActual(req) {
  const id = Number(req.get('X-Usuario-Id'));
  if (!id) return null;
  return db.prepare('SELECT id, nombre FROM usuarios WHERE id = ?').get(id) ?? null;
}

const responderErrores = (res, errores) => res.status(400).json({ error: ERROR_CAMPOS, campos: errores });
const hayErrores = (e) => Object.keys(e).length > 0;
const pagosValidos = () => db.prepare('SELECT * FROM pagos WHERE anulado = 0').all();

// ---------- usuarios ----------
app.get('/api/usuarios', (_req, res) => {
  res.json(db.prepare('SELECT id, nombre, creado FROM usuarios ORDER BY nombre').all());
});

app.post('/api/usuarios', (req, res) => {
  const { nombre, error } = leerUsuario(req.body);
  if (error) return res.status(400).json({ error });
  if (db.prepare('SELECT id FROM usuarios WHERE nombre = ?').get(nombre)) {
    return res.status(409).json({ error: `El usuario ${nombre} ya existe.` });
  }
  const r = db.prepare('INSERT INTO usuarios (nombre) VALUES (?)').run(nombre);
  res.status(201).json(db.prepare('SELECT id, nombre, creado FROM usuarios WHERE id = ?').get(r.lastInsertRowid));
});

// ---------- clientes ----------
const SELECT_CLIENTE = `
  SELECT c.*, u.nombre AS creado_por_nombre
  FROM clientes c LEFT JOIN usuarios u ON u.id = c.creado_por`;

app.get('/api/clientes', (req, res) => {
  const q = mayus(req.query.q);
  const filas = q
    ? db.prepare(`${SELECT_CLIENTE}
        WHERE c.nombre LIKE ? OR c.telefono LIKE ? OR c.direccion LIKE ?
        ORDER BY c.nombre`).all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare(`${SELECT_CLIENTE} ORDER BY c.nombre`).all();
  const resumen = resumenPorCliente(db.prepare('SELECT * FROM contratos').all(), pagosValidos());
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
  if (hayErrores(errores)) return responderErrores(res, errores);

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
  if (hayErrores(errores)) return responderErrores(res, errores);

  db.prepare(`
    UPDATE clientes SET nombre = ?, direccion = ?, direccion2 = ?, ocupacion = ?, telefono = ?, telefono2 = ?,
      whatsapp = ?, ruta = ?, observaciones = ?, modificado = datetime('now', 'localtime')
    WHERE id = ?`).run(
    c.nombre, c.direccion, c.direccion2, c.ocupacion, c.telefono, c.telefono2, c.whatsapp, c.ruta, c.observaciones, id,
  );
  res.json(db.prepare(`${SELECT_CLIENTE} WHERE c.id = ?`).get(id));
});

// ---------- totales ----------
app.get('/api/totales', (req, res) => {
  const contratos = db.prepare('SELECT k.*, c.ruta FROM contratos k JOIN clientes c ON c.id = k.cliente_id').all();
  const moras = db.prepare('SELECT * FROM moras WHERE anulado = 0').all();
  res.json(calcularTotales(contratos, pagosValidos(), String(req.query.ruta ?? ''), moras));
});

// ---------- planilla del día ----------
app.get('/api/planilla', (req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha)) ? String(req.query.fecha) : hoyLocal();
  const contratos = db.prepare(`
    SELECT k.*, c.nombre AS cliente_nombre, c.ruta, c.telefono, c.direccion
    FROM contratos k JOIN clientes c ON c.id = k.cliente_id`).all();
  const visitas = db.prepare(`
    SELECT v.*, u.nombre AS creado_por_nombre FROM visitas v LEFT JOIN usuarios u ON u.id = v.creado_por
    WHERE v.anulado = 0 AND v.fecha = ?`).all(fecha);
  res.json(calcularPlanilla(contratos, pagosValidos(), fecha, String(req.query.ruta ?? ''), visitas));
});

// ---------- contratos ----------
function contratoCompleto(id) {
  const k = db.prepare(`
    SELECT k.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.telefono2 AS cliente_telefono2, c.whatsapp AS cliente_whatsapp,
      c.direccion AS cliente_direccion, c.direccion2 AS cliente_direccion2, c.ocupacion AS cliente_ocupacion,
      c.ruta AS cliente_ruta, c.observaciones AS cliente_observaciones, u.nombre AS creado_por_nombre
    FROM contratos k JOIN clientes c ON c.id = k.cliente_id LEFT JOIN usuarios u ON u.id = k.creado_por
    WHERE k.id = ?`).get(id);
  if (!k) return null;
  const pagos = db.prepare(`
    SELECT p.*, u.nombre AS creado_por_nombre, ua.nombre AS anulado_por_nombre
    FROM pagos p LEFT JOIN usuarios u ON u.id = p.creado_por LEFT JOIN usuarios ua ON ua.id = p.anulado_por
    WHERE p.contrato_id = ?`).all(id);
  const visitas = db.prepare(`
    SELECT v.*, u.nombre AS creado_por_nombre, ua.nombre AS anulado_por_nombre
    FROM visitas v LEFT JOIN usuarios u ON u.id = v.creado_por LEFT JOIN usuarios ua ON ua.id = v.anulado_por
    WHERE v.contrato_id = ?`).all(id);
  const moras = db.prepare(`
    SELECT m.*, u.nombre AS creado_por_nombre, ua.nombre AS anulado_por_nombre
    FROM moras m LEFT JOIN usuarios u ON u.id = m.creado_por LEFT JOIN usuarios ua ON ua.id = m.anulado_por
    WHERE m.contrato_id = ?`).all(id);
  return armarContrato(k, pagos, visitas, moras);
}

app.get('/api/clientes/:id/contratos', (req, res) => {
  const ids = db.prepare('SELECT id FROM contratos WHERE cliente_id = ? ORDER BY id DESC').all(Number(req.params.id));
  res.json(ids.map(({ id }) => {
    const { pagos, estado: { plan, ...estado }, ...k } = contratoCompleto(id);
    return { ...k, estado };
  }));
});

app.get('/api/contratos/:id', (req, res) => {
  const k = contratoCompleto(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Contrato no encontrado.' });
  res.json(k);
});

app.post('/api/contratos', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });

  const existe = (id) => Boolean(db.prepare('SELECT id FROM clientes WHERE id = ?').get(id));
  const { k, errores } = leerContrato(req.body ?? {}, existe);
  if (hayErrores(errores)) return responderErrores(res, errores);

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

  const { p, errores } = leerPago(req.body ?? {}, k);
  if (hayErrores(errores)) return responderErrores(res, errores);

  db.prepare('INSERT INTO pagos (contrato_id, fecha, abono, int_mora, observacion, creado_por) VALUES (?, ?, ?, ?, ?, ?)')
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

// ---------- visitas sin pago ("No pagó") ----------
app.post('/api/contratos/:id/visitas', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });
  const k = contratoCompleto(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Contrato no encontrado.' });

  const { v, errores } = leerVisita(req.body ?? {}, k);
  if (hayErrores(errores)) return responderErrores(res, errores);

  db.prepare('INSERT INTO visitas (contrato_id, fecha, motivo, observacion, creado_por) VALUES (?, ?, ?, ?, ?)')
    .run(k.id, v.fecha, v.motivo, v.observacion, usuario.id);
  res.status(201).json(contratoCompleto(k.id));
});

app.post('/api/visitas/:id/anular', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });
  const v = db.prepare('SELECT * FROM visitas WHERE id = ?').get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Visita no encontrada.' });
  if (v.anulado) return res.status(409).json({ error: 'Esa visita ya estaba anulada.' });
  db.prepare(`UPDATE visitas SET anulado = 1, anulado_por = ?, anulado_en = datetime('now', 'localtime') WHERE id = ?`)
    .run(usuario.id, v.id);
  res.json(contratoCompleto(v.contrato_id));
});

// ---------- intereses de mora ----------
app.post('/api/contratos/:id/moras', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });
  const k = contratoCompleto(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Contrato no encontrado.' });
  const { m, errores } = leerMora(req.body ?? {}, k);
  if (hayErrores(errores)) return responderErrores(res, errores);
  db.prepare('INSERT INTO moras (contrato_id, fecha, valor, observacion, creado_por) VALUES (?, ?, ?, ?, ?)')
    .run(k.id, m.fecha, m.valor, m.observacion, usuario.id);
  res.status(201).json(contratoCompleto(k.id));
});

app.post('/api/moras/:id/anular', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });
  const m = db.prepare('SELECT * FROM moras WHERE id = ?').get(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Cargo de mora no encontrado.' });
  if (m.anulado) return res.status(409).json({ error: 'Ese cargo ya estaba anulado.' });
  db.prepare(`UPDATE moras SET anulado = 1, anulado_por = ?, anulado_en = datetime('now', 'localtime') WHERE id = ?`)
    .run(usuario.id, m.id);
  res.json(contratoCompleto(m.contrato_id));
});

// ---------- refinanciar ----------
app.post('/api/contratos/:id/refinanciar', (req, res) => {
  const usuario = usuarioActual(req);
  if (!usuario) return res.status(401).json({ error: 'Ingrese con un usuario.' });
  const viejo = contratoCompleto(Number(req.params.id));
  if (!viejo) return res.status(404).json({ error: 'Contrato no encontrado.' });

  const { k, errores, traslado } = leerRefinanciacion(req.body ?? {}, viejo);
  if (hayErrores(errores)) return responderErrores(res, errores);

  db.exec('BEGIN');
  try {
    const r = db.prepare(`
      INSERT INTO contratos (cliente_id, fecha_inicio, fecha_primera_cuota, forma_pago, prestamo, interes,
        num_cuotas, valor_cuota, credito, observaciones, creado_por, refinancia_id, adicional)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      k.cliente_id, k.fecha_inicio, k.fecha_primera_cuota, k.forma_pago, k.prestamo, k.interes,
      k.num_cuotas, k.valor_cuota, k.credito, k.observaciones, usuario.id, k.refinancia_id, k.adicional,
    );
    const nuevoId = Number(r.lastInsertRowid);
    db.prepare('UPDATE contratos SET refinanciado_por_id = ?, saldo_trasladado = ?, mora_trasladada = ? WHERE id = ?')
      .run(nuevoId, traslado.saldo, traslado.mora || null, viejo.id);
    db.exec('COMMIT');
    res.status(201).json(contratoCompleto(nuevoId));
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

app.listen(PUERTO, () => {
  console.log(`Soluciones Financieras en http://localhost:${PUERTO}`);
});
