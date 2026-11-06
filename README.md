# Soluciones Financieras

Aplicación web para el control de créditos y cobros: usuarios, clientes, contratos, registro de pagos, filtros por ruta y totales.

## Requisitos

- Node.js 22.13 o superior (usa `node:sqlite`, sin instalar base de datos aparte).

## Uso

```bash
npm install
npm start        # app real en http://localhost:3000 (base en data/soluciones.db)
npm run demo     # app con datos simulados en http://localhost:3001 (base en data/demo.db)
```

La carpeta `data/` no se sube al repositorio: ahí quedan las bases de datos.

## Estructura

- `server.js`: API (usuarios, clientes, contratos, pagos, totales).
- `db.js`: creación de tablas SQLite.
- `public/calculos.js`: cronograma de cuotas, saldos, atrasos, picos y adelantos (lo usan el servidor y el navegador).
- `public/`: interfaz (HTML, CSS y JavaScript sin frameworks).
- `demo.js`: genera datos simulados y arranca la app.
