/**
 * core/supabase-client.js
 * Cliente Supabase compartido — punto único de conexión a la base de datos.
 *
 * El SDK de Supabase se carga como global desde CDN en index.html
 * (mismo patrón que pdfjsLib y XLSX) — sin bundler, consistente con
 * el resto del proyecto. Este módulo solo llama a `supabase.createClient()`
 * y exporta la instancia resultante como `sb`, para no chocar con el
 * nombre del global `supabase` que expone el SDK.
 *
 * Credenciales: URL y anon key son públicas por diseño — la seguridad
 * de cada tabla depende de sus políticas RLS (Row Level Security),
 * no de ocultar estos valores. Se embeben aquí porque son configuración
 * de infraestructura, no de la UI del catálogo.
 *
 * Sin dependencias de otros módulos propios.
 */
const SUPABASE_URL      = 'https://rsnutqugrfcvmmishruv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbnV0cXVncmZjdm1taXNocnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMDc3NDEsImV4cCI6MjA5ODc4Mzc0MX0.0DCWJfM2XST0_5Z43j-Ar0Wcby1FXkV3UvdjAgTY50Q';

export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
