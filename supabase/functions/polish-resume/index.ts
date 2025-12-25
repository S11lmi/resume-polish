import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FREE_USAGE_LIMIT = 50;

// 内置免费 API 配置（存储在 secrets 中，用户无法获取）
const FREE_API_CONFIG = {
  apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
  model: 'Qwen/Qwen2.5-7B-Instruct',
};

const SYSTEM_PROMPT = `你是一位来自一线互联网大厂（如 Google, 阿里, 字节）的资深技术面试官。你的目标是将候选人平淡的描述改写为强有力的简历 Bullet Points。

你必须遵循以下规则：
1. 必须使用强动词开头（如：重构、主导、设计、优化、推动、落地、负责、搭建、构建）
2. 必须包含技术关键词
3. 遵循 STAR 法则（Situation, Task, Action, Result）
4. 语言专业、简洁有力

请根据用户输入，生成三个版本的简历话术：

**版本A - 标准专业版**：语言简练、用词专业，突出技术能力。

**版本B - 数据驱动版**：重点强调量化成果。你必须大胆假设并插入占位符如 [X]%、[Y]ms、[Z]倍 等，提示用户回填真实数据。例如："将响应时间从 [X]ms 降低至 [Y]ms"。

**版本C - 专家/架构师版**：强调技术深度、系统设计能力、商业价值和团队影响力。适合高级工程师或架构师级别。

请严格按照以下 JSON 格式返回，不要添加任何其他内容：
{
  "standard": "版本A的内容",
  "datadriven": "版本B的内容", 
  "expert": "版本C的内容"
}`;

interface AIProvider {
  name: string;
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface RequestBody {
  input: string;
  provider?: string;
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  deviceId?: string;
}

interface UsageInfo {
  usageCount: number;
  remaining: number;
  isFree: boolean;
}

// 获取或创建设备使用记录
async function getOrCreateUsage(supabase: any, deviceId: string): Promise<{ count: number; error?: string }> {
  try {
    // 尝试获取现有记录
    const { data: existing, error: selectError } = await supabase
      .from('usage_tracking')
      .select('usage_count')
      .eq('device_id', deviceId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      console.error('Error fetching usage:', selectError);
      return { count: 0, error: selectError.message };
    }

    if (existing) {
      return { count: existing.usage_count };
    }

    // 创建新记录
    const { error: insertError } = await supabase
      .from('usage_tracking')
      .insert({ device_id: deviceId, usage_count: 0 });

    if (insertError) {
      console.error('Error creating usage record:', insertError);
      return { count: 0, error: insertError.message };
    }

    return { count: 0 };
  } catch (e) {
    console.error('Usage tracking error:', e);
    return { count: 0, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// 增加使用次数
async function incrementUsage(supabase: any, deviceId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('usage_tracking')
      .update({ usage_count: supabase.rpc ? undefined : undefined })
      .eq('device_id', deviceId);

    // 使用 SQL 递增
    await supabase.rpc('increment_usage', { p_device_id: deviceId }).catch(async () => {
      // 如果 RPC 不存在，使用普通更新
      const { data: current } = await supabase
        .from('usage_tracking')
        .select('usage_count')
        .eq('device_id', deviceId)
        .single();
      
      if (current) {
        await supabase
          .from('usage_tracking')
          .update({ usage_count: current.usage_count + 1 })
          .eq('device_id', deviceId);
      }
    });
  } catch (e) {
    console.error('Error incrementing usage:', e);
  }
}

function getProvider(body: RequestBody, freeApiKey: string): AIProvider {
  const providerName = body.provider || 'free';
  
  switch (providerName) {
    case 'openai':
      const openaiKey = body.apiKey;
      if (!openaiKey) throw new Error('请配置 OpenAI API Key');
      return {
        name: 'openai',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        apiKey: openaiKey,
        model: body.model || 'gpt-4o-mini',
      };
    
    case 'custom':
      const customKey = body.apiKey;
      let customUrl = body.apiUrl;
      if (!customKey || !customUrl) throw new Error('请配置自定义 API URL 和 Key');
      if (!customUrl.endsWith('/chat/completions')) {
        customUrl = customUrl.replace(/\/$/, '') + '/chat/completions';
      }
      return {
        name: 'custom',
        apiUrl: customUrl,
        apiKey: customKey,
        model: body.model || 'default',
      };
    
    case 'free':
    default:
      return {
        name: 'free',
        apiUrl: FREE_API_CONFIG.apiUrl,
        apiKey: freeApiKey,
        model: FREE_API_CONFIG.model,
      };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const { input, deviceId } = body;
    
    if (!input || typeof input !== 'string') {
      return new Response(
        JSON.stringify({ error: '请输入有效的工作描述' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 创建 Supabase 客户端
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const providerName = body.provider || 'free';
    let usageInfo: UsageInfo | null = null;

    // 如果使用免费服务，检查使用次数
    if (providerName === 'free') {
      if (!deviceId) {
        return new Response(
          JSON.stringify({ error: '缺少设备标识' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { count, error: usageError } = await getOrCreateUsage(supabase, deviceId);
      
      if (usageError) {
        console.error('Usage tracking error:', usageError);
      }

      const remaining = FREE_USAGE_LIMIT - count;
      usageInfo = { usageCount: count, remaining, isFree: true };

      if (count >= FREE_USAGE_LIMIT) {
        return new Response(
          JSON.stringify({ 
            error: '免费次数已用完，请在设置中配置自己的 API',
            usageInfo: { ...usageInfo, remaining: 0 }
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('Processing input:', input.substring(0, 50), 'Provider:', providerName);

    // 获取免费 API Key
    const freeApiKey = Deno.env.get('SILICONFLOW_API_KEY') || '';
    
    const provider = getProvider(body, freeApiKey);
    console.log('Using provider:', provider.name, 'Model:', provider.model);

    const response = await fetch(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `请润色以下工作描述：\n\n${input}` }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: '请求过于频繁，请稍后再试', usageInfo }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI 服务额度已用完，请稍后再试', usageInfo }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'API Key 无效，请检查配置', usageInfo }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error('AI service error');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    console.log('AI response received, length:', content?.length);

    if (!content) {
      throw new Error('Empty response from AI');
    }

    // 如果是免费服务，增加使用次数
    if (providerName === 'free' && deviceId) {
      await incrementUsage(supabase, deviceId);
      if (usageInfo) {
        usageInfo.usageCount += 1;
        usageInfo.remaining -= 1;
      }
    }

    // Parse the JSON response from AI
    let result;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      result = {
        standard: content,
        datadriven: content,
        expert: content
      };
    }

    return new Response(JSON.stringify({ ...result, usageInfo }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in polish-resume function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : '服务暂时不可用，请稍后再试' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
