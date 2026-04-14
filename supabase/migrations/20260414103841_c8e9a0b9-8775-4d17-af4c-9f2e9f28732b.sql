
-- Add lifecycle columns to challenges
ALTER TABLE public.challenges
  ADD COLUMN is_repeatable boolean NOT NULL DEFAULT true,
  ADD COLUMN expires_at timestamptz;

-- Create challenge completions table
CREATE TABLE public.challenge_completions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, challenge_id)
);

ALTER TABLE public.challenge_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own challenge completions"
  ON public.challenge_completions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own challenge completions"
  ON public.challenge_completions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
