# 自部署指南 - Resume.polish()

本指南帮助你将项目部署到自己的 Supabase 和托管平台。

## 前置条件

- [Node.js](https://nodejs.org/) v20+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Git](https://git-scm.com/)
- 一个 [Supabase](https://supabase.com/) 账号
- 一个 [SiliconFlow](https://siliconflow.cn/) API Key（用于免费 AI 服务）

---

## 第一步：克隆项目

```bash
git clone <your-repo-url>
cd <project-folder>
npm install
```

---

## 第二步：创建 Supabase 项目

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)
2. 点击 **New Project**
3. 填写项目名称、数据库密码、选择区域
4. 等待项目创建完成（约 2 分钟）

### 获取项目凭证

在项目设置中找到：
- **Project URL** (例如: `https://xxxxx.supabase.co`)
- **Anon/Public Key** (在 API Settings 中)
- **Project ID** (URL 中的 `xxxxx` 部分)

---

## 第三步：配置数据库

在 Supabase Dashboard → **SQL Editor** 中运行以下 SQL：

```sql
-- 创建使用次数追踪表
CREATE TABLE public.usage_tracking (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 创建更新时间触发器
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_usage_tracking_updated_at
  BEFORE UPDATE ON public.usage_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 创建索引
CREATE INDEX idx_usage_tracking_device_id ON public.usage_tracking(device_id);

-- 禁用 RLS（或根据需要配置策略）
ALTER TABLE public.usage_tracking DISABLE ROW LEVEL SECURITY;
```

---

## 第四步：部署 Edge Function

### 4.1 登录 Supabase CLI

```bash
supabase login
```

### 4.2 链接项目

```bash
supabase link --project-ref <your-project-id>
```

### 4.3 配置 Secrets

```bash
# 添加 SiliconFlow API Key
supabase secrets set SILICONFLOW_API_KEY=<your-siliconflow-api-key>
```

### 4.4 部署函数

```bash
supabase functions deploy polish-resume --no-verify-jwt
```

> `--no-verify-jwt` 允许公开调用此函数

### 4.5 验证部署

部署成功后，你可以测试函数：

```bash
curl -X POST 'https://<project-id>.supabase.co/functions/v1/polish-resume' \
  -H 'Content-Type: application/json' \
  -d '{"input": "开发了一个网站", "provider": "free", "deviceId": "test-123"}'
```

---

## 第五步：配置前端环境变量

在项目根目录创建 `.env` 文件：

```env
VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
VITE_SUPABASE_PROJECT_ID=<your-project-id>
```

---

## 第六步：本地测试

```bash
npm run dev
```

访问 `http://localhost:5173` 测试应用。

---

## 第七步：部署到生产环境

### 选项 A：Vercel

1. 将代码推送到 GitHub
2. 在 [Vercel](https://vercel.com) 导入项目
3. 添加环境变量：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`
4. 部署

### 选项 B：Netlify

1. 将代码推送到 GitHub
2. 在 [Netlify](https://netlify.com) 导入项目
3. 添加环境变量（同上）
4. 部署

### 选项 C：Cloudflare Pages

1. 将代码推送到 GitHub
2. 在 [Cloudflare Pages](https://pages.cloudflare.com) 创建项目
3. 添加环境变量（同上）
4. 部署

---

## 管理 Secrets

部署后，你可以随时管理 API Keys：

### 查看 Secrets

```bash
supabase secrets list
```

### 更新 Secret

```bash
supabase secrets set SILICONFLOW_API_KEY=<new-api-key>
```

### 删除 Secret

```bash
supabase secrets unset SILICONFLOW_API_KEY
```

或在 Supabase Dashboard → **Edge Functions** → **Secrets** 中管理。

---

## 常见问题

### Q: Edge Function 返回 "Failed to send a request"

**可能原因：**
1. Edge Function 未部署
2. 环境变量配置错误
3. CORS 问题

**解决方法：**
1. 确认函数已部署：`supabase functions list`
2. 检查环境变量是否正确
3. 检查浏览器控制台的具体错误信息

### Q: 返回 "API Key 无效"

**解决方法：**
1. 确认 `SILICONFLOW_API_KEY` 已设置：`supabase secrets list`
2. 确认 API Key 有效且有余额

### Q: 免费次数不工作

**解决方法：**
1. 确认 `usage_tracking` 表已创建
2. 检查表是否有正确的权限

---

## 技术架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│  Supabase Edge   │────▶│  SiliconFlow    │
│   (React/Vite)  │     │  Function        │     │  AI API         │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Supabase        │
                        │  PostgreSQL      │
                        └──────────────────┘
```

---

## 相关链接

- [Supabase 文档](https://supabase.com/docs)
- [Supabase CLI 参考](https://supabase.com/docs/reference/cli)
- [SiliconFlow API](https://docs.siliconflow.cn/)
- [Vite 文档](https://vitejs.dev/)

---

## 许可证

MIT License
