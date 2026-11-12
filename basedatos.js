// Acceso a la base de datos con la misma forma para:
//  - Turso (en la nube): si están TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.
//  - SQLite local (archivo data/creaycrece.db): para usar la app en el computador.
// Todo es asíncrono porque Turso responde por internet.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));

// ---------- esquema ----------
const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS usuarios (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    creado  TEXT
  );

  CREATE TABLE IF NOT EXISTS clientes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL,
    direccion     TEXT NOT NULL,
    direccion2    TEXT,
    ocupacion     TEXT NOT NULL,
    telefono      TEXT NOT NULL,
    telefono2     TEXT,
    whatsapp      TEXT,
    ruta          INTEGER,
    observaciones TEXT,
    creado_por    INTEGER REFERENCES usuarios(id),
    creado        TEXT,
    modificado    TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_clientes_nombre ON clientes(nombre);

  CREATE TABLE IF NOT EXISTS contratos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id          INTEGER NOT NULL REFERENCES clientes(id),
    fecha_inicio        TEXT NOT NULL,
    fecha_primera_cuota TEXT NOT NULL,
    forma_pago          TEXT NOT NULL CHECK (forma_pago IN ('D', 'S', 'Q', 'M')),
    prestamo            INTEGER NOT NULL,
    interes             REAL NOT NULL,
    num_cuotas          INTEGER NOT NULL,
    valor_cuota         INTEGER NOT NULL,
    credito             INTEGER NOT NULL,
    observaciones       TEXT,
    creado_por          INTEGER REFERENCES usuarios(id),
    creado              TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_contratos_cliente ON contratos(cliente_id);

  CREATE TABLE IF NOT EXISTS pagos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    contrato_id  INTEGER NOT NULL REFERENCES contratos(id),
    fecha        TEXT NOT NULL,
    abono        INTEGER NOT NULL DEFAULT 0,
    int_mora     INTEGER NOT NULL DEFAULT 0,
    observacion  TEXT,
    creado_por   INTEGER REFERENCES usuarios(id),
    creado       TEXT,
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_por  INTEGER REFERENCES usuarios(id),
    anulado_en   TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_pagos_contrato ON pagos(contrato_id);

  CREATE TABLE IF NOT EXISTS visitas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    contrato_id  INTEGER NOT NULL REFERENCES contratos(id),
    fecha        TEXT NOT NULL,
    motivo       TEXT NOT NULL,
    observacion  TEXT,
    creado_por   INTEGER REFERENCES usuarios(id),
    creado       TEXT,
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_por  INTEGER REFERENCES usuarios(id),
    anulado_en   TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_visitas_contrato ON visitas(contrato_id);

  CREATE TABLE IF NOT EXISTS moras (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    contrato_id  INTEGER NOT NULL REFERENCES contratos(id),
    fecha        TEXT NOT NULL,
    valor        INTEGER NOT NULL,
    observacion  TEXT,
    creado_por   INTEGER REFERENCES usuarios(id),
    creado       TEXT,
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_por  INTEGER REFERENCES usuarios(id),
    anulado_en   TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_moras_contrato ON moras(contrato_id);
`;

// Columnas agregadas después de la primera versión (bases ya creadas no las tienen)
const COLUMNAS_NUEVAS = {
  contratos: {
    refinancia_id: 'INTEGER REFERENCES contratos(id)',        // contrato nuevo → el que refinanció
    refinanciado_por_id: 'INTEGER REFERENCES contratos(id)',  // contrato viejo → el que lo reemplazó
    saldo_trasladado: 'INTEGER',                              // saldo del crédito que pasó al nuevo
    mora_trasladada: 'INTEGER',                               // mora pendiente que pasó al nuevo
    adicional: 'INTEGER',                                     // dinero nuevo entregado al refinanciar
    interes_mes: 'REAL',                                      // % de interés por cada mes del plazo
    meses: 'REAL',                                            // plazo en meses (da el interés total)
    editado: 'TEXT',                                          // última vez que se corrigió el contrato
    editado_por: 'INTEGER REFERENCES usuarios(id)',
  },
};

/** Tablas en el orden en que se pueden copiar/restaurar (respetando referencias). */
export const TABLAS = ['usuarios', 'clientes', 'contratos', 'pagos', 'visitas', 'moras'];

// ---------- Turso (libSQL) ----------
async function abrirTurso(url, authToken) {
  // Para Turso se usa el cliente "web" (solo fetch, sin módulos nativos); para file: el de Node.
  const { createClient } = url.startsWith('file:')
    ? await import('@libsql/client')
    : await import('@libsql/client/web');
  const cliente = createClient({ url, authToken });
  const aObjetos = (r) => r.rows.map((fila) => Object.fromEntries(r.columns.map((c, i) => [c, fila[i]])));
  const operaciones = (ejecutor) => ({
    todas: async (sql, args = []) => aObjetos(await ejecutor.execute({ sql, args })),
    una: async (sql, args = []) => aObjetos(await ejecutor.execute({ sql, args }))[0] ?? null,
    ejecutar: async (sql, args = []) => {
      const r = await ejecutor.execute({ sql, args });
      return { id: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid), cambios: r.rowsAffected };
    },
  });
  return {
    tipo: url.startsWith('file:') ? 'libsql-archivo' : 'turso',
    ...operaciones(cliente),
    script: (sql) => cliente.executeMultiple(sql),
    async transaccion(fn) {
      const tx = await cliente.transaction('write');
      try {
        const resultado = await fn(operaciones(tx));
        await tx.commit();
        return resultado;
      } catch (e) {
        await tx.rollback().catch(() => {});
        throw e;
      } finally {
        tx.close();
      }
    },
    cerrar: () => cliente.close(),
  };
}

// ---------- SQLite local (node:sqlite) ----------
async function abrirLocal(ruta) {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  const ops = {
    todas: async (sql, args = []) => db.prepare(sql).all(...args),
    una: async (sql, args = []) => db.prepare(sql).get(...args) ?? null,
    ejecutar: async (sql, args = []) => {
      const r = db.prepare(sql).run(...args);
      return { id: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid), cambios: Number(r.changes) };
    },
  };
  let enTransaccion = Promise.resolve();
  return {
    tipo: 'local',
    ...ops,
    script: async (sql) => db.exec(sql),
    // se encadenan para que dos transacciones no se mezclen
    transaccion(fn) {
      const corrida = enTransaccion.then(async () => {
        db.exec('BEGIN');
        try {
          const r = await fn(ops);
          db.exec('COMMIT');
          return r;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      });
      enTransaccion = corrida.catch(() => {});
      return corrida;
    },
    cerrar: async () => db.close(),
  };
}

/** Abre la base que corresponda y deja listas las tablas. */
export async function abrirBase() {
  const url = process.env.TURSO_DATABASE_URL;
  const base = url
    ? await abrirTurso(url.trim(), limpiarToken(process.env.TURSO_AUTH_TOKEN))
    : await abrirLocal(process.env.SF_DB || join(raiz, 'data', 'creaycrece.db'));

  await base.script(ESQUEMA);
  for (const [tabla, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
    const existentes = new Set((await base.todas(`PRAGMA table_info(${tabla})`)).map((c) => c.name));
    for (const [nombre, tipo] of Object.entries(columnas)) {
      if (!existentes.has(nombre)) await base.script(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${tipo}`);
    }
  }
  return base;
}

/** Quita lo que suele colarse al pegar el token: espacios, saltos de línea, comillas o "Bearer". */
function limpiarToken(token) {
  return token?.trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '').trim() || undefined;
}
