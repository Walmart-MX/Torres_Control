# Análisis: integrar MONTO de factura al Excel unificado (RUTEO UNIFICADO)

## Qué había en la carpeta `docs/01 FACTURA 01-10/`
| Archivo | Qué es |
|---|---|
| `01 FACTURA 01-10.TXT` | Reporte de mainframe "INVOICE DETAIL" (DC# 4659/6151), texto plano de ancho fijo. |
| `01 FACTURA 01-10.xlsx` | **El mismo reporte**, ya volcado a columnas reales en Excel (`INVOICE, STORE, LOAD, ITEM, ITEM DESC, QUANTITY, UNIT COST, UNIT WEIGHT, TOTAL COST, TOTAL WEIGHT`). 294 facturas únicas (67434–67727), 16,493 renglones de detalle. |
| `ruteo_base_2026-10-01.xlsx` | Muestra de la hoja `RUTEO UNIFICADO` — el Excel final que ya produce la app (resultado de `merge.js`). 180 rutas, 52 columnas. |

## El monto SÍ se puede calcular
`MONTO_FACTURA = SUM(TOTAL COST)` agrupado por `INVOICE` (confirmado: cada invoice pertenece a una sola tienda). Ejemplo:

| INVOICE | MONTO |
|---|---|
| 67434 | $143,581.08 |
| 67435 | $1,020,247.47 |
| 67436 | $461,772.08 |

## La pieza clave: la columna `FAC.` del Excel unificado
`RUTEO UNIFICADO.FAC.` viene en formato `4659067069` → **DC (4659) + folio de 6 dígitos (067069 = invoice 67069)**. Se confirmó revisando el rango completo de `FAC.` en la muestra (067068–067433, consecutivo, sin huecos, mismo prefijo 4659) — coincide exactamente con el esquema de numeración de `INVOICE` del reporte de facturas (el archivo de prueba trae el *lote siguiente*, 67434–67727, por eso no cruzan entre sí en esta muestra puntual, pero el formato de la llave es inequívoco).

 **Llave de cruce: `INVOICE` (factura) ↔ últimos 6 dígitos de `FAC.` (ruteo unificado)**, no la tienda (`STORE`/`DET`, que da solo ~45% de match porque el ruteo solo cubre las rutas que da seguimiento esta app, no todo lo que factura el CEDIS ese día).

## Cómo encaja en la app (buena noticia: YA existe el mecanismo)
La app ya hace exactamente este tipo de cruce para otros dos campos de factura:

```
src/processors/excel.js   → lee hoja "CONCENTRADO FACTURAS", arma
                             factData: Map<invoice, {gls, horaFact}>
src/processors/merge.js   → runMerge() busca factData.get(factKey)
                             y escribe nr['_GLS'], nr['_HORA_FACT']
src/core/constants.js     → COL_MAP['GLS DE EMB.'] / ['HORA DE FACTURACION']
                             exponen esos campos en el Excel final
src/features/fact-cache.js→ cachea factData en Supabase (tabla fact_cache)
                             como respaldo multi-día
src/editing/edit-system.js→ los expone como campos editables/correcciones
```

**No existe hoy una columna de MONTO en `CONCENTRADO FACTURAS`** — solo GLS y hora. Para integrar el monto hay que:

1. **Agregar una columna MONTO a la hoja `CONCENTRADO FACTURAS`** del Excel macro que se sube cada día (se calcula igual que arriba: `SUM(TOTAL COST)` por invoice, desde el reporte de mainframe).
2. **`excel.js`**: agregar `colMonto = keys.find(k => /MONTO|TOTAL|IMPORTE/i.test(k))` y guardarlo en `factData` → `{ gls, horaFact, monto }`.
3. **`merge.js`**: en el bloque `if (factRow) {...}` agregar `nr['_MONTO_FACTURA'] = factRow.monto;` (mismo patrón que `_GLS`/`_HORA_FACT`).
4. **`constants.js`**: agregar entrada a `COL_MAP['MONTO FACTURA'] = r => r['_MONTO_FACTURA'] ?? ''` para que salga en el Excel exportado.
5. **`edit-system.js`**: agregar `{ key:'_MONTO_FACTURA', label:'Monto Factura', crit:false }` si se quiere editable/corregible.
6. **`fact-cache.js` + Supabase**: agregar columna `monto` a la tabla `fact_cache` (migración simple) y persistirla/leerla igual que `gls`/`hora_fact`.

## Veredicto
 **Sí se puede integrar**, con cambios chicos y de bajo riesgo porque sigue un patrón que YA existe en el código (GLS/Hora Facturación). El único requisito operativo es que la hoja `CONCENTRADO FACTURAS` que se sube diario incluya la columna de monto (se puede generar automáticamente a partir del reporte de mainframe, tal como se demostró arriba).

Esfuerzo estimado: ~1 punto de historia (5 archivos tocados, 1 migración de Supabase, sin cambios de arquitectura).
