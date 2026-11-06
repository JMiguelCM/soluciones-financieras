// Genera datos simulados (usuarios, clientes, contratos y pagos) relativos a hoy.
// Lo usan `npm run demo` (SQLite) y el modo demo del navegador (GitHub Pages).
import { cronograma, primeraCuotaSugerida, cuotaSugerida, sumarDias, hoyLocal } from './calculos.js';

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
const CUOTAS = { D: [20, 30], S: [4, 10], Q: [4, 8], M: [1, 4] };
const MESES_POR_CUOTA = { D: 1 / 26, S: 1 / 4.3, Q: 1 / 2, M: 1 };
const PERFILES = [['puntual', 6], ['atrasado', 4], ['picos', 2], ['adelantado', 2], ['moroso', 1], ['nuevo', 2]];

export function generarDemo(hoy = hoyLocal(), semillaInicial = 20261104) {
  // ---------- azar reproducible ----------
  let semilla = semillaInicial;
  const azar = () => ((semilla = (semilla * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
  const uno = (lista) => lista[Math.floor(azar() * lista.length)];
  const ponderado = (pares) => {
    let r = azar() * pares.reduce((s, [, p]) => s + p, 0);
    for (const [v, p] of pares) if ((r -= p) <= 0) return v;
    return pares[pares.length - 1][0];
  };
  const hora = () => `${String(entre(8, 17)).padStart(2, '0')}:${String(entre(0, 59)).padStart(2, '0')}:00`;

  const usuarios = ['JOSE', 'MARIA', 'CARLOS'].map((nombre, i) => ({ id: i + 1, nombre, creado: `${sumarDias(hoy, -210)} 08:00:00` }));
  const idsUsuarios = usuarios.map((u) => u.id);

  // ---------- clientes ----------
  const direccion = () => `${uno(VIAS)} ${entre(5, 80)}${azar() < 0.3 ? uno(['A', 'B', 'C']) : ''} # ${entre(1, 99)}-${entre(1, 99)}`;
  const celular = () => `3${uno(['00', '01', '04', '10', '13', '14', '15', '16', '17', '18', '20', '22', '23'])}${String(entre(0, 9999999)).padStart(7, '0')}`;

  const clientes = NOMBRES.map((nombre, i) => {
    const tel = celular();
    return {
      id: i + 1,
      nombre,
      direccion: direccion(),
      direccion2: azar() < 0.3 ? direccion() : null,
      ocupacion: ponderado(OCUPACIONES),
      telefono: tel,
      telefono2: azar() < 0.25 ? celular() : null,
      whatsapp: azar() < 0.8 ? tel : null,
      ruta: uno([13, 30, 36, 50]),
      observaciones: uno(OBS),
      creado_por: uno(idsUsuarios),
      creado: `${sumarDias(hoy, -entre(130, 200))} ${hora()}`,
      modificado: null,
    };
  });

  // ---------- contratos y pagos ----------
  const contratos = [];
  const pagos = [];

  function crearContrato(clienteId, perfil) {
    const forma = ponderado([['D', 4], ['S', 4], ['Q', 3], ['M', 1]]);
    const n = entre(...CUOTAS[forma]);
    const prestamo = uno([200, 250, 300, 400, 500, 600, 700, 800, 1000, 1200, 1500]) * 1000;
    const interes = Math.max(20, Math.round((20 * n * MESES_POR_CUOTA[forma]) / 5) * 5);
    const vc = cuotaSugerida(prestamo, interes, n);

    // Inicio: los pagados empiezan lo bastante atrás para haber terminado; los nuevos, hoy.
    let inicio = perfil === 'nuevo' ? hoy : sumarDias(hoy, -entre(3, 50));
    if (perfil === 'pagado') {
      const dur = cronograma(primeraCuotaSugerida(hoy, forma), forma, n);
      const dias = Math.round((Date.parse(dur[dur.length - 1]) - Date.parse(hoy)) / 864e5);
      inicio = sumarDias(hoy, -(dias + entre(20, 60)));
    }
    const primera = primeraCuotaSugerida(inicio, forma);
    const fechas = cronograma(primera, forma, n);
    const credito = vc * n;
    const id = contratos.length + 1;

    contratos.push({
      id,
      cliente_id: clienteId,
      fecha_inicio: inicio,
      fecha_primera_cuota: primera,
      forma_pago: forma,
      prestamo,
      interes: Math.round((credito / prestamo - 1) * 10000) / 100,
      num_cuotas: n,
      valor_cuota: vc,
      credito,
      observaciones: azar() < 0.15 ? 'Codeudor: familiar que vive en la misma casa' : null,
      creado_por: uno(idsUsuarios),
      creado: `${inicio} 09:${String(entre(10, 59))}:00`,
    });

    // Pagos según el comportamiento del cliente
    const vencidas = fechas.filter((f) => f < hoy); // la cuota de hoy queda pendiente de cobro
    let pagado = 0;
    const pagar = (fecha, abono, mora = 0, obs = null) => {
      abono = Math.min(abono, credito - pagado);
      if (abono <= 0 && !mora) return;
      if (fecha > hoy) fecha = hoy;
      pagado += abono;
      pagos.push({
        id: pagos.length + 1, contrato_id: id, fecha, abono, int_mora: mora, observacion: obs,
        creado_por: uno(idsUsuarios), creado: `${fecha} ${hora()}`, anulado: 0, anulado_por: null, anulado_en: null,
      });
    };

    if (perfil === 'pagado') {
      fechas.forEach((f) => pagar(sumarDias(f, entre(0, 1)), vc));
    } else if (perfil === 'puntual') {
      vencidas.forEach((f) => pagar(f, vc));
    } else if (perfil === 'adelantado') {
      vencidas.forEach((f, i) => pagar(f, i % 2 === 0 ? vc * 2 : vc));
    } else if (perfil === 'picos') {
      vencidas.forEach((f) => pagar(sumarDias(f, entre(0, 2)), azar() < 0.5 ? Math.round((vc * 0.6) / 1000) * 1000 : vc));
    } else if (perfil === 'atrasado') {
      const deja = Math.min(vencidas.length, entre(1, 3));
      vencidas.slice(0, vencidas.length - deja).forEach((f) => {
        const tarde = entre(0, 6);
        pagar(sumarDias(f, tarde), vc, tarde > 3 ? uno([5000, 10000, 15000]) : 0, tarde > 3 ? 'Pagó tarde, se cobró mora' : null);
      });
    } else if (perfil === 'moroso') {
      vencidas.slice(0, Math.min(1, vencidas.length)).forEach((f) => pagar(f, vc));
    }
  }

  clientes.forEach((c, i) => {
    if (i % 9 === 8) return; // algunos clientes sin contrato
    if (azar() < 0.35) crearContrato(c.id, 'pagado'); // historial: contrato ya terminado
    crearContrato(c.id, ponderado(PERFILES));
    if (azar() < 0.12) crearContrato(c.id, ponderado(PERFILES.slice(0, 2)));
  });

  // Un par de pagos anulados (digitados por error) y vueltos a registrar
  for (let i = 0; i < 2 && pagos.length; i++) {
    const orig = pagos[entre(0, pagos.length - 1)];
    if (orig.anulado) continue;
    orig.anulado = 1;
    orig.anulado_por = 1;
    orig.anulado_en = `${orig.fecha} 18:30:00`;
    pagos.push({
      ...orig, id: pagos.length + 1, anulado: 0, anulado_por: null, anulado_en: null,
      observacion: 'Se volvió a registrar (el anterior tenía error)', creado: `${orig.fecha} 18:31:00`,
    });
  }

  return { usuarios, clientes, contratos, pagos };
}
