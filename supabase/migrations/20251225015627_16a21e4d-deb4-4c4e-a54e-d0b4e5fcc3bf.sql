-- 创建使用次数追踪表
CREATE TABLE public.usage_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 启用 RLS
ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

-- 允许任何人读取和更新自己的设备记录（通过边缘函数使用 service role）
-- 由于我们使用 service role key 在边缘函数中操作，这里不需要复杂的 RLS 策略
CREATE POLICY "Allow service role full access" 
ON public.usage_tracking 
FOR ALL 
USING (true)
WITH CHECK (true);

-- 创建更新时间戳的函数（如果不存在）
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 创建触发器
CREATE TRIGGER update_usage_tracking_updated_at
BEFORE UPDATE ON public.usage_tracking
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();