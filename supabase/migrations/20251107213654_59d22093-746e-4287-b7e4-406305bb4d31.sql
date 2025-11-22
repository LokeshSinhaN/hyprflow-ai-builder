-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles (prevents recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Create admin check function
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
$$;

-- RLS policy: Users can view their own roles
CREATE POLICY "Users can view own roles"
ON public.user_roles FOR SELECT
USING (auth.uid() = user_id);

-- RLS policy: Only admins can manage roles
CREATE POLICY "Admins can manage roles"
ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Add approval fields to profiles table
ALTER TABLE public.profiles 
ADD COLUMN approved BOOLEAN DEFAULT false,
ADD COLUMN approved_at TIMESTAMPTZ,
ADD COLUMN approved_by UUID REFERENCES auth.users(id);

-- Update existing users to be approved (migration safety)
UPDATE public.profiles SET approved = true WHERE id IS NOT NULL;

-- Update handle_new_user function to set initial approval status
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, approved)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    false
  );
  RETURN NEW;
END;
$$;

-- Seed initial admin for sanskrutin@hyprtask.com
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM public.profiles
WHERE email = 'sanskrutin@hyprtask.com'
ON CONFLICT DO NOTHING;

-- Approve the initial admin user
UPDATE public.profiles 
SET approved = true, approved_at = now()
WHERE email = 'sanskrutin@hyprtask.com';

-- Update RLS policies on profiles to respect approval status
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

CREATE POLICY "Approved users can view own profile"
ON public.profiles FOR SELECT
USING (auth.uid() = id AND approved = true);

CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update profiles"
ON public.profiles FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

-- Update conversations policies to check approval
DROP POLICY IF EXISTS "Users can create their own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can view their own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can update their own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can delete their own conversations" ON public.conversations;

CREATE POLICY "Approved users can create conversations"
ON public.conversations FOR INSERT
WITH CHECK (
  auth.uid() = user_id AND 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND approved = true
  )
);

CREATE POLICY "Approved users can view conversations"
ON public.conversations FOR SELECT
USING (
  auth.uid() = user_id AND 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND approved = true
  )
);

CREATE POLICY "Approved users can update conversations"
ON public.conversations FOR UPDATE
USING (
  auth.uid() = user_id AND 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND approved = true
  )
);

CREATE POLICY "Approved users can delete conversations"
ON public.conversations FOR DELETE
USING (
  auth.uid() = user_id AND 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND approved = true
  )
);

-- Update chat_messages policies to check approval
DROP POLICY IF EXISTS "Users can create messages in their conversations" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can delete messages in their conversations" ON public.chat_messages;

CREATE POLICY "Approved users can create messages"
ON public.chat_messages FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.profiles p ON p.id = c.user_id
    WHERE c.id = chat_messages.conversation_id 
    AND c.user_id = auth.uid()
    AND p.approved = true
  )
);

CREATE POLICY "Approved users can view messages"
ON public.chat_messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.profiles p ON p.id = c.user_id
    WHERE c.id = chat_messages.conversation_id 
    AND c.user_id = auth.uid()
    AND p.approved = true
  )
);

CREATE POLICY "Approved users can delete messages"
ON public.chat_messages FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.profiles p ON p.id = c.user_id
    WHERE c.id = chat_messages.conversation_id 
    AND c.user_id = auth.uid()
    AND p.approved = true
  )
);