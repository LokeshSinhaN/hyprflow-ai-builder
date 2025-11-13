import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const messageSchema = z.object({
  message: z.string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message must be less than 10,000 characters'),
  document: z.string().optional()
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const validation = messageSchema.safeParse(body);
    
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: validation.error.issues[0].message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { message, document } = validation.data;
    console.log('Received message:', message);
    console.log('Has document:', !!document);
    
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    console.log('Calling OpenAI API...');
    
    // Retry logic with exponential backoff
    let response;
    let lastError;
    const maxRetries = 3;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-5-mini-2025-08-07', // Using mini for lower rate limits
            messages: [
              {
                role: 'system',
                content: `You are a Python automation script generator. Generate complete, working Python scripts based on user requests. 
Include necessary imports, proper error handling, and clear comments. 
Focus on healthcare automation tasks like patient registration, insurance verification, claims submission, lab orders, appointments, and payment processing.
When a document is provided, analyze it carefully and generate Python scripts that automate the workflow described in the document.
Always return ONLY the Python code without any markdown formatting or explanations.`
              },
              {
                role: 'user',
                content: document 
                  ? `Here is an SOP workflow document:\n\n${document}\n\nBased on this document: ${message}`
                  : message
              }
            ],
            max_completion_tokens: 2000,
          }),
        });
        
        // If successful or not a rate limit error, break the retry loop
        if (response.ok || response.status !== 429) {
          break;
        }
        
        // If rate limited and not the last attempt, wait before retrying
        if (response.status === 429 && attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 2}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        lastError = await response.text();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`Request failed, waiting ${waitTime}ms before retry ${attempt + 2}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }
    }

    if (!response || !response.ok) {
      const errorText = lastError || (response ? await response.text() : 'Unknown error');
      console.error('OpenAI API error:', response?.status, errorText);
      
      if (response?.status === 429) {
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        if (LOVABLE_API_KEY) {
          console.log('Rate limited by OpenAI. Falling back to Lovable AI gateway...');
          try {
            const fallback = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  {
                    role: 'system',
                    content: `You are a Python automation script generator. Generate complete, working Python scripts based on user requests. \nInclude necessary imports, proper error handling, and clear comments. \nFocus on healthcare automation tasks like patient registration, insurance verification, claims submission, lab orders, appointments, and payment processing.\nAlways return ONLY the Python code without any markdown formatting or explanations.`,
                  },
                  { role: 'user', content: message },
                ],
              }),
            });

            if (fallback.ok) {
              const j = await fallback.json();
              const script = j.choices?.[0]?.message?.content ?? '';
              return new Response(JSON.stringify({ script }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            } else {
              console.error('Lovable AI fallback failed:', fallback.status, await fallback.text());
            }
          } catch (e) {
            console.error('Lovable AI fallback error:', e);
          }
        }

        return new Response(
          JSON.stringify({
            error:
              'OpenAI rate limit reached. Please check your API quota at platform.openai.com or wait a moment and try again.',
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      
      if (response?.status === 401) {
        return new Response(
          JSON.stringify({ 
            error: 'Invalid OpenAI API key. Please check your API key configuration.' 
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`OpenAI API error: ${response?.status || 'unknown'} - ${errorText}`);
    }

    const data = await response.json();
    console.log('OpenAI response received');
    
    const generatedScript = data.choices[0].message.content;

    return new Response(
      JSON.stringify({ script: generatedScript }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in generate-script function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
