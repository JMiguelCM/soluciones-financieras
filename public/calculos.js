// Cálculos de contratos: se usan igual en el servidor y en el navegador.
// Fechas como texto 'AAAA-MM-DD'; valores en pesos (enteros).

export const FORMAS_PAGO = {
  D: 'Diario',
  S: 'Semanal',
  Q: 'Quincenal',
  M: 'Mensual',
};

// ---------- fechas ----------
const aFecha = (s) => {
  const [a, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};
const aTexto = (f) => f.toISOString().slice(0, 10);
const diasDelMes = (a, m) => new Date(Date.UTC(a, m + 1, 0)).getUTCDate();

export function sumarDias(s, n) {
  const f = aFecha(s);
  f.setUTCDate(f.getUTCDate() + n);
  return aTexto(f);
}

function sumarMeses(s, n, diaDeseado) {
  const f = aFecha(s);
  const a = f.getUTCFullYear();
  const m = f.getUTCMonth() + n;
  const dia = Math.min(diaDeseado ?? f.getUTCDate(), diasDelMes(a, m));
  return aTexto(new Date(Date.UTC(a, m, dia)));
}

const esDomingo = (s) => aFecha(s).getUTCDay() === 0;

export function diasEntre(desde, hasta) {
  return Math.round((aFecha(hasta) - aFecha(desde)) / 86400000);
}

export function hoyLocal() {
  const f = new Date();
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

/** Fecha sugerida para la primera cuota según la forma de pago. */
export function primeraCuotaSugerida(inicio, forma) {
  switch (forma) {
    case 'D': { const s = sumarDias(inicio, 1); return esDomingo(s) ? sumarDias(s, 1) : s; }
    case 'S': return sumarDias(inicio, 7);
    case 'Q': return sumarDias(inicio, 15);
    case 'M': return sumarMeses(inicio, 1);
    default: return inicio;
  }
}

/**
 * Fechas de todas las cuotas.
 * D: todos los días menos domingo. S: cada 7 días. M: mismo día cada mes.
 * Q: dos días fijos al mes separados 15 días (p. ej. 1 y 16), según el día de la primera cuota.
 */
export function cronograma(primera, forma, n) {
  const fechas = [primera];
  if (forma === 'Q') {
    const d1 = aFecha(primera).getUTCDate();
    const otro = d1 <= 15 ? d1 + 15 : d1 - 15;
    const bajo = Math.min(d1, otro);
    const alto = Math.max(d1, otro);
    let enBajo = d1 === bajo;
    let actual = primera;
    while (fechas.length < n) {
      if (enBajo) {
        const f = aFecha(actual);
        const dia = Math.min(alto, diasDelMes(f.getUTCFullYear(), f.getUTCMonth()));
        actual = aTexto(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), dia)));
      } else {
        actual = sumarMeses(actual, 1, bajo);
      }
      enBajo = !enBajo;
      fechas.push(actual);
    }
    return fechas;
  }
  while (fechas.length < n) {
    const ult = fechas[fechas.length - 1];
    if (forma === 'D') {
      let s = sumarDias(ult, 1);
      if (esDomingo(s)) s = sumarDias(s, 1);
      fechas.push(s);
    } else if (forma === 'S') {
      fechas.push(sumarDias(ult, 7));
    } else {
      fechas.push(sumarMeses(primera, fechas.length));
    }
  }
  return fechas;
}

/** Cuotas que caben en un mes según la forma de pago (diario: lunes a sábado). */
export const CUOTAS_POR_MES = { D: 26, S: 4, Q: 2, M: 1 };

/** Interés en pesos: cada mes del plazo suma su porcentaje (300.000 al 20 % a 2 meses → 120.000). */
export function interesPorMeses(prestamo, interesMesPct, meses) {
  return Math.round(prestamo * ((interesMesPct || 0) / 100) * (meses || 0));
}

/** Valor de cuota sugerido: (préstamo + interés) / cuotas, redondeado al mil más cercano. */
export function cuotaSugerida(prestamo, interesPesos, n) {
  if (!prestamo || !n) return 0;
  return Math.round((prestamo + (interesPesos || 0)) / n / 1000) * 1000;
}

/**
 * Estado del contrato a una fecha.
 * Los abonos llenan las cuotas en orden; lo que no completa una cuota queda como "pico".
 */
export function estadoContrato(contrato, pagos, hoy = hoyLocal()) {
  const vc = contrato.valor_cuota;
  const n = contrato.num_cuotas;
  const fechas = cronograma(contrato.fecha_primera_cuota, contrato.forma_pago, n);
  const validos = pagos.filter((p) => !p.anulado);

  const abonado = validos.reduce((s, p) => s + p.abono, 0);
  const mora = validos.reduce((s, p) => s + (p.int_mora || 0), 0);
  const saldo = Math.max(0, contrato.credito - abonado);

  const cuotasPagas = Math.min(n, Math.floor(abonado / vc));
  const picos = cuotasPagas >= n ? 0 : abonado - cuotasPagas * vc;

  const vencidas = fechas.filter((f) => f < hoy).length;   // ya debían estar pagas
  const exigibles = fechas.filter((f) => f <= hoy).length; // incluye la de hoy

  const cuotasAtraso = Math.max(0, vencidas - cuotasPagas);
  const valorAtrasos = Math.max(0, Math.min(saldo, vencidas * vc - abonado));
  const diasAtraso = cuotasAtraso > 0 ? diasEntre(fechas[cuotasPagas], hoy) : 0;

  const valorAdelantos = Math.max(0, abonado - exigibles * vc);
  const cuotasAdelantadas = Math.round((valorAdelantos / vc) * 100) / 100;

  const ordenados = [...validos].sort((a, b) => (a.fecha + a.id < b.fecha + b.id ? 1 : -1));
  const ultimo = ordenados[0] ?? null;

  const plan = fechas.map((fecha, i) => {
    const pagado = Math.max(0, Math.min(vc, abonado - i * vc));
    let estado = 'pendiente';
    if (pagado >= vc) estado = 'pagada';
    else if (fecha < hoy) estado = 'vencida';
    else if (fecha === hoy) estado = 'hoy';
    if (estado !== 'pagada' && pagado > 0 && estado === 'pendiente') estado = 'parcial';
    return { numero: i + 1, fecha, valor: vc, pagado, estado };
  });

  let estado = 'al_dia';
  if (saldo <= 0) estado = 'pagado';
  else if (cuotasAtraso > 0) estado = 'atrasado';

  const resultado = {
    estado,
    fechaUltimaCuota: fechas[fechas.length - 1],
    cuotasPagas,
    cuotasPendientes: n - cuotasPagas,
    picos,
    cuotasAtraso,
    diasAtraso,
    valorAtrasos,
    cuotasAdelantadas,
    valorAdelantos,
    abonoCredito: abonado,
    abonoMora: mora,
    totalAbonos: abonado + mora,
    saldo,
    fechaUltimoAbono: ultimo?.fecha ?? null,
    valorUltimoAbono: ultimo ? ultimo.abono + (ultimo.int_mora || 0) : 0,
    proximaCuota: plan.find((c) => c.estado !== 'pagada') ?? null,
    plan,
  };

  // Refinanciado: el saldo pasó a otro contrato; este queda cerrado, sin atrasos ni cuotas por cobrar.
  if (contrato.refinanciado_por_id) {
    Object.assign(resultado, {
      estado: 'refinanciado',
      saldo: 0,
      saldoTrasladado: contrato.saldo_trasladado ?? saldo,
      cuotasAtraso: 0,
      diasAtraso: 0,
      valorAtrasos: 0,
      valorAdelantos: 0,
      cuotasAdelantadas: 0,
      proximaCuota: null,
      plan: plan.map((c) => (c.estado === 'pagada' ? c : { ...c, estado: 'refinanciada' })),
    });
  }
  return resultado;
}

/** Contrato que ya no se cobra: pagado por completo o refinanciado en otro. */
export const estaCerrado = (estado) => estado === 'pagado' || estado === 'refinanciado';
