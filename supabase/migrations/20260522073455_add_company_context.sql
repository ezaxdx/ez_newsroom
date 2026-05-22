alter table public.curation_settings
  add column if not exists company_context text;
