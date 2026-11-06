// Modo demo sin servidor (GitHub Pages): responde las mismas rutas /api que server.js,
// con los datos guardados solo en este navegador (localStorage).
import { generarDemo } from './demo-datos.js';
import {
  leerUsuario, leerCliente, leerContrato, leerPago, resumenPorCliente, calcularTotales,
  armarContrato, ahoraLocal, RESUMEN_VACIO, ERROR_CAMPOS,
} from './logica.js';

const CLAVE = 'sf.demo.datos.v1';
let datos = cargar();

function cargar() {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado) return JSON.parse(guardado);
  } catch { /* sin almacenamiento o datos dañados: se generan de nuevo */ }
  const nuevos = generarDemo();
  guardar(nuevos);
  return nuevos;
}

function guardar(d = datos) {
  try { localStorage.setItem(CLAVE, JSON.stringify(d)); } catch { /* sin almacenamiento: los cambios duran lo que la pestaña */ }
}

export function reiniciarDemo() {
  datos = generarDemo();
  guardar();
}

// ---------- utilidades ----------
const falla = (status, error, campos) => Object.assign(new Error(error), { estado: status, campos });
const errorCampos = (campos) => falla(400, ERROR_CAMPOS, campos);
const hayErrores = (e) => Object.keys(e).length > 0;
const siguienteId = (lista) => lista.reduce((m, x) => Math.max(m, x.id), 0) + 1;
const nombreDe = (id) => datos.usuarios.find((u) => u.id === id)?.nombre ?? null;
const copia = (x) => JSON.parse(JSON.stringify(x));

function exigirUsuario(usuarioId) {
  const u = datos.usuarios.find((x) => x.id === usuarioId);
  if (!u) throw falla(401, 'Ingrese con un usuario.');
  return u;
}

const conCreador = (c) => ({ ...c, creado_por_nombre: nombreDe(c.creado_por) });
const pagosValidos = () => datos.pagos.filter((p) => !p.anulado);

function contratoCompleto(id) {
  const k = datos.contratos.find((x) => x.id === id);
  if (!k) return null;
  const cliente = datos.clientes.find((c) => c.id === k.cliente_id);
  const pagos = datos.pagos.filter((p) => p.contrato_id === id).map((p) => ({
    ...p, creado_por_nombre: nombreDe(p.creado_por), anulado_por_nombre: nombreDe(p.anulado_por),
  }));
  return armarContrato({ ...k, cliente_nombre: cliente?.nombre, creado_por_nombre: nombreDe(k.creado_por) }, pagos);
}

// ---------- rutas ----------
export async function apiLocal(metodo, ruta, cuerpo, usuarioId) {
  const url = new URL(ruta, 'http://local');
  const partes = url.pathname.replace(/^\/api\//, '').split('/');
  const [recurso, idTexto, sub] = partes;
  const id = Number(idTexto);
  const b = cuerpo ?? {};
  const r = enrutar(metodo, recurso, id, sub, b, url.searchParams, usuarioId);
  return copia(r);
}

function enrutar(metodo, recurso, id, sub, b, query, usuarioId) {
  // usuarios
  if (recurso === 'usuarios' && metodo === 'GET') {
    return [...datos.usuarios].sort((a, z) => a.nombre.localeCompare(z.nombre));
  }
  if (recurso === 'usuarios' && metodo === 'POST') {
    const { nombre, error } = leerUsuario(b);
    if (error) throw falla(400, error);
    if (datos.usuarios.some((u) => u.nombre === nombre)) throw falla(409, `El usuario ${nombre} ya existe.`);
    const u = { id: siguienteId(datos.usuarios), nombre, creado: ahoraLocal() };
    datos.usuarios.push(u);
    guardar();
    return u;
  }

  // clientes
  if (recurso === 'clientes' && !id && metodo === 'GET') {
    const resumen = resumenPorCliente(datos.contratos, pagosValidos());
    return datos.clientes
      .map((c) => ({ ...conCreador(c), ...(resumen.get(c.id) ?? RESUMEN_VACIO) }))
      .sort((a, z) => a.nombre.localeCompare(z.nombre));
  }
  if (recurso === 'clientes' && id && sub === 'contratos' && metodo === 'GET') {
    return datos.contratos.filter((k) => k.cliente_id === id).sort((a, z) => z.id - a.id).map((k) => {
      const { pagos, estado: { plan, ...estado }, ...resto } = contratoCompleto(k.id);
      return { ...resto, estado };
    });
  }
  if (recurso === 'clientes' && id && metodo === 'GET') {
    const c = datos.clientes.find((x) => x.id === id);
    if (!c) throw falla(404, 'Cliente no encontrado.');
    return conCreador(c);
  }
  if (recurso === 'clientes' && !id && metodo === 'POST') {
    const usuario = exigirUsuario(usuarioId);
    const { c, errores } = leerCliente(b);
    if (hayErrores(errores)) throw errorCampos(errores);
    const nuevo = { id: siguienteId(datos.clientes), ...c, creado_por: usuario.id, creado: ahoraLocal(), modificado: null };
    datos.clientes.push(nuevo);
    guardar();
    return conCreador(nuevo);
  }
  if (recurso === 'clientes' && id && metodo === 'PUT') {
    exigirUsuario(usuarioId);
    const existente = datos.clientes.find((x) => x.id === id);
    if (!existente) throw falla(404, 'Cliente no encontrado.');
    const { c, errores } = leerCliente(b);
    if (hayErrores(errores)) throw errorCampos(errores);
    Object.assign(existente, c, { modificado: ahoraLocal() });
    guardar();
    return conCreador(existente);
  }

  // totales
  if (recurso === 'totales' && metodo === 'GET') {
    const contratos = datos.contratos.map((k) => ({ ...k, ruta: datos.clientes.find((c) => c.id === k.cliente_id)?.ruta ?? null }));
    return calcularTotales(contratos, pagosValidos(), query.get('ruta') ?? '');
  }

  // contratos
  if (recurso === 'contratos' && id && sub === 'pagos' && metodo === 'POST') {
    const usuario = exigirUsuario(usuarioId);
    const k = contratoCompleto(id);
    if (!k) throw falla(404, 'Contrato no encontrado.');
    const { p, errores } = leerPago(b, k);
    if (hayErrores(errores)) throw errorCampos(errores);
    datos.pagos.push({
      id: siguienteId(datos.pagos), contrato_id: id, ...p, creado_por: usuario.id, creado: ahoraLocal(),
      anulado: 0, anulado_por: null, anulado_en: null,
    });
    guardar();
    return contratoCompleto(id);
  }
  if (recurso === 'contratos' && id && metodo === 'GET') {
    const k = contratoCompleto(id);
    if (!k) throw falla(404, 'Contrato no encontrado.');
    return k;
  }
  if (recurso === 'contratos' && !id && metodo === 'POST') {
    const usuario = exigirUsuario(usuarioId);
    const { k, errores } = leerContrato(b, (cid) => datos.clientes.some((c) => c.id === cid));
    if (hayErrores(errores)) throw errorCampos(errores);
    const nuevo = { id: siguienteId(datos.contratos), ...k, creado_por: usuario.id, creado: ahoraLocal() };
    datos.contratos.push(nuevo);
    guardar();
    return contratoCompleto(nuevo.id);
  }

  // pagos
  if (recurso === 'pagos' && id && sub === 'anular' && metodo === 'POST') {
    const usuario = exigirUsuario(usuarioId);
    const p = datos.pagos.find((x) => x.id === id);
    if (!p) throw falla(404, 'Pago no encontrado.');
    if (p.anulado) throw falla(409, 'Ese pago ya estaba anulado.');
    Object.assign(p, { anulado: 1, anulado_por: usuario.id, anulado_en: ahoraLocal() });
    guardar();
    return contratoCompleto(p.contrato_id);
  }

  throw falla(404, 'Ruta no encontrada.');
}
