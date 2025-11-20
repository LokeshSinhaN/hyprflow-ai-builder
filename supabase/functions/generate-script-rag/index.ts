import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateRequest {
  message: string;
  conversationId: string;
}

// Simple hash-based embedding (same as process-sop)
function generateSimpleEmbedding(text: string): number[] {
  const vector = new Array(384).fill(0);
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    vector[i % 384] = (vector[i % 384] + charCode) % 100;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / magnitude);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, conversationId }: GenerateRequest = await req.json();
    console.log('Generating script for message:', message);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const qdrantUrl = Deno.env.get('QDRANT_URL')!;
    const qdrantApiKey = Deno.env.get('QDRANT_API_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user's SOPs
    const { data: conversation } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', conversationId)
      .single();

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const { data: sops } = await supabase
      .from('sop_documents')
      .select('id')
      .eq('user_id', conversation.user_id)
      .eq('status', 'indexed');

    // Generate query embedding
    const queryEmbedding = generateSimpleEmbedding(message);

    // Search Qdrant for relevant chunks
    let relevantChunks: string[] = [];
    
    if (sops && sops.length > 0) {
      console.log(`Searching ${sops.length} SOPs in Qdrant...`);
      
      const searchResponse = await fetch(`${qdrantUrl}/collections/sop_chunks/points/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': qdrantApiKey,
        },
        body: JSON.stringify({
          vector: queryEmbedding,
          limit: 5,
          with_payload: true,
        }),
      });

      if (searchResponse.ok) {
        const searchResults = await searchResponse.json();
        relevantChunks = searchResults.result
          .filter((r: any) => r.score > 0.3)
          .map((r: any) => r.payload.content);
        console.log(`Found ${relevantChunks.length} relevant chunks`);
      }
    }

    // Construct enhanced prompt with context
    const context = relevantChunks.length > 0
      ? `\n\nRelevant SOP Context:\n${relevantChunks.join('\n\n---\n\n')}`
      : '';

    const systemPrompt = `You are an expert automation engineer. Generate TWO complete, production-ready automation scripts based on the user's request${context ? ' and the provided SOP documentation' : ''}.

Return your response in this EXACT format:

=== PYTHON_SCRIPT ===
[Complete Python script using Selenium WebDriver]
=== END_PYTHON_SCRIPT ===

=== PLAYWRIGHT_SCRIPT ===
[Complete Node.js Playwright script]
=== END_PLAYWRIGHT_SCRIPT ===

Requirements:
- Both scripts must be complete and executable
- Include all necessary imports and setup
- Add error handling and logging
- Use the SOP context to inform the automation steps
- Python script: Use Selenium WebDriver with proper waits
- Playwright script: Use async/await with proper error handling`;

    const userPrompt = `${message}${context}`;

    console.log('Calling Gemini 2.5 Flash...');
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const generatedContent = aiData.choices[0].message.content;

    console.log('Script generation complete');

    return new Response(
      JSON.stringify({ 
        scripts: generatedContent,
        chunksUsed: relevantChunks.length 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in generate-script-rag:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
