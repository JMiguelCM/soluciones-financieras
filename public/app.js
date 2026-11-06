import {
  FORMAS_PAGO, cronograma, cuotaSugerida, primeraCuotaSugerida, estadoContrato, estaCerrado, hoyLocal, sumarDias, diasEntre,
} from './calculos.js';
import { resumenMora } from './logica.js';

const $ = (sel) => document.querySelector(sel);
const CLAVE_USUARIO = 'sf.usuario';
const OCUPACIONES_BASE = ['INDEPENDIENTE', 'COMERCIANTE', 'EMPLEADO', 'SERVICIO AL CLIENTE', 'MOTORRATÓN', 'COSTURERA'];

let usuario = null;
let clientes = [];
let clienteAbierto = null;
let editandoId = null;

// ================= utilidades =================
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const icono = (id) => `<svg class="ic"><use href="#i-${id}"/></svg>`;

// Quita tildes sin cambiar la longitud (para resaltar coincidencias por posición)
const sinTildes = (s) => [...String(s ?? '').toLowerCase()].map((c) => c.normalize('NFD')[0]).join('');
const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');

function iniciales(nombre) {
  const partes = String(nombre ?? '').trim().split(/\s+/).filter((p) => !/^(DE|DEL|LA|LOS|LAS|Y)$/i.test(p));
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '?';
}

function tono(texto) {
  let h = 0;
  for (const c of String(texto)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

function avatar(nombre, clase = '') {
  return `<span class="avatar ${clase}" style="--h:${tono(nombre)}">${esc(iniciales(nombre))}</span>`;
}

function formatoTel(t) {
  const d = soloDigitos(t);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (d.length === 7) return `${d.slice(0, 3)} ${d.slice(3)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 10)}`;
}

const idCorto = (id) => `#${String(id).padStart(2, '0')}`;

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // respaldo para http sin candado (p. ej. abriendo por la IP del computador)
    const t = document.createElement('textarea');
    t.value = texto;
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

const bonito = (s) => String(s ?? '').toLowerCase();
const capital = (s) => bonito(s).replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());

// ---------- dinero y fechas ----------
const pesos = (n) => `$${Math.round(n || 0).toLocaleString('es-CO')}`;
const leerPesos = (s) => Number(soloDigitos(s)) || 0;
const formatoPesos = (s) => {
  const n = leerPesos(s);
  return n ? n.toLocaleString('es-CO') : '';
};
function fechaCorta(s, conAnio = true) {
  if (!s) return '';
  const f = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return f.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', ...(conAnio ? { year: 'numeric' } : {}), timeZone: 'UTC' })
    .replace('.', '');
}

/** Campos de dinero: muestran puntos de miles mientras se escribe. */
function campoDinero(input, alCambiar) {
  input.addEventListener('input', () => {
    const fin = input.value.length - input.selectionStart;
    input.value = formatoPesos(input.value);
    const pos = Math.max(0, input.value.length - fin);
    input.setSelectionRange(pos, pos);
    alCambiar?.();
  });
}

function mostrarErroresCampos(formulario, campos) {
  let primero = null;
  for (const [campo, msg] of Object.entries(campos)) {
    const el = formulario.elements[campo];
    if (el && el.classList) el.classList.add('invalido');
    const p = formulario.querySelector(`[data-error="${campo}"]`);
    if (p) p.textContent = msg;
    primero ??= el?.focus ? el : null;
  }
  primero?.focus();
  primero?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

function limpiarErroresDe(formulario) {
  formulario.querySelectorAll('.invalido').forEach((el) => el.classList.remove('invalido'));
  formulario.querySelectorAll('[data-error]').forEach((p) => (p.textContent = ''));
}

const ESTADOS = {
  al_dia: { texto: 'Al día', clase: 'ok' },
  atrasado: { texto: 'Atrasado', clase: 'peligro' },
  pagado: { texto: 'Pagado', clase: 'gris' },
  refinanciado: { texto: 'Refinanciado', clase: 'gris' },
};

// En GitHub Pages no hay servidor: la app usa una API simulada dentro del navegador.
// También se puede forzar con ?demo en la dirección.
const MODO_DEMO = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('demo');
let moduloLocal = null;

async function api(metodo, ruta, cuerpo) {
  if (MODO_DEMO) {
    moduloLocal ??= await import('./api-local.js');
    return moduloLocal.apiLocal(metodo, ruta, cuerpo, usuario?.id);
  }
  const r = await fetch(ruta, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(usuario ? { 'X-Usuario-Id': String(usuario.id) } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(datos.error || `Error ${r.status}`);
    e.campos = datos.campos;
    e.estado = r.status;
    throw e;
  }
  return datos;
}

let tAviso;
function aviso(msg) {
  const el = $('#aviso');
  el.innerHTML = `${icono('check')}<span>${esc(msg)}</span>`;
  // una ventana abierta queda por encima de todo: el aviso se muestra dentro de la de más arriba
  ([...document.querySelectorAll('dialog[open]')].pop() ?? document.body).append(el);
  el.hidden = false;
  clearTimeout(tAviso);
  tAviso = setTimeout(() => (el.hidden = true), 2600);
}

function guardarSesion(u) {
  usuario = u;
  try {
    if (u) localStorage.setItem(CLAVE_USUARIO, JSON.stringify(u));
    else localStorage.removeItem(CLAVE_USUARIO);
  } catch { /* sin almacenamiento: la sesión dura lo que la pestaña */ }
}

function leerSesion() {
  try { return JSON.parse(localStorage.getItem(CLAVE_USUARIO)); } catch { return null; }
}

// ================= ingreso =================
let usuarios = [];

async function mostrarIngreso() {
  $('#vista-app').hidden = true;
  $('#vista-ingreso').hidden = false;
  usuarios = await api('GET', '/api/usuarios');
  $('#bloque-usuarios').hidden = usuarios.length === 0;
  $('#lista-usuarios').innerHTML = usuarios.map((u) => `
    <button class="usuario-btn" type="button" data-id="${u.id}">
      ${avatar(u.nombre, 'avatar-sm')}
      <span>${esc(bonito(u.nombre))}</span>
      ${icono('chevron')}
    </button>`).join('');
  if (!usuarios.length) $('#nuevo-usuario').focus();
}

$('#lista-usuarios').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) entrar(usuarios.find((u) => u.id === Number(b.dataset.id)));
});

$('#form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#nuevo-usuario');
  const err = $('#error-usuario');
  err.hidden = true;
  if (!input.value.trim()) {
    err.textContent = 'Escribe un nombre para el usuario.';
    err.hidden = false;
    input.focus();
    return;
  }
  try {
    const u = await api('POST', '/api/usuarios', { nombre: input.value });
    input.value = '';
    entrar(u);
    aviso(`Bienvenido, ${capital(u.nombre)}`);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

function entrar(u) {
  guardarSesion({ id: u.id, nombre: u.nombre });
  $('#usuario-avatar').outerHTML = avatar(u.nombre, 'avatar-sm').replace('<span', '<span id="usuario-avatar"');
  $('#usuario-nombre').textContent = bonito(u.nombre);
  $('#vista-ingreso').hidden = true;
  $('#vista-app').hidden = false;
  $('#buscar').value = '';
  return cargarClientes();
}

$('#btn-salir').addEventListener('click', () => {
  guardarSesion(null);
  mostrarIngreso();
});

// ================= lista de clientes =================
async function cargarClientes() {
  clientes = await api('GET', '/api/clientes');
  pintarLista();
}

function coincide(c, q, qDig) {
  if (!q) return true;
  const enTexto = [c.nombre, c.direccion, c.direccion2, c.ocupacion].some((v) => sinTildes(v).includes(q));
  const enTel = qDig.length >= 3 && [c.telefono, c.telefono2, c.whatsapp].some((t) => t && t.includes(qDig));
  const enRuta = c.ruta != null && (q === String(c.ruta) || q === `ruta ${c.ruta}`);
  return enTexto || enTel || enRuta;
}

function resaltar(texto, q) {
  const original = bonito(texto);
  if (!q) return esc(original);
  const i = sinTildes(original).indexOf(q);
  if (i < 0) return esc(original);
  return esc(original.slice(0, i)) + `<mark>${esc(original.slice(i, i + q.length))}</mark>` + esc(original.slice(i + q.length));
}

// ---------- filtros (se recuerdan en este navegador) ----------
const FILTROS = {
  todos: { prueba: () => true, vacio: 'No hay clientes con estos filtros.' },
  hoy: { prueba: (c) => c.por_cobrar_hoy > 0, vacio: 'No hay cobros pendientes para hoy. 🎉' },
  atrasados: { prueba: (c) => c.atrasado, vacio: 'Ningún cliente está atrasado.' },
  al_dia: { prueba: (c) => c.contratos_activos > 0 && !c.atrasado, vacio: 'No hay clientes al día con estos filtros.' },
  sin_deuda: { prueba: (c) => c.contratos_activos === 0, vacio: 'Todos los clientes tienen contratos activos.' },
};

function leerPreferencia(clave, porDefecto) {
  try { return localStorage.getItem(clave) ?? porDefecto; } catch { return porDefecto; }
}
function guardarPreferencia(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

let filtro = leerPreferencia('sf.filtro', 'todos');
if (!FILTROS[filtro]) filtro = 'todos';
let filtroRuta = leerPreferencia('sf.ruta', '');

$('#filtros').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filtro]');
  if (!b) return;
  filtro = b.dataset.filtro;
  guardarPreferencia('sf.filtro', filtro);
  pintarLista();
});

$('#filtro-ruta').addEventListener('change', (e) => {
  filtroRuta = e.target.value;
  guardarPreferencia('sf.ruta', filtroRuta);
  pintarLista();
});

function pintarSelectorRutas() {
  const conteo = new Map();
  for (const c of clientes) {
    const k = c.ruta == null ? 'sin' : String(c.ruta);
    conteo.set(k, (conteo.get(k) ?? 0) + 1);
  }
  const rutas = [...conteo.keys()].filter((k) => k !== 'sin').sort((a, b) => a - b);
  if (filtroRuta && !conteo.has(filtroRuta)) filtroRuta = '';
  $('#filtro-ruta').innerHTML = `<option value="">Rutas</option>`
    + rutas.map((r) => `<option value="${r}">Ruta ${r} (${conteo.get(r)})</option>`).join('')
    + (conteo.has('sin') ? `<option value="sin">Sin ruta (${conteo.get('sin')})</option>` : '');
  $('#filtro-ruta').value = filtroRuta;
  $('.selector-ruta').classList.toggle('activo', Boolean(filtroRuta));
}

function pintarLista() {
  const q = sinTildes($('#buscar').value.trim());
  const qDig = soloDigitos(q);
  pintarSelectorRutas();

  const enRuta = (c) => !filtroRuta || (filtroRuta === 'sin' ? c.ruta == null : String(c.ruta) === filtroRuta);
  // un cliente con varios contratos activos aparece una vez por cada contrato
  const base = filasDeClientes(clientes).filter((c) => enRuta(c) && coincide(c, q, qDig));
  let visibles = base.filter(FILTROS[filtro].prueba);
  if (filtro === 'atrasados') visibles = [...visibles].sort((a, b) => b.dias_atraso - a.dias_atraso);
  if (filtro === 'hoy') visibles = [...visibles].sort((a, b) => (a.ruta ?? 1e9) - (b.ruta ?? 1e9) || a.nombre.localeCompare(b.nombre));

  // pestañas con su conteo
  document.querySelectorAll('#filtros [data-filtro]').forEach((b) => {
    const activo = b.dataset.filtro === filtro;
    b.setAttribute('aria-selected', String(activo));
    b.querySelector('span').textContent = base.filter(FILTROS[b.dataset.filtro].prueba).length;
  });

  // total del filtro
  const suma = (campo) => visibles.reduce((s, c) => s + (c[campo] || 0), 0);
  const total = $('#total-filtro');
  const textos = {
    hoy: ['Por cobrar hoy', suma('por_cobrar_hoy'), [
      suma('cuota_hoy') ? `${pesos(suma('cuota_hoy'))} vence hoy` : '',
      suma('valor_atrasos') ? `${pesos(suma('valor_atrasos'))} atrasado` : '',
    ].filter(Boolean).join(' + ')],
    atrasados: ['Total atrasado', suma('valor_atrasos'), `Saldo de estos clientes: ${pesos(suma('saldo'))}`],
    al_dia: ['Saldo por cobrar', suma('saldo'), null],
    todos: ['Cartera total', suma('saldo'), null],
  };
  const t = textos[filtro];
  total.hidden = !t || !visibles.length;
  if (t) {
    total.className = `total-filtro ${filtro === 'atrasados' ? 'tono-peligro' : filtro === 'hoy' ? 'tono-aviso' : ''}`;
    total.innerHTML = `
      <div><span class="sub">${t[0]}</span><strong>${pesos(t[1])}</strong></div>
      <span class="sub">${contarClientes(visibles)}${t[2] ? ` · ${t[2]}` : ''}</span>`;
  }

  const rutas = new Set(clientes.filter((c) => c.ruta != null).map((c) => c.ruta)).size;
  $('#resumen').textContent = clientes.length
    ? `${clientes.length} ${clientes.length === 1 ? 'cliente' : 'clientes'}${rutas ? ` · ${rutas} ${rutas === 1 ? 'ruta' : 'rutas'}` : ''}`
    : 'Sin clientes registrados';

  const montoDe = (c) => (filtro === 'hoy' ? c.por_cobrar_hoy : filtro === 'atrasados' ? c.valor_atrasos : c.saldo);

  $('#lista-clientes').innerHTML = visibles.map((c) => `
    <li><button class="cliente ${c.por_cobrar_hoy > 0 ? 'cobra-hoy' : ''}" type="button" data-id="${c.id}" ${c.contrato ? `data-contrato-fila="${c.contrato.id}"` : ''}>
      ${avatar(c.nombre)}
      <span class="cliente-info">
        <span class="cliente-nombre" style="display:block;text-transform:capitalize">${resaltar(c.nombre, q)}</span>
        <span class="cliente-sub">
          <span class="tel">${esc(formatoTel(c.telefono))}</span>
          ${c.ruta != null ? `<span class="tel ruta">Ruta ${esc(c.ruta)}</span>` : ''}
          ${c.contrato ? `<span class="tel contrato-chip">${idCorto(c.contrato.id)} ${FORMAS_PAGO[c.contrato.forma_pago]}</span>` : ''}
        </span>
      </span>
      <span class="cliente-der">
        ${c.contratos_activos ? `<span class="monto">${pesos(montoDe(c))}</span>` : ''}
        ${c.atrasado
          ? `<span class="etiqueta etiqueta-peligro">${c.dias_atraso} d atraso</span>`
          : c.cuota_hoy > 0 ? '<span class="etiqueta etiqueta-azul">Cobra hoy</span>'
            : c.contratos_activos ? '<span class="etiqueta etiqueta-ok">Al día</span>' : ''}
      </span>
      ${icono('chevron')}
    </button></li>`).join('');

  const vacio = $('#vacio');
  vacio.hidden = visibles.length > 0;
  if (!visibles.length) {
    const sinClientes = clientes.length === 0;
    $('#vacio-titulo').textContent = sinClientes ? 'Aún no hay clientes' : 'Sin resultados';
    $('#vacio-texto').textContent = sinClientes
      ? 'Registra el primer cliente para empezar a llevar sus créditos.'
      : q ? `Ningún cliente coincide con “${$('#buscar').value.trim()}”.` : FILTROS[filtro].vacio;
    $('#vacio-accion').hidden = !sinClientes;
  }
}

$('#buscar').addEventListener('input', pintarLista);

$('#lista-clientes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  const cliente = clientes.find((c) => c.id === Number(b.dataset.id));
  if (b.dataset.contratoFila) {
    // fila de un contrato: abre ese contrato (la flecha de volver lleva a la ficha del cliente)
    clienteAbierto = cliente;
    abrirContrato(Number(b.dataset.contratoFila)).catch((ex) => aviso(ex.message));
  } else {
    abrirFicha(cliente);
  }
});

/** Una fila por cada contrato activo del cliente; si no tiene ninguno, una sola fila. */
function filasDeClientes(lista) {
  return lista.flatMap((c) => {
    const ks = c.contratos ?? [];
    if (!ks.length) return [{ ...c, contrato: null }];
    return ks.map((k) => ({
      ...c,
      contrato: k,
      contratos_activos: 1,
      saldo: k.saldo,
      atrasado: k.atrasado,
      dias_atraso: k.dias_atraso,
      cuota_hoy: k.cuota_hoy,
      valor_atrasos: k.valor_atrasos,
      por_cobrar_hoy: k.por_cobrar_hoy,
    }));
  });
}

function contarClientes(filas) {
  const n = new Set(filas.map((f) => f.id)).size;
  const contratos = filas.filter((f) => f.contrato).length;
  return `${n} ${n === 1 ? 'cliente' : 'clientes'}${contratos > n ? ` · ${contratos} contratos` : ''}`;
}

// ================= ficha =================
function dato(ic, titulo, valoresHtml) {
  return `<div class="dato">${icono(ic)}<div><div class="dato-titulo">${titulo}</div>${valoresHtml}</div></div>`;
}

function abrirFicha(c) {
  pintarFicha(c);
  if (!$('#dlg-detalle').open) $('#dlg-detalle').showModal();
}

function pintarFicha(c) {
  clienteAbierto = c;
  const numero = (t) => `
    <div class="dato-valor numero">
      <span>${esc(formatoTel(t))}</span>
      <button class="btn-copiar" type="button" data-copiar="${esc(t)}" aria-label="Copiar ${esc(formatoTel(t))}">${icono('copy')} Copiar</button>
    </div>`;
  const telefonos = [c.telefono, c.telefono2].filter(Boolean).map(numero).join('');

  $('#det-contenido').innerHTML = `
    <div class="ficha-cabeza">
      ${avatar(c.nombre, 'avatar-lg')}
      <h2 class="ficha-nombre">${esc(bonito(c.nombre))}</h2>
      <div class="ficha-etiquetas">
        <span class="etiqueta etiqueta-gris">Cliente ${esc(idCorto(c.id))}</span>
        <span class="etiqueta etiqueta-gris" style="text-transform:capitalize">${icono('work')} ${esc(bonito(c.ocupacion))}</span>
        ${c.ruta != null ? `<span class="etiqueta">${icono('route')} Ruta ${esc(c.ruta)}</span>` : ''}
      </div>
    </div>

    <div class="ficha-acciones">
      <button class="btn btn-secundario" type="button" id="det-editar">${icono('edit')} Editar cliente</button>
    </div>

    <section class="seccion">
      <div class="seccion-cabeza">
        <h3>Contratos</h3>
        <button class="btn-chico" type="button" id="det-nuevo-contrato">${icono('plus')} Nuevo contrato</button>
      </div>
      <div id="det-contratos" class="contratos"><p class="sub">Cargando…</p></div>
    </section>

    <div class="ficha-cuerpo">
      ${dato('phone', 'Teléfonos', telefonos)}
      ${c.whatsapp ? dato('chat', 'WhatsApp', numero(c.whatsapp)) : ''}
      ${dato('pin', 'Dirección', `
        <div class="dato-valor">${esc(bonito(c.direccion))}</div>
        <div class="dato-valor ${c.direccion2 ? '' : 'dato-vacio'}">${c.direccion2 ? esc(bonito(c.direccion2)) : 'Sin segunda dirección'}</div>`)}
      ${c.observaciones ? dato('note', 'Observaciones', `<div class="dato-valor normal">${esc(c.observaciones)}</div>`) : ''}
    </div>

    <div class="ficha-meta">
      Creado ${esc(c.creado)}${c.creado_por_nombre ? ` por ${esc(capital(c.creado_por_nombre))}` : ''}${c.modificado ? ` · editado ${esc(c.modificado)}` : ''}
    </div>`;

  $('#det-editar').addEventListener('click', () => {
    $('#dlg-detalle').close();
    abrirFormulario(clienteAbierto);
  });
  $('#det-nuevo-contrato').addEventListener('click', () => abrirNuevoContrato(clienteAbierto));
  $('#det-contenido').scrollTop = 0;
  cargarContratosFicha(c.id);
}

function tarjetaContrato(k) {
  const e = k.estado;
  const est = ESTADOS[e.estado];
  const avance = Math.round((e.cuotasPagas / k.num_cuotas) * 100);
  const detalle = e.estado === 'atrasado'
    ? `${e.cuotasAtraso} ${e.cuotasAtraso === 1 ? 'cuota' : 'cuotas'} atrasada${e.cuotasAtraso === 1 ? '' : 's'} · ${e.diasAtraso} días`
    : e.estado === 'pagado'
      ? `Terminó de pagar ${fechaCorta(e.fechaUltimoAbono)}`
      : e.estado === 'refinanciado'
        ? `Refinanciado en el contrato ${idCorto(k.refinanciado_por_id)} · saldo trasladado ${pesos(e.saldoTrasladado)}`
        : `Próxima cuota ${fechaCorta(e.proximaCuota?.fecha, false)}`;
  return `
    <button class="contrato" type="button" data-contrato="${k.id}">
      <div class="contrato-fila">
        <span class="contrato-titulo">Contrato ${idCorto(k.id)} · ${FORMAS_PAGO[k.forma_pago]}</span>
        <span class="etiqueta etiqueta-${est.clase}">${est.texto}</span>
      </div>
      <div class="contrato-fila">
        <span class="contrato-saldo">${pesos(e.saldo)}</span>
        <span class="sub">${e.cuotasPagas}/${k.num_cuotas} cuotas de ${pesos(k.valor_cuota)}</span>
      </div>
      <div class="barra-avance ${est.clase}"><span style="width:${avance}%"></span></div>
      <div class="sub contrato-detalle">${detalle}</div>
    </button>`;
}

async function cargarContratosFicha(clienteId) {
  const cont = $('#det-contratos');
  try {
    const lista = await api('GET', `/api/clientes/${clienteId}/contratos`);
    if (clienteAbierto?.id !== clienteId || !document.body.contains(cont)) return;
    cont.innerHTML = lista.length
      ? lista.map(tarjetaContrato).join('')
      : '<p class="sub vacio-chico">Este cliente no tiene contratos todavía.</p>';
  } catch (ex) {
    cont.innerHTML = `<p class="error-campo">${esc(ex.message)}</p>`;
  }
}

// ================= contrato (vista) =================
let contratoAbierto = null;

async function abrirContrato(id) {
  const k = await api('GET', `/api/contratos/${id}`);
  pintarContrato(k);
  if (!$('#dlg-detalle').open) $('#dlg-detalle').showModal();
}

function filaInfo(etiqueta, valor, clase = '') {
  return `<div class="info-fila ${clase}"><dt>${etiqueta}</dt><dd>${valor}</dd></div>`;
}

function pintarContrato(k) {
  contratoAbierto = k;
  const e = k.estado;
  const est = ESTADOS[e.estado];
  const avance = Math.round((e.cuotasPagas / k.num_cuotas) * 100);

  const plan = e.plan.map((c) => {
    const etiquetas = {
      pagada: ['Pagada', 'ok'], vencida: ['Vencida', 'peligro'], hoy: ['Hoy', 'aviso'],
      parcial: ['Abonada', 'aviso'], pendiente: ['Pendiente', 'gris'], refinanciada: ['Refinanciada', 'gris'],
    };
    const [txt, cls] = etiquetas[c.estado];
    const abono = c.pagado > 0 && c.pagado < c.valor ? ` <span class="sub">(abonó ${pesos(c.pagado)})</span>` : '';
    return `<li class="cuota cuota-${c.estado}">
      <span class="cuota-num">${c.numero}</span>
      <span class="cuota-fecha">${fechaCorta(c.fecha)}${abono}</span>
      <span class="etiqueta etiqueta-${cls}">${txt}</span>
    </li>`;
  }).join('');

  const pagos = k.pagos.length
    ? k.pagos.map((p) => `
      <li class="pago ${p.anulado ? 'pago-anulado' : ''}">
        <div class="pago-info">
          <div class="pago-valor">${pesos(p.abono)}${p.int_mora ? ` <span class="sub">+ ${pesos(p.int_mora)} mora</span>` : ''}</div>
          <div class="sub">${fechaCorta(p.fecha)} · ${esc(capital(p.creado_por_nombre ?? ''))}${p.observacion ? ` · ${esc(p.observacion)}` : ''}</div>
          ${p.anulado ? `<div class="sub">Anulado por ${esc(capital(p.anulado_por_nombre ?? ''))} el ${esc(p.anulado_en)}</div>` : ''}
        </div>
        ${p.anulado ? '<span class="etiqueta etiqueta-gris">Anulado</span>' : `<span class="pago-botones"><button class="btn-chico" type="button" data-recibo="${p.id}">${icono('copy')} Mensaje</button><button class="btn-chico btn-chico-peligro" type="button" data-anular="${p.id}">Anular</button></span>`}
      </li>`).join('')
    : '<p class="sub vacio-chico">Aún no hay pagos registrados.</p>';

  const visitasValidas = (k.visitas ?? []).filter((v) => !v.anulado);
  const visitas = visitasValidas.map((v) => `
      <li class="pago pago-visita">
        <div class="pago-info">
          <div class="pago-valor">${icono('x')} No pagó · ${esc(v.motivo)}</div>
          <div class="sub">${fechaCorta(v.fecha)} · ${esc(capital(v.creado_por_nombre ?? ''))}${v.observacion ? ` · ${esc(v.observacion)}` : ''}</div>
        </div>
      </li>`).join('');

  const mora = k.mora ?? { cargado: 0, pagado: 0, trasladado: 0, saldo: 0 };
  const cerrado = estaCerrado(e.estado);
  const puedePagar = e.estado !== 'refinanciado' && (!cerrado || mora.saldo > 0);
  const cargosMora = (k.moras ?? []).map((m) => `
      <li class="pago ${m.anulado ? 'pago-anulado' : ''}">
        <div class="pago-info">
          <div class="pago-valor">${pesos(m.valor)}</div>
          <div class="sub">${fechaCorta(m.fecha)} · ${esc(capital(m.creado_por_nombre ?? ''))}${m.observacion ? ` · ${esc(m.observacion)}` : ''}</div>
          ${m.anulado ? `<div class="sub">Anulado por ${esc(capital(m.anulado_por_nombre ?? ''))} el ${esc(m.anulado_en)}</div>` : ''}
        </div>
        ${m.anulado ? '<span class="etiqueta etiqueta-gris">Anulado</span>' : `<button class="btn-chico btn-chico-peligro" type="button" data-anular-mora="${m.id}">Anular</button>`}
      </li>`).join('');

  $('#det-contenido').innerHTML = `
    <div class="contrato-cabeza">
      <button class="btn-icono" type="button" id="k-volver" aria-label="Volver al cliente">${icono('back')}</button>
      <div>
        <h2>Contrato ${idCorto(k.id)}</h2>
        <p class="sub" style="text-transform:capitalize">${esc(bonito(k.cliente_nombre))}</p>
      </div>
    </div>

    ${k.refinanciado_por_id ? `
      <button class="enlace-refi" type="button" data-contrato="${k.refinanciado_por_id}">
        ${icono('refresh')}
        <span><strong>Refinanciado en el contrato ${idCorto(k.refinanciado_por_id)}</strong>
        <span class="sub">Se trasladó un saldo de ${pesos(e.saldoTrasladado)}${k.mora_trasladada ? ` y ${pesos(k.mora_trasladada)} de mora` : ''}. Ver contrato nuevo</span></span>
        ${icono('chevron')}
      </button>` : ''}
    ${k.refinancia_id ? `
      <button class="enlace-refi" type="button" data-contrato="${k.refinancia_id}">
        ${icono('refresh')}
        <span><strong>Refinancia el contrato ${idCorto(k.refinancia_id)}</strong>
        <span class="sub">Capital ${pesos(k.prestamo)}${k.adicional ? ` (incluye ${pesos(k.adicional)} de dinero nuevo)` : ''}. Ver contrato anterior</span></span>
        ${icono('chevron')}
      </button>` : ''}

    <div class="saldo-grande">
      <div class="contrato-fila">
        <span class="sub">Saldo</span>
        <span class="etiqueta etiqueta-${est.clase}">${est.texto}</span>
      </div>
      <div class="saldo-valor">${pesos(e.saldo)}</div>
      ${mora.saldo ? `<div class="saldo-mora">+ ${pesos(mora.saldo)} de interés de mora · total ${pesos(e.saldo + mora.saldo)}</div>` : ''}
      <div class="barra-avance ${est.clase}"><span style="width:${avance}%"></span></div>
      <div class="sub">${e.cuotasPagas} de ${k.num_cuotas} cuotas pagas · crédito ${pesos(k.credito)}</div>
    </div>

    ${e.estado === 'atrasado' ? `
      <div class="alerta">${icono('alert')}
        <div><strong>${e.cuotasAtraso} ${e.cuotasAtraso === 1 ? 'cuota atrasada' : 'cuotas atrasadas'} · ${e.diasAtraso} días</strong>
        <div>Debe ponerse al día con ${pesos(e.valorAtrasos)}</div></div>
      </div>` : ''}

    ${puedePagar || !cerrado ? `
      <div class="ficha-acciones acciones-contrato">
        ${puedePagar ? `<button class="btn btn-primario btn-ancho" type="button" id="k-pagar">${icono('cash')} Registrar pago</button>` : ''}
        ${!cerrado ? `<button class="btn btn-secundario btn-ancho" type="button" id="k-refinanciar">${icono('refresh')} Refinanciar</button>` : ''}
      </div>` : ''}

    <section class="seccion">
      <div class="seccion-cabeza"><h3>Información del contrato</h3></div>
      <dl class="info">
        ${filaInfo('Inicio', fechaCorta(k.fecha_inicio))}
        ${filaInfo('1ra cuota', fechaCorta(k.fecha_primera_cuota))}
        ${filaInfo('Últ. cuota', fechaCorta(e.fechaUltimaCuota))}
        ${filaInfo('Forma de pago', FORMAS_PAGO[k.forma_pago])}
        ${filaInfo('Préstamo', pesos(k.prestamo))}
        ${filaInfo('Interés', `${String(k.interes).replace('.', ',')}%`)}
        ${filaInfo('Crédito', pesos(k.credito))}
        ${filaInfo('N° cuotas', k.num_cuotas)}
        ${filaInfo('Valor cuota', pesos(k.valor_cuota))}
        ${filaInfo('Cuotas pagas', e.cuotasPagas)}
        ${filaInfo('Cuotas pendientes', e.cuotasPendientes)}
        ${filaInfo('Picos', pesos(e.picos))}
        ${filaInfo('Atrasos', `C:${e.cuotasAtraso} D:${e.diasAtraso}`, e.cuotasAtraso ? 'peligro' : '')}
        ${filaInfo('Valor atrasos', pesos(e.valorAtrasos), e.valorAtrasos ? 'peligro' : '')}
        ${filaInfo('Cuotas adelantadas', e.cuotasAdelantadas.toLocaleString('es-CO', { minimumFractionDigits: 2 }))}
        ${filaInfo('Valor adelantos', pesos(e.valorAdelantos))}
        ${filaInfo('Fecha últ. abono', e.fechaUltimoAbono ? fechaCorta(e.fechaUltimoAbono) : 'No tiene abonos')}
        ${filaInfo('Valor últ. abono', pesos(e.valorUltimoAbono))}
        ${filaInfo('Abonos al crédito', pesos(e.abonoCredito))}
        ${filaInfo('Abonos int. mora', pesos(e.abonoMora))}
        ${filaInfo('Total abonos', pesos(e.totalAbonos))}
        ${filaInfo('Saldo crédito', pesos(e.saldo), 'fuerte')}
        ${filaInfo('Saldo int. mora', pesos(mora.saldo), mora.saldo ? 'peligro' : '')}
        ${filaInfo('Total saldo', pesos(e.saldo + mora.saldo), 'fuerte')}
      </dl>
      ${k.observaciones ? `<p class="nota">${esc(k.observaciones)}</p>` : ''}
    </section>

    <section class="seccion">
      <div class="seccion-cabeza">
        <h3>Intereses de mora</h3>
        ${e.estado !== 'refinanciado' ? `<button class="btn-chico" type="button" id="k-mora">${icono('plus')} Aplicar mora</button>` : ''}
      </div>
      <div class="mora-cajas">
        <div class="mora-caja ${mora.saldo ? 'tono-peligro' : ''}"><span>Saldo int. mora</span><strong>${pesos(mora.saldo)}</strong></div>
        <div class="mora-caja"><span>Aplicado</span><strong>${pesos(mora.cargado)}</strong></div>
        <div class="mora-caja"><span>Abonado</span><strong>${pesos(mora.pagado)}</strong></div>
        ${mora.trasladado ? `<div class="mora-caja"><span>Pasó al refinanciar</span><strong>${pesos(mora.trasladado)}</strong></div>` : ''}
      </div>
      ${cargosMora ? `<ul class="pagos">${cargosMora}</ul>` : '<p class="sub vacio-chico">No se le ha aplicado interés de mora.</p>'}
    </section>

    <section class="seccion">
      <details class="plegable">
        <summary><h3>Cuotas</h3><span class="sub">${e.cuotasPagas}/${k.num_cuotas}</span></summary>
        <ol class="cuotas">${plan}</ol>
      </details>
    </section>

    <section class="seccion">
      <div class="seccion-cabeza"><h3>Pagos</h3><span class="sub">${k.pagos.filter((p) => !p.anulado).length}</span></div>
      <ul class="pagos">${pagos}</ul>
    </section>

    ${visitasValidas.length ? `
      <section class="seccion">
        <div class="seccion-cabeza"><h3>Visitas sin pago</h3><span class="sub">${visitasValidas.length}</span></div>
        <ul class="pagos">${visitas}</ul>
      </section>` : ''}

    <div class="ficha-meta">
      Creado ${esc(k.creado)}${k.creado_por_nombre ? ` por ${esc(capital(k.creado_por_nombre))}` : ''}
    </div>`;

  $('#det-contenido').scrollTop = 0;
  $('#k-volver').addEventListener('click', () => {
    const c = clientes.find((x) => x.id === k.cliente_id);
    if (c) pintarFicha(c);
  });
  $('#k-pagar')?.addEventListener('click', () => abrirPago(contratoAbierto));
  $('#k-refinanciar')?.addEventListener('click', () => abrirRefinanciar(contratoAbierto));
  $('#k-mora')?.addEventListener('click', () => abrirMora(contratoAbierto));
}

$('#det-contenido').addEventListener('click', async (e) => {
  const tarjeta = e.target.closest('[data-contrato]');
  if (tarjeta) {
    abrirContrato(Number(tarjeta.dataset.contrato)).catch((ex) => aviso(ex.message));
    return;
  }
  const recibo = e.target.closest('[data-recibo]');
  if (recibo) {
    abrirRecibo(contratoAbierto, Number(recibo.dataset.recibo), false);
    return;
  }
  const anularMora = e.target.closest('[data-anular-mora]');
  if (anularMora) {
    const m = contratoAbierto.moras.find((x) => x.id === Number(anularMora.dataset.anularMora));
    if (!confirm(`¿Anular el interés de mora de ${pesos(m.valor)} del ${fechaCorta(m.fecha)}?`)) return;
    try {
      const k = await api('POST', `/api/moras/${m.id}/anular`);
      pintarContrato(k);
      aviso('Interés de mora anulado');
    } catch (ex) {
      aviso(ex.message);
    }
    return;
  }
  const anular = e.target.closest('[data-anular]');
  if (anular) {
    const p = contratoAbierto.pagos.find((x) => x.id === Number(anular.dataset.anular));
    if (!confirm(`¿Anular el pago de ${pesos(p.abono + p.int_mora)} del ${fechaCorta(p.fecha)}?\nEl saldo del contrato volverá a subir.`)) return;
    try {
      const k = await api('POST', `/api/pagos/${p.id}/anular`);
      pintarContrato(k);
      cargarClientes();
      if (pagina === 'planilla') cargarPlanilla();
      aviso('Pago anulado');
    } catch (ex) {
      aviso(ex.message);
    }
  }
});

// ================= nuevo contrato =================
const formK = $('#form-contrato');
let cuotaManual = false;
let primeraManual = false;
let clienteContrato = null;

let refinanciando = null; // contrato viejo cuando el formulario está en modo refinanciar

function prepararFormContrato(c, viejo) {
  clienteContrato = c;
  refinanciando = viejo;
  formK.reset();
  limpiarErroresDe(formK);
  cuotaManual = false;
  primeraManual = false;
  $('#contrato-cliente').textContent = capital(c.nombre);
  $('#contrato-titulo').textContent = viejo ? `Refinanciar contrato ${idCorto(viejo.id)}` : 'Nuevo contrato';
  $('#btn-guardar-contrato').lastChild.textContent = viejo ? ' Refinanciar' : ' Crear contrato';
  $('#k-refi').hidden = !viejo;
  formK.elements.prestamo.readOnly = Boolean(viejo);
  formK.elements.prestamo.closest('.campo').querySelector('label').textContent = viejo ? 'Capital del nuevo contrato' : 'Valor prestado';
  formK.elements.fecha_inicio.value = hoyLocal();
  formK.elements.interes.value = 20;
  if (viejo) {
    formK.querySelector(`[name="forma_pago"][value="${viejo.forma_pago}"]`).checked = true;
    const e = viejo.estado;
    $('#k-refi-resumen').innerHTML = tablaResumen([
      ['Crédito del contrato', pesos(viejo.credito)],
      ['Abonado (cuotas y picos)', pesos(e.abonoCredito)],
      ['Picos', pesos(e.picos)],
      ['Saldo que se traslada', pesos(e.saldo), 'fuerte'],
    ]);
    $('#k-refi-mora-fila').hidden = !viejo.mora.saldo;
    $('#k-refi-mora-texto').textContent = `Sumar el interés de mora pendiente (${pesos(viejo.mora.saldo)})`;
  }
  recalcularContrato();
  $('#dlg-contrato').showModal();
  $('#dlg-contrato .hoja-cuerpo').scrollTop = 0;
}

function abrirNuevoContrato(c) {
  prepararFormContrato(c, null);
}

function abrirRefinanciar(k) {
  prepararFormContrato({ id: k.cliente_id, nombre: k.cliente_nombre }, k);
}

function capitalRefinanciado() {
  if (!refinanciando) return 0;
  const mora = $('#k-incluir-mora').checked ? refinanciando.mora.saldo : 0;
  return refinanciando.estado.saldo + mora + leerPesos(formK.elements.adicional.value);
}

function recalcularContrato() {
  const f = formK.elements;
  const forma = f.forma_pago.value;
  if (refinanciando) f.prestamo.value = formatoPesos(String(capitalRefinanciado()));
  const prestamo = leerPesos(f.prestamo.value);
  const n = Number(f.num_cuotas.value) || 0;
  const interes = Number(f.interes.value) || 0;

  if (f.fecha_inicio.value && !primeraManual) f.fecha_primera_cuota.value = primeraCuotaSugerida(f.fecha_inicio.value, forma);
  if (!cuotaManual) f.valor_cuota.value = formatoPesos(String(cuotaSugerida(prestamo, interes, n)));

  const ayudas = {
    D: 'Se cobra todos los días, menos los domingos.',
    S: 'Se cobra cada 7 días, el mismo día de la semana.',
    Q: 'Se cobra dos veces al mes, en los mismos dos días (por ejemplo 1 y 16).',
    M: 'Se cobra una vez al mes, el mismo día.',
  };
  $('#ayuda-forma').textContent = ayudas[forma];

  const vc = leerPesos(f.valor_cuota.value);
  const resumen = $('#k-resumen');
  if (!prestamo || !n || !vc || !f.fecha_primera_cuota.value) {
    resumen.innerHTML = '<p class="sub">Escribe el valor prestado y el número de cuotas para ver el resumen.</p>';
    return;
  }
  const credito = vc * n;
  const interesReal = ((credito / prestamo) - 1) * 100;
  const fechas = cronograma(f.fecha_primera_cuota.value, forma, n);
  const dias = forma === 'Q'
    ? [...new Set(fechas.slice(0, 2).map((x) => Number(x.slice(8))))].sort((a, b) => a - b).join(' y ')
    : null;
  resumen.innerHTML = `
    <div class="resumen-total">
      <span class="sub">Total a pagar</span>
      <strong>${pesos(credito)}</strong>
    </div>
    <dl class="info">
      ${filaInfo('Cuotas', `${n} × ${pesos(vc)}`)}
      ${filaInfo('Ganancia', `${pesos(credito - prestamo)} (${interesReal.toLocaleString('es-CO', { maximumFractionDigits: 2 })}%)`, credito < prestamo ? 'peligro' : '')}
      ${filaInfo('1ra cuota', fechaCorta(fechas[0]))}
      ${filaInfo('Última cuota', fechaCorta(fechas[fechas.length - 1]))}
      ${dias ? filaInfo('Días de cobro', `${dias} de cada mes`) : ''}
    </dl>`;
}

campoDinero(formK.elements.prestamo, recalcularContrato);
campoDinero(formK.elements.adicional, recalcularContrato);
$('#k-incluir-mora').addEventListener('change', recalcularContrato);
campoDinero(formK.elements.valor_cuota, () => { cuotaManual = formK.elements.valor_cuota.value !== ''; recalcularContrato(); });
formK.elements.num_cuotas.addEventListener('input', recalcularContrato);
formK.elements.interes.addEventListener('input', () => { cuotaManual = false; recalcularContrato(); });
formK.elements.fecha_inicio.addEventListener('input', recalcularContrato);
formK.elements.fecha_primera_cuota.addEventListener('input', () => { primeraManual = true; recalcularContrato(); });
formK.querySelectorAll('[name="forma_pago"]').forEach((r) => r.addEventListener('change', () => { primeraManual = false; recalcularContrato(); }));
formK.addEventListener('input', (e) => {
  if (!e.target.name) return;
  e.target.classList.remove('invalido');
  const p = formK.querySelector(`[data-error="${e.target.name}"]`);
  if (p) p.textContent = '';
});

formK.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarErroresDe(formK);
  const f = formK.elements;
  const btn = $('#btn-guardar-contrato');
  btn.disabled = true;
  try {
    const datosContrato = {
      cliente_id: clienteContrato.id,
      forma_pago: f.forma_pago.value,
      prestamo: leerPesos(f.prestamo.value),
      num_cuotas: Number(f.num_cuotas.value) || 0,
      valor_cuota: leerPesos(f.valor_cuota.value),
      fecha_inicio: f.fecha_inicio.value,
      fecha_primera_cuota: f.fecha_primera_cuota.value,
      observaciones: f.observaciones.value,
    };
    const viejo = refinanciando;
    const k = viejo
      ? await api('POST', `/api/contratos/${viejo.id}/refinanciar`, {
        ...datosContrato,
        adicional: leerPesos(f.adicional.value),
        incluir_mora: $('#k-incluir-mora').checked,
      })
      : await api('POST', '/api/contratos', datosContrato);
    $('#dlg-contrato').close();
    await cargarClientes();
    if (pagina === 'planilla') cargarPlanilla();
    pintarContrato(k);
    if (!$('#dlg-detalle').open) $('#dlg-detalle').showModal();
    aviso(viejo ? `Contrato ${idCorto(viejo.id)} refinanciado en el ${idCorto(k.id)}` : `Contrato ${idCorto(k.id)} creado`);
  } catch (ex) {
    if (ex.campos) mostrarErroresCampos(formK, ex.campos);
    else aviso(ex.message);
  } finally {
    btn.disabled = false;
  }
});

// ================= registro de pago =================
const formP = $('#form-pago');

function tablaResumen(filas) {
  return `<dl>${filas.map(([a, b, cls = '']) => `<div class="${cls}"><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
}

function abrirPago(k) {
  formP.reset();
  limpiarErroresDe(formP);
  const e = k.estado;
  $('#pago-contrato').textContent = `Contrato ${idCorto(k.id)} · ${capital(k.cliente_nombre)}`;
  $('#pago-antes').innerHTML = tablaResumen([
    ['Atrasos', `C:${e.cuotasAtraso} D:${e.diasAtraso}`, e.cuotasAtraso ? 'peligro' : ''],
    ['Valor cuota', pesos(k.valor_cuota)],
    ['Cuotas pagas', `${e.cuotasPagas} de ${k.num_cuotas}`],
    ['Picos', pesos(e.picos)],
    ['Saldo crédito', pesos(e.saldo), 'fuerte'],
    ...(k.mora?.saldo ? [['Saldo int. mora', pesos(k.mora.saldo), 'peligro']] : []),
  ]);
  $('#p-mora-rapido').innerHTML = k.mora?.saldo
    ? `<button type="button" data-mora="${k.mora.saldo}">Abonar toda la mora · ${pesos(k.mora.saldo)}</button>`
    : '';
  $('#p-mora-ayuda').textContent = k.mora?.saldo
    ? 'Abona al saldo de interés de mora. No baja el saldo del crédito.'
    : 'No tiene mora aplicada; si cobras algo de mora, queda registrado aparte.';

  const rapidos = [];
  const faltaCuota = k.valor_cuota - e.picos;
  rapidos.push([e.picos ? `Completar cuota ${pesos(faltaCuota)}` : `1 cuota ${pesos(k.valor_cuota)}`, Math.min(faltaCuota, e.saldo)]);
  if (e.valorAtrasos > 0 && e.valorAtrasos !== faltaCuota) rapidos.push([`Atrasos ${pesos(e.valorAtrasos)}`, e.valorAtrasos]);
  const deHoy = (e.plan ?? []).filter((c) => c.estado === 'hoy').reduce((s, c) => s + c.valor - c.pagado, 0);
  const conHoy = Math.min(e.saldo, e.valorAtrasos + deHoy);
  if (e.valorAtrasos > 0 && deHoy > 0) rapidos.push([`Atrasos + hoy ${pesos(conHoy)}`, conHoy]);
  if (!rapidos.some(([, v]) => v === e.saldo)) rapidos.push([`Todo el saldo ${pesos(e.saldo)}`, e.saldo]);
  $('#p-rapidos').innerHTML = rapidos.filter(([, v]) => v > 0).map(([t, v]) => `<button type="button" data-valor="${v}">${t}</button>`).join('');

  formP.elements.fecha.value = hoyLocal();
  previsualizarPago();
  $('#dlg-pago').showModal();
  if (!matchMedia('(pointer: coarse)').matches) formP.elements.abono.focus();
}

function previsualizarPago() {
  const k = contratoAbierto;
  const abono = leerPesos(formP.elements.abono.value);
  const mora = leerPesos(formP.elements.int_mora.value);
  const despues = $('#pago-despues');
  if (!abono && !mora) {
    despues.hidden = true;
    return;
  }
  const simulado = estadoContrato(k, [...k.pagos, { id: 1e9, fecha: formP.elements.fecha.value || hoyLocal(), abono, int_mora: mora }]);
  const pasa = abono > k.estado.saldo;
  despues.hidden = false;
  despues.innerHTML = `<p class="tabla-titulo">Después de este pago</p>` + tablaResumen([
    ['Cuotas pagas', `${simulado.cuotasPagas} de ${k.num_cuotas}`],
    ['Picos', pesos(simulado.picos)],
    ['Atrasos', `C:${simulado.cuotasAtraso} D:${simulado.diasAtraso}`, simulado.cuotasAtraso ? 'peligro' : ''],
    ['Total recibido', pesos(abono + mora)],
    ['Saldo crédito', pasa ? 'El abono supera el saldo' : pesos(simulado.saldo), pasa ? 'peligro fuerte' : 'fuerte'],
    ...(k.mora?.saldo ? [['Saldo int. mora', pesos(Math.max(0, k.mora.saldo - mora)), k.mora.saldo - mora > 0 ? 'peligro' : '']] : []),
  ]);
}

$('#p-mora-rapido').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mora]');
  if (!b) return;
  formP.elements.int_mora.value = formatoPesos(b.dataset.mora);
  previsualizarPago();
});

campoDinero(formP.elements.abono, previsualizarPago);
campoDinero(formP.elements.int_mora, previsualizarPago);
formP.elements.fecha.addEventListener('input', previsualizarPago);
formP.addEventListener('input', (e) => {
  if (!e.target.name) return;
  e.target.classList.remove('invalido');
  const p = formP.querySelector(`[data-error="${e.target.name}"]`);
  if (p) p.textContent = '';
});

$('#p-rapidos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-valor]');
  if (!b) return;
  formP.elements.abono.value = formatoPesos(b.dataset.valor);
  formP.elements.abono.classList.remove('invalido');
  formP.querySelector('[data-error="abono"]').textContent = '';
  previsualizarPago();
});

formP.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarErroresDe(formP);
  const f = formP.elements;
  const btn = $('#btn-guardar-pago');
  btn.disabled = true;
  try {
    const abono = leerPesos(f.abono.value);
    const mora = leerPesos(f.int_mora.value);
    const k = await api('POST', `/api/contratos/${contratoAbierto.id}/pagos`, {
      fecha: f.fecha.value, abono, int_mora: mora, observacion: f.observacion.value,
    });
    $('#dlg-pago').close();
    pintarContrato(k);
    cargarClientes();
    if (pagina === 'planilla') cargarPlanilla();
    const nuevo = k.pagos.filter((p) => !p.anulado).reduce((a, b) => (b.id > a.id ? b : a));
    abrirRecibo(k, nuevo.id, true);
  } catch (ex) {
    if (ex.campos) mostrarErroresCampos(formP, ex.campos);
    else aviso(ex.message);
  } finally {
    btn.disabled = false;
  }
});

// ================= mensaje de confirmación del pago =================
const dias = (n) => `${n} ${n === 1 ? 'día' : 'días'}`;
const orden = (a, b) => (a.fecha === b.fecha ? a.id - b.id : a.fecha < b.fecha ? -1 : 1);

/**
 * Texto para enviarle al cliente. Usa el estado del contrato justo antes y justo después
 * de ese pago (así sirve también para pagos viejos del historial).
 */
function mensajePago(k, pagoId) {
  const validos = k.pagos.filter((p) => !p.anulado).sort(orden);
  const i = validos.findIndex((p) => p.id === pagoId);
  const pago = validos[i];
  const antes = validos.slice(0, i);
  const hasta = validos.slice(0, i + 1);
  const base = { ...k, refinanciado_por_id: null }; // el mensaje refleja el momento del pago
  const eAntes = estadoContrato(base, antes, pago.fecha);
  const eDespues = estadoContrato(base, hasta, pago.fecha);
  const morasHasta = (k.moras ?? []).filter((m) => m.fecha <= pago.fecha);
  const moraDespues = resumenMora(k, hasta, morasHasta).saldo;
  const nombre = String(k.cliente_nombre ?? '').toUpperCase();
  const total = pago.abono + (pago.int_mora || 0);

  return [
    `Hola ${nombre}.`,
    `[Antes del abono usted presentaba ${dias(eAntes.diasAtraso)} de atraso]`,
    `Confirmamos tu pago por ${pesos(total)}.`,
    `[Crédito: ${pesos(pago.abono)} Interes mora: ${pesos(pago.int_mora || 0)}].`,
    `Cuotas pagas: ${eDespues.cuotasPagas}.`,
    `Cuotas Pendientes: ${eDespues.cuotasPendientes}.`,
    `Saldo actual ${pesos(eDespues.saldo)}.`,
    moraDespues ? `Saldo int. mora ${pesos(moraDespues)}.` : '',
  ].filter(Boolean).join(' ');
}

function abrirRecibo(k, pagoId, recienRegistrado) {
  const pago = k.pagos.find((p) => p.id === pagoId);
  $('#recibo-titulo').textContent = recienRegistrado ? 'Pago registrado' : 'Mensaje del pago';
  $('#recibo-sub').textContent = `Contrato ${idCorto(k.id)} · ${capital(k.cliente_nombre)} · ${fechaCorta(pago.fecha)}`;
  $('#recibo-ok').hidden = !recienRegistrado;
  $('#recibo-valor').textContent = `${pesos(pago.abono + (pago.int_mora || 0))} recibidos${k.estado.estado === 'pagado' ? ' · ¡contrato pagado!' : ''}`;
  $('#recibo-texto').value = mensajePago(k, pagoId);
  $('#dlg-recibo').showModal();
}

$('#btn-copiar-recibo').addEventListener('click', async () => {
  await copiar($('#recibo-texto').value);
  aviso('Mensaje copiado');
});

// ================= interés de mora =================
const formM = $('#form-mora');

function abrirMora(k) {
  formM.reset();
  limpiarErroresDe(formM);
  const e = k.estado;
  $('#mora-contrato').textContent = `Contrato ${idCorto(k.id)} · ${capital(k.cliente_nombre)}`;
  $('#mora-resumen').innerHTML = tablaResumen([
    ['Atrasos', `C:${e.cuotasAtraso} D:${e.diasAtraso}`, e.cuotasAtraso ? 'peligro' : ''],
    ['Valor atrasos', pesos(e.valorAtrasos)],
    ['Saldo int. mora actual', pesos(k.mora.saldo), 'fuerte'],
  ]);
  // sugerencias: un porcentaje de lo atrasado o de la cuota, redondeado al mil
  const base = e.valorAtrasos || k.valor_cuota;
  const redondeo = (v) => Math.max(1000, Math.round(v / 1000) * 1000);
  const sugerencias = [
    [`5% ${e.valorAtrasos ? 'de los atrasos' : 'de la cuota'}`, redondeo(base * 0.05)],
    [`10% ${e.valorAtrasos ? 'de los atrasos' : 'de la cuota'}`, redondeo(base * 0.1)],
    ...(e.diasAtraso ? [[`${pesos(1000)} por día (${e.diasAtraso} días)`, 1000 * e.diasAtraso]] : []),
  ];
  $('#m-rapidos').innerHTML = sugerencias.map(([t, v]) => `<button type="button" data-valor="${v}">${t} · ${pesos(v)}</button>`).join('');
  formM.elements.fecha.value = hoyLocal();
  $('#dlg-mora').showModal();
}

campoDinero(formM.elements.valor);
$('#m-rapidos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-valor]');
  if (!b) return;
  formM.elements.valor.value = formatoPesos(b.dataset.valor);
  limpiarErroresDe(formM);
});
formM.addEventListener('input', () => limpiarErroresDe(formM));

formM.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarErroresDe(formM);
  const f = formM.elements;
  const btn = $('#btn-guardar-mora');
  btn.disabled = true;
  try {
    const valor = leerPesos(f.valor.value);
    const k = await api('POST', `/api/contratos/${contratoAbierto.id}/moras`, {
      fecha: f.fecha.value, valor, observacion: f.observacion.value,
    });
    $('#dlg-mora').close();
    pintarContrato(k);
    aviso(`Interés de mora de ${pesos(valor)} aplicado`);
  } catch (ex) {
    if (ex.campos) mostrarErroresCampos(formM, ex.campos);
    else aviso(ex.message);
  } finally {
    btn.disabled = false;
  }
});

// ================= formulario =================
const form = $('#form-cliente');
const chkWa = $('#f-mismo-wa');

function pintarSugerencias() {
  const usadas = clientes.map((c) => c.ocupacion);
  const todas = [...new Set([...OCUPACIONES_BASE, ...usadas])].slice(0, 10);
  const actual = form.elements.ocupacion.value.trim().toUpperCase();
  $('#sug-ocupacion').innerHTML = todas.map((o) =>
    `<button type="button" data-ocupacion="${esc(o)}" aria-pressed="${o === actual}">${esc(bonito(o))}</button>`).join('');
}

$('#sug-ocupacion').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ocupacion]');
  if (!b) return;
  form.elements.ocupacion.value = b.dataset.ocupacion;
  limpiarError('ocupacion');
  pintarSugerencias();
});
form.elements.ocupacion.addEventListener('input', pintarSugerencias);

function sincronizarWhatsapp() {
  $('#campo-whatsapp').hidden = chkWa.checked;
  if (chkWa.checked) {
    form.elements.whatsapp.value = form.elements.telefono.value;
    limpiarError('whatsapp');
  }
}
chkWa.addEventListener('change', () => {
  sincronizarWhatsapp();
  if (!chkWa.checked) form.elements.whatsapp.focus();
});

for (const nombre of ['telefono', 'telefono2', 'whatsapp']) {
  form.elements[nombre].addEventListener('input', (e) => {
    e.target.value = formatoTel(e.target.value);
    if (nombre === 'telefono' && chkWa.checked) form.elements.whatsapp.value = e.target.value;
  });
}

function limpiarError(campo) {
  form.elements[campo]?.classList.remove('invalido');
  const p = form.querySelector(`[data-error="${campo}"]`);
  if (p) p.textContent = '';
}

function limpiarErrores() {
  form.querySelectorAll('.invalido').forEach((el) => el.classList.remove('invalido'));
  form.querySelectorAll('[data-error]').forEach((p) => (p.textContent = ''));
}

form.addEventListener('input', (e) => { if (e.target.name) limpiarError(e.target.name); });

function abrirFormulario(c) {
  form.reset();
  limpiarErrores();
  editandoId = c?.id ?? null;
  $('#form-titulo').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
  if (c) {
    for (const campo of ['nombre', 'direccion', 'direccion2', 'ocupacion', 'ruta', 'observaciones']) {
      form.elements[campo].value = c[campo] ?? '';
    }
    for (const campo of ['telefono', 'telefono2', 'whatsapp']) form.elements[campo].value = formatoTel(c[campo]);
    chkWa.checked = Boolean(c.whatsapp) && c.whatsapp === c.telefono;
  } else {
    chkWa.checked = true; // la mayoría de celulares tienen WhatsApp
  }
  sincronizarWhatsapp();
  pintarSugerencias();
  $('#dlg-form').showModal();
  $('#dlg-form .hoja-cuerpo').scrollTop = 0;
  if (!matchMedia('(pointer: coarse)').matches) form.elements.nombre.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  sincronizarWhatsapp();
  limpiarErrores();
  const datos = Object.fromEntries(new FormData(form));
  const btn = $('#btn-guardar');
  btn.disabled = true;
  try {
    const c = editandoId
      ? await api('PUT', `/api/clientes/${editandoId}`, datos)
      : await api('POST', '/api/clientes', datos);
    $('#dlg-form').close();
    await cargarClientes();
    aviso(editandoId ? 'Cambios guardados' : 'Cliente registrado');
    if (editandoId) abrirFicha(clientes.find((x) => x.id === c.id) ?? c);
  } catch (ex) {
    if (ex.campos) {
      let primero = null;
      for (const [campo, msg] of Object.entries(ex.campos)) {
        // si el error es del WhatsApp oculto, mostrarlo
        if (campo === 'whatsapp' && chkWa.checked) { chkWa.checked = false; sincronizarWhatsapp(); }
        form.elements[campo]?.classList.add('invalido');
        const p = form.querySelector(`[data-error="${campo}"]`);
        if (p) p.textContent = msg;
        primero ??= form.elements[campo];
      }
      primero?.focus();
      primero?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (ex.estado === 401) {
      $('#dlg-form').close();
      guardarSesion(null);
      mostrarIngreso();
    } else {
      aviso(ex.message);
    }
  } finally {
    btn.disabled = false;
  }
});

// ================= diálogos =================
for (const id of ['#btn-nuevo', '#fab-nuevo', '#vacio-accion']) {
  $(id).addEventListener('click', () => abrirFormulario(null));
}

document.addEventListener('click', (e) => {
  const cerrar = e.target.closest('[data-cerrar]');
  if (cerrar) cerrar.closest('dialog').close();
});

$('#det-contenido').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copiar]');
  if (!b) return;
  await copiar(b.dataset.copiar);
  aviso(`Número ${formatoTel(b.dataset.copiar)} copiado`);
});

// clic en el fondo oscuro cierra la ficha (el formulario no, para no perder lo escrito)
$('#dlg-detalle').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

// ================= páginas =================
let pagina = 'clientes';

function irA(nueva) {
  pagina = nueva;
  $('#pagina-clientes').hidden = nueva !== 'clientes';
  $('#pagina-planilla').hidden = nueva !== 'planilla';
  $('#pagina-totales').hidden = nueva !== 'totales';
  $('#fab-nuevo').hidden = nueva !== 'clientes';
  document.querySelectorAll('.pestanas [data-pagina]').forEach((b) => {
    if (b.dataset.pagina === nueva) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (nueva === 'totales') cargarTotales();
  if (nueva === 'planilla') cargarPlanilla();
}

// ================= planilla del día =================
let fechaPlanilla = hoyLocal();
let vistaPlanilla = 'pendientes';
let planilla = null;

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const diaSemana = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
function lunesDe(s) {
  const d = diaSemana(s);
  return sumarDias(s, d === 0 ? -6 : 1 - d);
}
function fechaLarga(s) {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function pintarDias() {
  const hoy = hoyLocal();
  const lunes = lunesDe(fechaPlanilla);
  $('#planilla-dias').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const f = sumarDias(lunes, i);
    return `<button type="button" role="tab" data-fecha="${f}" aria-selected="${f === fechaPlanilla}" class="${f === hoy ? 'es-hoy' : ''}">
      <span>${f === hoy ? 'Hoy' : DIAS[diaSemana(f)]}</span><strong>${Number(f.slice(8))}</strong>
    </button>`;
  }).join('');
}

$('#planilla-dias').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fecha]');
  if (!b) return;
  fechaPlanilla = b.dataset.fecha;
  cargarPlanilla();
});
$('#semana-anterior').addEventListener('click', () => { fechaPlanilla = sumarDias(fechaPlanilla, -7); cargarPlanilla(); });
$('#semana-siguiente').addEventListener('click', () => { fechaPlanilla = sumarDias(fechaPlanilla, 7); cargarPlanilla(); });

$('#planilla-ruta').addEventListener('change', (e) => {
  filtroRuta = e.target.value;
  guardarPreferencia('sf.ruta', filtroRuta);
  pintarLista();
  cargarPlanilla();
});

$('#planilla-filtros').addEventListener('click', (e) => {
  const b = e.target.closest('[data-vista]');
  if (!b) return;
  vistaPlanilla = b.dataset.vista;
  pintarPlanilla();
});

async function cargarPlanilla() {
  pintarDias();
  const sel = $('#planilla-ruta');
  sel.innerHTML = $('#filtro-ruta').innerHTML;
  sel.value = filtroRuta;
  sel.closest('.selector-ruta').classList.toggle('activo', Boolean(filtroRuta));
  const hoy = hoyLocal();
  const cuando = fechaPlanilla === hoy ? 'Hoy' : fechaPlanilla < hoy ? 'Pasado' : 'Próximo';
  $('#planilla-fecha').textContent = `${cuando}: ${fechaLarga(fechaPlanilla)} · ${filtroRuta ? (filtroRuta === 'sin' ? 'sin ruta' : `ruta ${filtroRuta}`) : 'todas las rutas'}`;
  try {
    const params = new URLSearchParams({ fecha: fechaPlanilla, ...(filtroRuta ? { ruta: filtroRuta } : {}) });
    planilla = await api('GET', `/api/planilla?${params}`);
    pintarPlanilla();
  } catch (ex) {
    $('#planilla-lista').innerHTML = `<li class="error-campo" style="padding:16px">${esc(ex.message)}</li>`;
  }
}

const textoAtraso = (dias) => `Lleva ${dias} ${dias === 1 ? 'día' : 'días'} de atraso`;

function filaPlanilla(f) {
  let etiqueta;
  let monto;
  if (f.situacion === 'atrasado') {
    etiqueta = `<span class="etiqueta etiqueta-peligro">${textoAtraso(f.dias_atraso)}</span>`;
    monto = `<span class="monto">${pesos(f.a_cobrar)}</span>`;
  } else if (f.situacion === 'pendiente') {
    etiqueta = `<span class="etiqueta etiqueta-aviso">${f.cuota?.pagado ? `Abonó ${pesos(f.cuota.pagado)}` : 'Cuota del día'}</span>`;
    monto = `<span class="monto">${pesos(f.a_cobrar)}</span>`;
  } else if (f.situacion === 'visitado') {
    etiqueta = `<span class="etiqueta etiqueta-peligro">${icono('x')} No pagó · ${esc(f.visita.motivo)}</span>`;
    monto = `<span class="monto tenue">${pesos(f.a_cobrar)}</span>`;
  } else if (f.situacion === 'no_pago') {
    const dias = diasEntre(f.cuota.fecha, hoyLocal());
    const motivo = f.visita ? ` · ${esc(f.visita.motivo)}` : '';
    etiqueta = `<span class="etiqueta etiqueta-peligro">${f.cuota.pagado ? `Abonó ${pesos(f.cuota.pagado)}` : 'No pagó'}${motivo}${f.dias_atraso ? ` · ${dias} ${dias === 1 ? 'día' : 'días'}` : ''}</span>`;
    monto = `<span class="monto tenue">${pesos(f.cuota.valor - f.cuota.pagado)}</span>`;
  } else {
    const adelantada = f.situacion === 'cubierto' && !f.pagado_dia;
    etiqueta = `<span class="etiqueta etiqueta-ok">${adelantada ? 'Ya está cubierta' : 'Pagó'}</span>`;
    monto = f.pagado_dia ? `<span class="monto ok">${pesos(f.pagado_dia)}</span>` : '';
  }
  const detalle = [
    `${idCorto(f.contrato_id)} ${FORMAS_PAGO[f.forma_pago]}`,
    f.cuota ? `cuota ${pesos(f.valor_cuota)}` : 'sin cuota hoy',
    f.ruta != null ? `Ruta ${f.ruta}` : null,
  ].filter(Boolean).join(' · ');
  const esHoy = planilla?.fecha === hoyLocal();
  const nota = f.visita?.observacion ? `<span class="cliente-sub nota-visita"><span>“${esc(f.visita.observacion)}”${f.visita.creado_por_nombre ? ` — ${esc(capital(f.visita.creado_por_nombre))}` : ''}</span></span>` : '';
  let segundo = '';
  if (esHoy && (f.situacion === 'atrasado' || f.situacion === 'pendiente')) {
    segundo = `<button class="btn-no-pago" type="button" data-no-pago="${f.contrato_id}">${icono('x')} No pagó</button>`;
  } else if (f.situacion === 'visitado') {
    segundo = `<button class="btn-no-pago" type="button" data-deshacer="${f.visita.id}">Deshacer</button>`;
  }
  // Cobrar y Refinanciar mientras el contrato tenga algo por cobrar (hoy o días futuros)
  const pendiente = ['atrasado', 'pendiente', 'visitado'].includes(f.situacion);
  const botones = [
    pendiente ? `<button class="btn-cobrar" type="button" data-cobrar="${f.contrato_id}">${icono('cash')} Cobrar</button>` : '',
    pendiente ? `<button class="btn-refi" type="button" data-refinanciar="${f.contrato_id}">${icono('refresh')} Refinanciar</button>` : '',
    segundo,
  ].filter(Boolean);
  const acciones = botones.length ? `<div class="acciones-fila acciones-${botones.length}">${botones.join('')}</div>` : '';

  return `
    <li class="fila-planilla ${esHoy && (f.situacion === 'atrasado' || f.situacion === 'pendiente') ? 'cobra-hoy' : ''}">
      <button class="cliente" type="button" data-contrato="${f.contrato_id}">
        ${avatar(f.cliente_nombre)}
        <span class="cliente-info">
          <span class="cliente-nombre" style="text-transform:capitalize">${esc(bonito(f.cliente_nombre))}</span>
          <span class="fila-etiqueta">${etiqueta}</span>
          <span class="cliente-sub"><span>${esc(detalle)}</span></span>
          <span class="cliente-sub"><span style="text-transform:capitalize">${esc(bonito(f.direccion ?? ''))}</span></span>
          ${nota}
        </span>
        <span class="cliente-der">${monto}</span>
      </button>
      ${acciones}
    </li>`;
}

function pintarPlanilla() {
  if (!planilla) return;
  const { filas, resumen, fecha, hoy } = planilla;
  const grupos = {
    pendientes: filas.filter((f) => ['atrasado', 'pendiente'].includes(f.situacion)),
    no_pagaron: filas.filter((f) => ['visitado', 'no_pago'].includes(f.situacion)),
    cubiertos: filas.filter((f) => ['cubierto', 'pago'].includes(f.situacion)),
    todos: filas,
  };
  document.querySelectorAll('#planilla-filtros [data-vista]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.vista === vistaPlanilla));
    b.querySelector('span').textContent = grupos[b.dataset.vista].length;
  });

  const esPasado = fecha < hoy;
  $('#planilla-resumen').innerHTML = filas.length ? `
    <div class="kpis kpis-planilla">
      <div class="kpi ${esPasado ? '' : 'tono-aviso'}">
        <span class="kpi-titulo">${esPasado ? 'Cuotas del día' : 'Por cobrar'}</span>
        <strong>${pesos(esPasado ? resumen.cuotas_dia : resumen.a_cobrar)}</strong>
        <span class="kpi-nota">${resumen.clientes} ${resumen.clientes === 1 ? 'cliente' : 'clientes'}</span>
      </div>
      <div class="kpi">
        <span class="kpi-titulo">Recaudado ese día</span>
        <strong class="ok">${pesos(resumen.recaudado)}</strong>
        <span class="kpi-nota">${resumen.cubiertos} de ${resumen.contratos} al día</span>
      </div>
    </div>` : '';

  const visibles = grupos[vistaPlanilla];
  $('#planilla-lista').innerHTML = visibles.map(filaPlanilla).join('');
  const vacio = $('#planilla-vacio');
  vacio.hidden = visibles.length > 0;
  if (!visibles.length) {
    $('#planilla-vacio-titulo').textContent = filas.length ? 'Nada en esta lista' : 'Sin cobros este día';
    $('#planilla-vacio-texto').textContent = filas.length
      ? ({
        pendientes: 'No queda nadie por visitar este día.',
        no_pagaron: 'Nadie ha quedado sin pagar este día.',
        cubiertos: 'Todavía nadie ha pagado este día.',
      }[vistaPlanilla])
      : `No hay cuotas para el ${fechaLarga(fecha)}${filtroRuta ? ' en esta ruta' : ''}.`;
  }
}

$('#planilla-lista').addEventListener('click', async (e) => {
  const cobrar = e.target.closest('[data-cobrar]');
  const refinanciar = e.target.closest('[data-refinanciar]');
  const noPago = e.target.closest('[data-no-pago]');
  const deshacer = e.target.closest('[data-deshacer]');
  const abrir = e.target.closest('[data-contrato]');
  try {
    if (noPago) {
      const fila = planilla.filas.find((f) => f.contrato_id === Number(noPago.dataset.noPago));
      abrirNoPago(fila);
    } else if (deshacer) {
      await api('POST', `/api/visitas/${deshacer.dataset.deshacer}/anular`);
      await cargarPlanilla();
      aviso('Se quitó el "no pagó"');
    } else if (cobrar) {
      const k = await api('GET', `/api/contratos/${cobrar.dataset.cobrar}`);
      contratoAbierto = k;
      pintarContrato(k); // deja lista la ficha del contrato para cuando se guarde el pago
      abrirPago(k);
    } else if (refinanciar) {
      const k = await api('GET', `/api/contratos/${refinanciar.dataset.refinanciar}`);
      contratoAbierto = k;
      pintarContrato(k);
      abrirRefinanciar(k);
    } else if (abrir) {
      await abrirContrato(Number(abrir.dataset.contrato));
    }
  } catch (ex) {
    aviso(ex.message);
  }
});

$('.pestanas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pagina]');
  if (b) irA(b.dataset.pagina);
});

// ---------- "No pagó" ----------
const MOTIVOS = ['No estaba', 'No tenía plata', 'Pidió volver otro día', 'No quiso pagar', 'Otro'];
const formV = $('#form-visita');
let filaNoPago = null;

function abrirNoPago(f) {
  filaNoPago = f;
  formV.reset();
  limpiarErroresDe(formV);
  formV.elements.fecha.value = planilla.fecha;
  $('#visita-contrato').textContent = `Contrato ${idCorto(f.contrato_id)} · ${capital(f.cliente_nombre)}`;
  $('#visita-resumen').innerHTML = tablaResumen([
    ['Debía cobrar', pesos(f.a_cobrar), 'fuerte'],
    ['Atraso actual', f.dias_atraso ? textoAtraso(f.dias_atraso) : 'Al día', f.dias_atraso ? 'peligro' : ''],
  ]);
  $('#visita-motivos').innerHTML = MOTIVOS.map((m) => `
    <label><input type="radio" name="motivo" value="${esc(m)}"><span>${esc(m)}</span></label>`).join('');
  $('#dlg-visita').showModal();
}

formV.addEventListener('change', () => limpiarErroresDe(formV));

formV.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarErroresDe(formV);
  const f = formV.elements;
  const motivo = f.motivo.value;
  if (motivo === 'Otro' && !f.observacion.value.trim()) {
    mostrarErroresCampos(formV, { motivo: 'Escribe en la observación qué pasó.' });
    f.observacion.focus();
    return;
  }
  const btn = $('#btn-guardar-visita');
  btn.disabled = true;
  try {
    await api('POST', `/api/contratos/${filaNoPago.contrato_id}/visitas`, {
      fecha: f.fecha.value, motivo, observacion: f.observacion.value,
    });
    $('#dlg-visita').close();
    await cargarPlanilla();
    aviso(`${capital(filaNoPago.cliente_nombre)}: no pagó`);
  } catch (ex) {
    if (ex.campos) mostrarErroresCampos(formV, ex.campos);
    else aviso(ex.message);
  } finally {
    btn.disabled = false;
  }
});

// ================= totales =================
const CONCEPTOS = [
  ['registros', 'Contratos', (n) => n.toLocaleString('es-CO')],
  ['prestamos', 'Préstamos', pesos],
  ['creditos', 'Créditos', pesos],
  ['cuotas_dia', 'Cuotas día', pesos],
  ['cuotas', 'Cuotas', pesos],
  ['atrasos_dia', 'Atrasos día', pesos],
  ['atrasos', 'Atrasos', pesos],
  ['saldo_creditos', 'Saldo créditos', pesos],
  ['saldo_mora', 'Saldo int. mora', pesos],
  ['total_saldos', 'Total saldos', pesos],
];

async function cargarTotales() {
  const sel = $('#totales-ruta');
  sel.innerHTML = $('#filtro-ruta').innerHTML;
  sel.value = filtroRuta;
  sel.closest('.selector-ruta').classList.toggle('activo', Boolean(filtroRuta));
  $('#totales-fecha').textContent = `Hoy, ${fechaCorta(hoyLocal())} · ${filtroRuta ? (filtroRuta === 'sin' ? 'sin ruta' : `ruta ${filtroRuta}`) : 'todas las rutas'}`;
  try {
    const t = await api('GET', `/api/totales${filtroRuta ? `?ruta=${encodeURIComponent(filtroRuta)}` : ''}`);
    pintarTotales(t);
  } catch (ex) {
    $('#totales-contenido').innerHTML = `<p class="error-campo">${esc(ex.message)}</p>`;
  }
}

$('#totales-ruta').addEventListener('change', (e) => {
  filtroRuta = e.target.value;
  guardarPreferencia('sf.ruta', filtroRuta);
  pintarLista();
  cargarTotales();
});

function pintarTotales({ nuevos, total, porRuta }) {
  const kpi = (titulo, valor, nota, clase = '') => `
    <div class="kpi ${clase}">
      <span class="kpi-titulo">${titulo}</span>
      <strong>${valor}</strong>
      ${nota ? `<span class="kpi-nota">${nota}</span>` : ''}
    </div>`;

  const pendienteHoy = total.atrasos - total.atrasos_dia;

  $('#totales-contenido').innerHTML = `
    <div class="kpi-principal">
      <span class="sub">Total saldos</span>
      <strong>${pesos(total.total_saldos)}</strong>
      <span class="sub">${total.registros} contratos activos · prestado ${pesos(total.prestamos)}</span>
    </div>

    <div class="kpis">
      ${kpi('Cuotas día', pesos(total.cuotas_dia), 'Lo que vence hoy', 'tono-aviso')}
      ${kpi('Atrasos', pesos(total.atrasos), pendienteHoy ? `Incluye ${pesos(pendienteHoy)} de hoy sin pagar` : 'Todo lo que se debe a hoy', 'tono-peligro')}
      ${kpi('Atrasos día', pesos(total.atrasos_dia), 'Vencido hasta ayer')}
      ${kpi('Cuotas', pesos(total.cuotas), 'Suma de una cuota por contrato')}
    </div>

    <section class="tarjeta-tabla">
      <h3>Como en el listado</h3>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th></th><th>Hoy</th><th>Total</th></tr></thead>
          <tbody>
            ${CONCEPTOS.map(([campo, nombre, fmt]) => `
              <tr class="${campo === 'total_saldos' ? 'fila-total' : ''}">
                <th>${nombre}</th><td>${fmt(nuevos[campo])}</td><td>${fmt(total[campo])}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="sub nota-tabla">Hoy: préstamos que empiezan hoy (aún sin pagos ni cuotas). Total: todos los contratos activos. Saldo int. mora queda en $0 porque la mora se cobra a mano en cada pago.</p>
    </section>

    ${!filtroRuta && porRuta.length > 1 ? `
      <section class="tarjeta-tabla">
        <h3>Por ruta</h3>
        <div class="tabla-scroll">
          <table class="tabla tabla-rutas">
            <thead><tr><th>Ruta</th><th>#</th><th>Cuotas día</th><th>Atrasos</th><th>Saldo</th></tr></thead>
            <tbody>
              ${porRuta.map((r) => `
                <tr data-ruta="${r.ruta ?? 'sin'}" tabindex="0">
                  <th>${r.ruta ?? 'Sin ruta'}</th>
                  <td>${r.registros}</td>
                  <td>${pesos(r.cuotas_dia)}</td>
                  <td class="${r.atrasos ? 'rojo' : ''}">${pesos(r.atrasos)}</td>
                  <td>${pesos(r.total_saldos)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="sub nota-tabla">Toca una ruta para ver solo sus totales.</p>
      </section>` : ''}`;
}

$('#totales-contenido').addEventListener('click', (e) => {
  const fila = e.target.closest('[data-ruta]');
  if (!fila) return;
  filtroRuta = fila.dataset.ruta;
  guardarPreferencia('sf.ruta', filtroRuta);
  pintarLista();
  cargarTotales();
});

// ================= modo demo =================
if (MODO_DEMO) {
  $('#banda-demo').hidden = false;
  $('#btn-reiniciar-demo').addEventListener('click', async () => {
    if (!confirm('¿Borrar los cambios que hiciste y volver a los datos de prueba originales?')) return;
    moduloLocal ??= await import('./api-local.js');
    moduloLocal.reiniciarDemo();
    location.reload();
  });
}

// ================= cambio de día =================
// Si la app queda abierta y cambia la fecha (medianoche), se recalcula quién cobra hoy:
// el azul pasa a los clientes del nuevo día y la planilla salta al día nuevo.
let diaActual = hoyLocal();
function revisarCambioDeDia() {
  const hoy = hoyLocal();
  if (hoy === diaActual || !usuario) return;
  const planillaEnHoy = fechaPlanilla === diaActual;
  diaActual = hoy;
  cargarClientes();
  if (planillaEnHoy) fechaPlanilla = hoy;
  if (pagina === 'planilla') cargarPlanilla();
  if (pagina === 'totales') cargarTotales();
}
setInterval(revisarCambioDeDia, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarCambioDeDia(); });

// ================= filtros detrás del botón ☰ =================
function prepararMenu(botonId, panelId, esFiltroPorDefecto) {
  const boton = $(`#${botonId}`);
  const panel = $(`#${panelId}`);
  boton.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    boton.setAttribute('aria-expanded', String(!panel.hidden));
    boton.setAttribute('aria-label', panel.hidden ? 'Mostrar filtros' : 'Ocultar filtros');
  });
  // punto en el botón cuando hay un filtro distinto al normal y el panel está cerrado
  const marcar = () => { boton.querySelector('.punto-filtro').hidden = esFiltroPorDefecto(); };
  panel.addEventListener('click', () => setTimeout(marcar));
  marcar();
  return marcar;
}
prepararMenu('btn-filtros', 'filtros', () => filtro === 'todos');
prepararMenu('btn-filtros-planilla', 'planilla-filtros', () => vistaPlanilla === 'pendientes');

// ================= inicio =================
(async function iniciar() {
  try {
    const guardado = leerSesion();
    if (guardado) {
      const lista = await api('GET', '/api/usuarios');
      const u = lista.find((x) => x.id === guardado.id);
      if (u) return await entrar(u);
      guardarSesion(null);
    }
    await mostrarIngreso();
  } catch (ex) {
    console.error('No se pudo iniciar la app', ex);
    window.mostrarFalloCarga?.(ex.message);
  }
})();
