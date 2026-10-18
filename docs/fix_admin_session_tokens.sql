-- ════════════════════════════════════════════════════════════════
-- FIX SPOOFING DE IDENTIDAD EN RPCs DE ADMIN - SmartDispatch (oct-2026)
--
-- Problema (ver docs/fix_admin_roles.sql, el fix de sep-2026): las 4
-- funciones sd_admin_* reciben p_actor_id (un uuid) desde el CLIENTE
-- y solo verifican "¿ese uuid pertenece a una fila con role='admin'?".
-- Nunca verifican que quien llama en verdad SEA ese uuid - cualquiera
-- con la anon key (publica) que consiga/adivine el uuid de un admin
-- (viaja en texto plano en cada request de red y en localStorage de
-- la maquina del admin) puede llamar estas funciones para siempre,
-- sin contraseña, sin login, sin pasar por la app.
--
-- Fix: las 4 funciones dejan de aceptar p_actor_id y pasan a exigir
-- p_session_token - un token opaco de 256 bits que SOLO se emite
-- tras re-validar usuario+contraseña (sd_admin_login) y que expira
-- solo (4h, con renovacion deslizante en cada uso valido). Adivinar
-- un uuid ya no alcanza: hace falta la contraseña real del admin en
-- el momento de pedir el token.
--
-- No toca sd_login/sd_change_password/sd_update_profile - son aditivos,
-- cero riesgo de romper el login normal.
--
-- Requiere correr esto en el SQL Editor de Supabase, UNA sola vez,
-- DESPUES de fix_admin_roles.sql (asume que la columna app_users.role
-- y password_hash ya existen).
-- ════════════════════════════════════════════════════════════════

-- 1) Tabla de sesiones de admin. RLS encendido SIN policies = acceso
--    cero vía PostgREST con la anon key; solo las funciones
--    SECURITY DEFINER de abajo pueden leer/escribir esta tabla.
create table if not exists public.app_admin_sessions (
  token      text primary key,
  user_id    uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists app_admin_sessions_expires_idx
  on public.app_admin_sessions (expires_at);

alter table public.app_admin_sessions enable row level security;
revoke all on public.app_admin_sessions from public, anon, authenticated;

-- 2) sd_admin_login — re-valida usuario+contraseña (el usuario YA
--    logueado confirma que es quien dice ser) y, si tiene role='admin'
--    y está activo, emite un token nuevo. Mensaje de error genérico
--    sin importar la causa exacta (no dar pistas a quien adivina).
create or replace function public.sd_admin_login(p_username text, p_password text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user   record;
  v_token  text;
begin
  select id, password_hash, role, active
  into v_user
  from public.app_users
  where username = lower(trim(p_username));

  if v_user is null
     or coalesce(v_user.active, false) = false
     or v_user.password_hash is null
     or extensions.crypt(p_password, v_user.password_hash) is distinct from v_user.password_hash
  then
    return json_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  if v_user.role is distinct from 'admin' then
    return json_build_object('ok', false, 'error', 'not_admin');
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.app_admin_sessions (token, user_id, expires_at)
  values (v_token, v_user.id, now() + interval '4 hours');

  -- Housekeeping barato: purga sesiones vencidas en cada login nuevo,
  -- asi la tabla no crece sin limite sin necesitar un cron aparte.
  delete from public.app_admin_sessions where expires_at < now();

  return json_build_object('ok', true, 'token', v_token, 'expiresInMs', 4 * 60 * 60 * 1000);
end;
$function$;

revoke all on function public.sd_admin_login(text, text) from public;
grant execute on function public.sd_admin_login(text, text) to anon, authenticated;

-- 3) sd_admin_logout — revoca un token antes de que expire solo
--    (llamar al cerrar sesión / cambiar de usuario en el cliente).
create or replace function public.sd_admin_logout(p_session_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.app_admin_sessions where token = p_session_token;
end;
$function$;

revoke all on function public.sd_admin_logout(text) from public;
grant execute on function public.sd_admin_logout(text) to anon, authenticated;

-- 4) Helper reutilizable que reemplaza a _sd_assert_admin(uuid) — ya
--    no confía en un id que manda el cliente, confía en un token que
--    solo pudo haberse emitido tras una contraseña correcta. Re-chequea
--    rol/activo EN CADA llamada (si a alguien le bajan el rol a mitad
--    de turno, el token emitido antes deja de servir en el siguiente
--    uso) y desliza la expiración otras 4h para no cortar a un admin
--    con trabajo real a mitad de tarea.
create or replace function public._sd_assert_admin_session(p_session_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_role    text;
  v_active  boolean;
begin
  if p_session_token is null or length(p_session_token) = 0 then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select user_id into v_user_id
  from public.app_admin_sessions
  where token = p_session_token and expires_at > now();

  if v_user_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select role, active into v_role, v_active
  from public.app_users where id = v_user_id;
  if v_role is distinct from 'admin' or coalesce(v_active, false) = false then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.app_admin_sessions set expires_at = now() + interval '4 hours'
  where token = p_session_token;

  return v_user_id;
end;
$function$;

revoke all on function public._sd_assert_admin_session(text) from public;
grant execute on function public._sd_assert_admin_session(text) to anon, authenticated;

-- 5) Las 4 funciones sensibles, ahora con p_session_token (text) en
--    vez de p_actor_id (uuid) como primer argumento.

create or replace function public.sd_admin_list_users(p_session_token text)
returns table(id uuid, username text, display_name text, capture_name text,
              active boolean, first_login_at timestamptz, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._sd_assert_admin_session(p_session_token);
  return query
    select a.id, a.username, a.display_name, a.capture_name, a.active,
           a.first_login_at, a.created_at
    from public.app_users a order by a.display_name;
end;
$function$;

create or replace function public.sd_admin_create_user(
  p_session_token text, p_username text, p_password text, p_display_name text, p_capture_name text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  perform public._sd_assert_admin_session(p_session_token);
  if p_username is null or length(trim(p_username)) = 0 then
    return json_build_object('ok', false, 'error', 'missing_username');
  end if;
  if exists (select 1 from public.app_users where username = lower(trim(p_username))) then
    return json_build_object('ok', false, 'error', 'duplicate_username');
  end if;
  insert into public.app_users (username, password_hash, display_name, capture_name)
  values (lower(trim(p_username)), extensions.crypt(p_password, extensions.gen_salt('bf')),
          trim(p_display_name), trim(p_capture_name))
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end;
$function$;

create or replace function public.sd_admin_set_active(p_session_token text, p_user_id uuid, p_active boolean)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._sd_assert_admin_session(p_session_token);
  update public.app_users set active = p_active, updated_at = now() where id = p_user_id;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end;
$function$;

create or replace function public.sd_admin_reset_password(p_session_token text, p_user_id uuid, p_new_password text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._sd_assert_admin_session(p_session_token);
  if length(p_new_password) < 4 then return json_build_object('ok', false, 'error', 'too_short'); end if;
  update public.app_users set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    updated_at = now() where id = p_user_id;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end;
$function$;

-- 6) Borrar las firmas VIEJAS (con p_actor_id uuid) — sin esto, el
--    hueco que estamos cerrando sigue abierto en paralelo.
drop function if exists public.sd_admin_list_users(uuid);
drop function if exists public.sd_admin_create_user(uuid, text, text, text, text);
drop function if exists public.sd_admin_set_active(uuid, uuid, boolean);
drop function if exists public.sd_admin_reset_password(uuid, uuid, text);
drop function if exists public._sd_assert_admin(uuid);

-- 7) Defensa extra, mismo criterio que fix_admin_roles.sql paso 5.
revoke all on function public.sd_admin_list_users(text) from public;
revoke all on function public.sd_admin_create_user(text, text, text, text, text) from public;
revoke all on function public.sd_admin_set_active(text, uuid, boolean) from public;
revoke all on function public.sd_admin_reset_password(text, uuid, text) from public;

grant execute on function public.sd_admin_list_users(text) to anon, authenticated;
grant execute on function public.sd_admin_create_user(text, text, text, text, text) to anon, authenticated;
grant execute on function public.sd_admin_set_active(text, uuid, boolean) to anon, authenticated;
grant execute on function public.sd_admin_reset_password(text, uuid, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- Después de correr esto: actualizar el cliente (ya hecho en este
-- commit — ver src/features/auth.js y src/core/app.js) antes de que
-- alguien vuelva a abrir el panel de Usuarios, porque las firmas
-- viejas (p_actor_id) ya no existen.
-- ════════════════════════════════════════════════════════════════
