// Arranca la app con datos simulados en data/demo.db (la base real no se toca).
// Uso: npm run demo   → http://localhost:3001
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const rutaDemo = join(raiz, 'data', 'demo.db');
for (const sufijo of ['', '-journal', '-wal', '-shm']) rmSync(rutaDemo + sufijo, { force: true });

process.env.SF_DB = rutaDemo;
process.env.PORT ||= '3001';

const { db } = await import('./db.js');
const { generarDemo } = await import('./public/demo-datos.js');

const datos = generarDemo();

function insertar(tabla, filas) {
  if (!filas.length) return;
  const columnas = Object.keys(filas[0]);
  const stmt = db.prepare(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`);
  for (const f of filas) stmt.run(...columnas.map((c) => f[c]));
}

db.exec('BEGIN');
insertar('usuarios', datos.usuarios);
insertar('clientes', datos.clientes);
insertar('contratos', datos.contratos);
insertar('pagos', datos.pagos);
insertar('visitas', datos.visitas);
insertar('moras', datos.moras);
db.exec('COMMIT');

console.log(`Demo: ${datos.usuarios.length} usuarios, ${datos.clientes.length} clientes, ${datos.contratos.length} contratos, ${datos.pagos.length} pagos, ${datos.visitas.length} visitas sin pago, ${datos.moras.length} cargos de mora.`);

await import('./server.js');
