-- Create user activity logs table
CREATE TABLE public.user_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    activity_type TEXT NOT NULL,
    activity_description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX idx_user_activity_logs_user_id ON public.user_activity_logs(user_id);
CREATE INDEX idx_user_activity_logs_created_at ON public.user_activity_logs(created_at DESC);
CREATE INDEX idx_user_activity_logs_activity_type ON public.user_activity_logs(activity_type);

-- Enable RLS
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view all logs
CREATE POLICY "Admins can view all activity logs"
ON public.user_activity_logs FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- System can insert logs (used by triggers and functions)
CREATE POLICY "System can insert activity logs"
ON public.user_activity_logs FOR INSERT
WITH CHECK (true);

-- Create function to log user activity
CREATE OR REPLACE FUNCTION public.log_user_activity(
    _user_id UUID,
    _activity_type TEXT,
    _activity_description TEXT,
    _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO public.user_activity_logs (
        user_id,
        activity_type,
        activity_description,
        metadata
    ) VALUES (
        _user_id,
        _activity_type,
        _activity_description,
        _metadata
    )
    RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$;

-- Create trigger to log conversation creation
CREATE OR REPLACE FUNCTION public.log_conversation_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.log_user_activity(
        NEW.user_id,
        'conversation_created',
        'User created a new conversation',
        jsonb_build_object('conversation_id', NEW.id, 'title', NEW.title)
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_conversation_created
AFTER INSERT ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.log_conversation_created();

-- Create trigger to log profile approval changes
CREATE OR REPLACE FUNCTION public.log_profile_approval_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.approved IS DISTINCT FROM NEW.approved THEN
        PERFORM public.log_user_activity(
            NEW.id,
            CASE WHEN NEW.approved THEN 'user_approved' ELSE 'user_rejected' END,
            CASE WHEN NEW.approved 
                THEN 'User account was approved' 
                ELSE 'User account was rejected' 
            END,
            jsonb_build_object(
                'approved_by', NEW.approved_by,
                'approved_at', NEW.approved_at
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_approval_change
AFTER UPDATE ON public.profiles
FOR EACH ROW
WHEN (OLD.approved IS DISTINCT FROM NEW.approved)
EXECUTE FUNCTION public.log_profile_approval_change();