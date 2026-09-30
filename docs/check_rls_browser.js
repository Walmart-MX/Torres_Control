// Pegar en la consola del navegador (F12), en CUALQUIER pestaña
// (ni siquiera hace falta tener la app abierta - solo usa fetch
// nativo). Prueba de SOLO LECTURA - sd_admin_list_users no modifica
// nada, solo lista usuarios existentes.
//
// Si esto imprime datos (un array de usuarios) SIN haber iniciado
// sesion en ningun lado, confirma que cualquiera con la anon key
// (publica, esta en src/core/supabase-client.js) puede listar/crear/
// resetear usuarios sin pasar por el login de la app.

const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzbnV0cXVncmZjdm1taXNocnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMDc3NDEsImV4cCI6MjA5ODc4Mzc0MX0.0DCWJfM2XST0_5Z43j-Ar0Wcby1FXkV3UvdjAgTY50Q';
const BASE = 'https://rsnutqugrfcvmmishruv.supabase.co';

const res = await fetch(`${BASE}/rest/v1/rpc/sd_admin_list_users`, {
  method: 'POST',
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${ANON}`,
    'Content-Type': 'application/json'
  },
  body: '{}'
});
console.log('HTTP status:', res.status);
console.log('respuesta:', await res.json());
