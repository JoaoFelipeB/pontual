-- =====================================================================
-- VetCare — schema (Supabase / PostgreSQL 15+)
--
-- Security model:
--   * Every table has Row Level Security enabled and NO policies, so the
--     tables cannot be read or written directly by the app.
--   * The app talks to the database only through the functions in
--     0002_api.sql (SECURITY DEFINER). Each function checks who the user is,
--     which clinic they belong to and whether their role allows the action.
--   * Users and passwords live in Supabase Auth (auth.users). This schema
--     only stores the link user -> clinic -> role.
-- =====================================================================


create schema if not exists vc_private;

-- ---------------------------------------------------------------- clinics
create table public.clinics (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null check (length(trim(name)) between 2 and 120),
  timezone      text        not null default 'America/Sao_Paulo',
  open_time     time        not null default '07:00',
  close_time    time        not null default '20:00',
  slot_minutes  int         not null default 30 check (slot_minutes between 5 and 240),
  phone         text        null,
  created_at    timestamptz not null default now(),
  check (open_time < close_time)
);

-- ---------------------------------------------------------------- members
-- A member is a Supabase Auth user working at one clinic, with one role.
create table public.members (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid        not null references public.clinics(id) on delete cascade,
  user_id     uuid        not null unique references auth.users(id) on delete cascade,
  name        text        not null,
  email       text        not null,
  role        text        not null check (role in ('admin', 'recepcao', 'veterinario')),
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);
create index members_clinic_idx on public.members (clinic_id);

-- Invitations: the admin registers the e-mail and role; when that person
-- creates an account with the same e-mail, the trigger below links them.
create table public.invites (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid        not null references public.clinics(id) on delete cascade,
  email        text        not null,
  name         text        not null,
  role         text        not null check (role in ('admin', 'recepcao', 'veterinario')),
  created_by   uuid        null references public.members(id) on delete set null,
  accepted_at  timestamptz null,
  created_at   timestamptz not null default now()
);
create unique index invites_open_email_uq on public.invites (lower(email)) where accepted_at is null;

-- ---------------------------------------------------------------- catalog
create table public.health_plans (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid        not null references public.clinics(id) on delete cascade,
  code         text        not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name         text        not null,
  species      text        null check (species in ('cao', 'gato', 'outro')),
  description  text        null,
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  unique (clinic_id, code)
);

-- ---------------------------------------------------------------- patients
create table public.tutors (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid        not null references public.clinics(id) on delete cascade,
  name          text        not null,
  phone         text        not null,
  phone_digits  text        not null,
  email         text        null,
  notes         text        null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, phone_digits)
);
create index tutors_name_idx on public.tutors (clinic_id, lower(name));

create table public.animals (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid        not null references public.clinics(id) on delete cascade,
  tutor_id    uuid        not null references public.tutors(id) on delete cascade,
  name        text        not null,
  species     text        not null check (species in ('cao', 'gato', 'outro')),
  breed       text        null,
  sex         text        null check (sex in ('macho', 'femea')),
  birth_date  date        null,
  age_value   int         null check (age_value between 0 and 40),
  age_unit    text        not null default 'anos' check (age_unit in ('anos', 'meses')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index animals_tutor_name_uq on public.animals (tutor_id, lower(name));

-- ---------------------------------------------------------------- schedule
create table public.appointments (
  id                uuid primary key default gen_random_uuid(),
  number            bigint generated always as identity,
  clinic_id         uuid        not null references public.clinics(id) on delete cascade,
  tutor_id          uuid        not null references public.tutors(id),
  animal_id         uuid        not null references public.animals(id),
  vet_id            uuid        null references public.members(id) on delete set null,
  starts_on         date        not null,
  starts_at         time        not null,
  service_type      text        not null check (service_type in ('particular', 'plano')),
  health_plan_id    uuid        null references public.health_plans(id),
  reason            text        null,
  notes             text        null,
  status            text        not null default 'agendado'
                                check (status in ('agendado', 'concluido', 'cancelado', 'faltou')),
  created_by        uuid        null references public.members(id) on delete set null,
  updated_by        uuid        null references public.members(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((service_type = 'plano') = (health_plan_id is not null))
);
-- No two active bookings in the same slot of the same clinic, even under
-- concurrent requests.
create unique index appointments_slot_uq
  on public.appointments (clinic_id, starts_on, starts_at) where status = 'agendado';
create index appointments_list_idx on public.appointments (clinic_id, starts_on, starts_at, id);
create index appointments_animal_idx on public.appointments (animal_id, starts_on desc);

-- ---------------------------------------------------------------- audit
create table public.audit_log (
  id          bigint generated always as identity primary key,
  clinic_id   uuid        not null references public.clinics(id) on delete cascade,
  member_id   uuid        null references public.members(id) on delete set null,
  entity      text        not null,
  entity_id   uuid        not null,
  action      text        not null,
  data        jsonb       null,
  created_at  timestamptz not null default now()
);
create index audit_entity_idx on public.audit_log (clinic_id, entity, entity_id);

-- ---------------------------------------------------------------- lock down
alter table public.clinics      enable row level security;
alter table public.members      enable row level security;
alter table public.invites      enable row level security;
alter table public.health_plans enable row level security;
alter table public.tutors       enable row level security;
alter table public.animals      enable row level security;
alter table public.appointments enable row level security;
alter table public.audit_log    enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
