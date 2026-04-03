
CREATE TABLE public.gem_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  gem_reward integer NOT NULL DEFAULT 5,
  cooldown_hours integer NOT NULL DEFAULT 24,
  category text NOT NULL DEFAULT 'daily',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gem_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage gem tasks" ON public.gem_tasks
FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Gem tasks readable" ON public.gem_tasks
FOR SELECT TO authenticated USING (true);

CREATE TABLE public.gem_task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gem_task_id uuid NOT NULL REFERENCES public.gem_tasks(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gem_task_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own completions" ON public.gem_task_completions
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own completions" ON public.gem_task_completions
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
