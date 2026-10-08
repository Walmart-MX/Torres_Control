-- ════════════════════════════════════════════════════════════════
-- TABLA cita_patterns — SmartDispatch (Fase 1, catálogo de variantes
-- de cita self-service, ver src/features/citas/).
--
-- Permite agregar formatos nuevos de "cita" (ej. separador con punto,
-- año a 2 dígitos, orden mes/día, hora con "h") desde el Centro de
-- Mantenimiento de la app, SIN tocar código ni desplegar nada. El
-- formato estándar (DD/MM/AAAA o DD-MM-AAAA, hora opcional HH:MM)
-- sigue viviendo hardcodeado en processors/pdf.js y SIEMPRE se prueba
-- primero — esta tabla es solo el catálogo de variantes adicionales.
--
-- Requiere correr esto en el SQL Editor de Supabase, UNA sola vez.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.cita_patterns (
  id                  uuid primary key default gen_random_uuid(),
  label               text,
  date_order          text not null default 'DMY' check (date_order in ('DMY','MDY','YMD')),
  date_sep            text not null default '/'   check (date_sep in ('/','-','.')),
  year_digits         int  not null default 4     check (year_digits in (2,4)),
  allow_single_digit  boolean not null default false,
  has_time            boolean not null default false,
  time_sep            text check (time_sep in (':','.','h')),
  example_text        text,
  active              boolean not null default true,
  created_by          text,
  created_at          timestamptz not null default now()
);

-- Borrado lógico únicamente (ver CitaPatternStore.deletePattern) — una
-- variante "quitada" se desactiva, nunca se borra físicamente, para
-- conservar el rastro de por qué existió (mismo criterio de auditoría
-- que admin_incidents.status).
alter table public.cita_patterns enable row level security;

-- Misma superficie de acceso que catalog_ventana_recibo/catalog_pool_real/
-- admin_incidents: esta app usa autenticación propia (app_users), no la
-- de Supabase — el rol 'anon' es el único con el que el cliente se
-- conecta siempre (ver auth.js). Sin estas policies, loadAll()/addPattern()
-- fallarían en silencio con 0 filas (ver nota en catalog-store.js sobre
-- diagnóstico de RLS).
-- CREATE POLICY nunca soporto IF NOT EXISTS en Postgres (no es un tema
-- de version) -- se usa el patron estandar drop-si-existe + create.
drop policy if exists "cita_patterns_select_anon" on public.cita_patterns;
create policy "cita_patterns_select_anon" on public.cita_patterns
  for select to anon using (true);

drop policy if exists "cita_patterns_insert_anon" on public.cita_patterns;
create policy "cita_patterns_insert_anon" on public.cita_patterns
  for insert to anon with check (true);

drop policy if exists "cita_patterns_update_anon" on public.cita_patterns;
create policy "cita_patterns_update_anon" on public.cita_patterns
  for update to anon using (true) with check (true);
