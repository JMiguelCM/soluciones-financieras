# Crea y crece DF

Aplicación web para el control de créditos y cobros: usuarios, clientes, contratos, registro de pagos,
planilla del día, refinanciación, intereses de mora, totales y copia de seguridad.

## En internet (Render + Turso, plan gratuito)

- **Servidor:** Render, a partir de `render.yaml` (New → Blueprint → este repositorio).
- **Base de datos:** Turso (SQLite en la nube).
- Variables que se escriben a mano en Render:
  - `TURSO_DATABASE_URL`: `libsql://…` de la base.
  - `TURSO_AUTH_TOKEN`: token de la base.
  - `CLAVE_ACCESO`: clave que la app pide una vez en cada celular.
- `TZ=America/Bogota` ya viene en `render.yaml`: así "hoy" es el día de Colombia.

## En el computador

```bash
npm install
npm start        # http://localhost:3000 · base local en data/creaycrece.db
```

Sin `TURSO_DATABASE_URL` la app usa el archivo local. Sin `CLAVE_ACCESO` no pide clave.

## Copia de seguridad

En **Totales → Copia de seguridad**:

- **Descargar en Excel:** todas las tablas, una hoja por tabla, para leerlas.
- **Copia para restaurar** (`.json`): con ella se cargan todos los datos en otra base **vacía**
  (por ejemplo, si la base de Turso se llena y se crea una nueva).

## Estructura

- `server.js`: API (usuarios, clientes, contratos, pagos, visitas, moras, totales, planilla, respaldo).
- `basedatos.js`: conexión a Turso o al SQLite local y creación de tablas.
- `public/calculos.js`: cronograma de cuotas, saldos, atrasos, picos y adelantos.
- `public/logica.js`: validaciones, resumen por cliente, totales, planilla, mora y refinanciación.
- `public/excel.js`: genera archivos `.xlsx` en el navegador (planilla y copia de seguridad).
- `public/`: interfaz (HTML, CSS y JavaScript sin frameworks).
- `pages/`: aviso que publica GitHub Pages (la versión de prueba se retiró).
