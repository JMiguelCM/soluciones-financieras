// Reglas de negocio compartidas por el servidor (SQLite) y el modo demo del navegador.
import { estadoContrato, estaCerrado, FORMAS_PAGO, hoyLocal } from './calculos.js';

// ---------- utilidades ----------
// Map.groupBy no existe en navegadores de celular algo viejos
export function agrupar(lista, clave) {
  const m = new Map();
  for (const x of lista) {
    const k = clave(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
export const mayus = (v) => texto(v).toUpperCase();
const soloDigitos = (v) => texto(String(v ?? '')).replace(/\D/g, '');
export const entero = (v) => {
  const n = Number(String(v ?? '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
// Colombia: celular de 10 dígitos o fijo de 7
const telefonoValido = (t) => t.length === 10 || t.length === 7;

export function ahoraLocal() {
  const f = new Date();
  const d = (n) => String(n).padStart(2, '0');
  return `${hoyLocal()} ${d(f.getHours())}:${d(f.getMinutes())}:${d(f.getSeconds())}`;
}

export const ERROR_CAMPOS = 'Revise los campos marcados.';

// ---------- usuarios ----------
export function leerUsuario(body) {
  const nombre = mayus(body?.nombre);
  if (!nombre) return { error: 'Escriba el nombre del usuario.' };
  if (nombre.length > 40) return { error: 'El nombre no puede pasar de 40 caracteres.' };
  return { nombre };
}

// ---------- clientes ----------
export function leerCliente(body) {
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

// ---------- contratos ----------
export function leerContrato(body, clienteExiste) {
  const k = {
    cliente_id: Number(body.cliente_id),
    fecha_inicio: body.fecha_inicio,
    fecha_primera_cuota: body.fecha_primera_cuota,
    forma_pago: body.forma_pago,
    prestamo: entero(body.prestamo),
    num_cuotas: entero(body.num_cuotas),
    valor_cuota: entero(body.valor_cuota),
    observaciones: texto(body.observaciones) || null,
  };

  const errores = {};
  if (!clienteExiste(k.cliente_id)) errores.cliente_id = 'Cliente no encontrado.';
  if (!esFecha(k.fecha_inicio)) errores.fecha_inicio = 'Fecha no válida.';
  if (!esFecha(k.fecha_primera_cuota)) errores.fecha_primera_cuota = 'Fecha no válida.';
  else if (esFecha(k.fecha_inicio) && k.fecha_primera_cuota < k.fecha_inicio) errores.fecha_primera_cuota = 'No puede ser antes del inicio.';
  if (!FORMAS_PAGO[k.forma_pago]) errores.forma_pago = 'Escoja la forma de pago.';
  if (k.prestamo <= 0) errores.prestamo = 'Escriba el valor prestado.';
  if (k.num_cuotas <= 0) errores.num_cuotas = 'Mínimo 1 cuota.';
  else if (k.num_cuotas > 400) errores.num_cuotas = 'Máximo 400 cuotas.';
  if (k.valor_cuota <= 0) errores.valor_cuota = 'Escriba el valor de la cuota.';

  if (!Object.keys(errores).length) {
    k.credito = k.valor_cuota * k.num_cuotas;
    k.interes = Math.round(((k.credito / k.prestamo) - 1) * 10000) / 100;
    if (k.credito < k.prestamo) errores.valor_cuota = 'El total de cuotas no cubre lo prestado.';
  }
  return { k, errores };
}

// ---------- pagos ----------
/** `contrato` debe traer `estado` (resultado de estadoContrato). */
export function leerPago(body, contrato) {
  const p = {
    fecha: body.fecha,
    abono: entero(body.abono),
    int_mora: entero(body.int_mora),
    observacion: texto(body.observacion) || null,
  };
  const errores = {};
  if (!esFecha(p.fecha)) errores.fecha = 'Fecha no válida.';
  else if (p.fecha < contrato.fecha_inicio) errores.fecha = 'No puede ser antes del inicio del contrato.';
  if (p.abono <= 0 && p.int_mora <= 0) errores.abono = 'Escriba el valor del abono.';
  if (contrato.estado.estado === 'refinanciado') errores.abono = 'Este contrato fue refinanciado: registre el pago en el contrato nuevo.';
  else if (p.abono > contrato.estado.saldo) errores.abono = `El saldo es $${contrato.estado.saldo.toLocaleString('es-CO')}; el abono no puede ser mayor.`;
  return { p, errores };
}

// ---------- resumen por cliente (lista de clientes) ----------
export const RESUMEN_VACIO = {
  contratos_activos: 0, saldo: 0, atrasado: false, dias_atraso: 0, cuota_hoy: 0, valor_atrasos: 0, por_cobrar_hoy: 0,
  contratos: [], // nunca se modifica: los clientes con contratos reciben su propia lista
};

/** `pagos`: solo los no anulados. */
export function resumenPorCliente(contratos, pagos) {
  const pagosPorContrato = agrupar(pagos, (p) => p.contrato_id);
  const resumen = new Map();
  for (const k of contratos) {
    const e = estadoContrato(k, pagosPorContrato.get(k.id) ?? []);
    const r = resumen.get(k.cliente_id) ?? { ...RESUMEN_VACIO, contratos: [] };
    if (!estaCerrado(e.estado)) {
      // lo que vence hoy y aún no se ha pagado
      const cuotaHoy = e.plan.filter((c) => c.estado === 'hoy').reduce((s, c) => s + (c.valor - c.pagado), 0);
      r.contratos_activos += 1;
      r.saldo += e.saldo;
      r.cuota_hoy += cuotaHoy;
      r.valor_atrasos += e.valorAtrasos;
      r.por_cobrar_hoy = r.cuota_hoy + r.valor_atrasos;
      // cada contrato activo por separado (la lista muestra una fila por contrato)
      r.contratos.push({
        id: k.id,
        forma_pago: k.forma_pago,
        valor_cuota: k.valor_cuota,
        saldo: e.saldo,
        atrasado: e.estado === 'atrasado',
        dias_atraso: e.diasAtraso,
        cuota_hoy: cuotaHoy,
        valor_atrasos: e.valorAtrasos,
        por_cobrar_hoy: cuotaHoy + e.valorAtrasos,
      });
    }
    if (e.estado === 'atrasado') {
      r.atrasado = true;
      r.dias_atraso = Math.max(r.dias_atraso, e.diasAtraso);
    }
    resumen.set(k.cliente_id, r);
  }
  return resumen;
}

// ---------- totales (como el pie del listado impreso) ----------
const TOTALES_VACIO = () => ({
  registros: 0, prestamos: 0, creditos: 0, cuotas_dia: 0, cuotas: 0,
  atrasos_dia: 0, atrasos: 0, saldo_creditos: 0, saldo_mora: 0, total_saldos: 0,
});

/** `contratos` con la ruta del cliente en `ruta`; `pagos` y `moras` solo los no anulados. */
export function calcularTotales(contratos, pagos, ruta = '', moras = []) {
  const morasPorContrato = agrupar(moras, (m) => m.contrato_id);
  const hoy = hoyLocal();
  const porContrato = agrupar(pagos, (p) => p.contrato_id);
  const nuevos = TOTALES_VACIO();
  const total = TOTALES_VACIO();
  const porRuta = new Map();

  for (const k of contratos) {
    if (ruta && (ruta === 'sin' ? k.ruta != null : String(k.ruta) !== ruta)) continue;
    const e = estadoContrato(k, porContrato.get(k.id) ?? []);
    if (estaCerrado(e.estado)) continue;
    const mora = resumenMora(k, porContrato.get(k.id) ?? [], morasPorContrato.get(k.id) ?? []);

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
      saldo_mora: mora.saldo,
      total_saldos: e.saldo + mora.saldo,
    };
    const claveRuta = k.ruta == null ? 'sin' : String(k.ruta);
    if (!porRuta.has(claveRuta)) porRuta.set(claveRuta, { ruta: k.ruta, ...TOTALES_VACIO() });
    const destinos = [total, porRuta.get(claveRuta)];
    if (k.fecha_inicio === hoy) destinos.push(nuevos); // préstamos hechos hoy
    for (const d of destinos) for (const [campo, v] of Object.entries(fila)) d[campo] += v;
  }

  return {
    fecha: new Date().toISOString(),
    nuevos,
    total,
    porRuta: [...porRuta.values()].sort((a, b) => (a.ruta ?? 1e9) - (b.ruta ?? 1e9)),
  };
}

// ---------- planilla del día ----------
/**
 * Clientes a cobrar en `fecha`: los que tienen una cuota ese día y, si la fecha es hoy o futura,
 * también los atrasados (siguen debiendo hasta que paguen).
 * `contratos` con datos del cliente (cliente_nombre, ruta, telefono, direccion);
 * `pagos` y `visitas` solo los no anulados (visitas = "no pagó" registrados por el cobrador).
 */
export function calcularPlanilla(contratos, pagos, fecha, ruta = '', visitas = []) {
  const hoy = hoyLocal();
  const porContrato = agrupar(pagos, (p) => p.contrato_id);
  const visitaDelDia = new Map();
  for (const v of visitas) {
    if (v.fecha !== fecha) continue;
    const previa = visitaDelDia.get(v.contrato_id);
    if (!previa || v.id > previa.id) visitaDelDia.set(v.contrato_id, v);
  }
  const filas = [];

  for (const k of contratos) {
    if (ruta && (ruta === 'sin' ? k.ruta != null : String(k.ruta) !== ruta)) continue;
    const lista = porContrato.get(k.id) ?? [];
    const e = estadoContrato(k, lista);
    if (e.estado === 'refinanciado') continue; // se cobra en el contrato nuevo
    const cuota = e.plan.find((c) => c.fecha === fecha) ?? null;
    const atrasadoVigente = fecha >= hoy && e.estado === 'atrasado';
    if (!cuota && !atrasadoVigente) continue;

    const pendienteCuota = cuota && cuota.estado !== 'pagada' ? cuota.valor - cuota.pagado : 0;
    const aCobrar = fecha >= hoy ? pendienteCuota + e.valorAtrasos : 0;
    const pagadoDia = lista.filter((p) => p.fecha === fecha).reduce((s, p) => s + p.abono + (p.int_mora || 0), 0);

    const visita = visitaDelDia.get(k.id) ?? null;
    let situacion;
    if (fecha < hoy) situacion = cuota.estado === 'pagada' ? 'pago' : 'no_pago';
    else if (aCobrar <= 0) situacion = 'cubierto'; // ya pagó o va adelantado
    else if (visita) situacion = 'visitado'; // el cobrador marcó que no pagó
    else situacion = e.estado === 'atrasado' ? 'atrasado' : 'pendiente';

    filas.push({
      contrato_id: k.id,
      cliente_id: k.cliente_id,
      cliente_nombre: k.cliente_nombre,
      ruta: k.ruta,
      telefono: k.telefono,
      direccion: k.direccion,
      forma_pago: k.forma_pago,
      valor_cuota: k.valor_cuota,
      cuota,
      cuotas_atraso: e.cuotasAtraso,
      dias_atraso: e.diasAtraso,
      valor_atrasos: e.valorAtrasos,
      a_cobrar: aCobrar,
      pagado_dia: pagadoDia,
      saldo: e.saldo,
      situacion,
      visita,
    });
  }

  const orden = { atrasado: 0, pendiente: 1, visitado: 2, no_pago: 3, cubierto: 4, pago: 5 };
  filas.sort((a, b) => orden[a.situacion] - orden[b.situacion]
    || (a.ruta ?? 1e9) - (b.ruta ?? 1e9)
    || a.cliente_nombre.localeCompare(b.cliente_nombre));

  const suma = (campo, f = filas) => f.reduce((s, x) => s + (x[campo] || 0), 0);
  return {
    fecha,
    hoy,
    filas,
    resumen: {
      clientes: new Set(filas.map((f) => f.cliente_id)).size,
      contratos: filas.length,
      a_cobrar: suma('a_cobrar'),
      cuotas_dia: filas.reduce((s, f) => s + (f.cuota?.valor ?? 0), 0),
      recaudado: suma('pagado_dia'),
      pendientes: filas.filter((f) => ['atrasado', 'pendiente'].includes(f.situacion)).length,
      no_pagaron: filas.filter((f) => ['visitado', 'no_pago'].includes(f.situacion)).length,
      cubiertos: filas.filter((f) => ['cubierto', 'pago'].includes(f.situacion)).length,
    },
  };
}

// ---------- visitas sin pago ----------
export const MOTIVOS_NO_PAGO = ['No estaba', 'No tenía plata', 'Pidió volver otro día', 'No quiso pagar', 'Otro'];

export function leerVisita(body, contrato) {
  const v = {
    fecha: body.fecha,
    motivo: texto(body.motivo),
    observacion: texto(body.observacion) || null,
  };
  const errores = {};
  if (!esFecha(v.fecha)) errores.fecha = 'Fecha no válida.';
  else if (v.fecha < contrato.fecha_inicio) errores.fecha = 'No puede ser antes del inicio del contrato.';
  if (!v.motivo) errores.motivo = 'Escoja el motivo.';
  else if (v.motivo.length > 60) errores.motivo = 'Motivo muy largo.';
  if (estaCerrado(contrato.estado?.estado)) errores.motivo = contrato.estado.estado === 'pagado' ? 'Este contrato ya está pagado.' : 'Este contrato fue refinanciado.';
  return { v, errores };
}

const masReciente = (a, b) => (a.fecha === b.fecha ? b.id - a.id : a.fecha < b.fecha ? 1 : -1);

// ---------- intereses de mora ----------
/**
 * Saldo de interés de mora: lo cargado (moras) menos lo abonado en los pagos (int_mora)
 * y lo que se trasladó al refinanciar. Si se cobró mora sin haberla cargado, el saldo queda en 0.
 */
export function resumenMora(k, pagos, moras) {
  const cargado = moras.filter((m) => !m.anulado).reduce((s, m) => s + m.valor, 0);
  const pagado = pagos.filter((p) => !p.anulado).reduce((s, p) => s + (p.int_mora || 0), 0);
  const trasladado = k.mora_trasladada || 0;
  return { cargado, pagado, trasladado, saldo: Math.max(0, cargado - pagado - trasladado) };
}

export function leerMora(body, contrato) {
  const m = { fecha: body.fecha, valor: entero(body.valor), observacion: texto(body.observacion) || null };
  const errores = {};
  if (!esFecha(m.fecha)) errores.fecha = 'Fecha no válida.';
  else if (m.fecha < contrato.fecha_inicio) errores.fecha = 'No puede ser antes del inicio del contrato.';
  if (m.valor <= 0) errores.valor = 'Escriba el valor del interés de mora.';
  else if (m.valor > contrato.credito) errores.valor = 'El interés de mora no puede superar el valor del crédito.';
  if (contrato.estado?.estado === 'refinanciado') errores.valor = 'Este contrato fue refinanciado.';
  return { m, errores };
}

// ---------- refinanciación ----------
/**
 * Datos del contrato nuevo que reemplaza a `viejo` (contrato completo, con estado y mora).
 * Capital nuevo = saldo del crédito (ya descuenta abonos y picos) + mora pendiente si se incluye + dinero adicional.
 */
export function leerRefinanciacion(body, viejo) {
  const errores = {};
  if (estaCerrado(viejo.estado.estado)) {
    errores.forma_pago = viejo.estado.estado === 'pagado' ? 'Este contrato ya está pagado.' : 'Este contrato ya fue refinanciado.';
    return { k: null, errores, traslado: null };
  }
  const saldo = viejo.estado.saldo;
  const mora = body.incluir_mora ? viejo.mora.saldo : 0;
  const adicional = entero(body.adicional);
  const prestamo = saldo + mora + adicional;
  const { k, errores: e2 } = leerContrato({ ...body, cliente_id: viejo.cliente_id, prestamo }, () => true);
  Object.assign(errores, e2);
  if (errores.prestamo) errores.adicional = errores.prestamo;
  if (k) {
    k.refinancia_id = viejo.id;
    k.adicional = adicional || null;
  }
  return { k, errores, traslado: { saldo, mora } };
}

/** Contrato con su estado, pagos, visitas sin pago y cargos de mora (más recientes primero). */
export function armarContrato(k, pagos, visitas = [], moras = []) {
  const ordenados = [...pagos].sort(masReciente);
  const estado = estadoContrato(k, ordenados);
  const mora = resumenMora(k, ordenados, moras);
  return {
    ...k,
    pagos: ordenados,
    visitas: [...visitas].sort(masReciente),
    moras: [...moras].sort(masReciente),
    mora,
    estado: { ...estado, saldoMora: mora.saldo, totalSaldo: estado.saldo + mora.saldo },
  };
}
