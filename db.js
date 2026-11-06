import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const rutaDb = process.env.SF_DB || join(raiz, 'data', 'soluciones.db');
mkdirSync(dirname(rutaDb), { recursive: true });

export const db = new DatabaseSync(rutaDb);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS usuarios (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    creado  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
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
    creado        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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
    creado              TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
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
    creado       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_por  INTEGER REFERENCES usuarios(id),
    anulado_en   TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_pagos_contrato ON pagos(contrato_id);

  -- Visitas de cobro en las que el cliente no pagó
  CREATE TABLE IF NOT EXISTS visitas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    contrato_id  INTEGER NOT NULL REFERENCES contratos(id),
    fecha        TEXT NOT NULL,
    motivo       TEXT NOT NULL,
    observacion  TEXT,
    creado_por   INTEGER REFERENCES usuarios(id),
    creado       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    anulado      INTEGER NOT NULL DEFAULT 0,
    anulado_por  INTEGER REFERENCES usuarios(id),
    anulado_en   TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_visitas_contrato ON visitas(contrato_id);
`);
