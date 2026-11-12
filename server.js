import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBase, TABLAS } from './basedatos.js';
import {
  mayus, leerUsuario, leerCliente, leerContrato, leerPago, resumenPorCliente, calcularTotales,
  armarContrato, calcularPlanilla, leerVisita, leerMora, leerRefinanciacion, ahoraLocal,
  RESUMEN_VACIO, ERROR_CAMPOS,
} from './public/logica.js';
import { hoyLocal } from './public/calculos.js';

export const NOMBRE_APP = 'Crea y crece DF';

const app = express();
const raiz = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PORT) || 3000;
const db = await abrirBase();

// la restauración de una copia puede traer muchos datos
app.use('/api/respaldo/restaurar', express.json({ limit: '50mb' }));
app.use(express.json());
app.use(express.static(join(raiz, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

// ---------- clave de acceso ----------
// En internet cualquiera con el enlace podría entrar: si CLAVE_ACCESO está definida,
// toda la API exige esa clave (encabezado X-Clave). En el computador puede quedar sin clave.
const CLAVE_ACCESO = (process.env.CLAVE_ACCESO || '').trim(); // sin espacios que se cuelen al pegarla
const claveCorrecta = (dada) => {
  const a = Buffer.from(String(dada ?? ''));
  const b = Buffer.from(CLAVE_ACCESO);
  return a.length === b.length && timingSafeEqual(a, b);
};
app.use('/api', (req, res, next) => {
  if (!CLAVE_ACCESO || claveCorrecta(req.get('X-Clave'))) return next();
  // pequeña espera para que no se puedan probar claves a la carrera
  setTimeout(() => res.status(401).json({ error: 'Clave de acceso incorrecta.', clave: true }), 800);
});

// Express 4 no atrapa errores de funciones async: este envoltorio los manda al manejador de errores
const ruta = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- utilidades ----------
async function usuarioActual(req) {
  const id = Number(req.get('X-Usuario-Id'));
  if (!id) return null;
  return db.una('SELECT id, nombre FROM usuarios WHERE id = ?', [id]);
}

const responderErrores = (res, errores) => res.status(400).json({ error: ERROR_CAMPOS, campos: errores });
const hayErrores = (e) => Object.keys(e).length > 0;
const pagosValidos = () => db.todas('SELECT * FROM pagos WHERE anulado = 0');
const sinUsuario = (res) => res.status(401).json({ error: 'Ingrese con un usuario.' });

// ---------- usuarios ----------
app.get('/api/usuarios', ruta(async (_req, res) => {
  res.json(await db.todas('SELECT id, nombre, creado FROM usuarios ORDER BY nombre'));
}));

app.post('/api/usuarios', ruta(async (req, res) => {
  const { nombre, error } = leerUsuario(req.body);
  if (error) return res.status(400).json({ error });
  if (await db.una('SELECT id FROM usuarios WHERE nombre = ?', [nombre])) {
    return res.status(409).json({ error: `El usuario ${nombre} ya existe.` });
  }
  const r = await db.ejecutar('INSERT INTO usuarios (nombre, creado) VALUES (?, ?)', [nombre, ahoraLocal()]);
  res.status(201).json(await db.una('SELECT id, nombre, creado FROM usuarios WHERE id = ?', [r.id]));
}));

// ---------- clientes ----------
const SELECT_CLIENTE = `
  SELECT c.*, u.nombre AS creado_por_nombre
  FROM clientes c LEFT JOIN usuarios u ON u.id = c.creado_por`;

app.get('/api/clientes', ruta(async (req, res) => {
  const q = mayus(req.query.q);
  const [filas, contratos, pagos] = await Promise.all([
    q
      ? db.todas(`${SELECT_CLIENTE} WHERE c.nombre LIKE ? OR c.telefono LIKE ? OR c.direccion LIKE ? ORDER BY c.nombre`,
        [`%${q}%`, `%${q}%`, `%${q}%`])
      : db.todas(`${SELECT_CLIENTE} ORDER BY c.nombre`),
    db.todas('SELECT * FROM contratos'),
    pagosValidos(),
  ]);
  const resumen = resumenPorCliente(contratos, pagos);
  res.json(filas.map((c) => ({ ...c, ...(resumen.get(c.id) ?? RESUMEN_VACIO) })));
}));

app.get('/api/clientes/:id', ruta(async (req, res) => {
  const c = await db.una(`${SELECT_CLIENTE} WHERE c.id = ?`, [Number(req.params.id)]);
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado.' });
  res.json(c);
}));

app.post('/api/clientes', ruta(async (req, res) => {
  const usuario = await usuarioActual(req);
  if (!usuario) return sinUsuario(res);
  const { c, errores } = leerCliente(req.body ?? {});
  if (hayErrores(errores)) return responderErrores(res, errores);

  const r = await db.ejecutar(`
    INSERT INTO clientes (nombre, direccion, direccion2, ocupacion, telefono, telefono2, whatsapp, ruta, observaciones, creado_por, creado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [c.nombre, c.direccion, c.direccion2, c.ocupacion, c.telefono, c.telefono2, c.whatsapp, c.ruta, c.observaciones, usuario.id, ahoraLocal()]);
  res.status(201).json(await db.una(`${SELECT_CLIENTE} WHERE c.id = ?`, [r.id]));
}));

app.put('/api/clientes/:id', ruta(async (req, res) => {
  const usuario = await usuarioActual(req);
  if (!usuario) return sinUsuario(res);
  const id = Number(req.params.id);
  if (!(await db.una('SELECT id FROM clientes WHERE id = ?', [id]))) {
    return res.status(404).json({ error: 'Cliente no encontrado.' });
  }
  const { c, errores } = leerCliente(req.body ?? {});
  if (hayErrores(errores)) return responderErrores(res, errores);

  await db.ejecutar(`
    UPDATE clientes SET nombre = ?, direccion = ?, direccion2 = ?, ocupacion = ?, telefono = ?, telefono2 = ?,
      whatsapp = ?, ruta = ?, observaciones = ?, modificado = ?
    WHERE id = ?`,
  [c.nombre, c.direccion, c.direccion2, c.ocupacion, c.telefono, c.telefono2, c.whatsapp, c.ruta, c.observaciones, ahoraLocal(), id]);
  res.json(await db.una(`${SELECT_CLIENTE} WHERE c.id = ?`, [id]));
}));

// ---------- totales ----------
app.get('/api/totales', ruta(async (req, res) => {
  const [contratos, pagos, moras] = await Promise.all([
    db.todas('SELECT k.*, c.ruta FROM contratos k JOIN clientes c ON c.id = k.cliente_id'),
    pagosValidos(),
    db.todas('SELECT * FROM moras WHERE anulado = 0'),
  ]);
  res.json(calcularTotales(contratos, pagos, String(req.query.ruta ?? ''), moras));
}));

// ---------- planilla del día ----------
app.get('/api/planilla', ruta(async (req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha)) ? String(req.query.fecha) : hoyLocal();
  const [contratos, pagos, visitas] = await Promise.all([
    db.todas(`
      SELECT k.*, c.nombre AS cliente_nombre, c.ruta, c.telefono, c.direccion
      FROM contratos k JOIN clientes c ON c.id = k.cliente_id`),
    pagosValidos(),
    db.todas(`
      SELECT v.*, u.nombre AS creado_por_nombre FROM visitas v LEFT JOIN usuarios u ON u.id = v.creado_por
      WHERE v.anulado = 0 AND v.fecha = ?`, [fecha]),
  ]);
  res.json(calcularPlanilla(contratos, pagos, fecha, String(req.query.ruta ?? ''), visitas));
}));

// ---------- contratos ----------
async function contratoCompleto(id) {
  const [k, pagos, visitas, moras] = await Promise.all([
    db.una(`
      SELECT k.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.telefono2 AS cliente_telefono2, c.whatsapp AS cliente_whatsapp,
        c.direccion AS cliente_direccion, c.direccion2 AS cliente_direccion2, c.ocupacion AS cliente_ocupacion,
        c.ruta AS cliente_ruta, c.observaciones AS cliente_observaciones, u.nombre AS creado_por_nombre, ue.nombre AS editado_por_nombre
      FROM contratos k JOIN clientes c ON c.id = k.cliente_id LEFT JOIN usuarios u ON u.id = k.creado_por
      LEFT JOIN usuarios ue ON ue.id = k.editado_por
      WHERE k.id = ?`, [id]),
    db.todas(`
      SELECT p.*, u.nombre AS creado_por_nombre, ua.nombre AS anulado_por_nombre
      FROM pagos p LEFT JOIN usuarios u ON u.id = p.creado_por LEFT JOIN usuarios ua ON ua.id = p.anulado_por
      WHERE p.contrato_id = ?`, [id]),
    db.todas(`
      SELECT v.*, u.nombre AS creado_por_nombre, ua.nombre AS anulado_por_nombre
      FROM visitas v LEFT JOIN usuarios u ON u.id = v.creado_por LEFT JOIN usuarios ua ON ua.id = v.anulado_por
      WHERE v.contrato_id = ?`, [id]),
    db.todas(`
      SELECT m.*, u.nombre AS creado_por_nombre, ua.nombre AS anulado_por_nombre
      FROM moras m LEFT JOIN usuarios u ON u.id = m.creado_por LEFT JOIN usuarios ua ON ua.id = m.anulado_por
      WHERE m.contrato_id = ?`, [id]),
  ]);
  return k ? armarContrato(k, pagos, visitas, moras) : null;
}

app.get('/api/clientes/:id/contratos', ruta(async (req, res) => {
  const ids = await db.todas('SELECT id FROM contratos WHERE cliente_id = ? ORDER BY id DESC', [Number(req.params.id)]);
  const completos = await Promise.all(ids.map(({ id }) => contratoCompleto(id)));
  res.json(completos.map(({ pagos, estado: { plan, ...estado }, ...k }) => ({ ...k, estado })));
}));

app.get('/api/contratos/:id', ruta(async (req, res) => {
  const k = await contratoCompleto(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Contrato no encontrado.' });
  res.json(k);
}));

const INSERTAR_CONTRATO = `
  INSERT INTO contratos (cliente_id, fecha_inicio, fecha_primera_cuota, forma_pago, prestamo, interes,
    num_cuotas, valor_cuota, credito, observaciones, creado_por, creado, refinancia_id, adicional, interes_mes, meses)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const valoresContrato = (k, usuarioId) => [
  k.cliente_id, k.fecha_inicio, k.fecha_primera_cuota, k.forma_pago, k.prestamo, k.interes,
  k.num_cuotas, k.valor_cuota, k.credito, k.observaciones, usuarioId, ahoraLocal(), k.refinancia_id ?? null, k.adicional ?? null,
  k.interes_mes, k.meses,
];

app.post('/api/contratos', ruta(async (req, res) => {
  const usuario = await usuarioActual(req);
  if (!usuario) return sinUsuario(res);
  const b = req.body ?? {};
  const existe = Boolean(await db.una('SELECT id FROM clientes WHERE id = ?', [Number(b.cliente_id)]));
  const { k, errores } = leerContrato(b, () => existe);
  if (hayErrores(errores)) return responderErrores(res, errores);

  const r = await db.ejecutar(INSERTAR_CONTRATO, valoresContrato(k, usuario.id));
  res.status(201).json(await contratoCompleto(r.id));
}));

// ---------- editar contrato ----------
// Corrige valores, plazo y fechas. Los pagos, visitas y moras se conservan: el estado se recalcula solo.
app.put('/api/contratos/:id', ruta(async (req, res) => {
  const usuario = await usuarioActual(req);
  if (!usuario) return sinUsuario(res);
  const viejo = await contratoCompleto(Number(req.params.id));
  if (!viejo) return res.status(404).json({ error: 'Contrato no encontrado.' });
  if (viejo.refinanciado_por_id) {
    return res.status(409).json({ error: `Este contrato ya fue refinanciado. Edita el contrato nuevo (#${String(viejo.refinanciado_por_id).padStart(2, '0')}).` });
  }
  const b = req.body ?? {};
  // en un contrato que viene de refinanciar, el capital es el saldo trasladado: no se cambia
  const prestamo = viejo.refinancia_id ? viejo.prestamo : b.prestamo;
  const { k, errores } = leerContrato({ ...b, cliente_id: viejo.cliente_id, prestamo }, () => true);
  const abonado = viejo.estado.abonoCredito || 0;
  if (!errores.valor_cuota && k.credito < abonado) {
    errores.valor_cuota = `Ya se abonaron ${abonado.toLocaleString('es-CO')}: el total del crédito no puede ser menor.`;
  }
  if (hayErrores(errores)) return responderErrores(res, errores);

  await db.ejecutar(`
    UPDATE contratos SET fecha_inicio = ?, fecha_primera_cuota = ?, forma_pago = ?, prestamo = ?, interes = ?,
      num_cuotas = ?, valor_cuota = ?, credito = ?, observaciones = ?, interes_mes = ?, meses = ?, editado = ?, editado_por = ?
    WHERE id = ?`, [
    k.fecha_inicio, k.fecha_primera_cuota, k.forma_pago, k.prestamo, k.interes,
    k.num_cuotas, k.valor_cuota, k.credito, k.observaciones, k.interes_mes, k.meses, ahoraLocal(), usuario.id, viejo.id,
  ]);
  res.json(await contratoCompleto(viejo.id));
}));

// ---------- pagos ----------
app.post('/api/contratos/:id/pagos', ruta(async (req, res) => {
  const usuario = await usuarioActual(req);
  if (!usuario) return sinUsuario(res);
  const k = await contratoCompleto(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Contrato no encontrado.' });

  const { p, errores } = leerPago(req.body ?? {}, k);
  if (hayErrores(errores)) return responderErrores(res, errores);

  await db.ejecutar('INSERT INTO pagos (contrato_id, fecha, abono, int_mora, observacion, creado_por, creado) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [k.id, p.fecha, p.abono, p.int_mora, p.observacion, usuario.id, ahoraLocal()]);
  res.status(201).json(await contratoCompleto(k.id));
}));

// anular un pago, una visita o un cargo de mora: misma lógica
function rutaAnular(tabla, nombre, yaAnulado) {
  return ruta(async (req, res) => {
    const usuario = await usuarioActual(req);
    if (!usuario) return sinUsuario(res);
    const fila = await db.una(`SELECT * FROM ${tabla} WHERE id = ?`, [Number(req.params.id)]);
    if (!fila) return res.status(404).json({ error: `${nombre} no encontrado.` });
    if (fila.anulado) return res.status(409).json({ error: yaAnulado });
    await db.ejecutar(`UPDATE ${tabla} SET anulado = 1, anulado_por = ?, anulado_en = ? WHERE id = ?`, [usuario.id, ahoraLocal(), fila.id]);
    res.json(await contratoCompleto(fila.contrato_id));
  });
}
app.post('/api/pagos/:id/anular', rutaAnular('pagos', 'Pago', 'Ese pago ya estaba anulado.'));

// ---------- visitas sin pago ("No pagó") ----------
app.post('/api/contratos/:id/visitas', ruta(async (req, res) => {
  const usuario = await usuarioActual(req);
  if (!usuario) return sinUsuario(res);
  const k = await contratoCompleto(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Contrato no encontrado.' });
  const { v, errores } = leerVisita(req.body ?? {}, k);
  if (hayErrores(errores)) return responderErrores(res, errores);
  await db.ejecutar('INSERT INTO visitas (contrato_id, fecha, motivo, observacion, creado_por, creado) VALUES (?, ?, ?, ?, ?, ?)',
    [k.id, v.fecha, v.motivo, v.observacion, usuario.id, ahoraLocal()]);
  res.status(201).json(await contratoCompleto(k.id));
}));
app.post('/api/visitas/:id/anular', rutaAnular('visitas', 'Visita', 'Esa visita ya estaba anulada.'));

// ---------- intereses de mora ----------
app.post('/api/contratos/:id/moras', ruta(async (req, res) => {
  const usuario = await usuarioActual(req);
  if (!usuario) return sinUsuario(res);
  const k = await contratoCompleto(Number(req.params.id));
  if (!k) return res.status(404).json({ error: 'Contrato no encontrado.' });
  const { m, errores } = leerMora(req.body ?? {}, k);
  if (hayErrores(errores)) return responderErrores(res, errores);
  await db.ejecutar('INSERT INTO moras (contrato_id, fecha, valor, observacion, creado_por, creado) VALUES (?, ?, ?, ?, ?, ?)',
    [k.id, m.fecha, m.valor, m.observacion, usuario.id, ahoraLocal()]);
  res.status(201).json(await contratoCompleto(k.id));
}));
app.post('/api/moras/:id/anular', rutaAnular('moras', 'Cargo de mora', 'Ese cargo ya estaba anulado.'));

// ---------- refinanciar ----------
app.post('/api/contratos/:id/refinanciar', ruta(async (req, res) => {
  const usuario = await usuarioActual(req);
  if (!usuario) return sinUsuario(res);
  const viejo = await contratoCompleto(Number(req.params.id));
  if (!viejo) return res.status(404).json({ error: 'Contrato no encontrado.' });

  const { k, errores, traslado } = leerRefinanciacion(req.body ?? {}, viejo);
  if (hayErrores(errores)) return responderErrores(res, errores);

  const nuevoId = await db.transaccion(async (t) => {
    const r = await t.ejecutar(INSERTAR_CONTRATO, valoresContrato(k, usuario.id));
    await t.ejecutar('UPDATE contratos SET refinanciado_por_id = ?, saldo_trasladado = ?, mora_trasladada = ? WHERE id = ?',
      [r.id, traslado.saldo, traslado.mora || null, viejo.id]);
    return r.id;
  });
  res.status(201).json(await contratoCompleto(nuevoId));
}));

// ---------- copia de seguridad ----------
// Descarga todo (para guardarlo o pasarlo a otra base) y restaura en una base vacía.
app.get('/api/respaldo', ruta(async (_req, res) => {
  const tablas = {};
  for (const t of TABLAS) tablas[t] = await db.todas(`SELECT * FROM ${t} ORDER BY id`);
  const conteo = Object.fromEntries(TABLAS.map((t) => [t, tablas[t].length]));
  res.json({ app: NOMBRE_APP, version: 1, fecha: ahoraLocal(), conteo, tablas });
}));

app.post('/api/respaldo/restaurar', ruta(async (req, res) => {
  const respaldo = req.body ?? {};
  if (!respaldo.tablas || typeof respaldo.tablas !== 'object') {
    return res.status(400).json({ error: 'El archivo no es una copia de seguridad de la app.' });
  }
  // solo en una base sin clientes ni movimientos, para no mezclar ni pisar datos.
  // Los usuarios sí pueden existir (hace falta uno para entrar): se reemplazan por los de la copia.
  for (const t of TABLAS.filter((x) => x !== 'usuarios')) {
    if ((await db.una(`SELECT count(*) AS n FROM ${t}`)).n > 0) {
      return res.status(409).json({ error: 'La base ya tiene clientes o contratos. Solo se puede restaurar en una base nueva.' });
    }
  }
  const columnasDe = {};
  for (const t of TABLAS) columnasDe[t] = new Set((await db.todas(`PRAGMA table_info(${t})`)).map((c) => c.name));

  const conteo = {};
  // Turso revisa las referencias: un contrato refinanciado apunta al contrato nuevo, que puede
  // venir después. Los enlaces entre contratos se ponen al final, cuando ya existen todos.
  const ENLACES = ['refinancia_id', 'refinanciado_por_id'];
  await db.transaccion(async (tx) => {
    await tx.ejecutar('DELETE FROM usuarios');
    const enlaces = [];
    for (const t of TABLAS) {
      const filas = Array.isArray(respaldo.tablas[t]) ? respaldo.tablas[t] : [];
      for (const fila of filas) {
        let cols = Object.keys(fila).filter((c) => columnasDe[t].has(c));
        if (t === 'contratos') {
          if (ENLACES.some((c) => fila[c] != null)) enlaces.push(fila);
          cols = cols.filter((c) => !ENLACES.includes(c));
        }
        await tx.ejecutar(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => fila[c]));
      }
      conteo[t] = filas.length;
    }
    for (const k of enlaces) {
      await tx.ejecutar('UPDATE contratos SET refinancia_id = ?, refinanciado_por_id = ? WHERE id = ?',
        [k.refinancia_id ?? null, k.refinanciado_por_id ?? null, k.id]);
    }
  });
  res.json({ ok: true, conteo });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// errores inesperados (por ejemplo, la base no responde)
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Ocurrió un error en el servidor. Intenta de nuevo.' });
});

app.listen(PUERTO, () => {
  console.log(`${NOMBRE_APP} en http://localhost:${PUERTO} · base: ${db.tipo}`);
});
