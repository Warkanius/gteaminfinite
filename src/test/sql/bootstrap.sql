CREATE TYPE content_status AS ENUM ('draft','scheduled','active','disabled','archived');
CREATE TYPE app_role AS ENUM ('admin','player');
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '11111111-1111-1111-1111-111111111111'::uuid $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
