-- ════════════════════════════════════════════════════════════════
-- FIX ROLES DE ADMIN - SmartDispatch (sep-2026)
-- Cierra el hueco encontrado: las 4 funciones sd_admin_* tenian
-- EXECUTE otorgado a PUBLIC y ninguna verificaba quien las llamaba -
-- cualquiera con la anon key (publica, esta en el codigo del cliente)
-- podia listar/crear/resetear/desactivar usuarios sin haber iniciado
-- sesion nunca. Ver diagnostico completo en docs/check_rls.sql.
--
-- Requiere correr esto en el SQL Editor de Supabase, UNA sola vez.
-- Orden importa: 1) columna role, 2) helper de verificacion,
-- 3) las 4 funciones nuevas (con p_actor_id), 4) borrar las firmas
-- viejas sin p_actor_id (si no se borran, siguen siendo llamables
-- y todo este esfuerzo no sirve de nada).
-- ════════════════════════════════════════════════════════════════

-- 1) Columna de rol. Todo usuario existente arranca en 'user' - ver
--    PASO MANUAL al final de este script, es obligatorio antes de
--    que el panel de Usuarios vuelva a funcionar para alguien.
alter table public.app_users
  add column if not exists role text not null default 'user';

alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users
  add constraint app_users_role_check check (role in ('user','admin'));

-- 2) Helper reutilizable - DRY, un solo lugar que decide "quien puede
--    hacer cosas de admin" en vez de repetir la misma logica 4 veces.
create or replace function public._sd_assert_admin(p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role   text;
  v_active boolean;
begin
  if p_actor_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select role, active into v_role, v_active
  from public.app_users where id = p_actor_id;
  if v_role is distinct from 'admin' or coalesce(v_active, false) = false then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public._sd_assert_admin(uuid) from public;
grant execute on function public._sd_assert_admin(uuid) to anon, authenticated;

-- 3) Las 4 funciones sensibles, ahora con p_actor_id como PRIMER
--    argumento y el guard como primera linea del cuerpo.

create or replace function public.sd_admin_list_users(p_actor_id uuid)
returns table(id uuid, username text, display_name text, capture_name text,
              active boolean, first_login_at timestamptz, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._sd_assert_admin(p_actor_id);
  return query
    select a.id, a.username, a.display_name, a.capture_name, a.active,
           a.first_login_at, a.created_at
    from public.app_users a order by a.display_name;
end;
$function$;

create or replace function public.sd_admin_create_user(
  p_actor_id uuid, p_username text, p_password text, p_display_name text, p_capture_name text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  perform public._sd_assert_admin(p_actor_id);
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

create or replace function public.sd_admin_set_active(p_actor_id uuid, p_user_id uuid, p_active boolean)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._sd_assert_admin(p_actor_id);
  update public.app_users set active = p_active, updated_at = now() where id = p_user_id;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end;
$function$;

create or replace function public.sd_admin_reset_password(p_actor_id uuid, p_user_id uuid, p_new_password text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._sd_assert_admin(p_actor_id);
  if length(p_new_password) < 4 then return json_build_object('ok', false, 'error', 'too_short'); end if;
  update public.app_users set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    updated_at = now() where id = p_user_id;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end;
$function$;

-- 4) Borrar las firmas VIEJAS (sin p_actor_id) - sin esto, siguen
--    siendo llamables sin ningun chequeo y nada de lo de arriba sirve.
drop function if exists public.sd_admin_list_users();
drop function if exists public.sd_admin_create_user(text, text, text, text);
drop function if exists public.sd_admin_set_active(uuid, boolean);
drop function if exists public.sd_admin_reset_password(uuid, text);

-- 5) Defensa extra: quitar el EXECUTE de PUBLIC en las funciones
--    nuevas (quedan solo para anon/authenticated - que es como se
--    conecta siempre esta app, ver nota en auth.js sobre auth custom).
revoke all on function public.sd_admin_list_users(uuid) from public;
revoke all on function public.sd_admin_create_user(uuid, text, text, text, text) from public;
revoke all on function public.sd_admin_set_active(uuid, uuid, boolean) from public;
revoke all on function public.sd_admin_reset_password(uuid, uuid, text) from public;

grant execute on function public.sd_admin_list_users(uuid) to anon, authenticated;
grant execute on function public.sd_admin_create_user(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.sd_admin_set_active(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.sd_admin_reset_password(uuid, uuid, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- PASO MANUAL OBLIGATORIO - correr DESPUES de todo lo de arriba.
-- Sin esto, NADIE puede usar el panel de Usuarios (todos quedan en
-- role='user' por default) - reemplaza 'tu_usuario' por el username
-- real de quien SI debe tener permisos de admin.
-- ════════════════════════════════════════════════════════════════
-- update public.app_users set role = 'admin' where username = 'tu_usuario';
