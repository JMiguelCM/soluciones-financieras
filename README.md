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

## Versión demo en GitHub Pages

Cada push a `main` publica la carpeta `public/` en GitHub Pages (`.github/workflows/pages.yml`).
Pages no corre el servidor, así que en `*.github.io` la app usa `public/api-local.js`: una copia de la API
que funciona dentro del navegador con datos simulados guardados en `localStorage` (cada navegador tiene los suyos;
el botón "Reiniciar datos" los vuelve a generar). Localmente se puede probar igual abriendo la app con `?demo`.

Para activarlo la primera vez: en GitHub, **Settings → Pages → Source: GitHub Actions**.

## Estructura

- `server.js`: API (usuarios, clientes, contratos, pagos, totales).
- `db.js`: creación de tablas SQLite.
- `public/calculos.js`: cronograma de cuotas, saldos, atrasos, picos y adelantos (lo usan el servidor y el navegador).
- `public/logica.js`: validaciones, resumen por cliente y totales (compartido por el servidor y el modo demo).
- `public/demo-datos.js`: generador de datos simulados (lo usan `npm run demo` y el modo demo).
- `public/api-local.js`: API dentro del navegador para la demo sin servidor.
- `public/`: interfaz (HTML, CSS y JavaScript sin frameworks).
- `demo.js`: genera datos simulados y arranca la app.
