-- ════════════════════════════════════════════════════════════════
-- DIAGNOSTICO RLS + SEGURIDAD DE FUNCIONES - SmartDispatch
-- Solo LECTURA - no modifica nada. Pegar completo en el SQL Editor
-- de Supabase y ejecutar.
-- ════════════════════════════════════════════════════════════════

-- 1) RLS por tabla: relrowsecurity = true significa RLS ENCENDIDO.
--    Si sale 'false' en cualquiera de estas, esa tabla es de libre
--    acceso para quien tenga la anon key (publica, esta en el codigo).
select
  c.relname as tabla,
  c.relrowsecurity as rls_encendido,
  (select count(*) from pg_policies p where p.tablename = c.relname) as num_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'dispatch_sessions', 'dispatch_rows', 'operators',
    'catalog_ventana_recibo', 'catalog_pool_real', 'catalog_meta',
    'fact_cache', 'fact_cache_log', 'admin_incidents'
  )
order by c.relname;

-- 2) Politicas RLS existentes (si las hay) y a que rol aplican.
--    'anon' en la columna roles = cualquiera sin login puede usarla.
select tablename, policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3) Las funciones sd_* - lo mas importante para el tema de "roles":
--    security_type = 'DEFINER' significa que la funcion corre con
--    privilegios de su dueno (normalmente el owner del proyecto),
--    SIN IMPORTAR quien la llame - la unica proteccion real depende
--    de que el CODIGO de la funcion verifique el rol del que llama.
--    Si esto no lo hace, cualquiera con la anon key puede ejecutarla
--    igual que un admin, sin haber iniciado sesion nunca.
select
  p.proname as funcion,
  case when p.prosecdef then 'DEFINER (corre con privilegios del dueño)'
       else 'INVOKER (corre con privilegios de quien llama)' end as security_type,
  pg_get_function_identity_arguments(p.oid) as argumentos
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'sd\_%'
order by p.proname;

-- 4) A quien se le dio permiso de EJECUTAR cada funcion sd_* -
--    si 'anon' aparece aqui, la puede llamar cualquiera sin login.
select
  routine_name as funcion,
  grantee as rol_con_permiso,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name like 'sd\_%'
order by routine_name, grantee;
