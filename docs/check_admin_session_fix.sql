-- ════════════════════════════════════════════════════════════════
-- VERIFICACION POST-FIX - sesiones de admin (oct-2026)
-- Solo LECTURA (salvo el paso 5, que genera un valor random de prueba
-- y no escribe nada en ninguna tabla). Pegar completo en el SQL
-- Editor de Supabase y revisar cada bloque de resultados.
-- ════════════════════════════════════════════════════════════════

-- 1) La tabla de sesiones existe y tiene RLS encendido.
--    Esperado: 1 fila, rls_encendido = true.
select c.relname as tabla, c.relrowsecurity as rls_encendido,
       (select count(*) from pg_policies p where p.tablename = c.relname) as num_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'app_admin_sessions';
-- num_policies debe salir 0 -> sin policies, nadie entra via API REST
-- directo (anon/authenticated), solo las funciones de abajo.

-- 2) Confirma que anon/authenticated NO tienen permisos directos sobre
--    la tabla de sesiones (defensa en profundidad, además del RLS).
--    Esperado: 0 filas.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'app_admin_sessions'
  and grantee in ('anon', 'authenticated');

-- 3) Las funciones nuevas existen con la firma correcta (p_session_token
--    text como primer argumento, NO p_actor_id uuid).
--    Esperado: 6 filas (sd_admin_login, sd_admin_logout,
--    _sd_assert_admin_session, sd_admin_list_users, sd_admin_create_user,
--    sd_admin_set_active, sd_admin_reset_password — pueden ser 7 según
--    como cuente pg_proc duplicados de overload, pero NINGUNA debe
--    mostrar "uuid" como primer argumento en la columna argumentos).
select p.proname as funcion, pg_get_function_identity_arguments(p.oid) as argumentos
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'sd\_admin\_%' or p.proname = '_sd_assert_admin_session')
order by p.proname;

-- 4) Las firmas VIEJAS (con p_actor_id uuid) deben haber desaparecido.
--    Esperado: 0 filas. Si sale algo aquí, el fix quedó a medias — el
--    hueco de spoofing sigue abierto en paralelo.
select p.proname as funcion_vieja_todavia_viva, pg_get_function_identity_arguments(p.oid) as argumentos
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('sd_admin_list_users', 'sd_admin_create_user',
                     'sd_admin_set_active', 'sd_admin_reset_password', '_sd_assert_admin')
  and pg_get_function_identity_arguments(p.oid) ilike '%uuid%';

-- 5) Quien tiene permiso de EJECUTAR cada función nueva — debe incluir
--    anon y authenticated (así se conecta siempre esta app).
select routine_name as funcion, grantee as rol_con_permiso
from information_schema.routine_privileges
where routine_schema = 'public'
  and (routine_name like 'sd\_admin\_%' or routine_name = '_sd_assert_admin_session')
order by routine_name, grantee;

-- 6) pgcrypto/gen_random_bytes sigue disponible (lo usa sd_admin_login
--    para generar el token) — no escribe nada, solo muestra un ejemplo.
select encode(extensions.gen_random_bytes(8), 'hex') as ejemplo_de_token_de_prueba;
